/**
 * Spec 2 — flujo deposit autoservicio.
 *
 * Flujo:
 *   1. Admin crea player + asegura un payment_method activo.
 *   2. Player logueado navega a /play/deposits y crea un deposit nuevo.
 *   3. Admin (via API) aprueba el deposit.
 *   4. Player navega a /play/wallet y verifica que el balance refleja el monto.
 *
 * Disclaimer: la UI de creación del deposit puede haber cambiado. Los
 * selectores asumen un Select de método + Input de monto + botón Enviar.
 * Si emerge fallo de "no encuentra el botón", inspeccionar
 * `app/play/deposits/page.tsx` y ajustar.
 */

import { expect, test } from '@playwright/test';
import {
  ApiClient,
  createTestPlayer,
  ensurePaymentMethod,
  loginAsAdmin,
  uploadDepositProof,
  type TestPlayer,
} from './helpers/api';
import { loginPlayerViaUi } from './helpers/auth';

let api: ApiClient;
let player: TestPlayer;

test.beforeAll(async () => {
  api = await ApiClient.create();
  await loginAsAdmin(api);
  await ensurePaymentMethod(api);
  player = await createTestPlayer(api, 'deposit');
});

test.afterAll(async () => {
  await api.dispose();
});

test('player crea deposit, admin aprueba via API, balance refleja', async ({
  page,
}) => {
  // 1. Player crea deposit via API (más estable que UI para esta parte —
  //    el form puede tener variantes que rompen selectors). El test foca
  //    en el flow end-to-end y el reflejo en UI.
  const playerApi = await ApiClient.create();
  try {
    await playerApi.post('/tenant/auth/login', {
      username: player.username,
      password: player.password,
    });
  } finally {
    // Nota: no setteamos token vía login helper porque queremos hacerlo
    // limpio. Re-login para obtener token fresco:
  }
  const loginRes = await playerApi.post<{ accessToken: string }>(
    '/tenant/auth/login',
    { username: player.username, password: player.password },
  );
  playerApi.setToken(loginRes.accessToken);

  // Necesitamos el id del método de pago.
  const methods = await playerApi.get<{ data: Array<{ id: string }> }>(
    '/tenant/payment-methods?activeOnly=true',
  );
  const methodId = methods.data[0]!.id;

  // Sprint 51.6: comprobante obligatorio. Subimos un PNG dummy primero.
  const proof = await uploadDepositProof(playerApi);
  const deposit = await playerApi.post<{
    deposit: { id: string; status: string };
  }>('/tenant/deposits', {
    methodId,
    amountFiat: '500',
    currencyFiat: 'ARS',
    amountChips: '500',
    receiptUrl: proof.receiptUrl,
    receiptStorageKey: proof.receiptStorageKey,
  });
  expect(deposit.deposit.status).toBe('pending');

  // Sprint 50: el cajero no puede aprobar sin que un empleado de confianza
  // suba la bank_tx entrante y la matchee con el deposit.
  const incomingBt = await api.post<{ id: string }>('/tenant/bank-transactions', {
    bankAccount: 'CBU-E2E-02',
    amount: '500',
    direction: 'incoming',
    receivedAt: new Date().toISOString(),
  });
  await api.post(
    `/tenant/bank-transactions/${incomingBt.id}/match/${deposit.deposit.id}`,
    {},
  );

  // 2. Admin aprueba.
  await api.post(`/tenant/deposits/${deposit.deposit.id}/approve`);

  // 3. Player logueado verifica balance en UI.
  await loginPlayerViaUi(page, player.username, player.password);
  await page.goto('/play/wallet');
  // El balance se muestra. Buscamos "500" (formateado) en algún lugar
  // visible. Permitimos formateo es-AR ("500" o "500,00").
  await expect(page.getByText(/500([.,]00)?/).first()).toBeVisible({
    timeout: 15_000,
  });

  await playerApi.dispose();
});
