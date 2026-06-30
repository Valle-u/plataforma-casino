/**
 * E2E: login_streak.
 *
 * Mismo pattern que daily_wheel — endpoint user-facing
 * `POST /tenant/promotions/:id/claim-streak` + endpoint read
 * `GET /tenant/promotions/:id/my-streak`.
 *
 * Para testear streak progression (días futuros / pasados) manipulamos
 * el state del `promotion_participants` via SQL directo — simula que
 * el user claimeo ayer (o hace N días) sin esperar tiempo real.
 *
 * Hook de auto-claim:
 *   - Promo con `config.autoClaimOnLogin = true` → login dispara claim
 *     fail-soft. Verificamos via promotion_rewards row.
 *
 * Cobertura:
 *   - First claim: streak = 1, premio = prizes[0].
 *   - Mismo día: idempotent, mismo reward.
 *   - Día siguiente: streak = 2, premio = prizes[1].
 *   - Gap > forgivenessDays: reset streak = 1.
 *   - Gap dentro de forgivenessDays: streak++.
 *   - onMax='hold' después del último día.
 *   - Type mismatch (claim sobre wheel) → 400.
 *   - Auto-claim hook al login (autoClaimOnLogin=true).
 */

import postgres from 'postgres';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser } from '../helpers/test-users';
import { fundWalletForTests } from '../helpers/fund-wallet';
import { getTestTenantUrl } from '../setup/db-helpers';

async function setParticipantState(
  promotionId: string,
  userId: string,
  state: { streak: number; lastClaimDay: string },
): Promise<void> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    await sql.unsafe(
      `INSERT INTO promotion_participants (id, promotion_id, user_id, current_progress)
       VALUES (gen_random_uuid(), $1, $2, $3::jsonb)
       ON CONFLICT (promotion_id, user_id)
       DO UPDATE SET current_progress = EXCLUDED.current_progress, updated_at = now()`,
      [promotionId, userId, JSON.stringify(state)],
    );
  } finally {
    await sql.end();
  }
}

async function readParticipant(
  promotionId: string,
  userId: string,
): Promise<Record<string, unknown> | null> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await sql<Record<string, unknown>[]>`
      SELECT * FROM promotion_participants
      WHERE promotion_id = ${promotionId} AND user_id = ${userId}
    `;
    return rows[0] ?? null;
  } finally {
    await sql.end();
  }
}

async function countRewardsFor(
  promotionId: string,
  userId: string,
): Promise<number> {
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

/** YYYY-MM-DD a N días atrás (UTC). */
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

describe('Promotions / login_streak (E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);

    // Fondeo para premios: el mint viejo minteaba a la wallet del admin (actor
    // del token). Ahora fondeamos directo por DB esa misma wallet.
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

  async function createStreak(overrides?: {
    code?: string;
    status?: string;
    config?: Record<string, unknown>;
  }): Promise<{ id: string; code: string }> {
    const code = overrides?.code ?? `streak_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const res = await ctx.request
      .post('/tenant/promotions')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({
        code,
        name: `Streak ${code}`,
        type: 'login_streak',
        status: overrides?.status ?? 'active',
        config: overrides?.config ?? {
          prizes: [
            { kind: 'chips', amount: 50 },
            { kind: 'chips', amount: 100 },
            { kind: 'chips', amount: 200 },
          ],
        },
      });
    expect(res.status).toBe(201);
    return { id: res.body.id as string, code };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Claim
  // ──────────────────────────────────────────────────────────────────────

  describe('claim-streak', () => {
    it('primer claim → streak=1 + premio prizes[0]', async () => {
      const { id } = await createStreak();
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'streak-first',
        label: 'p',
        role: 'usuario_final',
      });
      const playerToken = await loginAs(ctx.request, player.username, player.password);
      await ctx.request
        .get('/tenant/wallet/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);

      const balanceBefore = await readWalletBalance(player.id);
      const res = await ctx.request
        .post(`/tenant/promotions/${id}/claim-streak`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        streak: 1,
        prize: { kind: 'chips', amount: 50 },
        created: true,
      });

      const balanceAfter = await readWalletBalance(player.id);
      expect(Number(balanceAfter) - Number(balanceBefore)).toBe(50);
    });

    it('mismo día → idempotent, mismo reward', async () => {
      const { id } = await createStreak();
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'streak-idem',
        label: 'p',
        role: 'usuario_final',
      });
      const playerToken = await loginAs(ctx.request, player.username, player.password);
      await ctx.request
        .get('/tenant/wallet/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);

      const r1 = await ctx.request
        .post(`/tenant/promotions/${id}/claim-streak`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);
      const r2 = await ctx.request
        .post(`/tenant/promotions/${id}/claim-streak`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      expect(r2.body.rewardId).toBe(r1.body.rewardId);
      expect(r2.body.created).toBe(false);
      expect(await countRewardsFor(id, player.id)).toBe(1);
    });

    it('día siguiente (simulado) → streak++', async () => {
      const { id } = await createStreak();
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'streak-next',
        label: 'p',
        role: 'usuario_final',
      });
      const playerToken = await loginAs(ctx.request, player.username, player.password);
      await ctx.request
        .get('/tenant/wallet/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);

      // Simulamos que ayer (UTC) ya hizo claim con streak=1.
      await setParticipantState(id, player.id, {
        streak: 1,
        lastClaimDay: daysAgo(1),
      });

      const res = await ctx.request
        .post(`/tenant/promotions/${id}/claim-streak`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        streak: 2,
        prize: { kind: 'chips', amount: 100 },
      });
    });

    it('gap > forgivenessDays → reset a streak=1', async () => {
      const { id } = await createStreak({
        config: {
          prizes: [
            { kind: 'chips', amount: 50 },
            { kind: 'chips', amount: 100 },
            { kind: 'chips', amount: 200 },
          ],
          forgivenessDays: 0,
        },
      });
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'streak-reset',
        label: 'p',
        role: 'usuario_final',
      });
      const playerToken = await loginAs(ctx.request, player.username, player.password);
      await ctx.request
        .get('/tenant/wallet/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);

      // Hace 3 días tenía streak=5, pero no claim ayer ni anteayer.
      await setParticipantState(id, player.id, {
        streak: 5,
        lastClaimDay: daysAgo(3),
      });

      const res = await ctx.request
        .post(`/tenant/promotions/${id}/claim-streak`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);
      expect(res.body).toMatchObject({
        streak: 1,
        prize: { kind: 'chips', amount: 50 },
      });
    });

    it('gap dentro de forgivenessDays → streak++', async () => {
      const { id } = await createStreak({
        config: {
          prizes: [
            { kind: 'chips', amount: 50 },
            { kind: 'chips', amount: 100 },
            { kind: 'chips', amount: 200 },
          ],
          forgivenessDays: 1, // perdona 1 día
        },
      });
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'streak-forgive',
        label: 'p',
        role: 'usuario_final',
      });
      const playerToken = await loginAs(ctx.request, player.username, player.password);
      await ctx.request
        .get('/tenant/wallet/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);

      // streak=2, claim hace 2 días (gap=2 = 1 día perdonado).
      await setParticipantState(id, player.id, {
        streak: 2,
        lastClaimDay: daysAgo(2),
      });

      const res = await ctx.request
        .post(`/tenant/promotions/${id}/claim-streak`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);
      expect(res.body).toMatchObject({
        streak: 3,
        prize: { kind: 'chips', amount: 200 },
      });
    });

    it('streak > prizes.length con onMax=hold → mantiene último premio', async () => {
      const { id } = await createStreak({
        config: {
          prizes: [
            { kind: 'chips', amount: 50 },
            { kind: 'chips', amount: 100 },
          ], // solo 2 premios
          onMax: 'hold',
        },
      });
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'streak-hold',
        label: 'p',
        role: 'usuario_final',
      });
      const playerToken = await loginAs(ctx.request, player.username, player.password);
      await ctx.request
        .get('/tenant/wallet/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);

      // streak=2, ayer hizo claim → hoy streak=3.
      await setParticipantState(id, player.id, {
        streak: 2,
        lastClaimDay: daysAgo(1),
      });

      const res = await ctx.request
        .post(`/tenant/promotions/${id}/claim-streak`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);
      // streak avanzó a 3, pero premio se mantiene en prizes[1] (último).
      expect(res.body).toMatchObject({
        streak: 3,
        prize: { kind: 'chips', amount: 100 },
      });
    });

    it('onMax=cycle wraps around', async () => {
      const { id } = await createStreak({
        config: {
          prizes: [
            { kind: 'chips', amount: 50 },
            { kind: 'chips', amount: 100 },
          ],
          onMax: 'cycle',
        },
      });
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'streak-cycle',
        label: 'p',
        role: 'usuario_final',
      });
      const playerToken = await loginAs(ctx.request, player.username, player.password);
      await ctx.request
        .get('/tenant/wallet/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);

      // streak=2 ayer → hoy streak=3 → idx=(3-1)%2=0 → prizes[0].
      await setParticipantState(id, player.id, {
        streak: 2,
        lastClaimDay: daysAgo(1),
      });

      const res = await ctx.request
        .post(`/tenant/promotions/${id}/claim-streak`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);
      expect(res.body).toMatchObject({
        streak: 3,
        prize: { kind: 'chips', amount: 50 },
      });
    });

    it('claim sobre wheel → 400 TYPE_MISMATCH', async () => {
      const wheelRes = await ctx.request
        .post('/tenant/promotions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          code: `wheel_for_streak_test_${Date.now()}`,
          name: 'wheel',
          type: 'daily_wheel',
          status: 'active',
          config: { segments: [{ id: 's', probability: 1, prize: { kind: 'try_again' } }] },
        });
      const wheelId = wheelRes.body.id;

      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'streak-wrongtype',
        label: 'p',
        role: 'usuario_final',
      });
      const playerToken = await loginAs(ctx.request, player.username, player.password);

      const res = await ctx.request
        .post(`/tenant/promotions/${wheelId}/claim-streak`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: 'PROMOTION_TYPE_MISMATCH' });
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // my-streak (lectura)
  // ──────────────────────────────────────────────────────────────────────

  describe('GET /:id/my-streak', () => {
    it('devuelve null si nunca participó', async () => {
      const { id } = await createStreak();
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'streak-progress-empty',
        label: 'p',
        role: 'usuario_final',
      });
      const playerToken = await loginAs(ctx.request, player.username, player.password);

      const res = await ctx.request
        .get(`/tenant/promotions/${id}/my-streak`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ progress: null });
    });

    it('devuelve state después de claim', async () => {
      const { id } = await createStreak();
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'streak-progress-has',
        label: 'p',
        role: 'usuario_final',
      });
      const playerToken = await loginAs(ctx.request, player.username, player.password);
      await ctx.request
        .get('/tenant/wallet/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);

      await ctx.request
        .post(`/tenant/promotions/${id}/claim-streak`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);

      const res = await ctx.request
        .get(`/tenant/promotions/${id}/my-streak`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);
      expect(res.status).toBe(200);
      expect(res.body.progress).toMatchObject({
        streak: 1,
        lastClaimDay: expect.any(String) as string,
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Hook: auto-claim on login
  // ──────────────────────────────────────────────────────────────────────

  describe('Hook autoClaimOnLogin', () => {
    it('login dispara claim si la promo tiene autoClaimOnLogin=true', async () => {
      const { id } = await createStreak({
        config: {
          prizes: [{ kind: 'chips', amount: 77 }],
          autoClaimOnLogin: true,
        },
      });
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'streak-autohook',
        label: 'p',
        role: 'usuario_final',
      });

      // Login → dispara hook fail-soft en background.
      const login = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({ username: player.username, password: player.password });
      expect(login.status).toBe(200);

      // El hook es void, async no esperado. Damos un toque de tiempo
      // para que el insert llegue a DB.
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(await countRewardsFor(id, player.id)).toBe(1);
    });

    it('login NO dispara claim si autoClaimOnLogin=false', async () => {
      const { id } = await createStreak({
        config: {
          prizes: [{ kind: 'chips', amount: 88 }],
          // autoClaimOnLogin omitido → false
        },
      });
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'streak-nohook',
        label: 'p',
        role: 'usuario_final',
      });

      const login = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({ username: player.username, password: player.password });
      expect(login.status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(await countRewardsFor(id, player.id)).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Participant state
  // ──────────────────────────────────────────────────────────────────────

  describe('Participant state', () => {
    it('claim crea row en promotion_participants', async () => {
      const { id } = await createStreak();
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'streak-participant',
        label: 'p',
        role: 'usuario_final',
      });
      const playerToken = await loginAs(ctx.request, player.username, player.password);
      await ctx.request
        .get('/tenant/wallet/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);

      const claimRes = await ctx.request
        .post(`/tenant/promotions/${id}/claim-streak`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);
      expect(claimRes.status).toBe(200);

      const participant = await readParticipant(id, player.id);
      expect(participant).not.toBeNull();
      expect(participant!.current_progress).toMatchObject({
        streak: 1,
        lastClaimDay: expect.any(String) as string,
      });
    });
  });
});
