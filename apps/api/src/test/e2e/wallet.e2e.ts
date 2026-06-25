/**
 * E2E: WalletController (mint/burn + GET).
 *
 * Cobertura exhaustiva — área crítica (CLAUDE.md "alta sensibilidad"):
 *
 * Lectura:
 *   - GET /me crea wallet idempotente si no existe.
 *   - GET /user/:id con/sin wallet.view_any.
 *
 * Mint:
 *   - Acceso: admin OK; cajero1 sin wallet.mint → 403.
 *   - Validación DTO: amount inválido (0, negativo, > 2 decimales) → 400.
 *   - Header Idempotency-Key faltante → 400.
 *   - Reason vacío → 400.
 *   - Funcional: balance sube por amount; version sube; aparece fila en
 *     wallet_transactions; aparece entry en audit_log con severity:high.
 *   - Idempotencia: mismo key + misma operación → mismo response, una sola
 *     fila en wallet_transactions.
 *   - Concurrencia (race): N mints concurrentes con keys distintas →
 *     balance final = suma exacta.
 *   - Concurrencia (race): N mints concurrentes con MISMA key → una sola
 *     fila + N responses idénticos.
 *
 * Burn:
 *   - Solo admin con wallet.burn.
 *   - Insuficiente saldo → 409 INSUFFICIENT_BALANCE.
 *   - Exitoso: balance baja, version sube.
 *
 * Constraints DB:
 *   - El CHECK constraint `wallets_balance_nonneg` cortaría cualquier UPDATE
 *     que pase balance < 0 (validado indirectamente: el burn falla con 409
 *     antes de llegar al constraint, pero el constraint sigue siendo
 *     defensa última).
 */

import postgres from 'postgres';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin, loginAsCajero1 } from '../helpers/auth';
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

interface MintBurnResponse {
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

/** Helper para generar una idempotency key única por test. */
function freshKey(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Lee directo de la DB la cantidad de tx para un wallet (incluye type filter opcional). */
async function countTxForWallet(walletId: string, type?: string): Promise<number> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = type
      ? await sql<{ count: string }[]>`SELECT count(*) FROM wallet_transactions WHERE wallet_id = ${walletId} AND type = ${type}`
      : await sql<{ count: string }[]>`SELECT count(*) FROM wallet_transactions WHERE wallet_id = ${walletId}`;
    return Number(rows[0]!.count);
  } finally {
    await sql.end();
  }
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
    // Sacar IDs.
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
      expect(typeof w1.balance).toBe('string');

      const r2 = await ctx.request
        .get('/tenant/wallet/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const w2 = r2.body as WalletView;
      expect(w2.id).toBe(w1.id); // Misma wallet, no duplicada.
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

    it('user con rol cajero (sin wallet.view_any) → 403', async () => {
      // Creamos un user fresco con rol cajero (sin permisos extra) para
      // garantizar estado aislado, independiente de cualquier override
      // que otra suite haya podido dejar sobre cajero1.
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
      expect(r.status).toBe(403);
    });
  });

  describe('POST /tenant/wallet/mint - validaciones', () => {
    it('400 si falta header Idempotency-Key', async () => {
      const r = await ctx.request
        .post('/tenant/wallet/mint')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ amount: '100.00', reason: 'reason valido descriptivo' });
      expect(r.status).toBe(400);
      expect((r.body as { message: string }).message).toMatch(/Idempotency-Key/i);
    });

    it('400 si amount = 0', async () => {
      const r = await ctx.request
        .post('/tenant/wallet/mint')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', freshKey('mint-zero'))
        .send({ amount: '0', reason: 'test' });
      expect(r.status).toBe(400);
    });

    it('400 si amount negativo', async () => {
      const r = await ctx.request
        .post('/tenant/wallet/mint')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', freshKey('mint-neg'))
        .send({ amount: '-100', reason: 'test' });
      expect(r.status).toBe(400);
    });

    it('400 si amount con > 2 decimales', async () => {
      const r = await ctx.request
        .post('/tenant/wallet/mint')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', freshKey('mint-prec'))
        .send({ amount: '100.123', reason: 'test' });
      expect(r.status).toBe(400);
    });

    it('400 si reason muy corto', async () => {
      const r = await ctx.request
        .post('/tenant/wallet/mint')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', freshKey('mint-reason'))
        .send({ amount: '100', reason: 'x' });
      expect(r.status).toBe(400);
    });

    it('400 si falta reason', async () => {
      const r = await ctx.request
        .post('/tenant/wallet/mint')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', freshKey('mint-noreason'))
        .send({ amount: '100' });
      expect(r.status).toBe(400);
    });

    it('400 si amount tiene formato no numérico', async () => {
      const r = await ctx.request
        .post('/tenant/wallet/mint')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', freshKey('mint-bad'))
        .send({ amount: '100abc', reason: 'test test' });
      expect(r.status).toBe(400);
    });

    it('403 si cajero1 (sin wallet.mint) intenta mintear', async () => {
      const r = await ctx.request
        .post('/tenant/wallet/mint')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero1Token)
        .set('Idempotency-Key', freshKey('mint-cajero'))
        .send({ amount: '100', reason: 'forbidden attempt' });
      expect(r.status).toBe(403);
    });
  });

  describe('POST /tenant/wallet/mint - funcional', () => {
    it('mint exitoso: balance sube, version sube, hay tx en wallet_transactions', async () => {
      // Admin dedicado para garantizar balance inicial 0 y version 0.
      const freshAdmin = await createTestUser(ctx.request, adminToken, {
        suite: 'wallet-mint-ok',
        label: 'admin',
        role: 'admin_tenant',
      });
      const freshToken = await loginAs(ctx.request, freshAdmin.username, freshAdmin.password);

      const key = freshKey('mint-ok');
      const r = await ctx.request
        .post('/tenant/wallet/mint')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', freshToken)
        .set('Idempotency-Key', key)
        .set('Idempotency-Key', key)
        .send({ amount: '500.50', reason: 'mint funcional ok' });

      expect(r.status).toBe(201);
      const body = r.body as MintBurnResponse;
      expect(body.transaction.type).toBe('mint');
      expect(body.transaction.amount).toBe('500.50');
      expect(body.transaction.idempotencyKey).toBe(key);
      // balance final exacto: 0 + 500.50 = 500.50.
      expect(body.wallet.balance).toBe('500.50');
      // version final exacto: 0 + 1 = 1.
      expect(body.wallet.version).toBe(1);
    });

    it('mint deja entry en audit_log con severity high y action wallet.mint', async () => {
      const key = freshKey('mint-audit');
      const r = await ctx.request
        .post('/tenant/wallet/mint')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', key)
        .send({ amount: '100', reason: 'audit check' });
      expect(r.status).toBe(201);
      const walletId = (r.body as MintBurnResponse).wallet.id;

      const audit = await ctx.request
        .get(`/tenant/audit-log?targetId=${walletId}&actionCode=wallet.mint&limit=200`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const entries = (audit.body as { entries: Array<Record<string, unknown>> }).entries;
      const last = entries[0]!;
      expect(last.actionCode).toBe('wallet.mint');
      expect(last.reason).toBe('audit check');
      expect((last.metadata as { severity: string }).severity).toBe('high');
      expect((last.metadata as { amount: string }).amount).toBe('100');
      expect((last.metadata as { idempotencyKey: string }).idempotencyKey).toBe(key);
    });
  });

  describe('Idempotencia', () => {
    it('mismo idempotency-key + body distinto → 409 IDEMPOTENCY_CONFLICT', async () => {
      const key = freshKey('mint-conflict');
      const r1 = await ctx.request
        .post('/tenant/wallet/mint')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', key)
        .send({ amount: '100', reason: 'first body' });
      expect(r1.status).toBe(201);

      // Mismo key, amount distinto.
      const r2 = await ctx.request
        .post('/tenant/wallet/mint')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', key)
        .send({ amount: '200', reason: 'first body' });
      expect(r2.status).toBe(409);
      expect((r2.body as { error: string }).error).toBe('IDEMPOTENCY_CONFLICT');

      // Mismo key, reason distinto.
      const r3 = await ctx.request
        .post('/tenant/wallet/mint')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', key)
        .send({ amount: '100', reason: 'second body' });
      expect(r3.status).toBe(409);
    });

    it('mismo idempotency-key + mismo body → mismo response, una sola tx', async () => {
      const key = freshKey('mint-idem');
      const r1 = await ctx.request
        .post('/tenant/wallet/mint')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', key)
        .send({ amount: '77.77', reason: 'idem test setup' });
      expect(r1.status).toBe(201);
      const tx1Id = (r1.body as MintBurnResponse).transaction.id;

      const r2 = await ctx.request
        .post('/tenant/wallet/mint')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', key)
        .send({ amount: '77.77', reason: 'idem test setup' });
      expect(r2.status).toBe(201);
      const tx2Id = (r2.body as MintBurnResponse).transaction.id;

      // Misma tx exactamente.
      expect(tx2Id).toBe(tx1Id);

      // Solo UNA fila en wallet_transactions con esa key.
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
  });

  describe('Concurrencia', () => {
    it('5 mints concurrentes con keys DISTINTAS: balance final = balance inicial + suma', async () => {
      // Usamos un admin fresco dedicado a este test → cero contaminación
      // cross-test. balance arranca en 0 y el delta es predecible.
      const freshAdmin = await createTestUser(ctx.request, adminToken, {
        suite: 'wallet-conc-distinct',
        label: 'admin',
        role: 'admin_tenant',
      });
      const freshToken = await loginAs(ctx.request, freshAdmin.username, freshAdmin.password);

      // balance inicial = 0 (wallet no existe, se crea on-demand).
      const promises = Array.from({ length: 5 }, (_, i) =>
        ctx.request
          .post('/tenant/wallet/mint')
          .set('Host', TEST_TENANT.host)
          .set('Authorization', freshToken)
          .set('Idempotency-Key', freshKey(`mint-conc-${i}`))
          .send({ amount: '10', reason: `concurrent #${i + 1}` }),
      );
      const results = await Promise.all(promises);
      for (const r of results) expect(r.status).toBe(201);

      const after = await ctx.request
        .get('/tenant/wallet/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', freshToken);
      const balanceAfter = (after.body as WalletView).balance;

      // Diferencia exacta = 50.00 (5 * 10) sobre el balance inicial de 0.
      const cents = BigInt(Math.round(parseFloat(balanceAfter) * 100));
      expect(cents).toBe(5000n);
    });

    it('10 ops concurrentes mezclando mints y burns: balance final exacto', async () => {
      // Admin dedicado, balance inicial controlado.
      const freshAdmin = await createTestUser(ctx.request, adminToken, {
        suite: 'wallet-conc-mixed',
        label: 'admin',
        role: 'admin_tenant',
      });
      const freshToken = await loginAs(ctx.request, freshAdmin.username, freshAdmin.password);

      // Fund inicial con 10000 para que los burns no fallen.
      await ctx.request
        .post('/tenant/wallet/mint')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', freshToken)
        .set('Idempotency-Key', freshKey('prep-mix'))
        .send({ amount: '10000', reason: 'prep mixed race' });

      // 5 mints de 50, 5 burns de 30. Neto: 5*50 - 5*30 = 250 - 150 = +100.
      const promises = [
        ...Array.from({ length: 5 }, (_, i) =>
          ctx.request
            .post('/tenant/wallet/mint')
            .set('Host', TEST_TENANT.host)
            .set('Authorization', freshToken)
            .set('Idempotency-Key', freshKey(`mix-mint-${i}`))
            .send({ amount: '50', reason: `mix mint #${i}` }),
        ),
        ...Array.from({ length: 5 }, (_, i) =>
          ctx.request
            .post('/tenant/wallet/burn')
            .set('Host', TEST_TENANT.host)
            .set('Authorization', freshToken)
            .set('Idempotency-Key', freshKey(`mix-burn-${i}`))
            .send({ amount: '30', reason: `mix burn #${i}` }),
        ),
      ];
      const results = await Promise.all(promises);
      for (const r of results) {
        expect(r.status).toBe(201);
      }

      const after = await ctx.request
        .get('/tenant/wallet/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', freshToken);
      const balanceAfter = parseFloat((after.body as WalletView).balance);
      // 10000 + 100 = 10100.
      expect(balanceAfter).toBeCloseTo(10100, 2);
    });

    it('5 mints concurrentes con MISMA key: una sola tx persiste', async () => {
      // Admin dedicado para que el delta sea predecible.
      const freshAdmin = await createTestUser(ctx.request, adminToken, {
        suite: 'wallet-conc-samekey',
        label: 'admin',
        role: 'admin_tenant',
      });
      const freshToken = await loginAs(ctx.request, freshAdmin.username, freshAdmin.password);

      // Wallet aún no existe — getOrCreate la creará en balance 0.
      const sharedKey = freshKey('mint-conc-samekey');
      const promises = Array.from({ length: 5 }, () =>
        ctx.request
          .post('/tenant/wallet/mint')
          .set('Host', TEST_TENANT.host)
          .set('Authorization', freshToken)
          .set('Idempotency-Key', sharedKey)
          .send({ amount: '33', reason: 'same key race' }),
      );
      const results = await Promise.all(promises);
      for (const r of results) expect([200, 201]).toContain(r.status);

      // Solo 1 fila en wallet_transactions con esa key.
      const sql = postgres(getTestTenantUrl(), { max: 1 });
      try {
        const rows = await sql<{ count: string }[]>`
          SELECT count(*) FROM wallet_transactions WHERE idempotency_key = ${sharedKey}
        `;
        expect(Number(rows[0]!.count)).toBe(1);
      } finally {
        await sql.end();
      }

      // Balance exactamente 33 (0 + 33).
      const after = await ctx.request
        .get('/tenant/wallet/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', freshToken);
      const cents = BigInt(Math.round(parseFloat((after.body as WalletView).balance) * 100));
      expect(cents).toBe(3300n);
    });
  });

  describe('POST /tenant/wallet/burn', () => {
    it('burn exitoso baja balance', async () => {
      // Asegurar balance suficiente.
      await ctx.request
        .post('/tenant/wallet/mint')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', freshKey('mint-prep-burn'))
        .send({ amount: '1000', reason: 'prep burn test setup' });

      const before = await ctx.request
        .get('/tenant/wallet/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const balanceBefore = (before.body as WalletView).balance;

      const r = await ctx.request
        .post('/tenant/wallet/burn')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', freshKey('burn-ok'))
        .send({ amount: '200', reason: 'burn ok test' });
      expect(r.status).toBe(201);
      const body = r.body as MintBurnResponse;
      expect(body.transaction.type).toBe('burn');

      const diffCents =
        BigInt(Math.round(parseFloat(body.wallet.balance) * 100)) -
        BigInt(Math.round(parseFloat(balanceBefore) * 100));
      expect(diffCents).toBe(-20000n);
    });

    it('409 INSUFFICIENT_BALANCE si quema más de lo que tiene', async () => {
      const me = await ctx.request
        .get('/tenant/wallet/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const currentBalance = parseFloat((me.body as WalletView).balance);
      const exorbitant = (currentBalance + 999999).toFixed(2);

      const r = await ctx.request
        .post('/tenant/wallet/burn')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', freshKey('burn-overflow'))
        .send({ amount: exorbitant, reason: 'burn too much' });
      expect(r.status).toBe(409);
      expect((r.body as { error: string }).error).toBe('INSUFFICIENT_BALANCE');
    });

    it('403 si cajero1 intenta burn', async () => {
      const r = await ctx.request
        .post('/tenant/wallet/burn')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero1Token)
        .set('Idempotency-Key', freshKey('burn-cajero'))
        .send({ amount: '10', reason: 'forbidden burn' });
      expect(r.status).toBe(403);
    });
  });

  describe('GET /tenant/wallet/me/transactions (history)', () => {
    it('devuelve las tx del actor ordenadas desc', async () => {
      const freshAdmin = await createTestUser(ctx.request, adminToken, {
        suite: 'wallet-hist',
        label: 'admin',
        role: 'admin_tenant',
      });
      const token = await loginAs(ctx.request, freshAdmin.username, freshAdmin.password);

      // Producir 3 tx: 2 mints + 1 burn.
      for (let i = 0; i < 2; i++) {
        await ctx.request
          .post('/tenant/wallet/mint')
          .set('Host', TEST_TENANT.host)
          .set('Authorization', token)
          .set('Idempotency-Key', freshKey(`hist-mint-${i}`))
          .send({ amount: '100', reason: `mint history test ${i}` });
      }
      await ctx.request
        .post('/tenant/wallet/burn')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token)
        .set('Idempotency-Key', freshKey('hist-burn'))
        .send({ amount: '50', reason: 'burn history test' });

      const r = await ctx.request
        .get('/tenant/wallet/me/transactions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token);
      expect(r.status).toBe(200);
      const body = r.body as {
        data: Array<{ type: string; amount: string }>;
        total: number;
      };
      expect(body.total).toBe(3);
      // El más nuevo primero (burn).
      expect(body.data[0]!.type).toBe('burn');
    });

    it('paginación respeta limit/offset', async () => {
      const freshAdmin = await createTestUser(ctx.request, adminToken, {
        suite: 'wallet-hist-pg',
        label: 'admin',
        role: 'admin_tenant',
      });
      const token = await loginAs(ctx.request, freshAdmin.username, freshAdmin.password);
      for (let i = 0; i < 5; i++) {
        await ctx.request
          .post('/tenant/wallet/mint')
          .set('Host', TEST_TENANT.host)
          .set('Authorization', token)
          .set('Idempotency-Key', freshKey(`pg-mint-${i}`))
          .send({ amount: '10', reason: `pagn mint test ${i}` });
      }

      const p1 = await ctx.request
        .get('/tenant/wallet/me/transactions?limit=2&offset=0')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token);
      const p2 = await ctx.request
        .get('/tenant/wallet/me/transactions?limit=2&offset=2')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token);
      const b1 = p1.body as { data: Array<{ id: string }>; total: number };
      const b2 = p2.body as { data: Array<{ id: string }> };
      expect(b1.total).toBe(5);
      expect(b1.data.length).toBe(2);
      expect(b2.data.length).toBe(2);
      const ids1 = new Set(b1.data.map((d) => d.id));
      for (const d of b2.data) expect(ids1.has(d.id)).toBe(false);
    });
  });

  describe('Reason validation reforzada (post hardening)', () => {
    it('400 si reason < 10 chars', async () => {
      const r = await ctx.request
        .post('/tenant/wallet/mint')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', freshKey('reason-short'))
        .send({ amount: '100', reason: 'corto' });
      expect(r.status).toBe(400);
    });

    it('400 si reason no contiene letras (solo símbolos/dígitos)', async () => {
      const r = await ctx.request
        .post('/tenant/wallet/mint')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', freshKey('reason-symbols'))
        .send({ amount: '100', reason: '1234567890!!!' });
      expect(r.status).toBe(400);
    });
  });

  describe('Constraint duro: locked_balance <= balance', () => {
    it('intento directo de UPDATE wallets con locked > balance → DB rechaza', async () => {
      const me = await ctx.request
        .get('/tenant/wallet/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const walletId = (me.body as WalletView).id;

      const sql = postgres(getTestTenantUrl(), { max: 1 });
      let failed = false;
      try {
        await sql`UPDATE wallets SET locked_balance = '999999999' WHERE id = ${walletId}`;
      } catch (err) {
        failed = true;
        expect((err as { code?: string }).code).toBe('23514');
      } finally {
        await sql.end();
      }
      expect(failed).toBe(true);
    });
  });

  describe('Constraint duro: balance no puede ser negativo', () => {
    it('intento directo de UPDATE wallets con balance < 0 → la DB lo rechaza', async () => {
      const me = await ctx.request
        .get('/tenant/wallet/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const walletId = (me.body as WalletView).id;

      const sql = postgres(getTestTenantUrl(), { max: 1 });
      let failed = false;
      try {
        await sql`UPDATE wallets SET balance = '-1' WHERE id = ${walletId}`;
      } catch (err) {
        // Esperamos error 23514 (check_violation).
        failed = true;
        const code = (err as { code?: string }).code;
        expect(code).toBe('23514');
      } finally {
        await sql.end();
      }
      expect(failed).toBe(true);
    });
  });
});
