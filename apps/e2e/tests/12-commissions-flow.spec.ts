/**
 * Spec 12 — Sistema de comisiones end-to-end (RE-ESCRITO en Sprint 50).
 *
 * Cambios del modelo (decidido por el dueño 2026-05-20):
 *   - El approver YA NO funder. Las commissions NO se pagan en el momento.
 *   - Cada deposit_approved acumula rows con status='accrued' (no 'paid').
 *   - Los wallets de los uplines NO cambian al aprobar el deposit.
 *   - Liquidación manual del admin via POST /tenant/commissions/payouts/settle
 *     mintea fichas a cada beneficiary y marca los payouts como 'paid'.
 *   - Solo deposits disparan commissions (withdrawals NO acumulan).
 *
 * Pre-requisito Sprint 50: el deposit debe tener bank_transaction matcheada
 * antes de aprobar. El setup del test sube + matchea una bank_tx primero.
 */

import { expect, test } from '@playwright/test';
import {
  ApiClient,
  createTestPlayer,
  createTestUserWithRole,
  ensurePaymentMethod,
  loginAs,
  loginAsAdmin,
  setUserParent,
  type TestPlayer,
} from './helpers/api';

const DEPOSIT_AMOUNT = '1000';
const PCT_CAJERO = '5.00';
const PCT_DISTRIB = '3.00';
const PCT_SOCIO = '2.00';

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

interface BankTxRow {
  id: string;
  amount: string;
  status: string;
}

interface DepositInfo {
  deposit: { id: string; status: string };
}

interface CommissionPayout {
  id: string;
  beneficiaryUserId: string;
  beneficiaryRoleAtTime: string;
  payoutAmount: string;
  status: string;
  walletTxId: string | null;
}

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
  const w = await api.get<{ balance: string }>(`/tenant/wallet/user/${userId}`);
  return w.balance;
}

async function uploadBankTx(
  api: ApiClient,
  amount: string,
  senderName: string,
): Promise<BankTxRow> {
  return api.post<BankTxRow>('/tenant/bank-transactions', {
    bankAccount: 'CBU-TEST-001',
    amount,
    currency: 'ARS',
    senderName,
    receivedAt: new Date().toISOString(),
    notes: 'e2e commissions test',
  });
}

async function matchBankTx(
  api: ApiClient,
  bankTxId: string,
  depositId: string,
): Promise<void> {
  await api.post(`/tenant/bank-transactions/${bankTxId}/match/${depositId}`, {});
}

// ──────────────────────────────────────────────────────────────────────

test.describe('Sistema de comisiones Sprint 50 — accrued + settle', () => {
  let adminApi: ApiClient;
  let socio: TestPlayer;
  let distrib: TestPlayer;
  let cajero: TestPlayer;
  let cliente: TestPlayer;
  let cajeroApi: ApiClient;
  let methodId: string;

  test.beforeAll(async () => {
    adminApi = await ApiClient.create();
    await loginAsAdmin(adminApi);
    const m = await ensurePaymentMethod(adminApi);
    methodId = m.id;

    await upsertRule(adminApi, 'cajero', 'deposit_approved', PCT_CAJERO);
    await upsertRule(adminApi, 'distribuidor', 'deposit_approved', PCT_DISTRIB);
    await upsertRule(adminApi, 'socio', 'deposit_approved', PCT_SOCIO);

    socio = await createTestUserWithRole(adminApi, 'socio', 'socio');
    distrib = await createTestUserWithRole(adminApi, 'distrib', 'distribuidor');
    cajero = await createTestUserWithRole(adminApi, 'cajero', 'cajero');
    cliente = await createTestPlayer(adminApi, 'cliente');

    await setUserParent(adminApi, distrib.id, socio.id);
    await setUserParent(adminApi, cajero.id, distrib.id);
    await setUserParent(adminApi, cliente.id, cajero.id);

    // Sprint 50: el cajero YA NO necesita prefunding — no paga commissions.
    // Solo necesita permisos.
    for (const perm of [
      'deposits.approve',
      'commissions.view',
      'bank_tx.view',
      'bank_tx.match',
    ]) {
      await adminApi.post('/tenant/permission-overrides/grant', {
        userId: cajero.id,
        permissionCode: perm,
        reason: 'e2e test setup',
      });
    }

    cajeroApi = await ApiClient.create();
    await loginAs(cajeroApi, cajero.username, cajero.password);
  });

  test.afterAll(async () => {
    await adminApi.dispose();
    if (cajeroApi) await cajeroApi.dispose();
  });

  // ──────────────────────────────────────────────────────────────────

  test('approve genera payouts ACCRUED — wallets de uplines NO cambian', async () => {
    const cajeroBefore = await getWalletBalance(adminApi, cajero.id);
    const distribBefore = await getWalletBalance(adminApi, distrib.id);
    const socioBefore = await getWalletBalance(adminApi, socio.id);
    const clienteBefore = await getWalletBalance(adminApi, cliente.id);

    // 1. Cliente crea deposit.
    const clienteApi = await ApiClient.create();
    await loginAs(clienteApi, cliente.username, cliente.password);
    const dep = await clienteApi.post<DepositInfo>('/tenant/deposits', {
      methodId,
      amountChips: DEPOSIT_AMOUNT,
      amountFiat: DEPOSIT_AMOUNT,
      currencyFiat: 'ARS',
    });
    await clienteApi.dispose();

    // 2. Empleado (admin en este test) sube la bank_tx con monto exacto.
    const bankTx = await uploadBankTx(adminApi, DEPOSIT_AMOUNT, 'Cliente Test');

    // 3. Cajero matchea bank_tx con deposit.
    await matchBankTx(cajeroApi, bankTx.id, dep.deposit.id);

    // 4. Cajero aprueba.
    await cajeroApi.post(`/tenant/deposits/${dep.deposit.id}/approve`);

    // 5. Cliente recibió el monto completo.
    const clienteAfter = await getWalletBalance(adminApi, cliente.id);
    expect(Number(clienteAfter) - Number(clienteBefore)).toBe(1000);

    // 🔑 NUEVO Sprint 50: wallets de uplines NO cambian al aprobar.
    expect(await getWalletBalance(adminApi, cajero.id)).toBe(cajeroBefore);
    expect(await getWalletBalance(adminApi, distrib.id)).toBe(distribBefore);
    expect(await getWalletBalance(adminApi, socio.id)).toBe(socioBefore);

    // 🔑 Los 3 payouts están en status='accrued' (no 'paid' como antes).
    const payouts = await adminApi.get<{ data: CommissionPayout[] }>(
      `/tenant/commissions/payouts?sourceEventId=${dep.deposit.id}`,
    );
    expect(payouts.data).toHaveLength(3);
    for (const p of payouts.data) {
      expect(p.status).toBe('accrued');
      expect(p.walletTxId).toBeNull();
    }

    const byRole = new Map(payouts.data.map((p) => [p.beneficiaryRoleAtTime, p]));
    expect(byRole.get('cajero')!.payoutAmount).toBe(EXPECTED_PAYOUT_CAJERO);
    expect(byRole.get('distribuidor')!.payoutAmount).toBe(EXPECTED_PAYOUT_DISTRIB);
    expect(byRole.get('socio')!.payoutAmount).toBe(EXPECTED_PAYOUT_SOCIO);
  });

  // ──────────────────────────────────────────────────────────────────

  test('settle mintea fichas a beneficiarios y marca payouts paid', async () => {
    // Snapshot wallets antes del settle.
    const cajeroBefore = Number(await getWalletBalance(adminApi, cajero.id));
    const distribBefore = Number(await getWalletBalance(adminApi, distrib.id));
    const socioBefore = Number(await getWalletBalance(adminApi, socio.id));

    // Liquidar TODOS los accrued (payoutIds vacío).
    const result = await adminApi.post<{
      settled: number;
      failed: number;
      totalPaid: string;
    }>('/tenant/commissions/payouts/settle', { payoutIds: [] });

    expect(result.settled).toBeGreaterThanOrEqual(3); // al menos los del test 1
    expect(result.failed).toBe(0);
    expect(Number(result.totalPaid)).toBeGreaterThanOrEqual(100); // 50+30+20

    // Verificar que los wallets de los 3 uplines recibieron sus payouts.
    expect(Number(await getWalletBalance(adminApi, cajero.id)) - cajeroBefore).toBe(50);
    expect(Number(await getWalletBalance(adminApi, distrib.id)) - distribBefore).toBe(30);
    expect(Number(await getWalletBalance(adminApi, socio.id)) - socioBefore).toBe(20);

    // El summary de pending ahora debería estar limpio (o sin esas rows).
    const summary = await adminApi.get<{ totalPending: string }>(
      '/tenant/commissions/payouts/pending-summary',
    );
    expect(Number(summary.totalPending)).toBe(0);
  });

  // ──────────────────────────────────────────────────────────────────

  test('no se puede aprobar deposit sin bank_tx matcheada', async () => {
    // Cliente crea deposit sin matchear bank_tx.
    const clienteApi = await ApiClient.create();
    await loginAs(clienteApi, cliente.username, cliente.password);
    const dep = await clienteApi.post<DepositInfo>('/tenant/deposits', {
      methodId,
      amountChips: '500',
      amountFiat: '500',
      currencyFiat: 'ARS',
    });
    await clienteApi.dispose();

    // Cajero intenta aprobar sin matchear → 400 DEPOSIT_REQUIRES_BANK_TX.
    const result = await cajeroApi.postRaw(
      `/tenant/deposits/${dep.deposit.id}/approve`,
    );
    expect(result.status).toBe(400);
    const body = result.body as { error?: string };
    expect(body.error).toBe('DEPOSIT_REQUIRES_BANK_TX');

    // El deposit sigue pending.
    const depAfter = await adminApi.get<{ deposit: { status: string } }>(
      `/tenant/deposits/${dep.deposit.id}`,
    );
    expect(depAfter.deposit.status).toBe('pending');
  });
});
