/**
 * Spec 4 — flujo retiro autoservicio.
 *
 * Flujo:
 *   1. Admin crea player + fondea wallet (mint→load).
 *   2. Player crea retiro via API (UI variable; el spec foca en outcome).
 *   3. Admin aprueba via API.
 *   4. Admin marca pagado con externalRef.
 *   5. Player UI verifica que el balance bajó en /play/wallet.
 *
 * Hybrid API+UI igual que el deposit spec — más estable.
 */

import { expect, test } from '@playwright/test';
import {
  ApiClient,
  createTestPlayer,
  ensurePaymentMethod,
  fundPlayer,
  loginAsAdmin,
  type TestPlayer,
} from './helpers/api';
import { loginPlayerViaUi } from './helpers/auth';

let api: ApiClient;
let player: TestPlayer;
const FUND_AMOUNT = '1000';
const WITHDRAW_AMOUNT = '300';

test.beforeAll(async () => {
  api = await ApiClient.create();
  await loginAsAdmin(api);
  await ensurePaymentMethod(api);
  player = await createTestPlayer(api, 'withdraw');
  await fundPlayer(player.id, FUND_AMOUNT);
});

test.afterAll(async () => {
  await api.dispose();
});

test('player crea withdrawal, admin aprueba + paga, balance refleja', async ({
  page,
}) => {
  // Player crea withdrawal via API (más estable que UI).
  const playerApi = await ApiClient.create();
  const loginRes = await playerApi.post<{ accessToken: string }>(
    '/tenant/auth/login',
    { username: player.username, password: player.password },
  );
  playerApi.setToken(loginRes.accessToken);

  const methods = await playerApi.get<{ data: Array<{ id: string }> }>(
    '/tenant/payment-methods?activeOnly=true',
  );
  const methodId = methods.data[0]!.id;

  const wd = await playerApi.post<{
    withdrawal: { id: string; status: string };
  }>('/tenant/withdrawals', {
    methodId,
    amountChips: WITHDRAW_AMOUNT,
    amountFiat: WITHDRAW_AMOUNT,
    currencyFiat: 'ARS',
    targetAccount: { cbu: '0000003100000000000000' },
  });
  expect(wd.withdrawal.status).toBe('pending');

  // Admin aprueba.
  await api.post(`/tenant/withdrawals/${wd.withdrawal.id}/approve`);

  // Sprint 51: el cajero no puede markPaid sin que un empleado de confianza
  // cargue la outgoing bank_tx + la matchee con el withdrawal.
  // Sprint 52: la outgoing requiere comprobante (receipt_storage_key).
  const outgoingBt = await api.post<{ id: string }>('/tenant/bank-transactions', {
    bankAccount: 'CBU-E2E-04',
    amount: WITHDRAW_AMOUNT,
    direction: 'outgoing',
    receiptUrl: `http://localhost/proofs/e2e-04-${Date.now()}.pdf`,
    receiptStorageKey: `test/proofs/e2e-04-${Date.now()}.pdf`,
    receivedAt: new Date().toISOString(),
  });
  await api.post(
    `/tenant/bank-transactions/${outgoingBt.id}/match-withdrawal/${wd.withdrawal.id}`,
    {},
  );

  await api.post(`/tenant/withdrawals/${wd.withdrawal.id}/mark-paid`, {});

  // Player verifica balance reducido.
  await loginPlayerViaUi(page, player.username, player.password);
  await page.goto('/play/wallet');
  // Esperado: 1000 - 300 = 700 (el hold del withdrawal se debita al pay).
  await expect(page.getByText(/700([.,]00)?/).first()).toBeVisible({
    timeout: 15_000,
  });

  await playerApi.dispose();
});
