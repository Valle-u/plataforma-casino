/**
 * E2E: WalletController (burn + GET).
 *
 * Área crítica (CLAUDE.md "alta sensibilidad"). El mint DIRECTO del admin se
 * eliminó (las fichas solo se crean vía aporte de capital a la Casa), así que
 * este suite cubre:
 *
 * Lectura:
 *   - GET /me crea wallet idempotente si no existe.
 *   - GET /user/:id con/sin wallet.view_any.
 *
 * Burn:
 *   - Validación DTO: amount inválido (0, negativo, > 2 decimales), reason
 *     corto/faltante, sin Idempotency-Key → 400.
 *   - Acceso: cajero1 sin wallet.burn → 403.
 *   - Funcional: balance baja, version sube, fila en wallet_transactions,
 *     entry en audit_log severity:high action wallet.burn.
 *   - Insuficiente saldo → 409 INSUFFICIENT_BALANCE.
 *   - Idempotencia: misma key → mismo response, una sola fila.
 *   - Concurrencia: N burns concurrentes con keys distintas → balance exacto.
 *
 * Las wallets de test se fondean DIRECTO por DB (`fundWallet`) — representa
 * el camino sancionado (Casa / aporte de capital), no el mint del admin.
 */

import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin, loginAsCajero1 } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser } from '../helpers/test-users';
import { fundWalletForTests } from '../helpers/fund-wallet';
import { getTestTenantUrl } from '../setup/db-helpers';
import postgres from 'postgres';

interface WalletView {
  id: string;
  userId: string;
  balance: string;
  lockedBalance: string;
  currency: string;
  version: number;
  updatedAt: string;
}

interface BurnResponse {
  ok: true;
  transaction: {
    id: string;
    type: string;
    amount: string;
    balanceAfter: string;
    createdAt: string;
    idempotencyKey: string | null;
  };
  wallet: WalletView;
}

function freshKey(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

describe('WalletController (E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let cajero1Token: string;
  let adminId: string;
  let cajero1Id: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
    cajero1Token = await loginAsCajero1(ctx.request);
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
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('GET /tenant/wallet/me', () => {
    it('crea wallet idempotentemente para el admin si no existe', async () => {
      const r1 = await ctx.request
        .get('/tenant/wallet/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(r1.status).toBe(200);
      const w1 = r1.body as WalletView;
      expect(w1.userId).toBe(adminId);
      expect(w1.currency).toBe('CHIPS');

      const r2 = await ctx.request
        .get('/tenant/wallet/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect((r2.body as WalletView).id).toBe(w1.id);
    });

    it('cajero1 también tiene wallet', async () => {
      const r = await ctx.request
        .get('/tenant/wallet/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero1Token);
      expect(r.status).toBe(200);
      expect((r.body as WalletView).userId).toBe(cajero1Id);
    });

    it('401 sin token', async () => {
      const r = await ctx.request.get('/tenant/wallet/me').set('Host', TEST_TENANT.host);
      expect(r.status).toBe(401);
    });
  });

  describe('GET /tenant/wallet/user/:userId', () => {
    it('admin lee wallet de cajero1 → OK', async () => {
      const r = await ctx.request
        .get(`/tenant/wallet/user/${cajero1Id}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(r.status).toBe(200);
      expect((r.body as WalletView).userId).toBe(cajero1Id);
    });

    it('user con rol cajero lee wallet (planilla cajero trae wallet.view_admin_network → alias)', async () => {
      // Con el modelo de planillas actual (Sprint 47+), la planilla `cajero`
      // incluye `wallet.view_admin_network` como perm base. Ese comodín se
      // resuelve por alias a `wallet.view_any` restringido al admin_network
      // (excluye sub-redes indep). Cajero SÍ ve wallets de la red del admin.
      const fresh = await createTestUser(ctx.request, adminToken, {
        suite: 'wallet-e2e-403',
        label: 'cashier',
        role: 'cajero',
      });
      const freshToken = await loginAs(ctx.request, fresh.username, fresh.password);
      const r = await ctx.request
        .get(`/tenant/wallet/user/${adminId}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', freshToken);
      expect(r.status).toBe(200);
    });
  });

  describe('POST /tenant/wallet/burn - validaciones', () => {
    const bad: Array<[string, Record<string, unknown>, boolean]> = [
      ['amount = 0', { amount: '0', reason: 'reason valido descriptivo' }, true],
      ['amount negativo', { amount: '-100', reason: 'reason valido descriptivo' }, true],
      ['amount > 2 decimales', { amount: '100.123', reason: 'reason valido descriptivo' }, true],
      ['amount no numérico', { amount: '100abc', reason: 'reason valido descriptivo' }, true],
      ['reason muy corto', { amount: '100', reason: 'x' }, true],
      ['falta reason', { amount: '100' }, true],
    ];
    it.each(bad)('400 si %s', async (_label, body, withKey) => {
      let req = ctx.request
        .post('/tenant/wallet/burn')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      if (withKey) req = req.set('Idempotency-Key', freshKey('burn-val'));
      const r = await req.send(body);
      expect(r.status).toBe(400);
    });

    it('400 si falta header Idempotency-Key', async () => {
      const r = await ctx.request
        .post('/tenant/wallet/burn')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ amount: '100.00', reason: 'reason valido descriptivo' });
      expect(r.status).toBe(400);
      expect((r.body as { message: string }).message).toMatch(/Idempotency-Key/i);
    });

    it('403 si cajero1 (sin wallet.burn) intenta burnear', async () => {
      const r = await ctx.request
        .post('/tenant/wallet/burn')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero1Token)
        .set('Idempotency-Key', freshKey('burn-cajero'))
        .send({ amount: '100', reason: 'forbidden attempt descriptivo' });
      expect(r.status).toBe(403);
    });
  });

  describe('POST /tenant/wallet/burn - funcional', () => {
    async function freshAdmin(): Promise<{ id: string; token: string }> {
      const a = await createTestUser(ctx.request, adminToken, {
        suite: 'wallet-burn',
        label: 'admin',
        role: 'admin_tenant',
      });
      const token = await loginAs(ctx.request, a.username, a.password);
      return { id: a.id, token };
    }

    it('burn exitoso: balance baja, version sube, hay tx + audit', async () => {
      const { id, token } = await freshAdmin();
      await fundWalletForTests(id, '1000.00');

      const r = await ctx.request
        .post('/tenant/wallet/burn')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token)
        .set('Idempotency-Key', freshKey('burn-ok'))
        .send({ amount: '300.50', reason: 'burn funcional ok descriptivo' });

      expect(r.status).toBe(201);
      const body = r.body as BurnResponse;
      expect(body.transaction.type).toBe('burn');
      expect(body.transaction.amount).toBe('300.50');
      expect(body.wallet.balance).toBe('699.50');

      const audit = await ctx.request
        .get(`/tenant/audit-log?targetId=${body.wallet.id}&actionCode=wallet.burn&limit=50`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const rows = audit.body as { entries: Array<{ actionCode: string }> };
      expect(rows.entries.some((e) => e.actionCode === 'wallet.burn')).toBe(true);
    });

    it('409 INSUFFICIENT_BALANCE si el wallet no tiene saldo', async () => {
      const { token } = await freshAdmin();
      const r = await ctx.request
        .post('/tenant/wallet/burn')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token)
        .set('Idempotency-Key', freshKey('burn-insuf'))
        .send({ amount: '100', reason: 'burn sin saldo descriptivo' });
      expect(r.status).toBe(409);
      expect((r.body as { error: string }).error).toBe('INSUFFICIENT_BALANCE');
    });

    it('idempotencia: misma key → mismo response, una sola fila', async () => {
      const { id, token } = await freshAdmin();
      await fundWalletForTests(id, '1000.00');
      const key = freshKey('burn-idem');
      const send = () =>
        ctx.request
          .post('/tenant/wallet/burn')
          .set('Host', TEST_TENANT.host)
          .set('Authorization', token)
          .set('Idempotency-Key', key)
          .send({ amount: '200', reason: 'burn idempotente descriptivo' });
      const r1 = await send();
      const r2 = await send();
      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);
      // Balance final 800 (un solo burn de 200), no 600.
      expect((r2.body as BurnResponse).wallet.balance).toBe('800.00');
    });

    it('concurrencia: 5 burns con keys distintas → balance exacto', async () => {
      const { id, token } = await freshAdmin();
      await fundWalletForTests(id, '1000.00');
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          ctx.request
            .post('/tenant/wallet/burn')
            .set('Host', TEST_TENANT.host)
            .set('Authorization', token)
            .set('Idempotency-Key', freshKey(`burn-conc-${i}`))
            .send({ amount: '100', reason: `burn concurrente ${i} descriptivo` }),
        ),
      );
      expect(results.every((r) => r.status === 201)).toBe(true);
      const w = await ctx.request
        .get(`/tenant/wallet/user/${id}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      // 1000 - 5×100 = 500 exacto (optimistic locking serializa).
      expect((w.body as WalletView).balance).toBe('500.00');
    });
  });

  describe('GET /tenant/wallet/me/transactions - excludeTypes', () => {
    it('excluye los tipos de juego de la lista y del total', async () => {
      const a = await createTestUser(ctx.request, adminToken, {
        suite: 'wallet-tx-exclude',
        label: 'admin',
        role: 'admin_tenant',
      });
      const token = await loginAs(ctx.request, a.username, a.password);

      const me = await ctx.request
        .get('/tenant/wallet/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token);
      expect(me.status).toBe(200);
      const walletId = (me.body as WalletView).id;

      // Fondeo (crea tx 'mint') + txs de juego insertadas directo por DB
      // (simulan manos jugadas — bet/win/jackpot_win/rollback).
      await fundWalletForTests(a.id, '1000.00');
      const sql = postgres(getTestTenantUrl(), { max: 1 });
      try {
        for (const type of ['bet', 'win', 'jackpot_win', 'rollback']) {
          await sql`
            INSERT INTO wallet_transactions
              (id, wallet_id, type, amount, balance_after, source, reason, idempotency_key)
            VALUES
              (gen_random_uuid(), ${walletId}, ${type}, '10.00', '0', 'game_engine',
               'tx de juego de test',
               ${`tx-${type}-${Date.now()}-${Math.random().toString(36).slice(2)}`})`;
        }
      } finally {
        await sql.end();
      }

      // Sin filtro: total = mint + 4 de juego = 5.
      const all = await ctx.request
        .get('/tenant/wallet/me/transactions?limit=50')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token);
      expect(all.status).toBe(200);
      const allBody = all.body as { data: Array<{ type: string }>; total: number };
      expect(allBody.total).toBe(5);
      expect(allBody.data.some((t) => t.type === 'bet')).toBe(true);

      // Con excludeTypes: solo queda el mint, total = 1.
      const filtered = await ctx.request
        .get(
          '/tenant/wallet/me/transactions?limit=50&excludeTypes=bet,win,jackpot_win,rollback',
        )
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token);
      expect(filtered.status).toBe(200);
      const fBody = filtered.body as { data: Array<{ type: string }>; total: number };
      expect(fBody.total).toBe(1);
      expect(
        fBody.data.every(
          (t) => !['bet', 'win', 'jackpot_win', 'rollback'].includes(t.type),
        ),
      ).toBe(true);
    });
  });
});
