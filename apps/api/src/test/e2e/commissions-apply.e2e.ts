/**
 * E2E: apply automático de commissions (Sprint 25, modelo nuevo Sprint 50).
 *
 * Cubre el flujo end-to-end:
 *   - `POST /tenant/deposits/:id/approve` → dispara
 *     `CommissionsService.applyForEvent('deposit_approved')` → inserta
 *     payouts en estado `accrued` (wallet_tx_id=null, SIN tocar saldos).
 *   - `POST /tenant/commissions/payouts/settle` → liquida los accrued:
 *     MINTEA fichas al beneficiary (no debita a nadie), marca el payout
 *     `paid` y le asigna wallet_tx_id.
 *
 * Casos:
 *   1. Happy path admin aprueba: approve acumula (accrued), settle mintea
 *      al cajero (admin NO cambia).
 *   2. Approver es ancestor (self-paid): approve acumula, settle mintea al
 *      cajero (que es approver y beneficiary).
 *   3. Multi-level chain: 3 ancestors, settle mintea las 3.
 *   4. Idempotencia: re-approve no duplica payouts; settle paga una vez.
 *   5. Sin rules activas → approve normal sin payouts.
 *   6. Withdrawal markPaid: Sprint 50 removió las comisiones en withdrawals
 *      → markPaid corre OK sin generar payouts.
 *
 * IMPORTANTE: cada test limpia commission_rules + commission_payouts en
 * `beforeEach` para evitar contaminación cross-test. Los wallets NO se
 * limpian — pero usamos `mint` para asegurar saldo del admin antes de
 * cada caso que lo necesite.
 */

import { sql } from 'drizzle-orm';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { createTestUser } from '../helpers/test-users';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import {
  matchBankTxForDeposit,
  matchOutgoingBankTxForWithdrawal,
} from '../helpers/bank-tx';
import { TEST_TENANT } from '../setup/test-tenant';

function freshKey(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

describe('Commissions apply flow (E2E, Sprint 25)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let cajeroToken: string;
  let cajeroId: string;
  let adminId: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
    cajeroToken = await loginAs(
      ctx.request,
      TEST_TENANT.cajero1.username,
      TEST_TENANT.cajero1.password,
    );
    const cRow = await ctx.tenantDb.execute(
      sql`SELECT id FROM users WHERE username = ${TEST_TENANT.cajero1.username} LIMIT 1`,
    );
    cajeroId = (cRow as unknown as Array<{ id: string }>)[0]!.id;
    const aRow = await ctx.tenantDb.execute(
      sql`SELECT id FROM users WHERE username = ${TEST_TENANT.admin.username} LIMIT 1`,
    );
    adminId = (aRow as unknown as Array<{ id: string }>)[0]!.id;

    // Otorgar `deposits.approve` al cajero (para tests donde el cajero
    // aprueba sus propios clientes).
    await ctx.request
      .post('/tenant/permission-overrides/grant')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({
        userId: cajeroId,
        permissionCode: 'deposits.approve',
        reason: 'test apply commissions',
      });
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    // Limpieza para aislamiento entre tests del módulo de commissions.
    await ctx.tenantDb.execute(sql`DELETE FROM commission_payouts`);
    await ctx.tenantDb.execute(sql`DELETE FROM commission_rules`);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────

  /** Mintea fichas al admin para tener saldo de funder en los tests. */
  async function mintToAdmin(amount: string): Promise<void> {
    const res = await ctx.request
      .post('/tenant/wallet/mint')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .set('Idempotency-Key', freshKey('mint-admin'))
      .send({ amount, reason: 'commission test funding' });
    if (res.status !== 201 && res.status !== 200) {
      throw new Error(`mint admin falló: ${res.status} ${JSON.stringify(res.body)}`);
    }
  }

  /** Lee balance directo de la DB. */
  async function getBalance(userId: string): Promise<string> {
    const r = await ctx.tenantDb.execute(
      sql`SELECT balance FROM wallets WHERE user_id = ${userId} LIMIT 1`,
    );
    const rows = r as unknown as Array<{ balance: string }>;
    return rows[0]?.balance ?? '0.00';
  }

  /** Inserta un payment_method de prueba (reusable). */
  async function ensurePaymentMethod(): Promise<string> {
    const existing = await ctx.tenantDb.execute(
      sql`SELECT id FROM payment_methods WHERE code = 'apply_test' LIMIT 1`,
    );
    const rows = existing as unknown as Array<{ id: string }>;
    if (rows[0]) return rows[0].id;
    const ins = await ctx.tenantDb.execute(
      sql`INSERT INTO payment_methods (id, code, name, type, config, is_active)
          VALUES (gen_random_uuid(), 'apply_test', 'Apply Test', 'bank_transfer', '{}'::jsonb, true)
          RETURNING id`,
    );
    return (ins as unknown as Array<{ id: string }>)[0]!.id;
  }

  /** Crea un deposit en estado pending directo en DB (skip flow del player). */
  async function insertDeposit(
    userId: string,
    methodId: string,
    amount: string,
  ): Promise<string> {
    const ins = await ctx.tenantDb.execute(
      sql`INSERT INTO deposits (id, user_id, method_id, amount_fiat, currency_fiat, amount_chips, status)
          VALUES (gen_random_uuid(), ${userId}, ${methodId}, ${amount}, 'ARS', ${amount}, 'pending')
          RETURNING id`,
    );
    const depositId = (ins as unknown as Array<{ id: string }>)[0]!.id;
    // Sprint 50: matchear una bank_tx para que el depósito sea aprobable.
    await matchBankTxForDeposit(ctx.request, adminToken, depositId);
    return depositId;
  }

  /** Crea una commission rule via API admin. */
  async function createRule(
    role: string,
    eventType: 'deposit_approved' | 'withdrawal_paid',
    pct: string,
  ): Promise<void> {
    const r = await ctx.request
      .post('/tenant/commissions/rules')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ role, eventType, pct });
    if (r.status !== 201) {
      throw new Error(`createRule falló: ${r.status} ${JSON.stringify(r.body)}`);
    }
  }

  /** Cuenta payouts para un sourceEventId. */
  async function countPayouts(eventId: string): Promise<number> {
    const r = await ctx.tenantDb.execute(
      sql`SELECT COUNT(*)::int as n FROM commission_payouts WHERE source_event_id = ${eventId}`,
    );
    return (r as unknown as Array<{ n: number }>)[0]?.n ?? 0;
  }

  /** Liquida TODOS los payouts accrued (mintea al beneficiary). */
  async function settleAllPayouts(): Promise<{ settled: number; failed: number; totalPaid: string }> {
    const res = await ctx.request
      .post('/tenant/commissions/payouts/settle')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ payoutIds: [] });
    if (res.status !== 200) throw new Error(`settle falló: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body as { settled: number; failed: number; totalPaid: string };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Tests
  // ──────────────────────────────────────────────────────────────────────

  describe('deposit approval con commission rule activa', () => {
    it('happy path: admin aprueba, cajero recibe 5% del deposit', async () => {
      await mintToAdmin('10000');
      await createRule('cajero', 'deposit_approved', '5.00');

      const client = await createTestUser(ctx.request, adminToken, {
        suite: 'commissions-apply',
        label: 'happy_client',
        role: 'usuario_final',
      });
      // Vinculamos client → cajero1.
      await ctx.request
        .put(`/tenant/user-hierarchy/${client.id}/parent`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ parentUserId: cajeroId, relationType: 'jugador_de_cajero' });

      const methodId = await ensurePaymentMethod();
      const depositId = await insertDeposit(client.id, methodId, '1000');

      const adminBefore = await getBalance(adminId);
      const cajeroBefore = await getBalance(cajeroId);

      const res = await ctx.request
        .post(`/tenant/deposits/${depositId}/approve`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.status).toBe(200);

      // Paso 1: approve solo ACUMULA. El payout queda accrued, sin wallet
      // tx, y NINGÚN balance cambió.
      expect(await countPayouts(depositId)).toBe(1);
      const accruedRows = (await ctx.tenantDb.execute(
        sql`SELECT status, wallet_tx_id FROM commission_payouts WHERE source_event_id = ${depositId}`,
      )) as unknown as Array<{ status: string; wallet_tx_id: string | null }>;
      expect(accruedRows[0]!.status).toBe('accrued');
      expect(accruedRows[0]!.wallet_tx_id).toBeNull();

      expect(await getBalance(adminId)).toBe(adminBefore);
      expect(await getBalance(cajeroId)).toBe(cajeroBefore);

      // Paso 2: settle liquida el accrued vía mint al beneficiary.
      const settle = await settleAllPayouts();
      expect(settle.settled).toBeGreaterThanOrEqual(1);

      const cajeroAfter = await getBalance(cajeroId);

      // El admin NO cambia — settle MINTEA fichas nuevas, no debita a nadie.
      expect(await getBalance(adminId)).toBe(adminBefore);
      // Cajero ganó 50 (5% de 1000) por mint.
      expect(Number(cajeroAfter)).toBeCloseTo(Number(cajeroBefore) + 50, 2);

      expect(await countPayouts(depositId)).toBe(1);

      const payouts = await ctx.tenantDb.execute(
        sql`SELECT beneficiary_user_id, payout_amount, status, wallet_tx_id FROM commission_payouts WHERE source_event_id = ${depositId}`,
      );
      const rows = payouts as unknown as Array<{
        beneficiary_user_id: string;
        payout_amount: string;
        status: string;
        wallet_tx_id: string | null;
      }>;
      expect(rows[0]!.beneficiary_user_id).toBe(cajeroId);
      expect(Number(rows[0]!.payout_amount)).toBeCloseTo(50, 2);
      expect(rows[0]!.status).toBe('paid');
      expect(rows[0]!.wallet_tx_id).not.toBeNull();
    });

    it('approver es ancestor (self-paid): approve acumula, settle mintea al cajero', async () => {
      // El cajero1 aprueba un deposit de SU propio cliente. Por regla
      // cajero=5%, el cajero1 es ancestor → es el beneficiary y el approver.
      await createRule('cajero', 'deposit_approved', '5.00');

      const client = await createTestUser(ctx.request, adminToken, {
        suite: 'commissions-apply',
        label: 'self_client',
        role: 'usuario_final',
      });
      await ctx.request
        .put(`/tenant/user-hierarchy/${client.id}/parent`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ parentUserId: cajeroId, relationType: 'jugador_de_cajero' });

      const methodId = await ensurePaymentMethod();
      const depositId = await insertDeposit(client.id, methodId, '500');

      const cajeroBefore = await getBalance(cajeroId);

      const res = await ctx.request
        .post(`/tenant/deposits/${depositId}/approve`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajeroToken);
      expect(res.status).toBe(200);

      // Paso 1: approve solo ACUMULA — accrued, sin tocar el saldo del cajero.
      expect(await countPayouts(depositId)).toBe(1);
      const accruedRows = (await ctx.tenantDb.execute(
        sql`SELECT wallet_tx_id, status FROM commission_payouts WHERE source_event_id = ${depositId}`,
      )) as unknown as Array<{ wallet_tx_id: string | null; status: string }>;
      expect(accruedRows[0]!.status).toBe('accrued');
      expect(accruedRows[0]!.wallet_tx_id).toBeNull();
      expect(await getBalance(cajeroId)).toBe(cajeroBefore);

      // Paso 2: settle mintea al cajero su comisión (5% de 500 = 25).
      const settle = await settleAllPayouts();
      expect(settle.settled).toBeGreaterThanOrEqual(1);

      const cajeroAfter = await getBalance(cajeroId);
      expect(Number(cajeroAfter)).toBeCloseTo(Number(cajeroBefore) + 25, 2);

      const payouts = await ctx.tenantDb.execute(
        sql`SELECT wallet_tx_id, status FROM commission_payouts WHERE source_event_id = ${depositId}`,
      );
      const rows = payouts as unknown as Array<{ wallet_tx_id: string | null; status: string }>;
      expect(rows[0]!.status).toBe('paid');
      expect(rows[0]!.wallet_tx_id).not.toBeNull();
    });

    it('sin rules activas: approve corre normal, sin payouts', async () => {
      // No creamos rules. El deposit se aprueba sin afectar commissions.
      const client = await createTestUser(ctx.request, adminToken, {
        suite: 'commissions-apply',
        label: 'no_rules_client',
        role: 'usuario_final',
      });
      const methodId = await ensurePaymentMethod();
      const depositId = await insertDeposit(client.id, methodId, '100');

      const res = await ctx.request
        .post(`/tenant/deposits/${depositId}/approve`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.status).toBe(200);
      expect(await countPayouts(depositId)).toBe(0);
    });

    it('idempotencia: re-approve mismo deposit no duplica payouts ni cobra dos veces', async () => {
      await mintToAdmin('10000');
      await createRule('cajero', 'deposit_approved', '5.00');

      const client = await createTestUser(ctx.request, adminToken, {
        suite: 'commissions-apply',
        label: 'idem_client',
        role: 'usuario_final',
      });
      await ctx.request
        .put(`/tenant/user-hierarchy/${client.id}/parent`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ parentUserId: cajeroId, relationType: 'jugador_de_cajero' });

      const methodId = await ensurePaymentMethod();
      const depositId = await insertDeposit(client.id, methodId, '400');

      const adminBefore = await getBalance(adminId);
      const cajeroBefore = await getBalance(cajeroId);

      // Primera aprobación: solo acumula (accrued), balances sin cambio.
      const r1 = await ctx.request
        .post(`/tenant/deposits/${depositId}/approve`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(r1.status).toBe(200);

      expect(await getBalance(adminId)).toBe(adminBefore);
      expect(await getBalance(cajeroId)).toBe(cajeroBefore);
      expect(await countPayouts(depositId)).toBe(1);

      // Segunda aprobación (idempotente: deposit ya está approved).
      const r2 = await ctx.request
        .post(`/tenant/deposits/${depositId}/approve`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(r2.status).toBe(200);

      // Sigue sin tocar saldos y sin duplicar el payout.
      expect(await getBalance(adminId)).toBe(adminBefore);
      expect(await getBalance(cajeroId)).toBe(cajeroBefore);
      expect(await countPayouts(depositId)).toBe(1);

      // Settle: el cajero gana su comisión (5% de 400 = 20) por mint, admin
      // queda igual.
      const settle1 = await settleAllPayouts();
      expect(settle1.settled).toBeGreaterThanOrEqual(1);

      const cajeroAfterSettle = await getBalance(cajeroId);
      expect(await getBalance(adminId)).toBe(adminBefore);
      expect(Number(cajeroAfterSettle)).toBeCloseTo(Number(cajeroBefore) + 20, 2);

      // Re-settle: ya están pagados → settled=0 y balances sin cambio.
      const settle2 = await settleAllPayouts();
      expect(settle2.settled).toBe(0);
      expect(await getBalance(adminId)).toBe(adminBefore);
      expect(await getBalance(cajeroId)).toBe(cajeroAfterSettle);
      expect(await countPayouts(depositId)).toBe(1);
    });

    it('multi-level chain: rule para cada nivel, todas se aplican', async () => {
      await mintToAdmin('10000');
      // 3 rules: cajero 5%, distribuidor 2%, socio 1%.
      await createRule('cajero', 'deposit_approved', '5.00');
      await createRule('distribuidor', 'deposit_approved', '2.00');
      await createRule('socio', 'deposit_approved', '1.00');

      // Setup: socio → distribuidor → cajero (nuestro cajero1) → client.
      const socio = await createTestUser(ctx.request, adminToken, {
        suite: 'commissions-apply',
        label: 'chain_socio',
        role: 'socio',
      });
      const distrib = await createTestUser(ctx.request, adminToken, {
        suite: 'commissions-apply',
        label: 'chain_distrib',
        role: 'distribuidor',
      });
      const client = await createTestUser(ctx.request, adminToken, {
        suite: 'commissions-apply',
        label: 'chain_client',
        role: 'usuario_final',
      });

      // Construir la jerarquía.
      await ctx.request
        .put(`/tenant/user-hierarchy/${distrib.id}/parent`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ parentUserId: socio.id, relationType: 'distribuidor_de_socio' });
      await ctx.request
        .put(`/tenant/user-hierarchy/${cajeroId}/parent`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ parentUserId: distrib.id, relationType: 'cajero_de_distribuidor' });
      await ctx.request
        .put(`/tenant/user-hierarchy/${client.id}/parent`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ parentUserId: cajeroId, relationType: 'jugador_de_cajero' });

      const methodId = await ensurePaymentMethod();
      const depositId = await insertDeposit(client.id, methodId, '1000');

      const adminBefore = await getBalance(adminId);
      const socioBefore = await getBalance(socio.id);
      const distribBefore = await getBalance(distrib.id);
      const cajeroBefore = await getBalance(cajeroId);

      const res = await ctx.request
        .post(`/tenant/deposits/${depositId}/approve`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.status).toBe(200);

      // Paso 1: approve acumula las 3 (accrued), ningún saldo cambia.
      expect(await countPayouts(depositId)).toBe(3);
      expect(await getBalance(adminId)).toBe(adminBefore);
      expect(await getBalance(cajeroId)).toBe(cajeroBefore);
      expect(await getBalance(distrib.id)).toBe(distribBefore);
      expect(await getBalance(socio.id)).toBe(socioBefore);

      // Paso 2: settle mintea las 3 comisiones.
      const settle = await settleAllPayouts();
      expect(settle.settled).toBe(3);
      // totalPaid ~ 50 + 20 + 10 = 80.
      expect(Number(settle.totalPaid)).toBeCloseTo(80, 2);

      // Admin queda igual (settle mintea, no debita).
      expect(await getBalance(adminId)).toBe(adminBefore);
      // Cada ancestor recibe lo suyo por mint.
      expect(Number(await getBalance(cajeroId))).toBeCloseTo(Number(cajeroBefore) + 50, 2);
      expect(Number(await getBalance(distrib.id))).toBeCloseTo(Number(distribBefore) + 20, 2);
      expect(Number(await getBalance(socio.id))).toBeCloseTo(Number(socioBefore) + 10, 2);

      expect(await countPayouts(depositId)).toBe(3);

      // Limpiar la jerarquía construida (cajero1 vuelve a no tener parent
      // para no contaminar otros tests).
      await ctx.tenantDb.execute(
        sql`DELETE FROM user_hierarchy WHERE user_id IN (${cajeroId}, ${distrib.id}, ${client.id})`,
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Withdrawals
  // ──────────────────────────────────────────────────────────────────────

  describe('withdrawal markPaid (Sprint 50: sin comisiones)', () => {
    it('markPaid corre OK SIN generar comisiones (aun con rule activa)', async () => {
      await mintToAdmin('10000');
      // Aun creando una rule de withdrawal_paid, Sprint 50 removió las
      // comisiones en withdrawals → markPaid NO debe generar payouts.
      await createRule('cajero', 'withdrawal_paid', '3.00');

      const client = await createTestUser(ctx.request, adminToken, {
        suite: 'commissions-apply',
        label: 'wd_client',
        role: 'usuario_final',
      });
      await ctx.request
        .put(`/tenant/user-hierarchy/${client.id}/parent`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ parentUserId: cajeroId, relationType: 'jugador_de_cajero' });

      // El cliente necesita saldo para poder hacer withdraw — minteamos al
      // admin y le transferimos via load para no inflar wallet.mint.
      const loadRes = await ctx.request
        .post('/tenant/wallet/load')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', freshKey('load-wd'))
        .send({ targetUserId: client.id, amount: '1000', notes: 'wd test' });
      expect([200, 201]).toContain(loadRes.status);

      const methodId = await ensurePaymentMethod();
      // Crear withdrawal con hold via API del jugador.
      const playerToken = await loginAs(
        ctx.request,
        client.username,
        client.password,
      );
      const wdRes = await ctx.request
        .post('/tenant/withdrawals')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken)
        .send({
          methodId,
          amountChips: '300',
          amountFiat: '300',
          currencyFiat: 'ARS',
          targetAccount: { cbu: '0000000000000000000000' },
        });
      expect(wdRes.status).toBe(201);
      const wdId = (wdRes.body as { withdrawal: { id: string } }).withdrawal.id;

      // Admin aprueba el withdrawal.
      const apprRes = await ctx.request
        .post(`/tenant/withdrawals/${wdId}/approve`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(apprRes.status).toBe(200);

      await matchOutgoingBankTxForWithdrawal(ctx.request, adminToken, wdId);

      const adminBefore = await getBalance(adminId);
      const cajeroBefore = await getBalance(cajeroId);

      // Admin marca paid. Sprint 50: ya NO se dispara ninguna commission.
      const payRes = await ctx.request
        .post(`/tenant/withdrawals/${wdId}/mark-paid`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ externalRef: 'ext-pay-test' });
      expect(payRes.status).toBe(200);

      // Sin comisiones: ningún balance de cajero/admin cambia por commission.
      expect(await getBalance(adminId)).toBe(adminBefore);
      expect(await getBalance(cajeroId)).toBe(cajeroBefore);

      // Y no se generó ningún payout para el withdrawal.
      expect(await countPayouts(wdId)).toBe(0);
    });
  });
});
