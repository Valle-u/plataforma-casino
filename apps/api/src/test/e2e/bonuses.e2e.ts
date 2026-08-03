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
 *   - GET /me devuelve bonos del actor.
 *   - GET /user/:userId requiere bonuses.view_any.
 *
 * Remove manual (débito de dinero de bono):
 *   - Sacar parte del bono → 200 + bonus_balance baja + reverso a la Casa.
 *   - Sacar más de lo disponible → 409 BONUS_INSUFFICIENT_BALANCE.
 *   - Target no es usuario final → 400 BONUS_TARGET_NOT_PLAYER.
 *   - Sin Idempotency-Key → 400.
 *   - Misma idempotency-key + body → no debita dos veces.
 *   - Audit log registra bonus.remove_manual severity:high.
 */

import postgres from 'postgres';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin, loginAsCajero1 } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser } from '../helpers/test-users';
import { fundWalletForTests } from '../helpers/fund-wallet';
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

async function readBonusBalance(userId: string): Promise<string> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await sql<{ bonus_balance: string }[]>`
      SELECT bonus_balance FROM wallets WHERE user_id = ${userId}
    `;
    return rows[0]?.bonus_balance ?? '0';
  } finally {
    await sql.end();
  }
}

async function getCasaUserId(): Promise<string> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM users WHERE username = '__casa__' LIMIT 1
    `;
    if (!rows[0]) throw new Error('Casa no provisionada en el test tenant');
    return rows[0]!.id;
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

    const meRes = await ctx.request
      .get('/tenant/auth/me')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminBearer);
    adminUserId = (meRes.body as { user: { id: string } }).user.id;

    // Fondea la TESORERÍA (__casa__). LEYES E3 (2026-07-31): los bonos de
    // planillas del admin salen de la Casa, no de la wallet personal.
    const casaId = await getCasaUserId();
    await fundWalletForTests(casaId, '1000000');

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

    it('admin otorga bono → 201 + debita tesorería + crea user_bonus', async () => {
      const casaId = await getCasaUserId();
      const balanceBefore = await readWalletBalance(casaId);
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
        fundedByUserId: casaId,
      });

      const balanceAfter = await readWalletBalance(casaId);
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

  // ──────────────────────────────────────────────────────────────────────
  // Remove manual (sacar dinero de bono)
  // ──────────────────────────────────────────────────────────────────────

  describe('Remove manual (sacar dinero de bono)', () => {
    let removeDefId: string;
    let removePlayerId: string;

    beforeAll(async () => {
      const def = await ctx.request
        .post('/tenant/bonus-definitions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer)
        .send({
          code: `remove_test_${Date.now()}`,
          name: 'Remove Test',
          type: 'manual',
          status: 'active',
          expirationDays: 30,
        });
      removeDefId = def.body.id;

      const player = await createTestUser(ctx.request, adminBearer, {
        suite: 'bonuses-remove',
        label: 'player',
        role: 'usuario_final',
      });
      removePlayerId = player.id;
    });

    it('saca parte del bono → 200 + bonus_balance baja + reverso a la Casa', async () => {
      // Grant 1000 (funder resuelto = Casa, LEYES E3).
      const grant = await ctx.request
        .post('/tenant/bonuses/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer)
        .set('Idempotency-Key', freshKey('remove-grant'))
        .send({
          userId: removePlayerId,
          definitionId: removeDefId,
          amount: '1000',
          reason: 'grant previo para test de remover bono',
        });
      expect(grant.status).toBe(201);

      const casaId = await getCasaUserId();
      const casaBefore = await readWalletBalance(casaId);
      const bonusBefore = await readBonusBalance(removePlayerId);
      expect(Number(bonusBefore)).toBe(1000);

      const res = await ctx.request
        .post('/tenant/bonuses/remove')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer)
        .set('Idempotency-Key', freshKey('remove-1'))
        .send({
          userId: removePlayerId,
          amount: '400',
          reason: 'error en la carga del bono, se retira parte del monto',
        });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        userId: removePlayerId,
        amount: '400',
        funderUserId: casaId,
      });

      const bonusAfter = await readBonusBalance(removePlayerId);
      expect(Number(bonusAfter)).toBe(600);
      const casaAfter = await readWalletBalance(casaId);
      expect(Number(casaAfter) - Number(casaBefore)).toBe(400);
    });

    it('saca más de lo disponible → 409 BONUS_INSUFFICIENT_BALANCE', async () => {
      const res = await ctx.request
        .post('/tenant/bonuses/remove')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer)
        .set('Idempotency-Key', freshKey('remove-over'))
        .send({
          userId: removePlayerId,
          amount: '99999',
          reason: 'prueba de saldo insuficiente en el bonus',
        });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: 'BONUS_INSUFFICIENT_BALANCE' });
    });

    it('target no es usuario final → 400 BONUS_TARGET_NOT_PLAYER', async () => {
      const res = await ctx.request
        .post('/tenant/bonuses/remove')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer)
        .set('Idempotency-Key', freshKey('remove-nonplayer'))
        .send({
          userId: adminUserId,
          amount: '10',
          reason: 'prueba de remover bono a un operador',
        });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: 'BONUS_TARGET_NOT_PLAYER' });
    });

    it('sin Idempotency-Key → 400', async () => {
      const res = await ctx.request
        .post('/tenant/bonuses/remove')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer)
        .send({
          userId: removePlayerId,
          amount: '10',
          reason: 'prueba de idempotency key obligatoria',
        });
      expect(res.status).toBe(400);
    });

    it('misma idempotency-key + body → no debita dos veces', async () => {
      const bonusBefore = await readBonusBalance(removePlayerId);
      const key = freshKey('remove-idem');
      const body = {
        userId: removePlayerId,
        amount: '50',
        reason: 'idempotency remove test de bono manual',
      };

      const r1 = await ctx.request
        .post('/tenant/bonuses/remove')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer)
        .set('Idempotency-Key', key)
        .send(body);
      expect(r1.status).toBe(200);

      const r2 = await ctx.request
        .post('/tenant/bonuses/remove')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer)
        .set('Idempotency-Key', key)
        .send(body);
      expect(r2.status).toBe(200);

      const bonusAfter = await readBonusBalance(removePlayerId);
      expect(Number(bonusBefore) - Number(bonusAfter)).toBe(50);
    });

    it('audit log registra bonus.remove_manual severity:high', async () => {
      const sql = postgres(getTestTenantUrl(), { max: 1 });
      try {
        const rows = await sql<{ metadata: { severity?: string } | null }[]>`
          SELECT metadata FROM audit_log
          WHERE action_code = 'bonus.remove_manual' AND target_id = ${removePlayerId}
          ORDER BY created_at DESC LIMIT 1
        `;
        expect(rows[0]).toBeDefined();
        expect(rows[0]!.metadata?.severity).toBe('high');
      } finally {
        await sql.end();
      }
    });
  });
});
