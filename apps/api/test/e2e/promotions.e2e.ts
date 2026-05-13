/**
 * E2E: subsistema de promotions (sorteos / actividades).
 *
 * MVP: solo daily_wheel tiene flow completo. CRUD admin + spin del user.
 *
 * Tests deterministicos: configuramos wheel con UN segmento al 100% — el
 * RNG no afecta el resultado. Para variantes (try_again, capeo, etc.)
 * usamos configs específicas de cada caso.
 */

import postgres from 'postgres';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin, loginAsCajero1 } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser } from '../helpers/test-users';
import { getTestTenantUrl } from '../setup/db-helpers';

function freshKey(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readWalletBalance(userId: string): Promise<string> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await sql<{ balance: string }[]>`
      SELECT balance FROM wallets WHERE user_id = ${userId}
    `;
    return rows[0]?.balance ?? '0';
  } finally {
    await sql.end();
  }
}

async function countRewardsFor(promotionId: string, userId: string): Promise<number> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await sql<{ count: string }[]>`
      SELECT count(*) FROM promotion_rewards
      WHERE promotion_id = ${promotionId} AND user_id = ${userId}
    `;
    return Number(rows[0]!.count);
  } finally {
    await sql.end();
  }
}

describe('Promotions / daily_wheel (E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let adminUserId: string;
  let cajero1Token: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);

    // Mint para fondear premios.
    await ctx.request
      .post('/tenant/wallet/mint')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .set('Idempotency-Key', freshKey('mint-promo'))
      .send({ amount: '1000000', reason: 'mint inicial para fondear promos en tests' });

    const me = await ctx.request
      .get('/tenant/auth/me')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken);
    adminUserId = (me.body as { user: { id: string } }).user.id;

    cajero1Token = await loginAsCajero1(ctx.request);
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function createWheel(overrides?: {
    code?: string;
    status?: string;
    config?: Record<string, unknown>;
    startsAt?: string;
    endsAt?: string;
  }): Promise<{ id: string; code: string }> {
    const code = overrides?.code ?? `wheel_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const res = await ctx.request
      .post('/tenant/promotions')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({
        code,
        name: `Wheel ${code}`,
        type: 'daily_wheel',
        status: overrides?.status ?? 'active',
        config: overrides?.config ?? {
          segments: [
            {
              id: 'win',
              label: '100 chips',
              probability: 1.0,
              prize: { kind: 'chips', amount: 100 },
            },
          ],
        },
        startsAt: overrides?.startsAt,
        endsAt: overrides?.endsAt,
      });
    expect(res.status).toBe(201);
    return { id: res.body.id as string, code };
  }

  // ──────────────────────────────────────────────────────────────────────
  // CRUD admin
  // ──────────────────────────────────────────────────────────────────────

  describe('CRUD admin', () => {
    it('admin crea promotion daily_wheel → 201', async () => {
      const { id } = await createWheel();
      expect(id).toBeDefined();
    });

    it('crear con code duplicado → 409', async () => {
      const code = `dup_${Date.now()}`;
      await createWheel({ code });
      const second = await ctx.request
        .post('/tenant/promotions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          code,
          name: 'dup',
          type: 'daily_wheel',
          config: { segments: [{ id: 's', probability: 1, prize: { kind: 'try_again' } }] },
        });
      expect(second.status).toBe(409);
      expect(second.body).toMatchObject({ error: 'PROMOTION_CODE_CONFLICT' });
    });

    it('cajero1 sin promotions.create_definition → 403', async () => {
      const res = await ctx.request
        .post('/tenant/promotions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero1Token)
        .send({
          code: `c_${Date.now()}`,
          name: 'X',
          type: 'daily_wheel',
          config: { segments: [{ id: 's', probability: 1, prize: { kind: 'try_again' } }] },
        });
      expect(res.status).toBe(403);
    });

    it('PATCH cambia status draft → active', async () => {
      const { id } = await createWheel({ status: 'draft' });
      const patch = await ctx.request
        .patch(`/tenant/promotions/${id}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ status: 'active' });
      expect(patch.status).toBe(200);
      expect(patch.body.status).toBe('active');
    });

    it('GET lista filtrada por type', async () => {
      await createWheel();
      const res = await ctx.request
        .get('/tenant/promotions?type=daily_wheel')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.status).toBe(200);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
      for (const p of res.body.data) {
        expect(p.type).toBe('daily_wheel');
      }
    });

    it('GET id inexistente → 404', async () => {
      const fakeId = '00000000-0000-7000-8000-000000000000';
      const res = await ctx.request
        .get(`/tenant/promotions/${fakeId}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.status).toBe(404);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Spin: happy path
  // ──────────────────────────────────────────────────────────────────────

  describe('Spin: happy path', () => {
    it('spin con 1 segmento chips 100% → credita user, debita funder', async () => {
      const { id } = await createWheel();

      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'wheel-happy',
        label: 'p',
        role: 'usuario_final',
      });
      const playerToken = await loginAs(ctx.request, player.username, player.password);
      // Crear wallet del player (cero-init).
      await ctx.request
        .get('/tenant/wallet/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);

      const adminBefore = await readWalletBalance(adminUserId);
      const playerBefore = await readWalletBalance(player.id);

      const spin = await ctx.request
        .post(`/tenant/promotions/${id}/spin`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);
      expect(spin.status).toBe(200);
      expect(spin.body).toMatchObject({
        segmentId: 'win',
        prize: { kind: 'chips', amount: 100 },
      });

      const adminAfter = await readWalletBalance(adminUserId);
      const playerAfter = await readWalletBalance(player.id);

      expect(Number(adminBefore) - Number(adminAfter)).toBe(100);
      expect(Number(playerAfter) - Number(playerBefore)).toBe(100);

      expect(await countRewardsFor(id, player.id)).toBe(1);
    });

    it('2do spin mismo día → idempotente, devuelve mismo reward', async () => {
      const { id } = await createWheel();

      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'wheel-idem',
        label: 'p',
        role: 'usuario_final',
      });
      const playerToken = await loginAs(ctx.request, player.username, player.password);
      await ctx.request
        .get('/tenant/wallet/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);

      const r1 = await ctx.request
        .post(`/tenant/promotions/${id}/spin`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);
      expect(r1.status).toBe(200);
      const r2 = await ctx.request
        .post(`/tenant/promotions/${id}/spin`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);
      expect(r2.status).toBe(200);
      // Mismo reward id.
      expect(r2.body.rewardId).toBe(r1.body.rewardId);
      // Solo 1 row en DB.
      expect(await countRewardsFor(id, player.id)).toBe(1);
    });

    it('segmento try_again → reward sin wallet impact', async () => {
      const { id } = await createWheel({
        config: {
          segments: [
            { id: 'again', probability: 1.0, prize: { kind: 'try_again' } },
          ],
        },
      });

      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'wheel-again',
        label: 'p',
        role: 'usuario_final',
      });
      const playerToken = await loginAs(ctx.request, player.username, player.password);
      await ctx.request
        .get('/tenant/wallet/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);

      const balanceBefore = await readWalletBalance(player.id);

      const spin = await ctx.request
        .post(`/tenant/promotions/${id}/spin`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);
      expect(spin.status).toBe(200);
      expect(spin.body.prize).toMatchObject({ kind: 'try_again' });

      const balanceAfter = await readWalletBalance(player.id);
      expect(balanceAfter).toBe(balanceBefore);

      expect(await countRewardsFor(id, player.id)).toBe(1);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Errores
  // ──────────────────────────────────────────────────────────────────────

  describe('Spin: errores', () => {
    it('promotion not active → 409', async () => {
      const { id } = await createWheel({ status: 'draft' });
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'wheel-draft',
        label: 'p',
        role: 'usuario_final',
      });
      const playerToken = await loginAs(ctx.request, player.username, player.password);

      const spin = await ctx.request
        .post(`/tenant/promotions/${id}/spin`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);
      expect(spin.status).toBe(409);
      expect(spin.body).toMatchObject({ error: 'PROMOTION_NOT_ACTIVE' });
    });

    it('promotion type=login_streak (wrong) → 400 TYPE_MISMATCH', async () => {
      const res = await ctx.request
        .post('/tenant/promotions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          code: `streak_${Date.now()}`,
          name: 'Streak',
          type: 'login_streak',
          status: 'active',
          config: { prizes: [] },
        });
      expect(res.status).toBe(201);
      const id = res.body.id;

      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'wheel-wrongtype',
        label: 'p',
        role: 'usuario_final',
      });
      const playerToken = await loginAs(ctx.request, player.username, player.password);

      const spin = await ctx.request
        .post(`/tenant/promotions/${id}/spin`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);
      expect(spin.status).toBe(400);
      expect(spin.body).toMatchObject({ error: 'PROMOTION_TYPE_MISMATCH' });
    });

    it('promotion fuera de schedule (endsAt pasado) → 409 SCHEDULE_CLOSED', async () => {
      const past = new Date(Date.now() - 24 * 3600_000).toISOString();
      const { id } = await createWheel({ endsAt: past });
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'wheel-closed',
        label: 'p',
        role: 'usuario_final',
      });
      const playerToken = await loginAs(ctx.request, player.username, player.password);

      const spin = await ctx.request
        .post(`/tenant/promotions/${id}/spin`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);
      expect(spin.status).toBe(409);
      expect(spin.body).toMatchObject({ error: 'PROMOTION_SCHEDULE_CLOSED' });
    });

    it('wheel config inválido (probabilidades no suman) → 409 WHEEL_CONFIG_INVALID', async () => {
      const { id } = await createWheel({
        config: {
          segments: [
            { id: 'a', probability: 0.3, prize: { kind: 'try_again' } },
            { id: 'b', probability: 0.3, prize: { kind: 'try_again' } },
          ], // suma = 0.6, fuera de tolerancia.
        },
      });
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'wheel-bad-config',
        label: 'p',
        role: 'usuario_final',
      });
      const playerToken = await loginAs(ctx.request, player.username, player.password);

      const spin = await ctx.request
        .post(`/tenant/promotions/${id}/spin`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);
      expect(spin.status).toBe(409);
      expect(spin.body).toMatchObject({ error: 'WHEEL_CONFIG_INVALID' });
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // my-rewards
  // ──────────────────────────────────────────────────────────────────────

  describe('GET /:id/my-rewards', () => {
    it('devuelve los rewards del user para la promotion', async () => {
      const { id } = await createWheel();
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'wheel-history',
        label: 'p',
        role: 'usuario_final',
      });
      const playerToken = await loginAs(ctx.request, player.username, player.password);
      await ctx.request
        .get('/tenant/wallet/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);

      await ctx.request
        .post(`/tenant/promotions/${id}/spin`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);

      const res = await ctx.request
        .get(`/tenant/promotions/${id}/my-rewards`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].userId).toBe(player.id);
    });
  });
});
