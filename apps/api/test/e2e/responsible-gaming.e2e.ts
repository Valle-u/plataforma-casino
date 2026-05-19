/**
 * E2E: ResponsibleGaming (Sprint 33).
 *
 * Cubre:
 *
 *   Self-service player:
 *     - GET /me sin settings → returns nulls.
 *     - PUT /me setea cap diario.
 *     - POST /me/exclude cool_off + endsAt → exclusion creada.
 *     - POST /me/exclude duplicada → 409.
 *     - Player NO puede setear `ageConfirmedMin` (se ignora silenciosamente).
 *
 *   Enforcement:
 *     - Deposit dentro del cap diario → 201.
 *     - Deposit que excede cap → 409 DEPOSIT_LIMIT_EXCEEDED.
 *     - Player con cool_off activa intenta crear deposit → 403 USER_EXCLUDED.
 *     - Player con cool_off activa intenta loguear → 401 con mensaje específico.
 *
 *   Admin:
 *     - GET /users/:id (review) lee settings de otro user.
 *     - PUT /users/:id/limits (admin_set) sin reason → 400.
 *     - PUT /users/:id/limits (admin_set) con reason → 200, audit severity:high.
 *     - POST /exclusions/:id/revoke → status='revoked'.
 *     - Cajero sin review → 403.
 */

import { sql } from 'drizzle-orm';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { createTestUser } from '../helpers/test-users';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { TEST_TENANT } from '../setup/test-tenant';

describe('Responsible gaming (E2E, Sprint 33)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let cajeroToken: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
    cajeroToken = await loginAs(
      ctx.request,
      TEST_TENANT.cajero1.username,
      TEST_TENANT.cajero1.password,
    );
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    // Limpieza entre tests para aislamiento.
    await ctx.tenantDb.execute(sql`DELETE FROM self_exclusions`);
    await ctx.tenantDb.execute(sql`DELETE FROM responsible_gaming_settings`);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────

  async function ensurePaymentMethod(): Promise<string> {
    const existing = await ctx.tenantDb.execute(
      sql`SELECT id FROM payment_methods WHERE code = 'rg_test' LIMIT 1`,
    );
    const rows = existing as unknown as Array<{ id: string }>;
    if (rows[0]) return rows[0].id;
    const ins = await ctx.tenantDb.execute(
      sql`INSERT INTO payment_methods (id, code, name, type, config, is_active)
          VALUES (gen_random_uuid(), 'rg_test', 'RG Test', 'bank_transfer', '{}'::jsonb, true)
          RETURNING id`,
    );
    return (ins as unknown as Array<{ id: string }>)[0]!.id;
  }

  async function makePlayer(label: string): Promise<{
    id: string;
    username: string;
    password: string;
    token: string;
  }> {
    const u = await createTestUser(ctx.request, adminToken, {
      suite: 'rg',
      label,
      role: 'usuario_final',
    });
    const token = await loginAs(ctx.request, u.username, u.password);
    return { ...u, token };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Self-service player
  // ──────────────────────────────────────────────────────────────────────

  describe('player self-service', () => {
    it('GET /me sin settings devuelve nulls', async () => {
      const player = await makePlayer('me_empty');
      const res = await ctx.request
        .get('/tenant/responsible-gaming/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ settings: null, exclusion: null });
    });

    it('PUT /me setea cap diario', async () => {
      const player = await makePlayer('me_setcap');
      const res = await ctx.request
        .patch('/tenant/responsible-gaming/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token)
        .send({ depositLimitDaily: '500' });
      expect(res.status).toBe(200);
      expect(res.body.depositLimitDaily).toBe('500.00');
      expect(res.body.updatedByUserId).toBe(player.id);
      expect(res.body.updatedByReason).toBeNull(); // self-service, no reason
    });

    it('player NO puede pisar ageConfirmedMin (campo ignorado en self-service)', async () => {
      const player = await makePlayer('me_age');
      // Mandamos 21 (valor válido para el DTO); el controller dropea el
      // campo porque actor=player (no admin).
      const res = await ctx.request
        .patch('/tenant/responsible-gaming/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token)
        .send({ ageConfirmedMin: 21 });
      expect(res.status).toBe(200);
      expect(res.body.ageConfirmedMin).toBeNull();
    });

    it('POST /me/exclude cool_off → exclusion activa', async () => {
      const player = await makePlayer('me_excl');
      const endsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const res = await ctx.request
        .post('/tenant/responsible-gaming/me/exclude')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token)
        .send({ type: 'cool_off', endsAt, reason: 'auto-test' });
      expect(res.status).toBe(201);
      expect(res.body.type).toBe('cool_off');
      expect(res.body.status).toBe('active');

      // GET /me/exclusion devuelve la activa.
      const r2 = await ctx.request
        .get('/tenant/responsible-gaming/me/exclusion')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token);
      expect(r2.status).toBe(200);
      expect(r2.body.exclusion.id).toBe(res.body.id);
    });

    it('duplicar exclusion activa → 409', async () => {
      const player = await makePlayer('me_dup');
      const endsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await ctx.request
        .post('/tenant/responsible-gaming/me/exclude')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token)
        .send({ type: 'cool_off', endsAt });
      const res = await ctx.request
        .post('/tenant/responsible-gaming/me/exclude')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token)
        .send({ type: 'temporary', endsAt });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('EXCLUSION_ALREADY_ACTIVE');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Enforcement
  // ──────────────────────────────────────────────────────────────────────

  describe('enforcement', () => {
    it('deposit dentro del cap diario → 201', async () => {
      const player = await makePlayer('enf_ok');
      await ctx.request
        .patch('/tenant/responsible-gaming/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token)
        .send({ depositLimitDaily: '1000' });
      const methodId = await ensurePaymentMethod();
      const res = await ctx.request
        .post('/tenant/deposits')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token)
        .send({
          methodId,
          amountFiat: '500',
          currencyFiat: 'ARS',
          amountChips: '500',
        });
      expect(res.status).toBe(201);
    });

    it('deposit que excede cap → 409 DEPOSIT_LIMIT_EXCEEDED', async () => {
      const player = await makePlayer('enf_cap');
      await ctx.request
        .patch('/tenant/responsible-gaming/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token)
        .send({ depositLimitDaily: '300' });
      const methodId = await ensurePaymentMethod();
      const res = await ctx.request
        .post('/tenant/deposits')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token)
        .send({
          methodId,
          amountFiat: '500',
          currencyFiat: 'ARS',
          amountChips: '500',
        });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('DEPOSIT_LIMIT_EXCEEDED');
      expect(res.body.window).toBe('daily');
      expect(res.body.cap).toBe('300.00');
    });

    it('player con cool_off activa: deposit → 403 USER_EXCLUDED', async () => {
      const player = await makePlayer('enf_excl_dep');
      const endsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await ctx.request
        .post('/tenant/responsible-gaming/me/exclude')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token)
        .send({ type: 'cool_off', endsAt });

      const methodId = await ensurePaymentMethod();
      const res = await ctx.request
        .post('/tenant/deposits')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token)
        .send({
          methodId,
          amountFiat: '100',
          currencyFiat: 'ARS',
          amountChips: '100',
        });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('USER_EXCLUDED');
      expect(res.body.exclusionType).toBe('cool_off');
    });

    it('player con cool_off activa: login → 401 con mensaje de bloqueo', async () => {
      const player = await makePlayer('enf_excl_login');
      const endsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await ctx.request
        .post('/tenant/responsible-gaming/me/exclude')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token)
        .send({ type: 'cool_off', endsAt });

      const res = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({ username: player.username, password: player.password });
      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/auto-exclusi/i);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Admin
  // ──────────────────────────────────────────────────────────────────────

  describe('admin', () => {
    it('admin GET /users/:id devuelve settings del player', async () => {
      const player = await makePlayer('admin_get');
      await ctx.request
        .patch('/tenant/responsible-gaming/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token)
        .send({ depositLimitDaily: '777' });
      const res = await ctx.request
        .get(`/tenant/responsible-gaming/users/${player.id}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.status).toBe(200);
      expect(res.body.settings.depositLimitDaily).toBe('777.00');
    });

    it('admin PUT /users/:id/limits sin reason → 400', async () => {
      const player = await makePlayer('admin_set_noreason');
      const res = await ctx.request
        .patch(`/tenant/responsible-gaming/users/${player.id}/limits`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ depositLimitDaily: '100' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('REASON_REQUIRED');
    });

    it('admin PUT con reason → 200 + updated_by_reason guardado', async () => {
      const player = await makePlayer('admin_set_ok');
      const res = await ctx.request
        .patch(`/tenant/responsible-gaming/users/${player.id}/limits`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          depositLimitDaily: '100',
          reason: 'soporte detectó comportamiento problemático',
        });
      expect(res.status).toBe(200);
      expect(res.body.depositLimitDaily).toBe('100.00');
      expect(res.body.updatedByReason).toMatch(/comportamiento/);
    });

    it('admin POST /exclusions/:id/revoke → status=revoked', async () => {
      const player = await makePlayer('admin_revoke');
      const endsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const create = await ctx.request
        .post('/tenant/responsible-gaming/me/exclude')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token)
        .send({ type: 'cool_off', endsAt });
      const exclusionId = create.body.id;

      const res = await ctx.request
        .post(`/tenant/responsible-gaming/exclusions/${exclusionId}/revoke`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ reason: 'jugador llamó a soporte, ya está OK' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('revoked');
      expect(res.body.revokedReason).toMatch(/soporte/);

      // El player ahora puede loguear de nuevo.
      const loginRes = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({ username: player.username, password: player.password });
      expect(loginRes.status).toBe(200);
    });

    it('cajero sin responsible_gaming.review → 403 al GET /users/:id', async () => {
      const player = await makePlayer('cajero_no_review');
      const res = await ctx.request
        .get(`/tenant/responsible-gaming/users/${player.id}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajeroToken);
      expect(res.status).toBe(403);
    });
  });
});
