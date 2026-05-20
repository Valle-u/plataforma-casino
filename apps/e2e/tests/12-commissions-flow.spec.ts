/**
 * Spec 12 — Sistema de comisiones end-to-end.
 *
 * Valida operativamente que las comisiones funcionan correctamente:
 *   - El cliente recibe el monto COMPLETO del depósito (sin descuentos).
 *   - El approver paga las commissions de su wallet a la cadena upstream.
 *   - La row del approver-si-mismo es net zero (wallet_tx_id null).
 *   - Si el approver no tiene saldo: 409 + rollback completo.
 *   - Idempotencia: aprobar 2 veces no duplica payouts.
 *   - Snapshot del rol del beneficiario al momento del payout.
 *
 * Setup de la pirámide (creado por el test):
 *
 *   demo_admin (raíz)
 *     └── socio_test     (2%)
 *         └── distrib_test  (3%)
 *             └── cajero_test  (5%)  ← approver
 *                 └── cliente_test
 *
 * Reglas:
 *   - deposit_approved · cajero: 5%
 *   - deposit_approved · distribuidor: 3%
 *   - deposit_approved · socio: 2%
 *
 * Depósito de prueba: $1000 → cliente recibe $1000 / cajero paga $50
 * (= $30 a distrib + $20 a socio; los $50 del cajero a sí mismo son net zero).
 */

import { expect, test } from '@playwright/test';
import {
  ApiClient,
  createTestPlayer,
  createTestUserWithRole,
  ensurePaymentMethod,
  fundPlayer,
  loginAs,
  loginAsAdmin,
  setUserParent,
  type TestPlayer,
} from './helpers/api';

// Constantes del escenario.
const DEPOSIT_AMOUNT = '1000';
const CAJERO_INITIAL_FUNDING = '500'; // suficiente para pagar $50 de commission
const PCT_CAJERO = '5.00';
const PCT_DISTRIB = '3.00';
const PCT_SOCIO = '2.00';

// Esperados (calculados):
//   $1000 * 5% = $50   (cajero — net zero por ser approver)
//   $1000 * 3% = $30   (distrib)
//   $1000 * 2% = $20   (socio)
const EXPECTED_PAYOUT_CAJERO = '50.00';
const EXPECTED_PAYOUT_DISTRIB = '30.00';
const EXPECTED_PAYOUT_SOCIO = '20.00';

interface RuleInfo {
  id: string;
  role: string;
  eventType: string;
  pct: string;
  active: boolean;
}

interface WalletInfo {
  id: string;
  balance: string;
}

interface DepositInfo {
  deposit: { id: string; status: string };
}

interface CommissionPayout {
  id: string;
  beneficiaryUserId: string;
  beneficiaryUsername: string | null;
  beneficiaryRoleAtTime: string;
  sourceAmount: string;
  pct: string;
  payoutAmount: string;
  status: string;
  walletTxId: string | null;
}

// ──────────────────────────────────────────────────────────────────────
// Helpers de setup específicos del spec
// ──────────────────────────────────────────────────────────────────────

/**
 * Crea o actualiza una rule. Si ya existe (role+event), la PATCHea con
 * el pct nuevo + active=true. Idempotente — no rompe si corres el test
 * varias veces sobre el mismo tenant.
 */
async function upsertRule(
  api: ApiClient,
  role: string,
  eventType: string,
  pct: string,
): Promise<RuleInfo> {
  const list = await api.get<{ data: RuleInfo[] }>(
    `/tenant/commissions/rules?eventType=${eventType}`,
  );
  const existing = list.data.find((r) => r.role === role);
  if (existing) {
    return api.patch<RuleInfo>(`/tenant/commissions/rules/${existing.id}`, {
      pct,
      active: true,
    });
  }
  return api.post<RuleInfo>('/tenant/commissions/rules', {
    role,
    eventType,
    pct,
    active: true,
  });
}

async function getWalletBalance(api: ApiClient, userId: string): Promise<string> {
  const w = await api.get<WalletInfo>(`/tenant/wallet/user/${userId}`);
  return w.balance;
}

async function getMyWalletBalance(api: ApiClient): Promise<string> {
  const w = await api.get<WalletInfo>('/tenant/wallet/me');
  return w.balance;
}

/**
 * Mintea fichas al admin (su wallet) y después load al targetUser.
 * Usado para precargar saldo a cajero, distribuidor, etc. para que
 * puedan funder commissions o ser fundeados.
 */
async function mintAndLoad(
  adminApi: ApiClient,
  targetUserId: string,
  amount: string,
  label: string,
): Promise<void> {
  const k = (lbl: string): string =>
    `${lbl}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await adminApi.post(
    '/tenant/wallet/mint',
    { amount, reason: `e2e ${label}` },
    { headers: { 'Idempotency-Key': k(`mint-${label}`) } },
  );
  await adminApi.post(
    '/tenant/wallet/load',
    { targetUserId, amount, notes: `e2e load ${label}` },
    { headers: { 'Idempotency-Key': k(`load-${label}`) } },
  );
}

// ──────────────────────────────────────────────────────────────────────
// Suite
// ──────────────────────────────────────────────────────────────────────

test.describe('Sistema de comisiones (Sprint 25 + audit)', () => {
  let adminApi: ApiClient;
  let socio: TestPlayer;
  let distrib: TestPlayer;
  let cajero: TestPlayer;
  let cliente: TestPlayer;
  let cajeroApi: ApiClient;
  let methodId: string;

  test.beforeAll(async () => {
    // 1. Admin API + ensure payment method
    adminApi = await ApiClient.create();
    await loginAsAdmin(adminApi);
    const m = await ensurePaymentMethod(adminApi);
    methodId = m.id;

    // 2. Setup de rules (idempotente)
    await upsertRule(adminApi, 'cajero', 'deposit_approved', PCT_CAJERO);
    await upsertRule(adminApi, 'distribuidor', 'deposit_approved', PCT_DISTRIB);
    await upsertRule(adminApi, 'socio', 'deposit_approved', PCT_SOCIO);

    // 3. Crear pirámide:
    //    socio_test → distrib_test → cajero_test → cliente_test
    socio = await createTestUserWithRole(adminApi, 'socio', 'socio');
    distrib = await createTestUserWithRole(adminApi, 'distrib', 'distribuidor');
    cajero = await createTestUserWithRole(adminApi, 'cajero', 'cajero');
    cliente = await createTestPlayer(adminApi, 'cliente');

    // 4. Linkear pirámide (admin tiene users.change_hierarchy)
    await setUserParent(adminApi, distrib.id, socio.id);
    await setUserParent(adminApi, cajero.id, distrib.id);
    await setUserParent(adminApi, cliente.id, cajero.id);

    // 5. Precargar al cajero con saldo suficiente para fundear commissions.
    //    Cajero va a pagar $50 cuando apruebe el deposit de $1000.
    await mintAndLoad(adminApi, cajero.id, CAJERO_INITIAL_FUNDING, 'cajero-prefund');

    // 6. El rol `cajero` no recibe `deposits.approve` por default del seed
    //    (solo admin_tenant tiene todos los permisos). En operación real,
    //    el admin del tenant lo otorga via override. Lo hacemos igual.
    for (const perm of ['deposits.approve', 'commissions.view']) {
      await adminApi.post('/tenant/permission-overrides/grant', {
        userId: cajero.id,
        permissionCode: perm,
        reason: 'e2e test setup',
      });
    }

    // 7. Login del cajero para hacer la aprobación.
    cajeroApi = await ApiClient.create();
    await loginAs(cajeroApi, cajero.username, cajero.password);
  });

  test.afterAll(async () => {
    await adminApi.dispose();
    if (cajeroApi) await cajeroApi.dispose();
  });

  // ──────────────────────────────────────────────────────────────────
  // Test 1: Flow happy path
  // ──────────────────────────────────────────────────────────────────

  test('flow happy path — cliente recibe $1000, cajero paga $50 a uplines', async () => {
    // Estado inicial: snapshot de balances.
    const clienteBefore = await getWalletBalance(adminApi, cliente.id);
    const cajeroBefore = await getWalletBalance(adminApi, cajero.id);
    const distribBefore = await getWalletBalance(adminApi, distrib.id);
    const socioBefore = await getWalletBalance(adminApi, socio.id);

    // Cliente crea deposit ($1000) via login propio.
    const clienteApi = await ApiClient.create();
    await loginAs(clienteApi, cliente.username, cliente.password);
    const dep = await clienteApi.post<DepositInfo>('/tenant/deposits', {
      methodId,
      amountChips: DEPOSIT_AMOUNT,
      amountFiat: DEPOSIT_AMOUNT,
      currencyFiat: 'ARS',
    });
    expect(dep.deposit.status).toBe('pending');
    await clienteApi.dispose();

    // Cajero aprueba el deposit (él es el approver/funder).
    await cajeroApi.post(`/tenant/deposits/${dep.deposit.id}/approve`);

    // Snapshot post-approve.
    const clienteAfter = await getWalletBalance(adminApi, cliente.id);
    const cajeroAfter = await getWalletBalance(adminApi, cajero.id);
    const distribAfter = await getWalletBalance(adminApi, distrib.id);
    const socioAfter = await getWalletBalance(adminApi, socio.id);

    // 🔑 ASSERTION CLAVE 1: el cliente recibe el monto COMPLETO ($1000).
    expect(Number(clienteAfter) - Number(clienteBefore)).toBe(1000);

    // 🔑 ASSERTION CLAVE 2: el cajero pagó $50 total (=$30 distrib + $20 socio;
    //    el $50 a sí mismo es net zero).
    expect(Number(cajeroBefore) - Number(cajeroAfter)).toBe(50);

    // 🔑 ASSERTION CLAVE 3: distrib recibió $30.
    expect(Number(distribAfter) - Number(distribBefore)).toBe(30);

    // 🔑 ASSERTION CLAVE 4: socio recibió $20.
    expect(Number(socioAfter) - Number(socioBefore)).toBe(20);

    // Verificar las 3 rows en commission_payouts.
    const payouts = await adminApi.get<{ data: CommissionPayout[] }>(
      `/tenant/commissions/payouts?sourceEventId=${dep.deposit.id}`,
    );
    expect(payouts.data).toHaveLength(3);

    // Por rol — cada uno con su pct + payoutAmount correctos.
    const byRole = new Map(payouts.data.map((p) => [p.beneficiaryRoleAtTime, p]));

    const cajeroPay = byRole.get('cajero');
    expect(cajeroPay).toBeDefined();
    expect(cajeroPay!.payoutAmount).toBe(EXPECTED_PAYOUT_CAJERO);
    expect(cajeroPay!.pct).toBe(PCT_CAJERO);
    // 🔑 Net zero: el row del cajero a sí mismo NO tiene wallet_tx_id.
    expect(cajeroPay!.walletTxId).toBeNull();

    const distribPay = byRole.get('distribuidor');
    expect(distribPay).toBeDefined();
    expect(distribPay!.payoutAmount).toBe(EXPECTED_PAYOUT_DISTRIB);
    expect(distribPay!.walletTxId).not.toBeNull();

    const socioPay = byRole.get('socio');
    expect(socioPay).toBeDefined();
    expect(socioPay!.payoutAmount).toBe(EXPECTED_PAYOUT_SOCIO);
    expect(socioPay!.walletTxId).not.toBeNull();

    // Todos status='paid' (no quedan pending).
    for (const p of payouts.data) {
      expect(p.status).toBe('paid');
    }
  });

  // ──────────────────────────────────────────────────────────────────
  // Test 2: Saldo insuficiente del approver → 409 + rollback
  // ──────────────────────────────────────────────────────────────────

  test('approver sin saldo → 409 INSUFFICIENT_FUNDER_BALANCE + rollback', async () => {
    // Drenar wallet del cajero a 0 — burn lo que le quede.
    const cajeroBal = await getWalletBalance(adminApi, cajero.id);
    const cajeroBalNum = Number(cajeroBal);
    if (cajeroBalNum > 0) {
      const k = `e2e-drain-${Date.now()}`;
      // Unload todo al admin (effectively drain). `reason` requerido.
      await adminApi.post(
        '/tenant/wallet/unload',
        {
          targetUserId: cajero.id,
          amount: cajeroBal,
          reason: 'e2e drain del cajero',
          notes: 'e2e drain',
        },
        { headers: { 'Idempotency-Key': k } },
      );
    }
    // Verificar que el cajero quedó en 0.
    expect(Number(await getWalletBalance(adminApi, cajero.id))).toBe(0);

    // Cliente crea otro deposit de $1000.
    const clienteApi = await ApiClient.create();
    await loginAs(clienteApi, cliente.username, cliente.password);
    const dep = await clienteApi.post<DepositInfo>('/tenant/deposits', {
      methodId,
      amountChips: '1000',
      amountFiat: '1000',
      currencyFiat: 'ARS',
    });
    await clienteApi.dispose();

    // Snapshot del cliente PRE-approve (para verificar rollback).
    const clienteBefore = await getWalletBalance(adminApi, cliente.id);

    // Cajero intenta aprobar — debe fallar.
    const approveResult = await cajeroApi.postRaw(
      `/tenant/deposits/${dep.deposit.id}/approve`,
    );

    expect(approveResult.status).toBe(409);
    const errBody = approveResult.body as { error?: string; message?: string };
    expect(errBody.error).toBe('INSUFFICIENT_FUNDER_BALANCE');

    // 🔑 Rollback: el deposit sigue en pending (no se aprobó).
    const depAfter = await adminApi.get<{ deposit: { status: string } }>(
      `/tenant/deposits/${dep.deposit.id}`,
    );
    expect(depAfter.deposit.status).toBe('pending');

    // 🔑 Rollback: el balance del cliente NO cambió.
    const clienteAfter = await getWalletBalance(adminApi, cliente.id);
    expect(clienteAfter).toBe(clienteBefore);

    // 🔑 No se persistió ningún commission_payout para este deposit.
    const payouts = await adminApi.get<{ data: CommissionPayout[] }>(
      `/tenant/commissions/payouts?sourceEventId=${dep.deposit.id}`,
    );
    expect(payouts.data).toHaveLength(0);
  });

  // ──────────────────────────────────────────────────────────────────
  // Test 3: Idempotencia — aprobar 2 veces no duplica payouts
  // ──────────────────────────────────────────────────────────────────

  test('aprobar deposit ya aprobado no duplica payouts (idempotente)', async () => {
    // Re-fondear al cajero (lo vaciamos en test anterior).
    await mintAndLoad(adminApi, cajero.id, '500', 'cajero-refund');

    // Cliente crea + cajero aprueba.
    const clienteApi = await ApiClient.create();
    await loginAs(clienteApi, cliente.username, cliente.password);
    const dep = await clienteApi.post<DepositInfo>('/tenant/deposits', {
      methodId,
      amountChips: '1000',
      amountFiat: '1000',
      currencyFiat: 'ARS',
    });
    await clienteApi.dispose();

    await cajeroApi.post(`/tenant/deposits/${dep.deposit.id}/approve`);

    // Conteo de payouts después del primer approve.
    const firstPayouts = await adminApi.get<{ data: CommissionPayout[] }>(
      `/tenant/commissions/payouts?sourceEventId=${dep.deposit.id}`,
    );
    expect(firstPayouts.data).toHaveLength(3);

    // Approver intenta aprobar de nuevo — el deposit ya está approved,
    // así que el service devuelve idempotente (no error).
    await cajeroApi.post(`/tenant/deposits/${dep.deposit.id}/approve`);

    // Conteo después del segundo approve: sigue siendo 3 (no duplica).
    const secondPayouts = await adminApi.get<{ data: CommissionPayout[] }>(
      `/tenant/commissions/payouts?sourceEventId=${dep.deposit.id}`,
    );
    expect(secondPayouts.data).toHaveLength(3);
  });

  // ──────────────────────────────────────────────────────────────────
  // Test 4: Cadena rota — cliente sin uplines completos
  // ──────────────────────────────────────────────────────────────────

  test('si la cadena tiene huecos, solo aplican las rules de roles presentes', async () => {
    // Crear un nuevo cliente que cuelga DIRECTO del admin (sin cajero/distrib/socio
    // intermedios). Solo el admin_tenant es su único ancestor.
    const huerfano = await createTestPlayer(adminApi, 'huerfano');
    // setUserParent al admin (necesitamos el admin id; lo sacamos de /me).
    const adminMe = await adminApi.get<{ user: { id: string } }>(
      '/tenant/auth/me',
    );
    await setUserParent(adminApi, huerfano.id, adminMe.user.id);

    // Crear deposit + admin aprueba (admin es approver y único ancestor).
    const clienteApi = await ApiClient.create();
    await loginAs(clienteApi, huerfano.username, huerfano.password);
    const dep = await clienteApi.post<DepositInfo>('/tenant/deposits', {
      methodId,
      amountChips: '500',
      amountFiat: '500',
      currencyFiat: 'ARS',
    });
    await clienteApi.dispose();

    await adminApi.post(`/tenant/deposits/${dep.deposit.id}/approve`);

    // No hay rules para 'admin_tenant' → ningún payout.
    // O si las hubiera, el admin se autopaga (net zero).
    const payouts = await adminApi.get<{ data: CommissionPayout[] }>(
      `/tenant/commissions/payouts?sourceEventId=${dep.deposit.id}`,
    );
    // Como no hay rule de admin_tenant, payouts vacío.
    expect(payouts.data).toHaveLength(0);

    // El cliente sí recibe sus $500 igual.
    const huerfanoBalance = await getWalletBalance(adminApi, huerfano.id);
    expect(Number(huerfanoBalance)).toBe(500);
  });

  // ──────────────────────────────────────────────────────────────────
  // Test 5: Preview compute sin persistir
  // ──────────────────────────────────────────────────────────────────

  test('preview compute devuelve el plan sin tocar wallets ni payouts', async () => {
    // Pre-conteo de payouts globales del cliente.
    const before = await adminApi.get<{ data: CommissionPayout[] }>(
      `/tenant/commissions/payouts?beneficiaryUserId=${cajero.id}`,
    );
    const beforeCount = before.data.length;

    // Preview de un deposit hipotético de $2000.
    const preview = await adminApi.post<{
      plan: Array<{
        beneficiaryUserId: string;
        beneficiaryRoleAtTime: string;
        pct: string;
        payoutAmount: string;
      }>;
      summary: {
        beneficiaries: number;
        sourceAmount: string;
        totalPayout: string;
        tenantKeeps: string;
      };
    }>('/tenant/commissions/preview', {
      eventType: 'deposit_approved',
      sourceUserId: cliente.id,
      sourceAmount: '2000',
    });

    // 3 beneficiarios (cajero/distrib/socio).
    expect(preview.plan).toHaveLength(3);
    expect(preview.summary.beneficiaries).toBe(3);
    expect(preview.summary.sourceAmount).toBe('2000');
    // Total = $2000 * (5+3+2)/100 = $200
    expect(Number(preview.summary.totalPayout)).toBe(200);
    expect(Number(preview.summary.tenantKeeps)).toBe(1800);

    // Confirmar que el preview NO persistió payouts nuevos.
    const after = await adminApi.get<{ data: CommissionPayout[] }>(
      `/tenant/commissions/payouts?beneficiaryUserId=${cajero.id}`,
    );
    expect(after.data.length).toBe(beforeCount);
  });
});
