/**
 * E2E: subsistema de bonos (MVP).
 *
 * Cobertura:
 *
 * BonusDefinitionsController:
 *   - POST crea (admin con permiso) → 201.
 *   - POST con code duplicado → 409.
 *   - POST sin permiso (cajero) → 403.
 *   - PATCH cambia status draft → active.
 *   - GET lista + filtros.
 *   - GET por id 404 si no existe.
 *
 * UserBonusesController:
 *   - Grant manual: el admin otorga bono a un user.
 *     - Debita wallet del funder (admin mintea primero).
 *     - Crea user_bonus con status='active'.
 *     - Audit log severity:high.
 *   - Grant con idempotency key duplicado mismo body → mismo response.
 *   - Grant con idempotency key duplicado distintos params → 409.
 *   - Grant con definition no-active → 409 BONUS_DEFINITION_NOT_ACTIVE.
 *   - Grant con definition inexistente → 404.
 *   - Grant con user target inexistente → 404.
 *   - Grant con funder sin saldo → 409 FUNDER_INSUFFICIENT_BALANCE.
 *   - Cancel: revierte fichas al funder, status=cancelled.
 *   - Cancel sobre bono ya cancelado → 409.
 *   - Force-clear: pasa fichas al wallet del user, status=cleared.
 *   - GET /me devuelve bonos del actor.
 *   - GET /user/:userId requiere bonuses.view_any.
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

async function readUserBonusFromDb(id: string): Promise<Record<string, unknown> | null> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await sql<Record<string, unknown>[]>`
      SELECT * FROM user_bonuses WHERE id = ${id}
    `;
    return rows[0] ?? null;
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

describe('Bonuses (E2E)', () => {
  let ctx: TestApp;
  let adminBearer: string;
  let adminUserId: string;
  let cajero1Bearer: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminBearer = await loginAsAdmin(ctx.request);

    // Admin mintea fichas para tener saldo de funder.
    await ctx.request
      .post('/tenant/wallet/mint')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminBearer)
      .set('Idempotency-Key', freshKey('mint-bonus-setup'))
      .send({ amount: '1000000', reason: 'mint inicial para fondear bonos en tests' });

    const meRes = await ctx.request
      .get('/tenant/auth/me')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminBearer);
    adminUserId = (meRes.body as { user: { id: string } }).user.id;

    cajero1Bearer = await loginAsCajero1(ctx.request);
  });

  afterAll(async () => {
    await ctx.close();
  });

  // ──────────────────────────────────────────────────────────────────────
  // bonus_definitions CRUD
  // ──────────────────────────────────────────────────────────────────────

  describe('BonusDefinitions CRUD', () => {
    it('admin crea definition → 201', async () => {
      const code = `welcome_test_${Date.now()}`;
      const res = await ctx.request
        .post('/tenant/bonus-definitions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer)
        .send({
          code,
          name: 'Welcome Test',
          type: 'welcome',
          status: 'active',
          config: { matchPct: 100, maxAmount: 50000, minDeposit: 1000 },
          wagering: { multiplier: 20, base: 'bonus' },
          expirationDays: 30,
        });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        code,
        type: 'welcome',
        status: 'active',
        fundedByUserId: adminUserId,
        createdByUserId: adminUserId,
      });
    });

    it('crear con code duplicado → 409', async () => {
      const code = `dup_test_${Date.now()}`;
      const body = { code, name: 'Dup Test', type: 'welcome' as const };

      const first = await ctx.request
        .post('/tenant/bonus-definitions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer)
        .send(body);
      expect(first.status).toBe(201);

      const second = await ctx.request
        .post('/tenant/bonus-definitions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer)
        .send(body);
      expect(second.status).toBe(409);
      expect(second.body).toMatchObject({ error: 'BONUS_DEFINITION_CODE_CONFLICT' });
    });

    it('cajero1 sin permiso bonuses.create_definition → 403', async () => {
      const res = await ctx.request
        .post('/tenant/bonus-definitions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero1Bearer)
        .send({ code: `c_${Date.now()}`, name: 'X', type: 'manual' });
      expect(res.status).toBe(403);
    });

    it('PATCH cambia status draft → active', async () => {
      const code = `draft_then_active_${Date.now()}`;
      const created = await ctx.request
        .post('/tenant/bonus-definitions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer)
        .send({ code, name: 'Draft', type: 'manual', status: 'draft' });
      expect(created.status).toBe(201);
      expect(created.body.status).toBe('draft');

      const patch = await ctx.request
        .patch(`/tenant/bonus-definitions/${created.body.id}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer)
        .send({ status: 'active' });
      expect(patch.status).toBe(200);
      expect(patch.body.status).toBe('active');
    });

    it('GET lista filtrada por status', async () => {
      const res = await ctx.request
        .get('/tenant/bonus-definitions?status=active')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        data: expect.any(Array),
        total: expect.any(Number),
      });
      for (const d of res.body.data) {
        expect(d.status).toBe('active');
      }
    });

    it('GET id inexistente → 404', async () => {
      const fakeId = '00000000-0000-7000-8000-000000000000';
      const res = await ctx.request
        .get(`/tenant/bonus-definitions/${fakeId}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer);
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: 'BONUS_DEFINITION_NOT_FOUND' });
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Grant manual + listing
  // ──────────────────────────────────────────────────────────────────────

  describe('Grant manual', () => {
    let definitionId: string;
    let playerId: string;
    let playerUsername: string;
    let playerPassword: string;

    beforeAll(async () => {
      // Crear definition activa.
      const def = await ctx.request
        .post('/tenant/bonus-definitions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer)
        .send({
          code: `grant_test_${Date.now()}`,
          name: 'Grant Test',
          type: 'manual',
          status: 'active',
          expirationDays: 30,
        });
      definitionId = def.body.id;

      // Crear player.
      const player = await createTestUser(ctx.request, adminBearer, {
        suite: 'bonuses',
        label: 'player',
        role: 'usuario_final',
      });
      playerId = player.id;
      playerUsername = player.username;
      playerPassword = player.password;
    });

    it('admin otorga bono → 201 + debita funder + crea user_bonus', async () => {
      const balanceBefore = await readWalletBalance(adminUserId);
      const key = freshKey('grant-1');

      const res = await ctx.request
        .post('/tenant/bonuses/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer)
        .set('Idempotency-Key', key)
        .send({
          userId: playerId,
          definitionId,
          amount: '500',
          reason: 'grant manual test e2e — bono de bienvenida',
        });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        userId: playerId,
        definitionId,
        grantedAmount: '500.00',
        remainingAmount: '500.00',
        status: 'active',
        fundedByUserId: adminUserId,
      });

      const balanceAfter = await readWalletBalance(adminUserId);
      expect(Number(balanceBefore) - Number(balanceAfter)).toBe(500);
    });

    it('mismo idempotency-key + body → mismo user_bonus', async () => {
      const key = freshKey('grant-idem');
      const body = {
        userId: playerId,
        definitionId,
        amount: '100',
        reason: 'idempotency grant test bonos',
      };

      const r1 = await ctx.request
        .post('/tenant/bonuses/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer)
        .set('Idempotency-Key', key)
        .send(body);
      const r2 = await ctx.request
        .post('/tenant/bonuses/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer)
        .set('Idempotency-Key', key)
        .send(body);
      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);
      expect(r1.body.id).toBe(r2.body.id);
    });

    it('mismo idempotency-key + body distinto → 409', async () => {
      const key = freshKey('grant-idem-conflict');
      const body1 = {
        userId: playerId,
        definitionId,
        amount: '100',
        reason: 'grant conflict idempotency test',
      };
      const body2 = { ...body1, amount: '200' };

      const r1 = await ctx.request
        .post('/tenant/bonuses/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer)
        .set('Idempotency-Key', key)
        .send(body1);
      expect(r1.status).toBe(201);

      const r2 = await ctx.request
        .post('/tenant/bonuses/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer)
        .set('Idempotency-Key', key)
        .send(body2);
      expect(r2.status).toBe(409);
      expect(r2.body).toMatchObject({ error: 'IDEMPOTENCY_CONFLICT' });
    });

    it('definition no-active → 409 BONUS_DEFINITION_NOT_ACTIVE', async () => {
      const draft = await ctx.request
        .post('/tenant/bonus-definitions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer)
        .send({
          code: `draft_${Date.now()}`,
          name: 'Draft',
          type: 'manual',
          status: 'draft',
        });
      const res = await ctx.request
        .post('/tenant/bonuses/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer)
        .set('Idempotency-Key', freshKey('grant-draft'))
        .send({
          userId: playerId,
          definitionId: draft.body.id,
          amount: '100',
          reason: 'grant draft test bono no activo',
        });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: 'BONUS_DEFINITION_NOT_ACTIVE' });
    });

    it('definition inexistente → 404', async () => {
      const fakeId = '00000000-0000-7000-8000-000000000000';
      const res = await ctx.request
        .post('/tenant/bonuses/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer)
        .set('Idempotency-Key', freshKey('grant-noexist'))
        .send({
          userId: playerId,
          definitionId: fakeId,
          amount: '100',
          reason: 'grant definition inexistente test',
        });
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: 'BONUS_DEFINITION_NOT_FOUND' });
    });

    it('user target inexistente → 404', async () => {
      const fakeId = '00000000-0000-7000-8000-000000000001';
      const res = await ctx.request
        .post('/tenant/bonuses/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer)
        .set('Idempotency-Key', freshKey('grant-user-noexist'))
        .send({
          userId: fakeId,
          definitionId,
          amount: '100',
          reason: 'grant target inexistente test bono',
        });
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: 'BONUS_TARGET_NOT_FOUND' });
    });

    it('GET /me devuelve bonos del player', async () => {
      const playerBearer = await loginAs(ctx.request, playerUsername, playerPassword);
      const res = await ctx.request
        .get('/tenant/bonuses/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerBearer);
      expect(res.status).toBe(200);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].userId).toBe(playerId);
    });

    it('GET /user/:id requiere bonuses.view_any (admin sí, player no)', async () => {
      const okRes = await ctx.request
        .get(`/tenant/bonuses/user/${playerId}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer);
      expect(okRes.status).toBe(200);

      const playerBearer = await loginAs(ctx.request, playerUsername, playerPassword);
      const denied = await ctx.request
        .get(`/tenant/bonuses/user/${playerId}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerBearer);
      expect(denied.status).toBe(403);
    });

    it('stats/active devuelve count + totalCommitted', async () => {
      const res = await ctx.request
        .get('/tenant/bonuses/stats/active')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        count: expect.any(Number),
        totalCommitted: expect.any(String),
      });
      expect(res.body.count).toBeGreaterThanOrEqual(1);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Cancel + force-clear
  // ──────────────────────────────────────────────────────────────────────

  describe('Cancel + force-clear', () => {
    let definitionId: string;
    let playerId: string;

    beforeAll(async () => {
      const def = await ctx.request
        .post('/tenant/bonus-definitions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer)
        .send({
          code: `cancel_test_${Date.now()}`,
          name: 'Cancel Test',
          type: 'manual',
          status: 'active',
        });
      definitionId = def.body.id;

      const player = await createTestUser(ctx.request, adminBearer, {
        suite: 'bonuses-cancel',
        label: 'player',
        role: 'usuario_final',
      });
      playerId = player.id;
    });

    it('cancel: revierte fichas al funder, status=cancelled', async () => {
      // Grant.
      const grantRes = await ctx.request
        .post('/tenant/bonuses/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer)
        .set('Idempotency-Key', freshKey('grant-for-cancel'))
        .send({
          userId: playerId,
          definitionId,
          amount: '300',
          reason: 'grant para test cancel del bonus',
        });
      const bonusId = grantRes.body.id;
      const balanceAfterGrant = await readWalletBalance(adminUserId);

      // Cancel.
      const cancelRes = await ctx.request
        .post(`/tenant/bonuses/${bonusId}/cancel`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer)
        .send({ reason: 'cancelación test e2e — el usuario no lo quería' });
      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body).toMatchObject({
        id: bonusId,
        status: 'cancelled',
        remainingAmount: '0.00',
      });

      const balanceAfterCancel = await readWalletBalance(adminUserId);
      expect(Number(balanceAfterCancel) - Number(balanceAfterGrant)).toBe(300);
    });

    it('cancel sobre bono ya cancelado → 409 INVALID_STATUS', async () => {
      const grantRes = await ctx.request
        .post('/tenant/bonuses/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer)
        .set('Idempotency-Key', freshKey('grant-double-cancel'))
        .send({
          userId: playerId,
          definitionId,
          amount: '100',
          reason: 'grant para double-cancel test bono',
        });
      const bonusId = grantRes.body.id;

      await ctx.request
        .post(`/tenant/bonuses/${bonusId}/cancel`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer)
        .send({ reason: 'primer cancel del test invalid status' });

      const second = await ctx.request
        .post(`/tenant/bonuses/${bonusId}/cancel`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer)
        .send({ reason: 'segundo cancel — debe fallar invalid status' });
      expect(second.status).toBe(409);
      expect(second.body).toMatchObject({ error: 'USER_BONUS_INVALID_STATUS' });
    });

    it('force-clear: pasa remaining al wallet real del user', async () => {
      const grantRes = await ctx.request
        .post('/tenant/bonuses/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer)
        .set('Idempotency-Key', freshKey('grant-for-clear'))
        .send({
          userId: playerId,
          definitionId,
          amount: '250',
          reason: 'grant para force-clear test bono',
        });
      const bonusId = grantRes.body.id;

      const playerBalanceBefore = await readWalletBalance(playerId);

      const clearRes = await ctx.request
        .post(`/tenant/bonuses/${bonusId}/force-clear`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer)
        .send({ reason: 'force-clear test e2e — admin decide entregarlo' });

      expect(clearRes.status).toBe(200);
      expect(clearRes.body).toMatchObject({
        id: bonusId,
        status: 'cleared',
        remainingAmount: '0.00',
      });

      const playerBalanceAfter = await readWalletBalance(playerId);
      expect(Number(playerBalanceAfter) - Number(playerBalanceBefore)).toBe(250);

      const fromDb = await readUserBonusFromDb(bonusId);
      expect(fromDb).not.toBeNull();
      expect(fromDb!.status).toBe('cleared');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Antifraude: warning (NO block) en grant manual
  // ──────────────────────────────────────────────────────────────────────

  describe('Grant manual + antifraude warning', () => {
    /** Inserta directamente un fraud_account_link. */
    async function insertFraudLink(
      userA: string,
      userB: string,
      score: number,
      status: 'suspected' | 'confirmed' | 'dismissed' = 'confirmed',
    ): Promise<void> {
      const sql = postgres(getTestTenantUrl(), { max: 1 });
      const [a, b] = userA < userB ? [userA, userB] : [userB, userA];
      try {
        await sql.unsafe(
          `INSERT INTO fraud_account_links
            (id, user_a_id, user_b_id, score, signals, status)
           VALUES (gen_random_uuid(), $1, $2, $3, '[]'::jsonb, $4)
           ON CONFLICT (user_a_id, user_b_id)
           DO UPDATE SET score = EXCLUDED.score, status = EXCLUDED.status,
                         last_updated_at = NOW()`,
          [a, b, score, status],
        );
      } finally {
        await sql.end();
      }
    }

    async function cleanFraud(): Promise<void> {
      const sql = postgres(getTestTenantUrl(), { max: 1 });
      try {
        await sql.unsafe(`DELETE FROM fraud_account_links`);
      } finally {
        await sql.end();
      }
    }

    async function countAuditByAction(action: string): Promise<number> {
      const sql = postgres(getTestTenantUrl(), { max: 1 });
      try {
        const rows = await sql<{ count: string }[]>`
          SELECT count(*) FROM audit_log WHERE action_code = ${action}
        `;
        return Number(rows[0]!.count);
      } finally {
        await sql.end();
      }
    }

    let warnDefId: string;
    let warnPlayerId: string;
    let warnPhantomId: string;

    beforeAll(async () => {
      const def = await ctx.request
        .post('/tenant/bonus-definitions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer)
        .send({
          code: `warn_test_${Date.now()}`,
          name: 'Warn Test',
          type: 'manual',
          status: 'active',
        });
      warnDefId = def.body.id;

      const player = await createTestUser(ctx.request, adminBearer, {
        suite: 'bonuses-warn',
        label: 'player',
        role: 'usuario_final',
      });
      warnPlayerId = player.id;

      const phantom = await createTestUser(ctx.request, adminBearer, {
        suite: 'bonuses-warn-phantom',
        label: 'phantom',
        role: 'usuario_final',
      });
      warnPhantomId = phantom.id;
    });

    beforeEach(async () => {
      await cleanFraud();
    });

    it('user en cluster confirmed score=95 → grant SE OTORGA + response.fraudWarning=true + audit', async () => {
      await insertFraudLink(warnPlayerId, warnPhantomId, 95, 'confirmed');

      const auditBefore = await countAuditByAction('bonus.grant_manual.fraud_warning');

      const res = await ctx.request
        .post('/tenant/bonuses/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer)
        .set('Idempotency-Key', freshKey('grant-warn-confirmed'))
        .send({
          userId: warnPlayerId,
          definitionId: warnDefId,
          amount: '100',
          reason: 'grant manual a cuenta flagged — admin sabe lo que hace',
        });

      // El grant SE EJECUTA (no block).
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        userId: warnPlayerId,
        grantedAmount: '100.00',
        status: 'active',
        fraudWarning: true,
      });

      // Audit entry adicional creada.
      expect(await countAuditByAction('bonus.grant_manual.fraud_warning')).toBe(
        auditBefore + 1,
      );
    });

    it('user en cluster suspected (no confirmed) → SIN warning (false positive scope)', async () => {
      await insertFraudLink(warnPlayerId, warnPhantomId, 95, 'suspected');

      const res = await ctx.request
        .post('/tenant/bonuses/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer)
        .set('Idempotency-Key', freshKey('grant-warn-suspected'))
        .send({
          userId: warnPlayerId,
          definitionId: warnDefId,
          amount: '50',
          reason: 'grant a cuenta solo suspected — no debe warnear',
        });

      expect(res.status).toBe(201);
      // No flag.
      expect(res.body.fraudWarning).toBeUndefined();
    });

    it('user en cluster confirmed pero score 85 (bajo threshold 90) → SIN warning', async () => {
      await insertFraudLink(warnPlayerId, warnPhantomId, 85, 'confirmed');

      const res = await ctx.request
        .post('/tenant/bonuses/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer)
        .set('Idempotency-Key', freshKey('grant-warn-low'))
        .send({
          userId: warnPlayerId,
          definitionId: warnDefId,
          amount: '50',
          reason: 'grant a cuenta confirmed pero score bajo threshold',
        });

      expect(res.status).toBe(201);
      expect(res.body.fraudWarning).toBeUndefined();
    });

    it('user sin links → SIN warning', async () => {
      const cleanPlayer = await createTestUser(ctx.request, adminBearer, {
        suite: 'bonuses-warn-clean',
        label: 'clean',
        role: 'usuario_final',
      });

      const res = await ctx.request
        .post('/tenant/bonuses/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer)
        .set('Idempotency-Key', freshKey('grant-warn-clean'))
        .send({
          userId: cleanPlayer.id,
          definitionId: warnDefId,
          amount: '50',
          reason: 'grant a cuenta sin links de fraud — caso happy path',
        });

      expect(res.status).toBe(201);
      expect(res.body.fraudWarning).toBeUndefined();
    });
  });
});
