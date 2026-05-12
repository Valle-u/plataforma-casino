/**
 * E2E: WithdrawalsController (flujo de retiro con holds).
 *
 * Cubre:
 *   - Create: validaciones DTO, método inexistente, max 2 pending,
 *     hold inmediato, INSUFFICIENT_BALANCE si saldo insuficiente.
 *   - Lista propia / lista para review.
 *   - Approve: transición pending → approved, NO mueve saldo.
 *   - Reject: status + reason + hold liberado (balance disponible vuelve).
 *   - Mark paid: balance debitado, hold liberado, wallet tx withdrawal generada.
 *   - Mark failed: hold liberado.
 *   - Cross-state: aprobar un rejected → 409 INVALID_STATE.
 *   - Idempotencia: marcar paid dos veces → mismo wallet tx.
 *   - Permission gates.
 */

import postgres from 'postgres';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin, loginAsCajero1 } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser } from '../helpers/test-users';
import { getTestTenantUrl } from '../setup/db-helpers';

interface WithdrawalView {
  id: string;
  userId: string;
  status: string;
  amountChips: string;
  amountFiat: string;
  currencyFiat: string;
  holdId: string | null;
  walletTxId: string | null;
  rejectionReason: string | null;
  failureReason: string | null;
  paidExternalRef: string | null;
}

async function createPaymentMethod(code: string): Promise<string> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO payment_methods (id, code, name, type, config, is_active)
      VALUES (gen_random_uuid(), ${code}, ${code + ' display'}, 'bank_transfer', '{"cbu":"0000000000000000000000"}'::jsonb, true)
      RETURNING id
    `;
    return rows[0]!.id;
  } finally {
    await sql.end();
  }
}

/**
 * Crea un user + lo fondea con `amount` chips usando el admin del seed.
 * El admin se mintea UNA VEZ por suite (en beforeAll) con saldo grande;
 * cada test solo hace load (sin crear ownAdmin extra). Reduce el pool
 * pressure significativamente vs crear ownAdmin por test.
 */
async function createFundedUser(
  ctx: TestApp,
  adminToken: string,
  label: string,
  amount: string,
): Promise<{ id: string; username: string; password: string; token: string }> {
  const user = await createTestUser(ctx.request, adminToken, {
    suite: 'wd',
    label,
    role: 'cajero',
  });
  await ctx.request
    .post('/tenant/wallet/load')
    .set('Host', TEST_TENANT.host)
    .set('Authorization', adminToken)
    .set('Idempotency-Key', `wd-load-${user.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
    .send({ targetUserId: user.id, amount });
  const token = await loginAs(ctx.request, user.username, user.password);
  return { ...user, token };
}

describe('WithdrawalsController (E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let cajero1Token: string;
  let methodId: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
    cajero1Token = await loginAsCajero1(ctx.request);
    methodId = await createPaymentMethod(`wd-method-${Date.now().toString(36)}`);

    // Mintear UNA VEZ saldo grande al admin del seed; todos los tests
    // que necesiten fondear users harán load desde acá. Evita crear
    // ownAdmin por test (que multiplicaba connections postgres).
    await ctx.request
      .post('/tenant/wallet/mint')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .set('Idempotency-Key', `wd-suite-mint-${Date.now()}`)
      .send({ amount: '10000000', reason: 'wd suite mint' });
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('POST /tenant/withdrawals - create', () => {
    it('valid request: status pending, hold creado, saldo disponible se reduce', async () => {
      const u = await createFundedUser(ctx, adminToken, 'cr', '1000');

      // Antes del withdrawal: balance 1000, locked 0.
      const before = await ctx.request
        .get('/tenant/wallet/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', u.token);
      expect(parseFloat((before.body as { balance: string }).balance)).toBeCloseTo(1000, 2);
      expect(parseFloat((before.body as { lockedBalance: string }).lockedBalance)).toBeCloseTo(0, 2);

      const r = await ctx.request
        .post('/tenant/withdrawals')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', u.token)
        .send({
          methodId,
          amountChips: '300',
          amountFiat: '3000',
          currencyFiat: 'ARS',
          targetAccount: { cbu: '0000000000000000000000' },
        });

      expect(r.status).toBe(201);
      const body = r.body as { withdrawal: WithdrawalView };
      expect(body.withdrawal.status).toBe('pending');
      expect(body.withdrawal.holdId).toBeTruthy();

      // Después: balance sigue 1000, locked 300.
      const after = await ctx.request
        .get('/tenant/wallet/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', u.token);
      expect(parseFloat((after.body as { balance: string }).balance)).toBeCloseTo(1000, 2);
      expect(parseFloat((after.body as { lockedBalance: string }).lockedBalance)).toBeCloseTo(300, 2);
    });

    it('400 si amountChips <= 0', async () => {
      const u = await createFundedUser(ctx, adminToken, 'cr-amt0', '100');
      const r = await ctx.request
        .post('/tenant/withdrawals')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', u.token)
        .send({
          methodId,
          amountChips: '0',
          amountFiat: '0',
          currencyFiat: 'ARS',
          targetAccount: {},
        });
      expect(r.status).toBe(400);
    });

    it('400 si falta targetAccount', async () => {
      const u = await createFundedUser(ctx, adminToken, 'cr-no-ta', '100');
      const r = await ctx.request
        .post('/tenant/withdrawals')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', u.token)
        .send({
          methodId,
          amountChips: '50',
          amountFiat: '500',
          currencyFiat: 'ARS',
        });
      expect(r.status).toBe(400);
    });

    it('400 INVALID_PAYMENT_METHOD si el method no existe', async () => {
      const u = await createFundedUser(ctx, adminToken, 'cr-nomet', '100');
      const r = await ctx.request
        .post('/tenant/withdrawals')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', u.token)
        .send({
          methodId: '019e0000-0000-7000-8000-000000000000',
          amountChips: '50',
          amountFiat: '500',
          currencyFiat: 'ARS',
          targetAccount: { cbu: '0' },
        });
      expect(r.status).toBe(400);
      expect((r.body as { error: string }).error).toBe('INVALID_PAYMENT_METHOD');
    });

    it('409 INSUFFICIENT_BALANCE si pide más de lo disponible', async () => {
      const u = await createFundedUser(ctx, adminToken, 'cr-insuf', '100');
      const r = await ctx.request
        .post('/tenant/withdrawals')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', u.token)
        .send({
          methodId,
          amountChips: '500', // tiene 100.
          amountFiat: '5000',
          currencyFiat: 'ARS',
          targetAccount: { cbu: '0' },
        });
      expect(r.status).toBe(409);
      expect((r.body as { error: string }).error).toBe('INSUFFICIENT_BALANCE');
    });

    it('409 TOO_MANY_PENDING_WITHDRAWALS', async () => {
      const u = await createFundedUser(ctx, adminToken, 'cr-many', '1000');
      const body = {
        methodId,
        amountChips: '50',
        amountFiat: '500',
        currencyFiat: 'ARS',
        targetAccount: { cbu: '0' },
      };
      const r1 = await ctx.request
        .post('/tenant/withdrawals')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', u.token)
        .send(body);
      const r2 = await ctx.request
        .post('/tenant/withdrawals')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', u.token)
        .send(body);
      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);

      const r3 = await ctx.request
        .post('/tenant/withdrawals')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', u.token)
        .send(body);
      expect(r3.status).toBe(409);
      expect((r3.body as { error: string }).error).toBe('TOO_MANY_PENDING_WITHDRAWALS');
    });
  });

  describe('GET /tenant/withdrawals (review)', () => {
    it('403 sin withdrawals.view (cajero1)', async () => {
      const r = await ctx.request
        .get('/tenant/withdrawals')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero1Token);
      expect(r.status).toBe(403);
    });

    it('admin lista por status', async () => {
      const r = await ctx.request
        .get('/tenant/withdrawals?status=pending')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(r.status).toBe(200);
      const body = r.body as { data: WithdrawalView[]; total: number };
      for (const w of body.data) expect(w.status).toBe('pending');
    });
  });

  describe('POST /:id/approve', () => {
    it('pending → approved, balance + locked sin cambios', async () => {
      const u = await createFundedUser(ctx, adminToken, 'apr', '500');
      const c = await ctx.request
        .post('/tenant/withdrawals')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', u.token)
        .send({
          methodId,
          amountChips: '100',
          amountFiat: '1000',
          currencyFiat: 'ARS',
          targetAccount: { cbu: '0' },
        });
      const id = (c.body as { withdrawal: WithdrawalView }).withdrawal.id;

      const r = await ctx.request
        .post(`/tenant/withdrawals/${id}/approve`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(r.status).toBe(200);
      expect((r.body as { withdrawal: WithdrawalView }).withdrawal.status).toBe('approved');

      // Saldo intacto: balance 500, locked 100.
      const wallet = await ctx.request
        .get(`/tenant/wallet/user/${u.id}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(parseFloat((wallet.body as { balance: string }).balance)).toBeCloseTo(500, 2);
      expect(parseFloat((wallet.body as { lockedBalance: string }).lockedBalance)).toBeCloseTo(100, 2);
    });
  });

  describe('POST /:id/reject', () => {
    it('libera el hold, locked_balance vuelve a 0', async () => {
      const u = await createFundedUser(ctx, adminToken, 'rej', '500');
      const c = await ctx.request
        .post('/tenant/withdrawals')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', u.token)
        .send({
          methodId,
          amountChips: '200',
          amountFiat: '2000',
          currencyFiat: 'ARS',
          targetAccount: { cbu: '0' },
        });
      const id = (c.body as { withdrawal: WithdrawalView }).withdrawal.id;

      const r = await ctx.request
        .post(`/tenant/withdrawals/${id}/reject`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ reason: 'CBU inválido' });
      expect(r.status).toBe(200);
      expect((r.body as { withdrawal: WithdrawalView }).withdrawal.status).toBe('rejected');
      expect((r.body as { withdrawal: WithdrawalView }).withdrawal.rejectionReason).toBe('CBU inválido');

      const wallet = await ctx.request
        .get(`/tenant/wallet/user/${u.id}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      // Balance 500, locked vuelve a 0.
      expect(parseFloat((wallet.body as { balance: string }).balance)).toBeCloseTo(500, 2);
      expect(parseFloat((wallet.body as { lockedBalance: string }).lockedBalance)).toBeCloseTo(0, 2);
    });

    it('400 si falta reason', async () => {
      const u = await createFundedUser(ctx, adminToken, 'rej-nr', '100');
      const c = await ctx.request
        .post('/tenant/withdrawals')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', u.token)
        .send({
          methodId,
          amountChips: '50',
          amountFiat: '500',
          currencyFiat: 'ARS',
          targetAccount: { cbu: '0' },
        });
      const id = (c.body as { withdrawal: WithdrawalView }).withdrawal.id;
      const r = await ctx.request
        .post(`/tenant/withdrawals/${id}/reject`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({});
      expect(r.status).toBe(400);
    });
  });

  describe('POST /:id/mark-paid', () => {
    it('approved → paid: balance debitado, locked liberado, wallet tx generada', async () => {
      const u = await createFundedUser(ctx, adminToken, 'paid', '500');
      const c = await ctx.request
        .post('/tenant/withdrawals')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', u.token)
        .send({
          methodId,
          amountChips: '150',
          amountFiat: '1500',
          currencyFiat: 'ARS',
          targetAccount: { cbu: '0' },
        });
      const id = (c.body as { withdrawal: WithdrawalView }).withdrawal.id;

      await ctx.request
        .post(`/tenant/withdrawals/${id}/approve`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      const r = await ctx.request
        .post(`/tenant/withdrawals/${id}/mark-paid`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ externalRef: '0xABCDEF123' });
      expect(r.status).toBe(200);
      const body = r.body as { withdrawal: WithdrawalView };
      expect(body.withdrawal.status).toBe('paid');
      expect(body.withdrawal.walletTxId).toBeTruthy();
      expect(body.withdrawal.paidExternalRef).toBe('0xABCDEF123');

      // Balance 500 - 150 = 350. Locked 0.
      const wallet = await ctx.request
        .get(`/tenant/wallet/user/${u.id}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(parseFloat((wallet.body as { balance: string }).balance)).toBeCloseTo(350, 2);
      expect(parseFloat((wallet.body as { lockedBalance: string }).lockedBalance)).toBeCloseTo(0, 2);
    });

    it('idempotente: segunda llamada devuelve mismo walletTxId', async () => {
      const u = await createFundedUser(ctx, adminToken, 'paid-idem', '500');
      const c = await ctx.request
        .post('/tenant/withdrawals')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', u.token)
        .send({
          methodId,
          amountChips: '100',
          amountFiat: '1000',
          currencyFiat: 'ARS',
          targetAccount: { cbu: '0' },
        });
      const id = (c.body as { withdrawal: WithdrawalView }).withdrawal.id;

      await ctx.request
        .post(`/tenant/withdrawals/${id}/approve`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      const r1 = await ctx.request
        .post(`/tenant/withdrawals/${id}/mark-paid`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ externalRef: 'ref-1' });
      const r2 = await ctx.request
        .post(`/tenant/withdrawals/${id}/mark-paid`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ externalRef: 'ref-1' });
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      expect((r1.body as { withdrawal: WithdrawalView }).withdrawal.walletTxId).toBe(
        (r2.body as { withdrawal: WithdrawalView }).withdrawal.walletTxId,
      );

      // Balance no se debitó doble.
      const wallet = await ctx.request
        .get(`/tenant/wallet/user/${u.id}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(parseFloat((wallet.body as { balance: string }).balance)).toBeCloseTo(400, 2);
    });
  });

  describe('POST /:id/mark-failed', () => {
    it('approved → failed: hold liberado, balance no cambia', async () => {
      const u = await createFundedUser(ctx, adminToken, 'fail', '500');
      const c = await ctx.request
        .post('/tenant/withdrawals')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', u.token)
        .send({
          methodId,
          amountChips: '120',
          amountFiat: '1200',
          currencyFiat: 'ARS',
          targetAccount: { cbu: '0' },
        });
      const id = (c.body as { withdrawal: WithdrawalView }).withdrawal.id;
      await ctx.request
        .post(`/tenant/withdrawals/${id}/approve`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      const r = await ctx.request
        .post(`/tenant/withdrawals/${id}/mark-failed`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ reason: 'cuenta destino bloqueada' });
      expect(r.status).toBe(200);
      expect((r.body as { withdrawal: WithdrawalView }).withdrawal.status).toBe('failed');

      // Balance 500, locked 0.
      const wallet = await ctx.request
        .get(`/tenant/wallet/user/${u.id}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(parseFloat((wallet.body as { balance: string }).balance)).toBeCloseTo(500, 2);
      expect(parseFloat((wallet.body as { lockedBalance: string }).lockedBalance)).toBeCloseTo(0, 2);
    });
  });

  describe('Cross-state errors', () => {
    it('409 INVALID_STATE si apruebo un rejected', async () => {
      const u = await createFundedUser(ctx, adminToken, 'cs1', '200');
      const c = await ctx.request
        .post('/tenant/withdrawals')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', u.token)
        .send({
          methodId,
          amountChips: '50',
          amountFiat: '500',
          currencyFiat: 'ARS',
          targetAccount: { cbu: '0' },
        });
      const id = (c.body as { withdrawal: WithdrawalView }).withdrawal.id;
      await ctx.request
        .post(`/tenant/withdrawals/${id}/reject`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ reason: 'rechazado para test cross-state' });

      const r = await ctx.request
        .post(`/tenant/withdrawals/${id}/approve`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(r.status).toBe(409);
      expect((r.body as { error: string }).error).toBe('WITHDRAWAL_INVALID_STATE');
    });

    it('409 INVALID_STATE si mark-paid sobre pending (sin approve)', async () => {
      const u = await createFundedUser(ctx, adminToken, 'cs2', '200');
      const c = await ctx.request
        .post('/tenant/withdrawals')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', u.token)
        .send({
          methodId,
          amountChips: '50',
          amountFiat: '500',
          currencyFiat: 'ARS',
          targetAccount: { cbu: '0' },
        });
      const id = (c.body as { withdrawal: WithdrawalView }).withdrawal.id;

      const r = await ctx.request
        .post(`/tenant/withdrawals/${id}/mark-paid`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ externalRef: 'ref-cross-state-test' });
      expect(r.status).toBe(409);
    });
  });

  describe('GET /:id', () => {
    it('404 si no existe', async () => {
      const r = await ctx.request
        .get('/tenant/withdrawals/019e0000-0000-7000-8000-000000000000')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(r.status).toBe(404);
    });
  });
});
