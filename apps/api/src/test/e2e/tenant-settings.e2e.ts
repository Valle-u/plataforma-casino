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
    // También el history — sin esto, los tests del describe `History
    // endpoint` ven entries de tests previos del mismo suite.
    await sql.unsafe(`DELETE FROM tenant_settings_history`);
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

  // ──────────────────────────────────────────────────────────────────────
  // Validación typed por key (Zod registry)
  // ──────────────────────────────────────────────────────────────────────

  describe('Schema validation por key', () => {
    it('fraud.suspected_threshold acepta number 0-100', async () => {
      const ok = await ctx.request
        .patch('/tenant/settings/fraud.suspected_threshold')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: 75 });
      expect(ok.status).toBe(200);

      // Edge cases válidos.
      for (const v of [0, 50.5, 100]) {
        const r = await ctx.request
          .patch('/tenant/settings/fraud.suspected_threshold')
          .set('Host', TEST_TENANT.host)
          .set('Authorization', adminToken)
          .send({ value: v });
        expect(r.status).toBe(200);
      }
    });

    it('fraud.suspected_threshold rechaza string → 400', async () => {
      const res = await ctx.request
        .patch('/tenant/settings/fraud.suspected_threshold')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: 'seventy' });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        error: 'SETTING_VALUE_INVALID',
        key: 'fraud.suspected_threshold',
      });
      expect(res.body.issues).toBeDefined();
      expect(Array.isArray(res.body.issues)).toBe(true);
    });

    it('fraud.suspected_threshold rechaza valor fuera de rango (-1 o 101) → 400', async () => {
      for (const bad of [-1, 101, 150]) {
        const r = await ctx.request
          .patch('/tenant/settings/fraud.suspected_threshold')
          .set('Host', TEST_TENANT.host)
          .set('Authorization', adminToken)
          .send({ value: bad });
        expect(r.status).toBe(400);
        expect(r.body).toMatchObject({ error: 'SETTING_VALUE_INVALID' });
      }
    });

    it('fraud.welcome_block_threshold mismo schema 0-100', async () => {
      const ok = await ctx.request
        .patch('/tenant/settings/fraud.welcome_block_threshold')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: 95 });
      expect(ok.status).toBe(200);

      const bad = await ctx.request
        .patch('/tenant/settings/fraud.welcome_block_threshold')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: 'high' });
      expect(bad.status).toBe(400);
    });

    it('key NO registrada acepta cualquier value (forward-compat)', async () => {
      // Future feature: branding.primary_color (no registrada todavía).
      const r1 = await ctx.request
        .patch('/tenant/settings/custom.unknown_key')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: { nested: { obj: true }, arr: [1, 2, 3] } });
      expect(r1.status).toBe(200);

      const r2 = await ctx.request
        .patch('/tenant/settings/custom.another_unknown')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: 'anything goes' });
      expect(r2.status).toBe(200);
    });

    it('validation error body tiene issues con path/message/code', async () => {
      const res = await ctx.request
        .patch('/tenant/settings/fraud.suspected_threshold')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: 200 });
      expect(res.status).toBe(400);
      const issues = res.body.issues as Array<{ path: unknown; message: string; code: string }>;
      expect(issues.length).toBeGreaterThanOrEqual(1);
      expect(issues[0]).toHaveProperty('message');
      expect(issues[0]).toHaveProperty('code');
    });

    it('después de validation error, setting previo NO cambió', async () => {
      // Setear OK.
      await ctx.request
        .patch('/tenant/settings/fraud.suspected_threshold')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: 60 });

      // Intentar setear inválido.
      await ctx.request
        .patch('/tenant/settings/fraud.suspected_threshold')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: 999 });

      // Verificar que sigue siendo 60.
      const get = await ctx.request
        .get('/tenant/settings/fraud.suspected_threshold')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(get.status).toBe(200);
      expect(get.body.value).toBe(60);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // History (append-only audit detallado)
  // ──────────────────────────────────────────────────────────────────────

  describe('History endpoint', () => {
    /** Lee history directo de DB (más confiable que el endpoint para asserts). */
    async function readHistoryFromDb(key: string): Promise<Array<Record<string, unknown>>> {
      const sql = postgres(getTestTenantUrl(), { max: 1 });
      try {
        const rows = await sql<Array<Record<string, unknown>>>`
          SELECT * FROM tenant_settings_history
          WHERE key = ${key}
          ORDER BY changed_at ASC
        `;
        return rows;
      } finally {
        await sql.end();
      }
    }

    it('primer set crea history entry con previousValue=null', async () => {
      const key = 'fraud.suspected_threshold';
      await ctx.request
        .patch(`/tenant/settings/${key}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: 65 });

      const rows = await readHistoryFromDb(key);
      expect(rows.length).toBeGreaterThanOrEqual(1);
      const first = rows[0]!;
      expect(first.action).toBe('set');
      expect(first.new_value).toBe(65);
      expect(first.previous_value).toBeNull();
      expect(first.changed_by_user_id).toBeDefined();
    });

    it('segundo set captura previous → new', async () => {
      const key = 'fraud.suspected_threshold';
      await ctx.request
        .patch(`/tenant/settings/${key}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: 50 });
      await ctx.request
        .patch(`/tenant/settings/${key}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: 75 });

      const rows = await readHistoryFromDb(key);
      // Last entry: previous=50, new=75.
      const last = rows[rows.length - 1]!;
      expect(last.previous_value).toBe(50);
      expect(last.new_value).toBe(75);
      expect(last.action).toBe('set');
    });

    it('unset crea entry con action=unset y new_value=null', async () => {
      const key = 'custom.tmp_for_unset';
      await ctx.request
        .patch(`/tenant/settings/${key}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: 'temp' });
      await ctx.request
        .delete(`/tenant/settings/${key}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      const rows = await readHistoryFromDb(key);
      // 1 set + 1 unset.
      expect(rows.length).toBe(2);
      const unsetEntry = rows[1]!;
      expect(unsetEntry.action).toBe('unset');
      expect(unsetEntry.previous_value).toBe('temp');
      expect(unsetEntry.new_value).toBeNull();
    });

    it('unset idempotente NO crea history entry si el setting no existía', async () => {
      const key = 'custom.never_set_at_all';
      await ctx.request
        .delete(`/tenant/settings/${key}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      const rows = await readHistoryFromDb(key);
      expect(rows).toHaveLength(0);
    });

    it('GET /:key/history devuelve entries ordenadas DESC', async () => {
      const key = 'custom.history_endpoint';
      // 3 sets sequential.
      for (const v of ['a', 'b', 'c']) {
        await ctx.request
          .patch(`/tenant/settings/${key}`)
          .set('Host', TEST_TENANT.host)
          .set('Authorization', adminToken)
          .send({ value: v });
      }

      const res = await ctx.request
        .get(`/tenant/settings/${key}/history`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.status).toBe(200);
      const data = res.body.data as Array<{
        newValue: unknown;
        previousValue: unknown;
        action: string;
      }>;
      expect(data).toHaveLength(3);
      // DESC: el más reciente primero (c, b, a).
      expect(data[0]!.newValue).toBe('c');
      expect(data[1]!.newValue).toBe('b');
      expect(data[2]!.newValue).toBe('a');
      // Previous values en la secuencia.
      expect(data[0]!.previousValue).toBe('b');
      expect(data[1]!.previousValue).toBe('a');
      expect(data[2]!.previousValue).toBeNull();
    });

    it('GET history con limit/offset funciona', async () => {
      const key = 'custom.history_pagination';
      for (let i = 0; i < 5; i += 1) {
        await ctx.request
          .patch(`/tenant/settings/${key}`)
          .set('Host', TEST_TENANT.host)
          .set('Authorization', adminToken)
          .send({ value: i });
      }

      const page1 = await ctx.request
        .get(`/tenant/settings/${key}/history?limit=2&offset=0`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(page1.body.data).toHaveLength(2);
      // Más recientes primero: 4 luego 3.
      expect(page1.body.data[0].newValue).toBe(4);

      const page2 = await ctx.request
        .get(`/tenant/settings/${key}/history?limit=2&offset=2`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(page2.body.data).toHaveLength(2);
      expect(page2.body.data[0].newValue).toBe(2);
    });

    it('cajero1 sin tenant.settings.edit → 403 en /:key/history', async () => {
      const res = await ctx.request
        .get('/tenant/settings/fraud.suspected_threshold/history')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero1Token);
      expect(res.status).toBe(403);
    });

    it('validation error NO escribe history', async () => {
      const key = 'fraud.suspected_threshold';
      // 1 set válido.
      await ctx.request
        .patch(`/tenant/settings/${key}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: 50 });

      const before = (await readHistoryFromDb(key)).length;

      // Set inválido.
      await ctx.request
        .patch(`/tenant/settings/${key}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: 'invalid-not-a-number' });

      const after = (await readHistoryFromDb(key)).length;
      // Mismo count — no se creó entry por el intento inválido.
      expect(after).toBe(before);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Retention policy (purga periódica del history)
  // ──────────────────────────────────────────────────────────────────────

  describe('History retention', () => {
    /**
     * Inserta una entry sintética con `changed_at` arbitrario (back-
     * dated). Útil para testear retention sin esperar días reales.
     */
    async function insertHistoryEntry(
      key: string,
      changedAtIso: string,
      value: unknown = 'old',
    ): Promise<void> {
      const sql = postgres(getTestTenantUrl(), { max: 1 });
      try {
        await sql.unsafe(
          `INSERT INTO tenant_settings_history
            (id, key, previous_value, new_value, action, changed_at)
           VALUES (gen_random_uuid(), $1, NULL, $2::jsonb, 'set', $3)`,
          [key, JSON.stringify(value), changedAtIso],
        );
      } finally {
        await sql.end();
      }
    }

    async function countHistory(key: string): Promise<number> {
      const sql = postgres(getTestTenantUrl(), { max: 1 });
      try {
        const rows = await sql<{ count: string }[]>`
          SELECT count(*) FROM tenant_settings_history WHERE key = ${key}
        `;
        return Number(rows[0]!.count);
      } finally {
        await sql.end();
      }
    }

    it('endpoint con default retention 365 borra entries > 365d y respeta entries recientes', async () => {
      const key = 'custom.retention_default';
      const now = Date.now();
      const oldIso = new Date(now - 400 * 24 * 3600 * 1000).toISOString();
      const recentIso = new Date(now - 10 * 24 * 3600 * 1000).toISOString();
      await insertHistoryEntry(key, oldIso, 'ancient');
      await insertHistoryEntry(key, recentIso, 'recent');

      expect(await countHistory(key)).toBe(2);

      const res = await ctx.request
        .post('/tenant/settings/history/purge')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        retentionDaysApplied: 365,
        deleted: 1,
      });

      expect(await countHistory(key)).toBe(1);
    });

    it('custom retention 30d: borra >30d, conserva ≤30d', async () => {
      // Setear retention agresiva.
      const setRes = await ctx.request
        .patch('/tenant/settings/tenant_settings.history_retention_days')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: 30 });
      expect(setRes.status).toBe(200);

      const key = 'custom.retention_30';
      const now = Date.now();
      await insertHistoryEntry(key, new Date(now - 60 * 24 * 3600 * 1000).toISOString(), 'm2');
      await insertHistoryEntry(key, new Date(now - 45 * 24 * 3600 * 1000).toISOString(), 'm1.5');
      await insertHistoryEntry(key, new Date(now - 15 * 24 * 3600 * 1000).toISOString(), 'recent');

      // Total: 3 del key + 1 del set (tenant_settings.history_retention_days)
      // del PATCH anterior. El purge se aplica al history GLOBAL.
      const beforeKey = await countHistory(key);
      expect(beforeKey).toBe(3);

      const res = await ctx.request
        .post('/tenant/settings/history/purge')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.status).toBe(200);
      expect(res.body.retentionDaysApplied).toBe(30);
      // Al menos 2 del key debieron borrarse.
      expect(res.body.deleted).toBeGreaterThanOrEqual(2);

      const afterKey = await countHistory(key);
      expect(afterKey).toBe(1);
    });

    it('purge idempotente: re-run no borra entries que ya pasaron', async () => {
      const key = 'custom.retention_idempotent';
      await insertHistoryEntry(
        key,
        new Date(Date.now() - 400 * 24 * 3600 * 1000).toISOString(),
      );

      const r1 = await ctx.request
        .post('/tenant/settings/history/purge')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(r1.body.deleted).toBeGreaterThanOrEqual(1);

      const r2 = await ctx.request
        .post('/tenant/settings/history/purge')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      // Segunda corrida: nada nuevo elegible.
      expect(r2.body.deleted).toBe(0);
    });

    it('schema rechaza retention <7 días → 400', async () => {
      const res = await ctx.request
        .patch('/tenant/settings/tenant_settings.history_retention_days')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: 1 });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        error: 'SETTING_VALUE_INVALID',
        key: 'tenant_settings.history_retention_days',
      });
    });

    it('schema rechaza retention >3650 días → 400', async () => {
      const res = await ctx.request
        .patch('/tenant/settings/tenant_settings.history_retention_days')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: 5000 });
      expect(res.status).toBe(400);
    });

    it('schema rechaza retention no-entero → 400', async () => {
      const res = await ctx.request
        .patch('/tenant/settings/tenant_settings.history_retention_days')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: 90.5 });
      expect(res.status).toBe(400);
    });

    it('cajero1 sin tenant.settings.edit → 403 en POST history/purge', async () => {
      const res = await ctx.request
        .post('/tenant/settings/history/purge')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero1Token);
      expect(res.status).toBe(403);
    });

    it('purge sin entries → deleted=0', async () => {
      // beforeEach ya limpió history.
      const res = await ctx.request
        .post('/tenant/settings/history/purge')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ deleted: 0, retentionDaysApplied: 365 });
    });

    it('audit log: purge manual con deleted>0 graba entry severity=medium', async () => {
      const key = 'custom.retention_audit';
      await insertHistoryEntry(
        key,
        new Date(Date.now() - 400 * 24 * 3600 * 1000).toISOString(),
      );

      // Capturar audit count antes.
      const sql = postgres(getTestTenantUrl(), { max: 1 });
      let beforeCount: number;
      try {
        const rows = await sql<{ count: string }[]>`
          SELECT count(*) FROM audit_log
          WHERE action_code = 'tenant.setting.history.purge.manual'
        `;
        beforeCount = Number(rows[0]!.count);
      } finally {
        await sql.end();
      }

      const res = await ctx.request
        .post('/tenant/settings/history/purge')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.status).toBe(200);
      expect(res.body.deleted).toBeGreaterThanOrEqual(1);

      const sql2 = postgres(getTestTenantUrl(), { max: 1 });
      try {
        const rows = await sql2<{ count: string }[]>`
          SELECT count(*) FROM audit_log
          WHERE action_code = 'tenant.setting.history.purge.manual'
        `;
        expect(Number(rows[0]!.count)).toBeGreaterThan(beforeCount);

        // Verificar severity=medium en la entry más reciente.
        const latest = await sql2<Array<{ metadata: Record<string, unknown> }>>`
          SELECT metadata FROM audit_log
          WHERE action_code = 'tenant.setting.history.purge.manual'
          ORDER BY created_at DESC
          LIMIT 1
        `;
        expect(latest[0]!.metadata).toMatchObject({ severity: 'medium' });
        expect(latest[0]!.metadata).toHaveProperty('deleted');
        expect(latest[0]!.metadata).toHaveProperty('retentionDays');
      } finally {
        await sql2.end();
      }
    });

    it('audit log: purge con deleted=0 NO graba entry (skip)', async () => {
      const sql = postgres(getTestTenantUrl(), { max: 1 });
      let beforeCount: number;
      try {
        const rows = await sql<{ count: string }[]>`
          SELECT count(*) FROM audit_log
          WHERE action_code = 'tenant.setting.history.purge.manual'
        `;
        beforeCount = Number(rows[0]!.count);
      } finally {
        await sql.end();
      }

      const res = await ctx.request
        .post('/tenant/settings/history/purge')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.body.deleted).toBe(0);

      const sql2 = postgres(getTestTenantUrl(), { max: 1 });
      try {
        const rows = await sql2<{ count: string }[]>`
          SELECT count(*) FROM audit_log
          WHERE action_code = 'tenant.setting.history.purge.manual'
        `;
        expect(Number(rows[0]!.count)).toBe(beforeCount);
      } finally {
        await sql2.end();
      }
    });
  });
});
