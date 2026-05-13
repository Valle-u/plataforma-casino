/**
 * E2E: premio kind=bonus en promotions.
 *
 * Verifica el wireup PrizeAwarder → UserBonusesService.grantManual:
 *   - daily_wheel con segmento bonus → user recibe user_bonus row.
 *   - login_streak con prize bonus → user recibe user_bonus row.
 *   - bonus_definition inactiva → fail-soft (reward sin bonusId, sin
 *     romper el spin/claim del user).
 *   - bonus_definition inexistente → fail-soft.
 *
 * El dinero del bono sale del funder de la BONUS DEFINITION (no del
 * funder del promo). Ambas en MVP suelen ser el admin del tenant.
 */

import postgres from 'postgres';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser } from '../helpers/test-users';
import { getTestTenantUrl } from '../setup/db-helpers';

function freshKey(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readUserBonusesFor(userId: string): Promise<Array<Record<string, unknown>>> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await sql<Array<Record<string, unknown>>>`
      SELECT id, granted_amount, status, source_event, definition_id
      FROM user_bonuses WHERE user_id = ${userId} ORDER BY granted_at ASC
    `;
    return rows;
  } finally {
    await sql.end();
  }
}

async function readPromotionRewardsFor(
  promotionId: string,
  userId: string,
): Promise<Array<Record<string, unknown>>> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await sql<Array<Record<string, unknown>>>`
      SELECT id, prize, wallet_tx_id, bonus_id
      FROM promotion_rewards
      WHERE promotion_id = ${promotionId} AND user_id = ${userId}
    `;
    return rows;
  } finally {
    await sql.end();
  }
}

describe('Promotions / prize kind=bonus (E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let activeBonusDefId: string;
  let inactiveBonusDefId: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);

    // Mint para fondear bonos + premios.
    await ctx.request
      .post('/tenant/wallet/mint')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .set('Idempotency-Key', freshKey('mint-prize-bonus'))
      .send({ amount: '1000000', reason: 'mint inicial para tests de prize kind bonus' });

    // Bonus definition activa (target del prize=bonus).
    const def = await ctx.request
      .post('/tenant/bonus-definitions')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({
        code: `prize_bonus_${Date.now()}`,
        name: 'Prize Bonus',
        type: 'manual',
        status: 'active',
        expirationDays: 30,
      });
    expect(def.status).toBe(201);
    activeBonusDefId = def.body.id;

    // Bonus definition INACTIVA (para test de fail-soft).
    const draftDef = await ctx.request
      .post('/tenant/bonus-definitions')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({
        code: `prize_bonus_draft_${Date.now()}`,
        name: 'Prize Bonus Draft',
        type: 'manual',
        status: 'draft',
        expirationDays: 30,
      });
    expect(draftDef.status).toBe(201);
    inactiveBonusDefId = draftDef.body.id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function createWheelWithBonus(
    overrides: { definitionId: string; amount: number; code?: string },
  ): Promise<{ id: string }> {
    const code = overrides.code ?? `wheel_bonus_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const res = await ctx.request
      .post('/tenant/promotions')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({
        code,
        name: `Wheel ${code}`,
        type: 'daily_wheel',
        status: 'active',
        config: {
          segments: [
            {
              id: 'bonus_seg',
              label: 'Bonus prize',
              probability: 1.0,
              prize: {
                kind: 'bonus',
                definitionId: overrides.definitionId,
                amount: overrides.amount,
              },
            },
          ],
        },
      });
    expect(res.status).toBe(201);
    return { id: res.body.id as string };
  }

  async function spinAsPlayer(
    promoId: string,
    suite: string,
  ): Promise<{ player: { id: string; username: string; password: string }; res: import('supertest').Response }> {
    const player = await createTestUser(ctx.request, adminToken, {
      suite,
      label: 'p',
      role: 'usuario_final',
    });
    const playerToken = await loginAs(ctx.request, player.username, player.password);
    await ctx.request
      .get('/tenant/wallet/me')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', playerToken);

    const res = await ctx.request
      .post(`/tenant/promotions/${promoId}/spin`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', playerToken);
    return { player, res };
  }

  // ──────────────────────────────────────────────────────────────────────
  // wheel + bonus
  // ──────────────────────────────────────────────────────────────────────

  describe('daily_wheel + prize bonus', () => {
    it('user gira → recibe user_bonus + reward linkea via bonusId', async () => {
      const { id: promoId } = await createWheelWithBonus({
        definitionId: activeBonusDefId,
        amount: 250,
      });

      const { player, res } = await spinAsPlayer(promoId, 'wheel-bonus-ok');
      expect(res.status).toBe(200);
      expect(res.body.prize).toMatchObject({
        kind: 'bonus',
        definitionId: activeBonusDefId,
        amount: 250,
      });

      // user_bonus creado.
      const bonuses = await readUserBonusesFor(player.id);
      expect(bonuses).toHaveLength(1);
      expect(bonuses[0]!.granted_amount).toBe('250.00');
      expect(bonuses[0]!.status).toBe('active');
      expect(bonuses[0]!.definition_id).toBe(activeBonusDefId);
      const ev = bonuses[0]!.source_event as { kind: string; promotionId: string };
      expect(ev.kind).toBe('promotion');
      expect(ev.promotionId).toBe(promoId);

      // promotion_reward linkea.
      const rewards = await readPromotionRewardsFor(promoId, player.id);
      expect(rewards).toHaveLength(1);
      expect(rewards[0]!.bonus_id).toBe(bonuses[0]!.id);
      expect(rewards[0]!.wallet_tx_id).toBeNull();
    });

    it('definition inactiva → fail-soft: reward creado, bonus_id=null', async () => {
      const { id: promoId } = await createWheelWithBonus({
        definitionId: inactiveBonusDefId, // status='draft', no se puede otorgar
        amount: 100,
      });

      const { player, res } = await spinAsPlayer(promoId, 'wheel-bonus-inactive');
      // El spin igual responde 200 — el premio se "registra" aunque no se entregue.
      expect(res.status).toBe(200);

      const bonuses = await readUserBonusesFor(player.id);
      expect(bonuses).toHaveLength(0);

      const rewards = await readPromotionRewardsFor(promoId, player.id);
      expect(rewards).toHaveLength(1);
      expect(rewards[0]!.bonus_id).toBeNull();
    });

    it('definition inexistente → fail-soft', async () => {
      const fakeDefId = '00000000-0000-7000-8000-000000000000';
      const { id: promoId } = await createWheelWithBonus({
        definitionId: fakeDefId,
        amount: 50,
      });

      const { player, res } = await spinAsPlayer(promoId, 'wheel-bonus-nodef');
      expect(res.status).toBe(200);

      expect(await readUserBonusesFor(player.id)).toHaveLength(0);
      const rewards = await readPromotionRewardsFor(promoId, player.id);
      expect(rewards).toHaveLength(1);
      expect(rewards[0]!.bonus_id).toBeNull();
    });

    it('idempotencia: re-spin mismo día → mismo bonus, no doble grant', async () => {
      const { id: promoId } = await createWheelWithBonus({
        definitionId: activeBonusDefId,
        amount: 75,
      });

      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'wheel-bonus-idem',
        label: 'p',
        role: 'usuario_final',
      });
      const playerToken = await loginAs(ctx.request, player.username, player.password);
      await ctx.request
        .get('/tenant/wallet/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);

      const r1 = await ctx.request
        .post(`/tenant/promotions/${promoId}/spin`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);
      const r2 = await ctx.request
        .post(`/tenant/promotions/${promoId}/spin`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      expect(r2.body.rewardId).toBe(r1.body.rewardId);

      // Solo un user_bonus.
      expect(await readUserBonusesFor(player.id)).toHaveLength(1);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // login_streak + bonus
  // ──────────────────────────────────────────────────────────────────────

  describe('login_streak + prize bonus', () => {
    it('claim-streak con prize bonus → user_bonus creado', async () => {
      const code = `streak_bonus_${Date.now()}`;
      const promo = await ctx.request
        .post('/tenant/promotions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          code,
          name: 'Streak Bonus',
          type: 'login_streak',
          status: 'active',
          config: {
            prizes: [
              {
                kind: 'bonus',
                definitionId: activeBonusDefId,
                amount: 333,
              },
            ],
          },
        });
      expect(promo.status).toBe(201);
      const promoId = promo.body.id;

      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'streak-bonus-ok',
        label: 'p',
        role: 'usuario_final',
      });
      const playerToken = await loginAs(ctx.request, player.username, player.password);
      await ctx.request
        .get('/tenant/wallet/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);

      const claim = await ctx.request
        .post(`/tenant/promotions/${promoId}/claim-streak`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);
      expect(claim.status).toBe(200);
      expect(claim.body.prize).toMatchObject({
        kind: 'bonus',
        definitionId: activeBonusDefId,
        amount: 333,
      });

      const bonuses = await readUserBonusesFor(player.id);
      expect(bonuses).toHaveLength(1);
      expect(bonuses[0]!.granted_amount).toBe('333.00');

      const rewards = await readPromotionRewardsFor(promoId, player.id);
      expect(rewards).toHaveLength(1);
      expect(rewards[0]!.bonus_id).toBe(bonuses[0]!.id);
    });
  });
});
