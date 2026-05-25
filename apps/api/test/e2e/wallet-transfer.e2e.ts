/**
 * E2E: load y unload (transferencias entre dos wallets).
 *
 * Casos cubiertos:
 *   - Validaciones DTO: amount, targetUserId UUID, reason en unload.
 *   - Permission gates: cajero1 sin wallet.load → 403.
 *   - Anti-self: actor.id === targetUserId → 409 SELF_TRANSFER.
 *   - Target inexistente → 409 TARGET_NOT_FOUND.
 *   - Saldo insuficiente del source → 409 INSUFFICIENT_BALANCE.
 *   - Happy path load: balance source baja, target sube, audit entries.
 *   - Par de transactions linkeadas via related_tx_id.
 *   - Idempotencia: misma key → mismo par. Body distinto → 409.
 *   - Concurrencia: N loads concurrentes A→B → balances exactos.
 *   - Anti-deadlock: A→B y B→A concurrentes → ambos completan sin
 *     deadlock (validamos balances finales).
 *   - Unload: inverso, con reason obligatorio.
 *
 * Estos tests están en suite separada (`wallet-transfer.e2e.ts`) para
 * mantener `wallet.e2e.ts` enfocado en mint/burn/get.
 */

import postgres from 'postgres';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin, loginAsCajero1, loginAsCajero2 } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser } from '../helpers/test-users';
import { getTestTenantUrl } from '../setup/db-helpers';

interface WalletView {
  id: string;
  userId: string;
  balance: string;
  lockedBalance: string;
  currency: string;
  version: number;
  updatedAt: string;
}

interface TransferResponse {
  ok: true;
  sourceTransaction: {
    id: string;
    type: string;
    amount: string;
    balanceAfter: string;
    createdAt: string;
  };
  targetTransaction: {
    id: string;
    type: string;
    amount: string;
    balanceAfter: string;
    createdAt: string;
    relatedTxId: string | null;
  };
  sourceWallet: WalletView;
  targetWallet: WalletView;
}

function freshKey(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

describe('Wallet transfers - load/unload (E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let adminId: string;
  let cajero1Token: string;
  let cajero1Id: string;
  let cajero2Token: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
    cajero1Token = await loginAsCajero1(ctx.request);
    cajero2Token = await loginAsCajero2(ctx.request);

    const me = await ctx.request
      .get('/tenant/auth/me')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken);
    adminId = (me.body as { user: { id: string } }).user.id;

    const meC1 = await ctx.request
      .get('/tenant/auth/me')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', cajero1Token);
    cajero1Id = (meC1.body as { user: { id: string } }).user.id;

    // Cajero2 token se usa en algunos tests para validar cross-cajero;
    // su id no se necesita actualmente, dejamos solo el token.
    await ctx.request
      .get('/tenant/auth/me')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', cajero2Token);

    // Setup: damos a cajero1 los permisos para load/unload (delegables) y
    // wallet.view_any para que pueda inspeccionar wallets en sus tests.
    for (const code of ['wallet.load', 'wallet.unload', 'wallet.view_any']) {
      await ctx.request
        .post('/tenant/permission-overrides/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ userId: cajero1Id, permissionCode: code });
    }
    // Re-login para que el token traiga roles/permisos frescos en el
    // siguiente ciclo del guard.
    cajero1Token = await loginAsCajero1(ctx.request);

    // Fondear el wallet del cajero1 desde admin (mint admin + load admin→cajero1).
    await ctx.request
      .post('/tenant/wallet/mint')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .set('Idempotency-Key', freshKey('setup-mint-admin'))
      .send({ amount: '100000', reason: 'setup fund admin wallet' });
    await ctx.request
      .post('/tenant/wallet/load')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .set('Idempotency-Key', freshKey('setup-load-c1'))
      .send({ targetUserId: cajero1Id, amount: '10000', reason: 'setup fund cajero1' });
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('Validaciones DTO + permisos', () => {
    it('400 si falta Idempotency-Key', async () => {
      const r = await ctx.request
        .post('/tenant/wallet/load')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ targetUserId: cajero1Id, amount: '10' });
      expect(r.status).toBe(400);
    });

    it('400 si targetUserId no es UUID', async () => {
      const r = await ctx.request
        .post('/tenant/wallet/load')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', freshKey('bad-uuid'))
        .send({ targetUserId: 'not-a-uuid', amount: '10' });
      expect(r.status).toBe(400);
    });

    it('400 si amount es 0', async () => {
      const r = await ctx.request
        .post('/tenant/wallet/load')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', freshKey('bad-amount'))
        .send({ targetUserId: cajero1Id, amount: '0' });
      expect(r.status).toBe(400);
    });

    it('400 unload sin reason', async () => {
      const r = await ctx.request
        .post('/tenant/wallet/unload')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', freshKey('unload-noreason'))
        .send({ targetUserId: cajero1Id, amount: '10' });
      expect(r.status).toBe(400);
    });

    it('403 cajero2 sin wallet.load', async () => {
      const r = await ctx.request
        .post('/tenant/wallet/load')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero2Token)
        .set('Idempotency-Key', freshKey('c2-load'))
        .send({ targetUserId: cajero1Id, amount: '10' });
      expect(r.status).toBe(403);
    });
  });

  describe('Anti-self + target inexistente', () => {
    it('409 SELF_TRANSFER si actor = target', async () => {
      const r = await ctx.request
        .post('/tenant/wallet/load')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', freshKey('self'))
        .send({ targetUserId: adminId, amount: '10' });
      expect(r.status).toBe(409);
      expect((r.body as { error: string }).error).toBe('SELF_TRANSFER');
    });

    it('409 TARGET_NOT_FOUND si target no existe', async () => {
      const r = await ctx.request
        .post('/tenant/wallet/load')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', freshKey('notarget'))
        .send({
          targetUserId: '019e0000-0000-7000-8000-000000000000',
          amount: '10',
        });
      expect(r.status).toBe(409);
      expect((r.body as { error: string }).error).toBe('TARGET_NOT_FOUND');
    });
  });

  describe('Happy path load', () => {
    it('owner → target carga 100: balances mueven correctos, par linkeado', async () => {
      const ownAdmin = await createTestUser(ctx.request, adminToken, {
        suite: 'wallet-happy',
        label: 'admin',
        role: 'admin_tenant',
      });
      const target = await createTestUser(ctx.request, adminToken, {
        suite: 'wallet-happy',
        label: 'target',
        role: 'cajero',
      });
      const ownToken = await loginAs(ctx.request, ownAdmin.username, ownAdmin.password);
      await ctx.request
        .post('/tenant/wallet/mint')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', ownToken)
        .set('Idempotency-Key', freshKey('happy-prep'))
        .send({ amount: '500', reason: 'prep happy' });

      const r = await ctx.request
        .post('/tenant/wallet/load')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', ownToken)
        .set('Idempotency-Key', freshKey('happy-load'))
        .send({ targetUserId: target.id, amount: '100', reason: 'happy load' });

      expect(r.status).toBe(201);
      const body = r.body as TransferResponse;
      expect(body.sourceTransaction.type).toBe('transfer_out');
      expect(body.targetTransaction.type).toBe('load');
      // Linkeo via related_tx_id (target apunta a source).
      expect(body.targetTransaction.relatedTxId).toBe(body.sourceTransaction.id);
      // Balances: ownAdmin 500-100=400, target 0+100=100.
      expect(parseFloat(body.sourceWallet.balance)).toBeCloseTo(400, 2);
      expect(parseFloat(body.targetWallet.balance)).toBeCloseTo(100, 2);
    });

    it('user con wallet.load + saldo → puede hacer load a otro user', async () => {
      // Trio aislado: ownAdmin + cashier + player. ownAdmin mintea para
      // fondear al cashier — independientemente del balance del admin seed.
      const ownAdmin = await createTestUser(ctx.request, adminToken, {
        suite: 'wallet-c2c',
        label: 'admin',
        role: 'admin_tenant',
      });
      const cashier = await createTestUser(ctx.request, adminToken, {
        suite: 'wallet-c2c',
        label: 'cashier',
        role: 'cajero',
      });
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'wallet-c2c',
        label: 'player',
        role: 'cajero',
      });
      await ctx.request
        .post('/tenant/permission-overrides/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ userId: cashier.id, permissionCode: 'wallet.load' });
      // ScopeGuard requiere que player esté en la red del cashier.
      await ctx.request
        .put(`/tenant/user-hierarchy/${player.id}/parent`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ parentUserId: cashier.id, relationType: 'jugador_de_cajero' });

      const ownToken = await loginAs(ctx.request, ownAdmin.username, ownAdmin.password);
      // ownAdmin mintea + fonde cashier con 200.
      await ctx.request
        .post('/tenant/wallet/mint')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', ownToken)
        .set('Idempotency-Key', freshKey('c2c-mint'))
        .send({ amount: '500', reason: 'prep c2c test setup' });
      await ctx.request
        .post('/tenant/wallet/load')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', ownToken)
        .set('Idempotency-Key', freshKey('c2c-fund'))
        .send({ targetUserId: cashier.id, amount: '200' });

      const cashierToken = await loginAs(ctx.request, cashier.username, cashier.password);
      const r = await ctx.request
        .post('/tenant/wallet/load')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cashierToken)
        .set('Idempotency-Key', freshKey('cashier-to-player'))
        .send({ targetUserId: player.id, amount: '50' });
      expect(r.status).toBe(201);
      const body = r.body as TransferResponse;
      expect(body.sourceTransaction.type).toBe('transfer_out');
      expect(body.targetTransaction.type).toBe('load');
      expect(parseFloat(body.sourceWallet.balance)).toBeCloseTo(150, 2);
      expect(parseFloat(body.targetWallet.balance)).toBeCloseTo(50, 2);
    });

    it('audit registra wallet.load con sourceTxId y targetTxId en metadata', async () => {
      // Setup aislado: admin fresco + target. Asegura admin tiene saldo.
      const ownAdmin = await createTestUser(ctx.request, adminToken, {
        suite: 'wallet-load-audit',
        label: 'admin',
        role: 'admin_tenant',
      });
      const target = await createTestUser(ctx.request, adminToken, {
        suite: 'wallet-load-audit',
        label: 'target',
        role: 'cajero',
      });
      const ownToken = await loginAs(ctx.request, ownAdmin.username, ownAdmin.password);
      await ctx.request
        .post('/tenant/wallet/mint')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', ownToken)
        .set('Idempotency-Key', freshKey('audit-load-mint'))
        .send({ amount: '500', reason: 'prep load audit' });

      const key = freshKey('audit-load');
      const r = await ctx.request
        .post('/tenant/wallet/load')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', ownToken)
        .set('Idempotency-Key', key)
        .send({ targetUserId: target.id, amount: '25' });
      expect(r.status).toBe(201);

      const audit = await ctx.request
        .get(
          `/tenant/audit-log?actionCode=wallet.load&targetId=${target.id}&limit=10&order=desc`,
        )
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const entries = (audit.body as { entries: Array<Record<string, unknown>> }).entries;
      const last = entries[0]!;
      expect(last.actionCode).toBe('wallet.load');
      const meta = last.metadata as { idempotencyKey: string; sourceTxId: string; targetTxId: string };
      expect(meta.idempotencyKey).toBe(key);
      expect(meta.sourceTxId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(meta.targetTxId).toMatch(/^[0-9a-f-]{36}$/i);
    });
  });

  describe('Saldo insuficiente', () => {
    it('409 INSUFFICIENT_BALANCE si el actor intenta cargar más de lo que tiene', async () => {
      // User fresco SIN fondos, con permiso wallet.load.
      const cashier = await createTestUser(ctx.request, adminToken, {
        suite: 'wallet-insuf',
        label: 'cashier',
        role: 'cajero',
      });
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'wallet-insuf',
        label: 'player',
        role: 'cajero',
      });
      await ctx.request
        .post('/tenant/permission-overrides/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ userId: cashier.id, permissionCode: 'wallet.load' });
      // ScopeGuard: player en red del cashier.
      await ctx.request
        .put(`/tenant/user-hierarchy/${player.id}/parent`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ parentUserId: cashier.id, relationType: 'jugador_de_cajero' });
      const cashierToken = await loginAs(ctx.request, cashier.username, cashier.password);

      // Cashier balance = 0, intenta cargar 100 → 409.
      const r = await ctx.request
        .post('/tenant/wallet/load')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cashierToken)
        .set('Idempotency-Key', freshKey('insuf'))
        .send({ targetUserId: player.id, amount: '100' });
      expect(r.status).toBe(409);
      expect((r.body as { error: string }).error).toBe('INSUFFICIENT_BALANCE');
    });
  });

  describe('Idempotencia load', () => {
    it('mismo key + mismo body → mismo response, una sola par de tx', async () => {
      // Setup aislado: ownAdmin + target. ownAdmin mintea para tener saldo.
      const ownAdmin = await createTestUser(ctx.request, adminToken, {
        suite: 'wallet-idem',
        label: 'admin',
        role: 'admin_tenant',
      });
      const target = await createTestUser(ctx.request, adminToken, {
        suite: 'wallet-idem',
        label: 'target',
        role: 'cajero',
      });
      const ownToken = await loginAs(ctx.request, ownAdmin.username, ownAdmin.password);
      await ctx.request
        .post('/tenant/wallet/mint')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', ownToken)
        .set('Idempotency-Key', freshKey('idem-prep'))
        .send({ amount: '500', reason: 'prep idem test setup' });

      const key = freshKey('idem-load');
      const r1 = await ctx.request
        .post('/tenant/wallet/load')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', ownToken)
        .set('Idempotency-Key', key)
        .send({ targetUserId: target.id, amount: '40', reason: 'idem' });
      expect(r1.status).toBe(201);
      const ids1 = {
        source: (r1.body as TransferResponse).sourceTransaction.id,
        target: (r1.body as TransferResponse).targetTransaction.id,
      };

      const r2 = await ctx.request
        .post('/tenant/wallet/load')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', ownToken)
        .set('Idempotency-Key', key)
        .send({ targetUserId: target.id, amount: '40', reason: 'idem' });
      expect(r2.status).toBe(201);
      const ids2 = {
        source: (r2.body as TransferResponse).sourceTransaction.id,
        target: (r2.body as TransferResponse).targetTransaction.id,
      };
      expect(ids2).toEqual(ids1);

      const sql = postgres(getTestTenantUrl(), { max: 1 });
      try {
        const rows = await sql<{ count: string }[]>`
          SELECT count(*) FROM wallet_transactions WHERE idempotency_key = ${key}
        `;
        expect(Number(rows[0]!.count)).toBe(1);
      } finally {
        await sql.end();
      }
    });

    it('mismo key + amount distinto → 409 IDEMPOTENCY_CONFLICT', async () => {
      const ownAdmin = await createTestUser(ctx.request, adminToken, {
        suite: 'wallet-idem-conf',
        label: 'admin',
        role: 'admin_tenant',
      });
      const target = await createTestUser(ctx.request, adminToken, {
        suite: 'wallet-idem-conf',
        label: 'target',
        role: 'cajero',
      });
      const ownToken = await loginAs(ctx.request, ownAdmin.username, ownAdmin.password);
      await ctx.request
        .post('/tenant/wallet/mint')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', ownToken)
        .set('Idempotency-Key', freshKey('conf-prep'))
        .send({ amount: '500', reason: 'prep conflict' });

      const key = freshKey('idem-conflict');
      await ctx.request
        .post('/tenant/wallet/load')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', ownToken)
        .set('Idempotency-Key', key)
        .send({ targetUserId: target.id, amount: '10', reason: 'first' });

      const r2 = await ctx.request
        .post('/tenant/wallet/load')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', ownToken)
        .set('Idempotency-Key', key)
        .send({ targetUserId: target.id, amount: '20', reason: 'first' });
      expect(r2.status).toBe(409);
      expect((r2.body as { error: string }).error).toBe('IDEMPOTENCY_CONFLICT');
    });
  });

  describe('Concurrencia', () => {
    it('5 loads concurrentes A→B con keys distintas: target sube por suma', async () => {
      const ownAdmin = await createTestUser(ctx.request, adminToken, {
        suite: 'wallet-conc-5',
        label: 'admin',
        role: 'admin_tenant',
      });
      const target = await createTestUser(ctx.request, adminToken, {
        suite: 'wallet-conc-5',
        label: 'target',
        role: 'cajero',
      });
      const ownToken = await loginAs(ctx.request, ownAdmin.username, ownAdmin.password);
      await ctx.request
        .post('/tenant/wallet/mint')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', ownToken)
        .set('Idempotency-Key', freshKey('conc5-prep'))
        .send({ amount: '500', reason: 'prep conc test setup' });

      const promises = Array.from({ length: 5 }, (_, i) =>
        ctx.request
          .post('/tenant/wallet/load')
          .set('Host', TEST_TENANT.host)
          .set('Authorization', ownToken)
          .set('Idempotency-Key', freshKey(`conc-${i}`))
          .send({ targetUserId: target.id, amount: '7' }),
      );
      const results = await Promise.all(promises);
      for (const r of results) expect(r.status).toBe(201);

      const after = await ctx.request
        .get(`/tenant/wallet/user/${target.id}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      // target arranca en 0, recibe 5*7=35.
      expect(parseFloat((after.body as WalletView).balance)).toBeCloseTo(35, 2);
    });

    it('A→B y B→A concurrentes: NO deadlock, ambos completan', async () => {
      // Trio aislado: ownAdmin (mintea, fonde) + userA + userB.
      // Ambos userA/B son admin_tenant para que ScopeGuard les permita
      // cargar entre sí (admin_tenant bypassa scope). El test mide
      // anti-deadlock, no scope.
      const ownAdmin = await createTestUser(ctx.request, adminToken, {
        suite: 'wlt-dl',
        label: 'own',
        role: 'admin_tenant',
      });
      const userA = await createTestUser(ctx.request, adminToken, {
        suite: 'wlt-dl',
        label: 'a',
        role: 'admin_tenant',
      });
      const userB = await createTestUser(ctx.request, adminToken, {
        suite: 'wlt-dl',
        label: 'b',
        role: 'admin_tenant',
      });
      // ownAdmin mintea 2000 y fondea 500 a cada uno.
      const ownAdminToken = await loginAs(
        ctx.request,
        ownAdmin.username,
        ownAdmin.password,
      );
      await ctx.request
        .post('/tenant/wallet/mint')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', ownAdminToken)
        .set('Idempotency-Key', freshKey('dl-mint'))
        .send({ amount: '2000', reason: 'prep deadlock' });
      await ctx.request
        .post('/tenant/wallet/load')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', ownAdminToken)
        .set('Idempotency-Key', freshKey('dl-fund-a'))
        .send({ targetUserId: userA.id, amount: '500' });
      await ctx.request
        .post('/tenant/wallet/load')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', ownAdminToken)
        .set('Idempotency-Key', freshKey('dl-fund-b'))
        .send({ targetUserId: userB.id, amount: '500' });

      const tokenA = await loginAs(ctx.request, userA.username, userA.password);
      const tokenB = await loginAs(ctx.request, userB.username, userB.password);

      // 3 loads A→B + 3 loads B→A en paralelo: cada uno perdió 30 y ganó 30
      // → balance final == balance inicial == 500.
      const promises = [
        ...Array.from({ length: 3 }, (_, i) =>
          ctx.request
            .post('/tenant/wallet/load')
            .set('Host', TEST_TENANT.host)
            .set('Authorization', tokenA)
            .set('Idempotency-Key', freshKey(`a-to-b-${i}`))
            .send({ targetUserId: userB.id, amount: '10' }),
        ),
        ...Array.from({ length: 3 }, (_, i) =>
          ctx.request
            .post('/tenant/wallet/load')
            .set('Host', TEST_TENANT.host)
            .set('Authorization', tokenB)
            .set('Idempotency-Key', freshKey(`b-to-a-${i}`))
            .send({ targetUserId: userA.id, amount: '10' }),
        ),
      ];
      const results = await Promise.all(promises);
      for (const r of results) expect(r.status).toBe(201);

      const afterA = await ctx.request
        .get('/tenant/wallet/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', tokenA);
      const afterB = await ctx.request
        .get('/tenant/wallet/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', tokenB);
      // Ambos terminan en 500 (inicial). Perdieron 30, ganaron 30.
      expect(parseFloat((afterA.body as WalletView).balance)).toBeCloseTo(500, 2);
      expect(parseFloat((afterB.body as WalletView).balance)).toBeCloseTo(500, 2);
    });
  });

  describe('Unload (inverso)', () => {
    it('admin unload target → fichas pasan del target al admin', async () => {
      // Setup aislado: admin nuevo + target nuevo con balance controlado.
      const ownAdmin = await createTestUser(ctx.request, adminToken, {
        suite: 'wallet-unload',
        label: 'admin',
        role: 'admin_tenant',
      });
      const target = await createTestUser(ctx.request, adminToken, {
        suite: 'wallet-unload',
        label: 'target',
        role: 'cajero',
      });
      const ownAdminToken = await loginAs(ctx.request, ownAdmin.username, ownAdmin.password);
      // Fund target con 1000 desde ownAdmin (necesita mintear primero).
      await ctx.request
        .post('/tenant/wallet/mint')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', ownAdminToken)
        .set('Idempotency-Key', freshKey('unload-mint-prep'))
        .send({ amount: '2000', reason: 'prep unload' });
      await ctx.request
        .post('/tenant/wallet/load')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', ownAdminToken)
        .set('Idempotency-Key', freshKey('unload-fund-target'))
        .send({ targetUserId: target.id, amount: '1000' });

      const r = await ctx.request
        .post('/tenant/wallet/unload')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', ownAdminToken)
        .set('Idempotency-Key', freshKey('unload-ok'))
        .send({ targetUserId: target.id, amount: '300', reason: 'unload happy path' });

      expect(r.status).toBe(201);
      const body = r.body as TransferResponse;
      expect(body.sourceTransaction.type).toBe('unload');
      expect(body.targetTransaction.type).toBe('transfer_in');
      // target: tenía 1000, perdió 300 → 700.
      expect(parseFloat(body.sourceWallet.balance)).toBeCloseTo(700, 2);
      // ownAdmin: tenía 2000-1000=1000, recibe 300 → 1300.
      expect(parseFloat(body.targetWallet.balance)).toBeCloseTo(1300, 2);
    });

    it('409 INSUFFICIENT_BALANCE si el target no tiene fondos', async () => {
      // Tomamos un user nuevo con balance 0 garantizado.
      const username = `nofunds_${Date.now()}`;
      const newRes = await ctx.request
        .post('/tenant/users')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          username,
          password: 'a-valid-pwd',
          displayName: 'Empty',
          roleCode: 'cajero',
        });
      const newId = (newRes.body as { user: { id: string } }).user.id;

      const r = await ctx.request
        .post('/tenant/wallet/unload')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', freshKey('unload-noFunds'))
        .send({ targetUserId: newId, amount: '100', reason: 'unload empty wallet' });
      expect(r.status).toBe(409);
      expect((r.body as { error: string }).error).toBe('INSUFFICIENT_BALANCE');
    });
  });
});
