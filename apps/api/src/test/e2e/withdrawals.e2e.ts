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
import { matchOutgoingBankTxForWithdrawal } from '../helpers/bank-tx';
import { fundWalletForTests } from '../helpers/fund-wallet';
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

    // Fondear UNA VEZ saldo grande al admin del seed; todos los tests
    // que necesiten fondear users harán load desde acá. Evita crear
    // ownAdmin por test (que multiplicaba connections postgres).
    const me = await ctx.request
      .get('/tenant/auth/me')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken);
    const adminId = (me.body as { user: { id: string } }).user.id;
    await fundWalletForTests(adminId, '10000000');
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
    it('cajero1 puede listar (planilla cajero trae withdrawals.view_admin_network → alias a withdrawals.view)', async () => {
      // Con el nuevo modelo de planillas (Sprint 47+), la planilla `cajero`
      // incluye `withdrawals.view_admin_network` como permiso base. Ese
      // comodín se resuelve por alias a `withdrawals.view` scopéandolo al
      // admin_network (excluye sub-redes indep). Así que cajero1 SÍ ve el
      // listing de la red del admin, restringido a su scope.
      const r = await ctx.request
        .get('/tenant/withdrawals')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero1Token);
      expect(r.status).toBe(200);
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

      await matchOutgoingBankTxForWithdrawal(ctx.request, adminToken, id);
      const r = await ctx.request
        .post(`/tenant/withdrawals/${id}/mark-paid`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send();
      expect(r.status).toBe(200);
      const body = r.body as { withdrawal: WithdrawalView };
      expect(body.withdrawal.status).toBe('paid');
      expect(body.withdrawal.walletTxId).toBeTruthy();
      // Sprint 52: paidExternalRef auto-generada (sin referencia manual).
      expect(body.withdrawal.paidExternalRef).toMatch(/^WTH-/);

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

      await matchOutgoingBankTxForWithdrawal(ctx.request, adminToken, id);
      const r1 = await ctx.request
        .post(`/tenant/withdrawals/${id}/mark-paid`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send();
      const r2 = await ctx.request
        .post(`/tenant/withdrawals/${id}/mark-paid`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send();
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

  describe('POST /:id/pay-in-full (Fase 2 — pago completo)', () => {
    function pifPayload(amountFiat: string, overrides: Record<string, unknown> = {}) {
      // Sprint 53 (decisión dueño): el CBU de origen ya no se envía — con
      // subir el comprobante alcanza. Sprint 52: el comprobante es
      // obligatorio. Cada payload genera un receiptStorageKey único salvo
      // que el test lo pise explícitamente (para probar el dedupe).
      return {
        amount: amountFiat,
        currency: 'ARS',
        receivedAt: new Date().toISOString(),
        receiptUrl: `http://localhost/proofs/pif-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.pdf`,
        receiptStorageKey: `test/proofs/pif-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.pdf`,
        ...overrides,
      };
    }

    async function createApprovedWithdrawal(label: string, amountChips = '150') {
      const u = await createFundedUser(ctx, adminToken, label, '500');
      const c = await ctx.request
        .post('/tenant/withdrawals')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', u.token)
        .send({
          methodId,
          amountChips,
          currencyFiat: 'ARS',
          targetAccount: { cbu: '0' },
        });
      const w = (c.body as { withdrawal: WithdrawalView }).withdrawal;
      await ctx.request
        .post(`/tenant/withdrawals/${w.id}/approve`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      return { id: w.id, userId: u.id, amountFiat: w.amountFiat };
    }

    interface PifResponse {
      withdrawal: WithdrawalView;
      bankTransaction: {
        id: string;
        direction: string;
        status: string;
        amount: string;
        matchedWithdrawalId: string | null;
        overrideReason: string | null;
      };
      walletTx: { id: string; type: string; amount: string } | null;
    }

    it('approved → paid en un solo paso: bank_tx outgoing creada + matcheada + hold consumido', async () => {
      const { id, userId, amountFiat } = await createApprovedWithdrawal('pif-happy');
      const payload = pifPayload(amountFiat);

      const r = await ctx.request
        .post(`/tenant/withdrawals/${id}/pay-in-full`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', `pif-${id}-1`)
        .send(payload);
      expect(r.status).toBe(200);

      const body = r.body as PifResponse;
      expect(body.withdrawal.status).toBe('paid');
      expect(body.withdrawal.walletTxId).toBeTruthy();
      expect(body.withdrawal.paidExternalRef).toMatch(/^WTH-/);
      expect(body.bankTransaction.direction).toBe('outgoing');
      expect(body.bankTransaction.status).toBe('matched');
      expect(body.bankTransaction.matchedWithdrawalId).toBe(id);
      expect(body.bankTransaction.amount).toBe(amountFiat);
      expect(body.walletTx?.type).toBe('withdrawal');

      // Balance 500 - 150 = 350; locked 0.
      const wallet = await ctx.request
        .get(`/tenant/wallet/user/${userId}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(parseFloat((wallet.body as { balance: string }).balance)).toBeCloseTo(350, 2);
      expect(parseFloat((wallet.body as { lockedBalance: string }).lockedBalance)).toBeCloseTo(0, 2);

      // La bank_tx queda linkeada al retiro en el detalle.
      const detail = await ctx.request
        .get(`/tenant/withdrawals/${id}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect((detail.body as { withdrawal: WithdrawalView }).withdrawal.walletTxId).toBeTruthy();
    });

    it('idempotente: retry post-commit devuelve el mismo walletTxId y NO duplica bank_tx', async () => {
      const { id, userId, amountFiat } = await createApprovedWithdrawal('pif-idem');
      const payload = pifPayload(amountFiat);
      const key = `pif-${id}-retry`;

      const r1 = await ctx.request
        .post(`/tenant/withdrawals/${id}/pay-in-full`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', key)
        .send(payload);
      const r2 = await ctx.request
        .post(`/tenant/withdrawals/${id}/pay-in-full`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', key)
        .send(payload);

      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      const b1 = r1.body as PifResponse;
      const b2 = r2.body as PifResponse;
      expect(b2.withdrawal.walletTxId).toBe(b1.withdrawal.walletTxId);
      expect(b2.bankTransaction.id).toBe(b1.bankTransaction.id);
      expect(b2.withdrawal.paidExternalRef).toMatch(/^WTH-/);

      const wallet = await ctx.request
        .get(`/tenant/wallet/user/${userId}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(parseFloat((wallet.body as { balance: string }).balance)).toBeCloseTo(350, 2);
    });

    it('400 BANK_TX_AMOUNT_MISMATCH sin override, y la operación revierte (sin bank_tx huérfana)', async () => {
      const { id, amountFiat } = await createApprovedWithdrawal('pif-mismatch');
      const r = await ctx.request
        .post(`/tenant/withdrawals/${id}/pay-in-full`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', `pif-${id}-mismatch`)
        .send(pifPayload((Number(amountFiat) - 0.5).toFixed(2))); // difiere de amount_fiat
      expect(r.status).toBe(400);
      expect((r.body as { error: string }).error).toBe('BANK_TX_AMOUNT_MISMATCH');

      // Atomicidad: el retiro sigue approved y sin bank_tx (rollback completo).
      const detail = await ctx.request
        .get(`/tenant/withdrawals/${id}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const w = (detail.body as { withdrawal: WithdrawalView }).withdrawal;
      expect(w.status).toBe('approved');
      expect(w.walletTxId).toBeNull();
    });

    it('200 con override + motivo cuando el monto transferido difiere', async () => {
      const { id, amountFiat } = await createApprovedWithdrawal('pif-override');
      const reason = 'Comisión bancaria descontada en destino';
      const r = await ctx.request
        .post(`/tenant/withdrawals/${id}/pay-in-full`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', `pif-${id}-override`)
        .send(pifPayload((Number(amountFiat) - 0.5).toFixed(2), { override: true, overrideReason: reason }));
      expect(r.status).toBe(200);
      const body = r.body as PifResponse;
      expect(body.withdrawal.status).toBe('paid');
      expect(body.bankTransaction.overrideReason).toBe(reason);
    });

    it('400 si falta el header Idempotency-Key', async () => {
      const { id } = await createApprovedWithdrawal('pif-noidem');
      const r = await ctx.request
        .post(`/tenant/withdrawals/${id}/pay-in-full`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send(pifPayload('1500'));
      expect(r.status).toBe(400);
    });

    it('409 WITHDRAWAL_INVALID_STATE si el retiro está pending (sin approve)', async () => {
      const u = await createFundedUser(ctx, adminToken, 'pif-pending', '500');
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
        .post(`/tenant/withdrawals/${id}/pay-in-full`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', `pif-${id}-pending`)
        .send(pifPayload('1000'));
      expect(r.status).toBe(409);
      expect((r.body as { error: string }).error).toBe('WITHDRAWAL_INVALID_STATE');
    });

    it('409 BANK_TX_DUPLICATE_REF si el mismo comprobante ya se usó en otra bank_tx', async () => {
      const a = await createApprovedWithdrawal('pif-dup-a');
      // Mismo comprobante (receipt_storage_key) para ambos intentos — el
      // dedupe por comprobante reemplaza al viejo dedupe por bankReference.
      const payload = pifPayload(a.amountFiat, {
        receiptStorageKey: `test/proofs/pif-same-${Date.now().toString(36)}.pdf`,
      });
      const r1 = await ctx.request
        .post(`/tenant/withdrawals/${a.id}/pay-in-full`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', `pif-${a.id}-dup`)
        .send(payload);
      expect(r1.status).toBe(200);

      const b = await createApprovedWithdrawal('pif-dup-b');
      const r2 = await ctx.request
        .post(`/tenant/withdrawals/${b.id}/pay-in-full`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', `pif-${b.id}-dup`)
        .send(payload); // mismo comprobante
      expect(r2.status).toBe(409);
      expect((r2.body as { error: string }).error).toBe('BANK_TX_DUPLICATE_REF');
    });

    it('403 si el actor tiene withdrawals.process pero NO bank_tx.upload/match', async () => {
      const { id, userId } = await createApprovedWithdrawal('pif-perm');
      const cashier = await createTestUser(ctx.request, adminToken, {
        suite: 'wd-pif-perm',
        label: 'cs',
        role: 'cajero',
      });
      // El player del retiro queda en la red del cajero para que el scope pase
      // y así aislar el chequeo de permisos atómicos (que corre ANTES en el guard).
      await ctx.request
        .put(`/tenant/user-hierarchy/${userId}/parent`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ parentUserId: cashier.id, relationType: 'jugador_de_cajero' });
      await ctx.request
        .post('/tenant/permission-overrides/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ userId: cashier.id, permissionCode: 'withdrawals.process' });

      const cashierToken = await loginAs(ctx.request, cashier.username, cashier.password);
      const r = await ctx.request
        .post(`/tenant/withdrawals/${id}/pay-in-full`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cashierToken)
        .set('Idempotency-Key', `pif-${id}-perm`)
        .send(pifPayload('1500'));
      expect(r.status).toBe(403);
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
        .send();
      expect(r.status).toBe(409);
    });
  });

  describe('Scope sobre approve/reject/mark-paid/mark-failed', () => {
    it('cajero con withdrawals.approve SIN player en red → 403 OUT_OF_SCOPE', async () => {
      const player = await createFundedUser(ctx, adminToken, 'sc-out-p', '500');
      const cashier = await createTestUser(ctx.request, adminToken, {
        suite: 'wd-sc-out',
        label: 'cs',
        role: 'cajero',
      });
      await ctx.request
        .post('/tenant/permission-overrides/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ userId: cashier.id, permissionCode: 'withdrawals.approve' });

      const created = await ctx.request
        .post('/tenant/withdrawals')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token)
        .send({
          methodId,
          amountChips: '100',
          amountFiat: '1000',
          currencyFiat: 'ARS',
          targetAccount: { cbu: '0' },
        });
      const id = (created.body as { withdrawal: { id: string } }).withdrawal.id;

      const cashierToken = await loginAs(ctx.request, cashier.username, cashier.password);
      const r = await ctx.request
        .post(`/tenant/withdrawals/${id}/approve`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cashierToken);
      expect(r.status).toBe(403);
      expect((r.body as { error: string }).error).toBe('OUT_OF_SCOPE');
    });

    it('cajero CON player en red → puede approve + mark-paid', async () => {
      const player = await createFundedUser(ctx, adminToken, 'sc-in-p', '500');
      const cashier = await createTestUser(ctx.request, adminToken, {
        suite: 'wd-sc-in',
        label: 'cs',
        role: 'cajero',
      });
      await ctx.request
        .put(`/tenant/user-hierarchy/${player.id}/parent`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ parentUserId: cashier.id, relationType: 'jugador_de_cajero' });
      for (const code of ['withdrawals.approve', 'withdrawals.process']) {
        await ctx.request
          .post('/tenant/permission-overrides/grant')
          .set('Host', TEST_TENANT.host)
          .set('Authorization', adminToken)
          .send({ userId: cashier.id, permissionCode: code });
      }

      const created = await ctx.request
        .post('/tenant/withdrawals')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token)
        .send({
          methodId,
          amountChips: '100',
          amountFiat: '1000',
          currencyFiat: 'ARS',
          targetAccount: { cbu: '0' },
        });
      const id = (created.body as { withdrawal: { id: string } }).withdrawal.id;

      const cashierToken = await loginAs(ctx.request, cashier.username, cashier.password);
      const approve = await ctx.request
        .post(`/tenant/withdrawals/${id}/approve`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cashierToken);
      expect(approve.status).toBe(200);

      await matchOutgoingBankTxForWithdrawal(ctx.request, adminToken, id);
      const paid = await ctx.request
        .post(`/tenant/withdrawals/${id}/mark-paid`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cashierToken)
        .send();
      expect(paid.status).toBe(200);
    });
  });

  describe('POST /tenant/withdrawals/on-behalf* (retiro en nombre del jugador)', () => {
    interface OnBehalfPaidResponse {
      withdrawal: WithdrawalView;
      bankTransaction: { id: string; direction: string; status: string; amount: string };
      walletTx: { id: string; type: string; amount: string } | null;
    }

    /** Crea un jugador (usuario_final) fondeado con `amount` fichas. */
    async function createFundedPlayer(label: string, amount: string) {
      const user = await createTestUser(ctx.request, adminToken, {
        suite: 'wd-ob',
        label,
        role: 'usuario_final',
      });
      await ctx.request
        .post('/tenant/wallet/load')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', `ob-load-${user.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
        .send({ targetUserId: user.id, amount });
      return user;
    }

    /** Payload del pago en un paso. amountFiat == amountChips (ratio 1). */
    function obPaidPayload(
      targetUserId: string,
      amountChips: string,
      overrides: Record<string, unknown> = {},
    ) {
      const rand = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      return {
        targetUserId,
        methodId,
        amountChips,
        currencyFiat: 'ARS',
        targetAccount: { cbu: '0000000000000000000000' },
        reason: 'El jugador no sabe hacer la solicitud',
        amount: Number(amountChips).toFixed(2),
        currency: 'ARS',
        receivedAt: new Date().toISOString(),
        receiptUrl: `http://localhost/proofs/ob-${rand}.pdf`,
        receiptStorageKey: `test/proofs/ob-${rand}.pdf`,
        ...overrides,
      };
    }

    it('on-behalf-paid: crea+paga en un paso → retiro REAL (type withdrawal), balance del jugador debitado', async () => {
      const player = await createFundedPlayer('happy', '500');

      const r = await ctx.request
        .post('/tenant/withdrawals/on-behalf-paid')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', `ob-${player.id}-1`)
        .send(obPaidPayload(player.id, '150'));
      expect(r.status).toBe(201);

      const body = r.body as OnBehalfPaidResponse;
      expect(body.withdrawal.status).toBe('paid');
      expect(body.withdrawal.userId).toBe(player.id);
      expect(body.withdrawal.walletTxId).toBeTruthy();
      expect(body.withdrawal.paidExternalRef).toMatch(/^WTH-/);
      // La clave del diagnóstico: es un retiro (type 'withdrawal'), NO un unload.
      expect(body.walletTx?.type).toBe('withdrawal');
      expect(body.bankTransaction.direction).toBe('outgoing');
      expect(body.bankTransaction.status).toBe('matched');

      const wallet = await ctx.request
        .get(`/tenant/wallet/user/${player.id}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(parseFloat((wallet.body as { balance: string }).balance)).toBeCloseTo(350, 2);
      expect(parseFloat((wallet.body as { lockedBalance: string }).lockedBalance)).toBeCloseTo(0, 2);
    });

    it('400 WITHDRAWAL_TARGET_NOT_PLAYER si el target es un operador', async () => {
      const cajero = await createTestUser(ctx.request, adminToken, {
        suite: 'wd-ob',
        label: 'notplayer',
        role: 'cajero',
      });
      const r = await ctx.request
        .post('/tenant/withdrawals/on-behalf-paid')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', `ob-${cajero.id}-np`)
        .send(obPaidPayload(cajero.id, '50'));
      expect(r.status).toBe(400);
      expect((r.body as { error: string }).error).toBe('WITHDRAWAL_TARGET_NOT_PLAYER');
    });

    it('400 si falta el comprobante (receiptStorageKey)', async () => {
      const player = await createFundedPlayer('noreceipt', '200');
      const payload = obPaidPayload(player.id, '100');
      delete (payload as Record<string, unknown>).receiptStorageKey;
      const r = await ctx.request
        .post('/tenant/withdrawals/on-behalf-paid')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', `ob-${player.id}-nr`)
        .send(payload);
      expect(r.status).toBe(400);
    });

    it('403 si el actor no tiene permisos de pago (cajero1 solo tiene withdrawals.view)', async () => {
      const player = await createFundedPlayer('perm', '200');
      const r = await ctx.request
        .post('/tenant/withdrawals/on-behalf-paid')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero1Token)
        .set('Idempotency-Key', `ob-${player.id}-perm`)
        .send(obPaidPayload(player.id, '50'));
      expect(r.status).toBe(403);
    });

    it('on-behalf (pendiente): crea el retiro en la cola con hold, sin pagar', async () => {
      const player = await createFundedPlayer('pending', '300');
      const r = await ctx.request
        .post('/tenant/withdrawals/on-behalf')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          targetUserId: player.id,
          methodId,
          amountChips: '100',
          currencyFiat: 'ARS',
          targetAccount: { cbu: '0000000000000000000000' },
          reason: 'El jugador no sabe hacer la solicitud',
        });
      expect(r.status).toBe(201);
      const w = (r.body as { withdrawal: WithdrawalView }).withdrawal;
      expect(w.status).toBe('pending');
      expect(w.userId).toBe(player.id);
      expect(w.holdId).toBeTruthy();

      // El hold reserva las fichas: balance 300, locked 100.
      const wallet = await ctx.request
        .get(`/tenant/wallet/user/${player.id}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(parseFloat((wallet.body as { balance: string }).balance)).toBeCloseTo(300, 2);
      expect(parseFloat((wallet.body as { lockedBalance: string }).lockedBalance)).toBeCloseTo(100, 2);
    });

    it('doble-submit del mismo comprobante: el segundo falla (409) y el balance se debita una sola vez', async () => {
      const player = await createFundedPlayer('dup', '500');
      const payload = obPaidPayload(player.id, '150'); // MISMO receiptStorageKey en ambos

      const r1 = await ctx.request
        .post('/tenant/withdrawals/on-behalf-paid')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', `ob-${player.id}-d1`)
        .send(payload);
      const r2 = await ctx.request
        .post('/tenant/withdrawals/on-behalf-paid')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', `ob-${player.id}-d2`)
        .send(payload);

      expect(r1.status).toBe(201);
      expect(r2.status).toBe(409);

      // Atomicidad: el segundo revierte por completo, balance debitado una vez.
      const wallet = await ctx.request
        .get(`/tenant/wallet/user/${player.id}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(parseFloat((wallet.body as { balance: string }).balance)).toBeCloseTo(350, 2);
      expect(parseFloat((wallet.body as { lockedBalance: string }).lockedBalance)).toBeCloseTo(0, 2);
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
