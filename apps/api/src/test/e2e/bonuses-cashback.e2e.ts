/**
 * E2E: Job de cashback.
 *
 * Dispara via `POST /tenant/bonuses/jobs/cashback?asOf=ISO`. El cron real
 * está deshabilitado en tests (env `BONUSES_CASHBACK_ENABLED=false`).
 *
 * Pattern de tests:
 *   - Insertamos bet/win wallet_tx via SQL directo en el período BUCKET
 *     CERRADO (anclado por `asOf`). El servicio mira ese rango.
 *   - Llamamos el endpoint con asOf controlado para tener bucket
 *     determinístico.
 *   - Verificamos user_bonuses creados / no creados.
 *
 * Cobertura:
 *
 * Cálculo:
 *   - Player con netloss > minNetloss → cashback = pct% del netloss,
 *     respetando maxCashback.
 *   - Player con netwin (ganó) → no cashback.
 *   - Player con netloss bajo el minNetloss → no cashback.
 *   - Monto capeado por maxCashback.
 *
 * Bucket:
 *   - Solo procesa el bucket CERRADO más reciente (no current bucket).
 *   - bet/win FUERA del bucket cerrado → no entran al cálculo.
 *
 * Idempotencia:
 *   - Re-correr el job → 0 grants nuevos (idempotencia por key
 *     `cashback:<defId>:<userId>:<bucketIndex>`).
 *
 * Permisos:
 *   - cajero1 sin force_clear → 403.
 *
 * No-op:
 *   - Sin definitions cashback activas → run no-op.
 *   - pct=0 → skip.
 */

import postgres from 'postgres';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAsAdmin, loginAsCajero1 } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser } from '../helpers/test-users';
import { fundWalletForTests } from '../helpers/fund-wallet';
import { getTestTenantUrl } from '../setup/db-helpers';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Calcula el rango del bucket cerrado más reciente para un `asOf` dado
 * y un `periodDays`. Equivalente al cálculo del service — re-implementado
 * acá para tener tests independientes de la implementación interna.
 */
function bucketRange(asOf: Date, periodDays: number): {
  bucketIndex: number;
  start: Date;
  end: Date;
} {
  const days = Math.floor(asOf.getTime() / MS_PER_DAY);
  const currentBucket = Math.floor(days / periodDays);
  const closedBucket = currentBucket - 1;
  const startMs = closedBucket * periodDays * MS_PER_DAY;
  const endMs = startMs + periodDays * MS_PER_DAY;
  return {
    bucketIndex: closedBucket,
    start: new Date(startMs),
    end: new Date(endMs),
  };
}

/**
 * Inserta una tx artificial bet/win en wallet_transactions. Le pega un
 * createdAt arbitrario para anclarla al bucket que queremos. Como el
 * service usa lock optimista por idempotency_key, generamos una key
 * única random por inserción.
 *
 * IMPORTANTE: insertamos directamente sin pasar por WalletService porque:
 *   - WalletService no expone "createBet/createWin" hoy (vendrá con el
 *     engine de juegos en Fase 6).
 *   - Necesitamos manipular `created_at` para anclar al bucket.
 *
 * Trade-off: balance_after lo dejamos como el monto mismo (no es exacto
 * pero el test no lo consulta — el cashback service solo lee SUM(amount)
 * por type, no balance_after).
 */
async function insertGameTx(params: {
  walletId: string;
  type: 'bet' | 'win';
  amount: string;
  createdAt: Date;
}): Promise<void> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const idemKey = `synthetic-${params.type}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await sql.unsafe(
      `INSERT INTO wallet_transactions
        (id, wallet_id, type, amount, balance_after, source, idempotency_key, created_at)
       VALUES
        (gen_random_uuid(), $1, $2, $3, $4, 'synthetic_test', $5, $6)`,
      [params.walletId, params.type, params.amount, params.amount, idemKey, params.createdAt.toISOString()],
    );
  } finally {
    await sql.end();
  }
}

async function getWalletId(userId: string): Promise<string> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM wallets WHERE user_id = ${userId}
    `;
    return rows[0]!.id;
  } finally {
    await sql.end();
  }
}

async function ensureWallet(ctx: TestApp, token: string): Promise<void> {
  // Llamar GET /me crea el wallet si no existe.
  const res = await ctx.request
    .get('/tenant/wallet/me')
    .set('Host', TEST_TENANT.host)
    .set('Authorization', token);
  expect(res.status).toBe(200);
}

async function readBonusesFor(userId: string): Promise<Array<Record<string, unknown>>> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await sql<Array<Record<string, unknown>>>`
      SELECT id, granted_amount, status, source_event
      FROM user_bonuses WHERE user_id = ${userId} ORDER BY granted_at ASC
    `;
    return rows;
  } finally {
    await sql.end();
  }
}

async function archiveAllCashbackDefsExcept(keepCode: string): Promise<void> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    await sql.unsafe(
      `UPDATE bonus_definitions SET status = 'archived' WHERE type = 'cashback' AND code <> $1`,
      [keepCode],
    );
  } finally {
    await sql.end();
  }
}

describe('Bonuses cashback job (E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let cajero1Token: string;

  // Anclamos `asOf` a un momento estable. Esto fija el bucket cerrado
  // para todos los tests del suite — facilita razonar y debugging.
  const asOf = new Date('2026-05-15T12:00:00.000Z');
  const periodDays = 7;
  const bucket = bucketRange(asOf, periodDays);

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
    cajero1Token = await loginAsCajero1(ctx.request);

    // Fondeo para fondear cashbacks (el admin es funder por default).
    // Obtenemos su id vía /tenant/auth/me para fondear su wallet directo por DB.
    const me = await ctx.request
      .get('/tenant/auth/me')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken);
    const adminId = (me.body as { user: { id: string } }).user.id;
    await fundWalletForTests(adminId, '1000000');
  });

  afterAll(async () => {
    await ctx.close();
  });

  /** Helper: crea una definition cashback activa, archivando otras. */
  async function createCashbackDef(config: {
    pct: number;
    periodDays?: number;
    minNetloss?: number;
    maxCashback?: number;
  }): Promise<{ id: string; code: string }> {
    const code = `cashback_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await archiveAllCashbackDefsExcept(code);
    const res = await ctx.request
      .post('/tenant/bonus-definitions')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({
        code,
        name: 'Cashback Test',
        type: 'cashback',
        status: 'active',
        config: {
          pct: config.pct,
          periodDays: config.periodDays ?? periodDays,
          minNetloss: config.minNetloss ?? 0,
          maxCashback: config.maxCashback,
        },
      });
    expect(res.status).toBe(201);
    return { id: res.body.id as string, code };
  }

  async function runJob(): Promise<{
    status: number;
    body: Record<string, unknown>;
  }> {
    const res = await ctx.request
      .post(`/tenant/bonuses/jobs/cashback?asOf=${asOf.toISOString()}`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken);
    return { status: res.status, body: res.body };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Cálculo
  // ──────────────────────────────────────────────────────────────────────

  describe('Cálculo de netwin', () => {
    it('player con netloss > minNetloss → cashback = netloss * pct/100', async () => {
      await createCashbackDef({ pct: 10, minNetloss: 100 });

      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'cb-basic',
        label: 'p',
        role: 'usuario_final',
      });
      const playerToken = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({ username: player.username, password: player.password });
      await ensureWallet(ctx, `Bearer ${playerToken.body.accessToken}`);
      const walletId = await getWalletId(player.id);

      // Activity en el bucket cerrado: apostó 1000, ganó 200 → netloss 800.
      const mid = new Date(bucket.start.getTime() + (bucket.end.getTime() - bucket.start.getTime()) / 2);
      await insertGameTx({ walletId, type: 'bet', amount: '1000', createdAt: mid });
      await insertGameTx({ walletId, type: 'win', amount: '200', createdAt: mid });

      const run = await runJob();
      expect(run.status).toBe(200);
      expect(run.body.grantsCreated).toBe(1);

      const bonuses = await readBonusesFor(player.id);
      expect(bonuses).toHaveLength(1);
      // 800 * 10% = 80.
      expect(bonuses[0]!.granted_amount).toBe('80.00');
      const ev = bonuses[0]!.source_event as { kind: string; bucketIndex: number };
      expect(ev.kind).toBe('cashback');
      expect(ev.bucketIndex).toBe(bucket.bucketIndex);
    });

    it('player con netwin (ganó) → no cashback', async () => {
      await createCashbackDef({ pct: 10, minNetloss: 0 });

      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'cb-win',
        label: 'p',
        role: 'usuario_final',
      });
      const login = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({ username: player.username, password: player.password });
      await ensureWallet(ctx, `Bearer ${login.body.accessToken}`);
      const walletId = await getWalletId(player.id);

      // Apostó 100, ganó 300 → netwin +200.
      const mid = new Date(bucket.start.getTime() + (bucket.end.getTime() - bucket.start.getTime()) / 2);
      await insertGameTx({ walletId, type: 'bet', amount: '100', createdAt: mid });
      await insertGameTx({ walletId, type: 'win', amount: '300', createdAt: mid });

      const run = await runJob();
      expect(run.status).toBe(200);
      const bonuses = await readBonusesFor(player.id);
      expect(bonuses).toHaveLength(0);
    });

    it('netloss bajo minNetloss → no cashback', async () => {
      await createCashbackDef({ pct: 10, minNetloss: 500 });

      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'cb-min',
        label: 'p',
        role: 'usuario_final',
      });
      const login = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({ username: player.username, password: player.password });
      await ensureWallet(ctx, `Bearer ${login.body.accessToken}`);
      const walletId = await getWalletId(player.id);

      // netloss 100 — bajo el min 500.
      const mid = new Date(bucket.start.getTime() + 1000);
      await insertGameTx({ walletId, type: 'bet', amount: '200', createdAt: mid });
      await insertGameTx({ walletId, type: 'win', amount: '100', createdAt: mid });

      const run = await runJob();
      expect(run.status).toBe(200);
      const bonuses = await readBonusesFor(player.id);
      expect(bonuses).toHaveLength(0);
    });

    it('cashback capeado por maxCashback', async () => {
      // pct 50%, max 100 — netloss de 1000 daría 500, pero capea a 100.
      await createCashbackDef({ pct: 50, minNetloss: 0, maxCashback: 100 });

      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'cb-cap',
        label: 'p',
        role: 'usuario_final',
      });
      const login = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({ username: player.username, password: player.password });
      await ensureWallet(ctx, `Bearer ${login.body.accessToken}`);
      const walletId = await getWalletId(player.id);

      const mid = new Date(bucket.start.getTime() + 1000);
      await insertGameTx({ walletId, type: 'bet', amount: '1000', createdAt: mid });

      const run = await runJob();
      expect(run.status).toBe(200);
      const bonuses = await readBonusesFor(player.id);
      expect(bonuses).toHaveLength(1);
      expect(bonuses[0]!.granted_amount).toBe('100.00');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Bucket: solo bucket cerrado entra
  // ──────────────────────────────────────────────────────────────────────

  describe('Bucket window', () => {
    it('activity FUERA del bucket cerrado NO entra al cálculo', async () => {
      await createCashbackDef({ pct: 10, minNetloss: 0 });

      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'cb-outside',
        label: 'p',
        role: 'usuario_final',
      });
      const login = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({ username: player.username, password: player.password });
      await ensureWallet(ctx, `Bearer ${login.body.accessToken}`);
      const walletId = await getWalletId(player.id);

      // Activity FUERA: 1 segundo antes del bucket cerrado.
      const before = new Date(bucket.start.getTime() - 1000);
      await insertGameTx({ walletId, type: 'bet', amount: '1000', createdAt: before });
      // Activity FUERA: 1 segundo después del bucket cerrado (bucket actual).
      const after = new Date(bucket.end.getTime() + 1000);
      await insertGameTx({ walletId, type: 'bet', amount: '1000', createdAt: after });

      const run = await runJob();
      expect(run.status).toBe(200);
      // No bonos otorgados — la activity está fuera de la ventana cerrada.
      const bonuses = await readBonusesFor(player.id);
      expect(bonuses).toHaveLength(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Idempotencia
  // ──────────────────────────────────────────────────────────────────────

  describe('Idempotencia', () => {
    it('re-correr el job → 0 grants nuevos para el player (mismo bucket)', async () => {
      // Definition fresca → cada test tiene SU propio defId.
      // Asserts per-player para aislar de activity de tests previos
      // (mismo bucket compartido — la suite no resetea wallet_transactions
      // entre tests).
      await createCashbackDef({ pct: 10, minNetloss: 0 });

      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'cb-idem',
        label: 'p',
        role: 'usuario_final',
      });
      const login = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({ username: player.username, password: player.password });
      await ensureWallet(ctx, `Bearer ${login.body.accessToken}`);
      const walletId = await getWalletId(player.id);

      const mid = new Date(bucket.start.getTime() + 1000);
      await insertGameTx({ walletId, type: 'bet', amount: '500', createdAt: mid });

      await runJob();
      const afterFirst = await readBonusesFor(player.id);
      expect(afterFirst).toHaveLength(1);

      await runJob();
      const afterSecond = await readBonusesFor(player.id);
      // Sigue siendo solo 1 — idempotency por key
      // `cashback:<defId>:<playerId>:<bucketIndex>`.
      expect(afterSecond).toHaveLength(1);
      expect(afterSecond[0]!.id).toBe(afterFirst[0]!.id);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Permisos + no-op
  // ──────────────────────────────────────────────────────────────────────

  describe('Permisos + no-op', () => {
    it('cajero1 sin bonuses.force_clear → 403', async () => {
      const res = await ctx.request
        .post('/tenant/bonuses/jobs/cashback')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero1Token);
      expect(res.status).toBe(403);
    });

    it('sin definitions cashback activas → run vacío', async () => {
      await archiveAllCashbackDefsExcept('__none__');

      const run = await runJob();
      expect(run.status).toBe(200);
      expect(run.body.definitionsProcessed).toBe(0);
      expect(run.body.grantsCreated).toBe(0);
    });

    it('pct=0 → skip (config inválida)', async () => {
      await createCashbackDef({ pct: 0, minNetloss: 0 });

      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'cb-pct0',
        label: 'p',
        role: 'usuario_final',
      });
      const login = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({ username: player.username, password: player.password });
      await ensureWallet(ctx, `Bearer ${login.body.accessToken}`);
      const walletId = await getWalletId(player.id);

      const mid = new Date(bucket.start.getTime() + 1000);
      await insertGameTx({ walletId, type: 'bet', amount: '500', createdAt: mid });

      const run = await runJob();
      expect(run.body.grantsCreated).toBe(0);
    });

    it('asOf inválido → 400', async () => {
      const res = await ctx.request
        .post('/tenant/bonuses/jobs/cashback?asOf=not-a-date')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.status).toBe(400);
    });
  });
});
