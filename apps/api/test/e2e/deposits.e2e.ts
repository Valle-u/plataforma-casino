/**
 * E2E: DepositsController (carga autoservicio del jugador).
 *
 * Cubre:
 *   - Solicitud: validaciones DTO, método inexistente, máx 2 pending.
 *   - Lista propia (jugador) + lista para review (cajero).
 *   - Aprobación: status cambia, wallet del user recibe `amount_chips`,
 *     wallet_tx_id linkeado, audit log generado.
 *   - Aprobación idempotente: segunda llamada devuelve mismo deposit + 1
 *     sola wallet tx.
 *   - Rechazo: status + reason + audit.
 *   - Aprobar después de rechazar → 409 ALREADY_RESOLVED.
 *   - Permission gates: usuario sin deposits.approve/reject → 403.
 *
 * Cada test usa users dedicados (createTestUser) para evitar
 * contaminación cross-suite.
 */

import postgres from 'postgres';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin, loginAsCajero1 } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser } from '../helpers/test-users';
import { getTestTenantUrl } from '../setup/db-helpers';

interface DepositView {
  id: string;
  userId: string;
  status: string;
  amountChips: string;
  amountFiat: string;
  currencyFiat: string;
  walletTxId: string | null;
  rejectionReason: string | null;
  reviewedBy: string | null;
}

/** Crea un payment method de test directamente en DB. */
async function createPaymentMethod(code: string): Promise<string> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    // Generamos un UUIDv7 simple via Postgres (no tenemos uuid7 nativo, usamos
    // gen_random_uuid que es v4 — para test no nos importa el orden).
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

describe('DepositsController (E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let cajero1Token: string;
  let methodId: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
    cajero1Token = await loginAsCajero1(ctx.request);
    methodId = await createPaymentMethod(`test-method-${Date.now().toString(36)}`);
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('POST /tenant/deposits - create', () => {
    it('valid request creates deposit con status pending', async () => {
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'dep-create',
        label: 'p',
        role: 'cajero', // any role works; lo importante es que sea user del tenant
      });
      const token = await loginAs(ctx.request, player.username, player.password);

      const r = await ctx.request
        .post('/tenant/deposits')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token)
        .send({
          methodId,
          amountFiat: '5000',
          currencyFiat: 'ARS',
          amountChips: '500',
        });

      expect(r.status).toBe(201);
      const body = r.body as { deposit: DepositView };
      expect(body.deposit.status).toBe('pending');
      expect(body.deposit.amountChips).toBe('500.00');
      expect(body.deposit.amountFiat).toBe('5000.00');
    });

    it('400 si methodId no es UUID', async () => {
      const r = await ctx.request
        .post('/tenant/deposits')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          methodId: 'not-a-uuid',
          amountFiat: '100',
          currencyFiat: 'ARS',
          amountChips: '100',
        });
      expect(r.status).toBe(400);
    });

    it('400 si amountChips <= 0', async () => {
      const r = await ctx.request
        .post('/tenant/deposits')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          methodId,
          amountFiat: '100',
          currencyFiat: 'ARS',
          amountChips: '0',
        });
      expect(r.status).toBe(400);
    });

    it('400 si currencyFiat no está en el whitelist', async () => {
      const r = await ctx.request
        .post('/tenant/deposits')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          methodId,
          amountFiat: '100',
          currencyFiat: 'EUR', // no en whitelist
          amountChips: '100',
        });
      expect(r.status).toBe(400);
    });

    it('400 INVALID_PAYMENT_METHOD si el method no existe', async () => {
      const r = await ctx.request
        .post('/tenant/deposits')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          methodId: '019e0000-0000-7000-8000-000000000000',
          amountFiat: '100',
          currencyFiat: 'ARS',
          amountChips: '100',
        });
      expect(r.status).toBe(400);
      expect((r.body as { error: string }).error).toBe('INVALID_PAYMENT_METHOD');
    });

    it('409 TOO_MANY_PENDING_DEPOSITS si el user ya tiene 2 pending', async () => {
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'dep-toomany',
        label: 'p',
        role: 'cajero',
      });
      const token = await loginAs(ctx.request, player.username, player.password);

      const body = {
        methodId,
        amountFiat: '100',
        currencyFiat: 'ARS',
        amountChips: '100',
      };

      const r1 = await ctx.request
        .post('/tenant/deposits')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token)
        .send(body);
      const r2 = await ctx.request
        .post('/tenant/deposits')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token)
        .send(body);
      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);

      const r3 = await ctx.request
        .post('/tenant/deposits')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token)
        .send(body);
      expect(r3.status).toBe(409);
      expect((r3.body as { error: string }).error).toBe('TOO_MANY_PENDING_DEPOSITS');
    });
  });

  describe('GET /tenant/deposits/mine', () => {
    it('devuelve solo los depósitos del actor', async () => {
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'dep-mine',
        label: 'p',
        role: 'cajero',
      });
      const token = await loginAs(ctx.request, player.username, player.password);

      await ctx.request
        .post('/tenant/deposits')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token)
        .send({
          methodId,
          amountFiat: '100',
          currencyFiat: 'ARS',
          amountChips: '100',
        });

      const r = await ctx.request
        .get('/tenant/deposits/mine')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token);
      expect(r.status).toBe(200);
      const data = (r.body as { data: DepositView[] }).data;
      expect(data.length).toBeGreaterThanOrEqual(1);
      for (const d of data) {
        expect(d.userId).toBe(player.id);
      }
    });
  });

  describe('GET /tenant/deposits (review list)', () => {
    it('cajero1 sin deposits.view → 403', async () => {
      const r = await ctx.request
        .get('/tenant/deposits')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero1Token);
      expect(r.status).toBe(403);
    });

    it('admin lista con filtro status', async () => {
      const r = await ctx.request
        .get('/tenant/deposits?status=pending')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(r.status).toBe(200);
      const body = r.body as { data: DepositView[]; total: number };
      for (const d of body.data) {
        expect(d.status).toBe('pending');
      }
    });
  });

  describe('POST /tenant/deposits/:id/approve', () => {
    it('aprueba: status → approved, walletTx generado, balance acreditado', async () => {
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'dep-app',
        label: 'p',
        role: 'cajero',
      });
      const playerToken = await loginAs(ctx.request, player.username, player.password);

      const created = await ctx.request
        .post('/tenant/deposits')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken)
        .send({
          methodId,
          amountFiat: '8000',
          currencyFiat: 'ARS',
          amountChips: '800',
        });
      const depositId = (created.body as { deposit: { id: string } }).deposit.id;

      const r = await ctx.request
        .post(`/tenant/deposits/${depositId}/approve`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(r.status).toBe(200);
      const body = r.body as { deposit: DepositView; walletTxId: string };
      expect(body.deposit.status).toBe('approved');
      expect(body.deposit.walletTxId).toBeTruthy();
      expect(body.walletTxId).toBe(body.deposit.walletTxId);

      // Wallet del player con balance 800.
      const wallet = await ctx.request
        .get(`/tenant/wallet/user/${player.id}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(parseFloat((wallet.body as { balance: string }).balance)).toBeCloseTo(800, 2);
    });

    it('approve es idempotente: segunda llamada devuelve mismo deposit + sin doble wallet tx', async () => {
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'dep-idem',
        label: 'p',
        role: 'cajero',
      });
      const playerToken = await loginAs(ctx.request, player.username, player.password);

      const created = await ctx.request
        .post('/tenant/deposits')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken)
        .send({
          methodId,
          amountFiat: '1000',
          currencyFiat: 'ARS',
          amountChips: '100',
        });
      const depositId = (created.body as { deposit: { id: string } }).deposit.id;

      const r1 = await ctx.request
        .post(`/tenant/deposits/${depositId}/approve`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const r2 = await ctx.request
        .post(`/tenant/deposits/${depositId}/approve`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      expect((r1.body as { walletTxId: string }).walletTxId).toBe(
        (r2.body as { walletTxId: string }).walletTxId,
      );

      // Balance == 100 (no se duplicó).
      const wallet = await ctx.request
        .get(`/tenant/wallet/user/${player.id}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(parseFloat((wallet.body as { balance: string }).balance)).toBeCloseTo(100, 2);
    });

    it('audit registra deposits.approve', async () => {
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'dep-audit',
        label: 'p',
        role: 'cajero',
      });
      const playerToken = await loginAs(ctx.request, player.username, player.password);

      const created = await ctx.request
        .post('/tenant/deposits')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken)
        .send({
          methodId,
          amountFiat: '300',
          currencyFiat: 'ARS',
          amountChips: '30',
        });
      const depositId = (created.body as { deposit: { id: string } }).deposit.id;

      await ctx.request
        .post(`/tenant/deposits/${depositId}/approve`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      const audit = await ctx.request
        .get(`/tenant/audit-log?actionCode=deposits.approve&targetId=${depositId}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const entries = (audit.body as { entries: Array<Record<string, unknown>> }).entries;
      expect(entries.length).toBe(1);
    });

    it('403 cajero1 sin deposits.approve', async () => {
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'dep-403',
        label: 'p',
        role: 'cajero',
      });
      const playerToken = await loginAs(ctx.request, player.username, player.password);
      const created = await ctx.request
        .post('/tenant/deposits')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken)
        .send({
          methodId,
          amountFiat: '100',
          currencyFiat: 'ARS',
          amountChips: '100',
        });
      const depositId = (created.body as { deposit: { id: string } }).deposit.id;

      const r = await ctx.request
        .post(`/tenant/deposits/${depositId}/approve`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero1Token);
      expect(r.status).toBe(403);
    });
  });

  describe('POST /tenant/deposits/:id/reject', () => {
    it('rechaza: status → rejected, reason guardado', async () => {
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'dep-rej',
        label: 'p',
        role: 'cajero',
      });
      const playerToken = await loginAs(ctx.request, player.username, player.password);
      const created = await ctx.request
        .post('/tenant/deposits')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken)
        .send({
          methodId,
          amountFiat: '500',
          currencyFiat: 'ARS',
          amountChips: '50',
        });
      const depositId = (created.body as { deposit: { id: string } }).deposit.id;

      const r = await ctx.request
        .post(`/tenant/deposits/${depositId}/reject`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ reason: 'comprobante ilegible' });
      expect(r.status).toBe(200);
      const body = r.body as { deposit: DepositView };
      expect(body.deposit.status).toBe('rejected');
      expect(body.deposit.rejectionReason).toBe('comprobante ilegible');
    });

    it('400 si falta reason', async () => {
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'dep-rej-noreason',
        label: 'p',
        role: 'cajero',
      });
      const playerToken = await loginAs(ctx.request, player.username, player.password);
      const created = await ctx.request
        .post('/tenant/deposits')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken)
        .send({
          methodId,
          amountFiat: '500',
          currencyFiat: 'ARS',
          amountChips: '50',
        });
      const depositId = (created.body as { deposit: { id: string } }).deposit.id;

      const r = await ctx.request
        .post(`/tenant/deposits/${depositId}/reject`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({});
      expect(r.status).toBe(400);
    });

    it('409 ALREADY_RESOLVED al aprobar un rejected', async () => {
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'dep-resolved',
        label: 'p',
        role: 'cajero',
      });
      const playerToken = await loginAs(ctx.request, player.username, player.password);
      const created = await ctx.request
        .post('/tenant/deposits')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken)
        .send({
          methodId,
          amountFiat: '100',
          currencyFiat: 'ARS',
          amountChips: '100',
        });
      const depositId = (created.body as { deposit: { id: string } }).deposit.id;

      await ctx.request
        .post(`/tenant/deposits/${depositId}/reject`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ reason: 'rechazado' });

      const r = await ctx.request
        .post(`/tenant/deposits/${depositId}/approve`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(r.status).toBe(409);
      expect((r.body as { error: string }).error).toBe('DEPOSIT_ALREADY_RESOLVED');
    });
  });

  describe('Scope sobre approve/reject', () => {
    it('cajero con deposits.approve PERO sin player en su red → 403 OUT_OF_SCOPE', async () => {
      // Setup: player crea su depósito. Cajero "ajeno" tiene
      // deposits.approve via override pero no tiene al player en red.
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'dep-scope-out',
        label: 'pl',
        role: 'cajero',
      });
      const cashier = await createTestUser(ctx.request, adminToken, {
        suite: 'dep-scope-out',
        label: 'cs',
        role: 'cajero',
      });
      await ctx.request
        .post('/tenant/permission-overrides/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ userId: cashier.id, permissionCode: 'deposits.approve' });

      const playerToken = await loginAs(ctx.request, player.username, player.password);
      const created = await ctx.request
        .post('/tenant/deposits')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken)
        .send({
          methodId,
          amountFiat: '100',
          currencyFiat: 'ARS',
          amountChips: '100',
        });
      const depositId = (created.body as { deposit: { id: string } }).deposit.id;

      const cashierToken = await loginAs(ctx.request, cashier.username, cashier.password);
      const r = await ctx.request
        .post(`/tenant/deposits/${depositId}/approve`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cashierToken);
      expect(r.status).toBe(403);
      expect((r.body as { error: string }).error).toBe('OUT_OF_SCOPE');
    });

    it('cajero CON player en su red → puede approve', async () => {
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'dep-scope-in',
        label: 'pl',
        role: 'cajero',
      });
      const cashier = await createTestUser(ctx.request, adminToken, {
        suite: 'dep-scope-in',
        label: 'cs',
        role: 'cajero',
      });
      // Asigno cashier como parent de player.
      await ctx.request
        .put(`/tenant/user-hierarchy/${player.id}/parent`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ parentUserId: cashier.id, relationType: 'jugador_de_cajero' });
      await ctx.request
        .post('/tenant/permission-overrides/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ userId: cashier.id, permissionCode: 'deposits.approve' });

      const playerToken = await loginAs(ctx.request, player.username, player.password);
      const created = await ctx.request
        .post('/tenant/deposits')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken)
        .send({
          methodId,
          amountFiat: '100',
          currencyFiat: 'ARS',
          amountChips: '100',
        });
      const depositId = (created.body as { deposit: { id: string } }).deposit.id;

      const cashierToken = await loginAs(ctx.request, cashier.username, cashier.password);
      const r = await ctx.request
        .post(`/tenant/deposits/${depositId}/approve`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cashierToken);
      expect(r.status).toBe(200);
    });

    it('reject fuera de red → 403 OUT_OF_SCOPE', async () => {
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'dep-rej-scope',
        label: 'pl',
        role: 'cajero',
      });
      const cashier = await createTestUser(ctx.request, adminToken, {
        suite: 'dep-rej-scope',
        label: 'cs',
        role: 'cajero',
      });
      await ctx.request
        .post('/tenant/permission-overrides/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ userId: cashier.id, permissionCode: 'deposits.reject' });

      const playerToken = await loginAs(ctx.request, player.username, player.password);
      const created = await ctx.request
        .post('/tenant/deposits')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken)
        .send({
          methodId,
          amountFiat: '50',
          currencyFiat: 'ARS',
          amountChips: '50',
        });
      const depositId = (created.body as { deposit: { id: string } }).deposit.id;

      const cashierToken = await loginAs(ctx.request, cashier.username, cashier.password);
      const r = await ctx.request
        .post(`/tenant/deposits/${depositId}/reject`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cashierToken)
        .send({ reason: 'rechazo de prueba fuera de red' });
      expect(r.status).toBe(403);
      expect((r.body as { error: string }).error).toBe('OUT_OF_SCOPE');
    });
  });

  describe('GET /tenant/deposits/:id', () => {
    it('404 si el deposit no existe', async () => {
      const r = await ctx.request
        .get('/tenant/deposits/019e0000-0000-7000-8000-000000000000')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(r.status).toBe(404);
    });
  });
});
