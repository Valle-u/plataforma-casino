/**
 * E2E: TenantSettings key-value store + uso desde Fraud thresholds.
 *
 * Cobertura:
 *
 * CRUD del endpoint:
 *   - PATCH /:key crea + audit.
 *   - PATCH /:key re-upsert actualiza.
 *   - GET /:key 404 si no existe.
 *   - GET / lista todos.
 *   - DELETE /:key unset (idempotent).
 *   - Permission gate: cajero1 → 403.
 *
 * Integración con Fraud:
 *   - Sin setting → fraud usa default 70 (suspected) y 90 (welcome_block).
 *   - Set fraud.suspected_threshold = 50 → link con score 60 ahora se
 *     crea (donde antes no se creaba con default 70).
 *   - Set fraud.welcome_block_threshold = 80 → user en cluster confirmed
 *     score 85 ahora se bloquea (donde antes default 90 no bloqueaba).
 */

import postgres from 'postgres';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAsAdmin, loginAsCajero1 } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser } from '../helpers/test-users';
import { getTestTenantUrl } from '../setup/db-helpers';

function freshKey(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function deleteAllSettings(): Promise<void> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    await sql.unsafe(`DELETE FROM tenant_settings`);
  } finally {
    await sql.end();
  }
}

async function deleteAllFraudLinks(): Promise<void> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    await sql.unsafe(`DELETE FROM fraud_account_links`);
  } finally {
    await sql.end();
  }
}

async function insertFraudLink(
  userA: string,
  userB: string,
  score: number,
  status: 'suspected' | 'confirmed' | 'dismissed' = 'suspected',
): Promise<void> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  const [a, b] = userA < userB ? [userA, userB] : [userB, userA];
  try {
    await sql.unsafe(
      `INSERT INTO fraud_account_links
        (id, user_a_id, user_b_id, score, signals, status)
       VALUES (gen_random_uuid(), $1, $2, $3, '[]'::jsonb, $4)
       ON CONFLICT (user_a_id, user_b_id) DO UPDATE
       SET score = EXCLUDED.score, status = EXCLUDED.status,
           last_updated_at = NOW()`,
      [a, b, score, status],
    );
  } finally {
    await sql.end();
  }
}

async function insertSession(userId: string, ip: string): Promise<void> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    await sql.unsafe(
      `INSERT INTO user_sessions (id, user_id, token_hash, ip, expires_at)
       VALUES (gen_random_uuid(), $1, $2, $3, NOW() + INTERVAL '30 days')`,
      [userId, `synthetic-ts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ip],
    );
  } finally {
    await sql.end();
  }
}

async function setEmail(userId: string, email: string): Promise<void> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    await sql.unsafe(`UPDATE users SET email = $1 WHERE id = $2`, [email, userId]);
  } finally {
    await sql.end();
  }
}

async function countActiveBonusesFor(userId: string): Promise<number> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await sql<{ count: string }[]>`
      SELECT count(*) FROM user_bonuses WHERE user_id = ${userId} AND status = 'active'
    `;
    return Number(rows[0]!.count);
  } finally {
    await sql.end();
  }
}

describe('TenantSettings + Fraud thresholds (E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let cajero1Token: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
    cajero1Token = await loginAsCajero1(ctx.request);

    // Mint para fondear bonos.
    await ctx.request
      .post('/tenant/wallet/mint')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .set('Idempotency-Key', freshKey('mint-ts'))
      .send({ amount: '500000', reason: 'mint inicial para tests de tenant settings' });
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await deleteAllSettings();
    await deleteAllFraudLinks();
  });

  // ──────────────────────────────────────────────────────────────────────
  // CRUD endpoint
  // ──────────────────────────────────────────────────────────────────────

  describe('CRUD admin', () => {
    it('PATCH crea + GET devuelve el value', async () => {
      const res = await ctx.request
        .patch('/tenant/settings/test.foo')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: 42 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ key: 'test.foo' });

      const get = await ctx.request
        .get('/tenant/settings/test.foo')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(get.status).toBe(200);
      expect(get.body).toEqual({ key: 'test.foo', value: 42 });
    });

    it('PATCH re-upsert sobrescribe', async () => {
      await ctx.request
        .patch('/tenant/settings/test.bar')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: 'hello' });
      await ctx.request
        .patch('/tenant/settings/test.bar')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: 'world' });

      const get = await ctx.request
        .get('/tenant/settings/test.bar')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(get.body.value).toBe('world');
    });

    it('soporta objetos JSON arbitrarios', async () => {
      const value = { color: 'blue', count: 3, nested: { ok: true } };
      await ctx.request
        .patch('/tenant/settings/test.obj')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value });
      const get = await ctx.request
        .get('/tenant/settings/test.obj')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(get.body.value).toEqual(value);
    });

    it('GET inexistente → 404', async () => {
      const res = await ctx.request
        .get('/tenant/settings/never.set')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: 'SETTING_NOT_FOUND' });
    });

    it('DELETE unset (idempotent)', async () => {
      await ctx.request
        .patch('/tenant/settings/test.del')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: 1 });

      const d1 = await ctx.request
        .delete('/tenant/settings/test.del')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(d1.status).toBe(204);

      // Re-DELETE — idempotent.
      const d2 = await ctx.request
        .delete('/tenant/settings/test.del')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(d2.status).toBe(204);

      // GET ya no existe.
      const get = await ctx.request
        .get('/tenant/settings/test.del')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(get.status).toBe(404);
    });

    it('GET / lista todos los settings', async () => {
      await ctx.request
        .patch('/tenant/settings/list.a')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: 1 });
      await ctx.request
        .patch('/tenant/settings/list.b')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: 2 });

      const res = await ctx.request
        .get('/tenant/settings')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.status).toBe(200);
      const keys = (res.body.data as Array<{ key: string }>).map((r) => r.key);
      expect(keys).toContain('list.a');
      expect(keys).toContain('list.b');
    });

    it('cajero1 sin tenant.settings.edit → 403', async () => {
      const res = await ctx.request
        .patch('/tenant/settings/test.cajero')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero1Token)
        .send({ value: 'should-fail' });
      expect(res.status).toBe(403);
    });

    it('PATCH sin body.value → 400', async () => {
      const res = await ctx.request
        .patch('/tenant/settings/test.empty')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({});
      expect(res.status).toBe(400);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Integración: Fraud lee thresholds del setting
  // ──────────────────────────────────────────────────────────────────────

  describe('Fraud thresholds vía settings', () => {
    it('default suspected=70: pair con score 30 (solo shared_ip) NO crea link', async () => {
      // Sin setting → default 70. Solo shared_ip = score 30, no link.
      const pA = await createTestUser(ctx.request, adminToken, {
        suite: 'ts-fraud-default-A',
        label: 'p',
        role: 'usuario_final',
      });
      const pB = await createTestUser(ctx.request, adminToken, {
        suite: 'ts-fraud-default-B',
        label: 'p',
        role: 'usuario_final',
      });
      await insertSession(pA.id, '111.111.111.111');
      await insertSession(pB.id, '111.111.111.111');

      await ctx.request
        .post('/tenant/fraud/scans/run')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      const links = await ctx.request
        .get('/tenant/fraud/links')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const data = links.body.data as Array<{ userAId: string; userBId: string }>;
      expect(data.find((l) => l.userAId === pA.id || l.userBId === pA.id)).toBeUndefined();
    });

    it('setting suspected=25: pair con score 30 AHORA crea link', async () => {
      await ctx.request
        .patch('/tenant/settings/fraud.suspected_threshold')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: 25 });

      const pA = await createTestUser(ctx.request, adminToken, {
        suite: 'ts-fraud-low-A',
        label: 'p',
        role: 'usuario_final',
      });
      const pB = await createTestUser(ctx.request, adminToken, {
        suite: 'ts-fraud-low-B',
        label: 'p',
        role: 'usuario_final',
      });
      await insertSession(pA.id, '222.222.222.222');
      await insertSession(pB.id, '222.222.222.222');

      await ctx.request
        .post('/tenant/fraud/scans/run')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      const links = await ctx.request
        .get('/tenant/fraud/links')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const data = links.body.data as Array<{ userAId: string; userBId: string; score: string }>;
      const myLink = data.find(
        (l) =>
          (l.userAId === pA.id && l.userBId === pB.id) ||
          (l.userAId === pB.id && l.userBId === pA.id),
      );
      expect(myLink).toBeDefined();
      expect(Number(myLink!.score)).toBe(30);
    });

    it('setting welcome_block=80: link confirmed score 85 AHORA bloquea welcome', async () => {
      await ctx.request
        .patch('/tenant/settings/fraud.welcome_block_threshold')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: 80 });

      // Crear welcome definition.
      const code = `welcome_ts_${Date.now()}`;
      // Archive previous welcomes para determinismo (mismo helper que
      // bonuses-auto-grant.e2e usa).
      const sqlConn = postgres(getTestTenantUrl(), { max: 1 });
      try {
        await sqlConn.unsafe(
          `UPDATE bonus_definitions SET status = 'archived' WHERE type = 'welcome' AND code <> $1`,
          [code],
        );
      } finally {
        await sqlConn.end();
      }
      await ctx.request
        .post('/tenant/bonus-definitions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          code,
          name: 'Welcome TS Test',
          type: 'welcome',
          status: 'active',
          config: { matchPct: 100, maxAmount: 50000, minDeposit: 0 },
        });

      // Crear player y forzar link confirmed score 85.
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'ts-welcome-block',
        label: 'p',
        role: 'usuario_final',
      });
      const phantom = await createTestUser(ctx.request, adminToken, {
        suite: 'ts-welcome-phantom',
        label: 'p',
        role: 'usuario_final',
      });
      await insertFraudLink(player.id, phantom.id, 85, 'confirmed');
      void setEmail;

      // Crear payment method.
      const methodSql = postgres(getTestTenantUrl(), { max: 1 });
      let methodId: string;
      try {
        const rows = await methodSql<{ id: string }[]>`
          INSERT INTO payment_methods (id, code, name, type, config, is_active)
          VALUES (gen_random_uuid(), ${`m-${Date.now()}`}, 'm', 'bank_transfer',
                  '{"cbu":"0000"}'::jsonb, true)
          RETURNING id
        `;
        methodId = rows[0]!.id;
      } finally {
        await methodSql.end();
      }

      // Crear + approve deposit.
      const playerLogin = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({ username: player.username, password: player.password });
      const pToken = `Bearer ${playerLogin.body.accessToken}`;

      const dep = await ctx.request
        .post('/tenant/deposits')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', pToken)
        .send({
          methodId,
          amountChips: '500',
          amountFiat: '500',
          currencyFiat: 'ARS',
        });
      expect(dep.status).toBe(201);
      const depositId = dep.body.deposit.id;

      const approve = await ctx.request
        .post(`/tenant/deposits/${depositId}/approve`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(approve.status).toBe(200);

      // Con welcome_block_threshold=80 y link score=85 confirmed,
      // el bono NO se otorga.
      expect(await countActiveBonusesFor(player.id)).toBe(0);
    });
  });
});
