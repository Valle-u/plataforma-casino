/**
 * E2E: GamesController (Sprint 34).
 *
 * Cubre:
 *   - Seed mock games: el catálogo se popula en bootstrap.
 *   - Player /active: solo isActive=true; filter por category + featuredOnly.
 *   - Player /code/:code: 404 si archivado, 200 con detalle si activo.
 *   - Admin GET / (con games.edit): list paginado.
 *   - Admin POST: crea con audit.
 *   - Admin POST conflict code → 409.
 *   - Admin PATCH actualiza + audit.
 *   - Admin /archive (soft-delete) + idempotente.
 *   - Cajero sin games.edit → 403.
 *   - Player NO ve archivados en /active.
 */

import { sql } from 'drizzle-orm';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { createTestUser } from '../helpers/test-users';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { TEST_TENANT } from '../setup/test-tenant';

describe('Games catalog (E2E, Sprint 34)', () => {
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
    // Limpiar games custom creados por tests previos pero PRESERVAR el
    // catálogo mock del seed (los códigos empiezan con 'mock_').
    await ctx.tenantDb.execute(
      sql`DELETE FROM games WHERE code NOT LIKE 'mock_%'`,
    );
    // Re-set isActive=true en los mock por si algún test los archivó.
    await ctx.tenantDb.execute(
      sql`UPDATE games SET is_active = true WHERE code LIKE 'mock_%'`,
    );
  });

  // ──────────────────────────────────────────────────────────────────────
  // Seed: el catálogo mock se popula en bootstrap
  // ──────────────────────────────────────────────────────────────────────

  describe('seed mock catalog', () => {
    it('el bootstrap dejó al menos 8 mock games activos', async () => {
      const r = await ctx.tenantDb.execute(
        sql`SELECT COUNT(*)::int AS n FROM games WHERE code LIKE 'mock_%' AND is_active = true`,
      );
      const n = (r as unknown as Array<{ n: number }>)[0]!.n;
      expect(n).toBeGreaterThanOrEqual(8);
    });

    it('al menos un mock está marcado como featured', async () => {
      const r = await ctx.tenantDb.execute(
        sql`SELECT COUNT(*)::int AS n FROM games WHERE code LIKE 'mock_%' AND featured = true`,
      );
      const n = (r as unknown as Array<{ n: number }>)[0]!.n;
      expect(n).toBeGreaterThanOrEqual(1);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Player-facing
  // ──────────────────────────────────────────────────────────────────────

  describe('GET /tenant/games/active', () => {
    // El lobby es PÚBLICO desde "feat: public browsing" (commit 87a1683,
    // 2026-07-25): el casino se ve sin login. El endpoint está marcado
    // @Public() y solo expone catálogo (sin datos sensibles del jugador).
    it('sin JWT → 200 (browsing público, casino visible sin login)', async () => {
      const res = await ctx.request
        .get('/tenant/games/active')
        .set('Host', TEST_TENANT.host);
      expect(res.status).toBe(200);
      const body = res.body as { data: Array<{ isActive: boolean }> };
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.every((g) => g.isActive === true)).toBe(true);
    });

    it('player logueado recibe activos', async () => {
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'games',
        label: 'player_active',
        role: 'usuario_final',
      });
      const token = await loginAs(ctx.request, player.username, player.password);
      const res = await ctx.request
        .get('/tenant/games/active')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token);
      expect(res.status).toBe(200);
      const body = res.body as { data: Array<{ code: string; isActive: boolean }> };
      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data.every((g) => g.isActive === true)).toBe(true);
    });

    it('filter por category=slots', async () => {
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'games',
        label: 'player_cat',
        role: 'usuario_final',
      });
      const token = await loginAs(ctx.request, player.username, player.password);
      const res = await ctx.request
        .get('/tenant/games/active?category=slots')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token);
      expect(res.status).toBe(200);
      const body = res.body as { data: Array<{ category: string }> };
      expect(body.data.every((g) => g.category === 'slots')).toBe(true);
    });

    it('filter featuredOnly=true', async () => {
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'games',
        label: 'player_feat',
        role: 'usuario_final',
      });
      const token = await loginAs(ctx.request, player.username, player.password);
      const res = await ctx.request
        .get('/tenant/games/active?featuredOnly=true')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token);
      expect(res.status).toBe(200);
      const body = res.body as { data: Array<{ featured: boolean }> };
      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data.every((g) => g.featured === true)).toBe(true);
    });
  });

  describe('filtro por proveedor (multi-proveedor Forever)', () => {
    it('un juego de Forever aparece mezclado y se filtra por providerCode', async () => {
      // Crear un juego con provider_code='forever'.
      const created = await ctx.request
        .post('/tenant/games')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          code: 'forever_testvendor_g1',
          name: 'Forever Test Game',
          category: 'slots',
          providerCode: 'forever',
          config: { forever: { vendorCode: 'testvendor', gameCode: 'g1', gameType: 1 } },
        });
      expect(created.status).toBe(201);

      // Mezclado: el lobby sin filtro lo incluye.
      const all = await ctx.request
        .get('/tenant/games/active')
        .set('Host', TEST_TENANT.host);
      expect(all.status).toBe(200);
      const allCodes = (all.body as { data: Array<{ code: string }> }).data.map((g) => g.code);
      expect(allCodes).toContain('forever_testvendor_g1');

      // Filtrado por proveedor: providerCode=forever → solo Forever.
      const onlyForever = await ctx.request
        .get('/tenant/games/active?providerCode=forever')
        .set('Host', TEST_TENANT.host);
      expect(onlyForever.status).toBe(200);
      const fdata = (onlyForever.body as { data: Array<{ code: string; providerCode: string }> }).data;
      expect(fdata.length).toBeGreaterThan(0);
      expect(fdata.every((g) => g.providerCode === 'forever')).toBe(true);

      // Filtrado por Palace NO trae el de Forever.
      const onlyPalace = await ctx.request
        .get('/tenant/games/active?providerCode=palace')
        .set('Host', TEST_TENANT.host);
      const pcodes = (onlyPalace.body as { data: Array<{ code: string }> }).data.map((g) => g.code);
      expect(pcodes).not.toContain('forever_testvendor_g1');
    });
  });

  describe('GET /tenant/games/code/:code', () => {
    it('200 con detalle si activo', async () => {
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'games',
        label: 'player_code',
        role: 'usuario_final',
      });
      const token = await loginAs(ctx.request, player.username, player.password);
      const res = await ctx.request
        .get('/tenant/games/code/mock_lucky_seven')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token);
      expect(res.status).toBe(200);
      expect(res.body.code).toBe('mock_lucky_seven');
      expect(res.body.category).toBe('slots');
    });

    it('404 si code inexistente', async () => {
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'games',
        label: 'player_404',
        role: 'usuario_final',
      });
      const token = await loginAs(ctx.request, player.username, player.password);
      const res = await ctx.request
        .get('/tenant/games/code/no_existe')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token);
      expect(res.status).toBe(404);
    });

    it('404 si archivado (player no ve)', async () => {
      // Archivamos un mock via SQL para no depender del endpoint admin.
      await ctx.tenantDb.execute(
        sql`UPDATE games SET is_active = false WHERE code = 'mock_fruit_fiesta'`,
      );
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'games',
        label: 'player_archived',
        role: 'usuario_final',
      });
      const token = await loginAs(ctx.request, player.username, player.password);
      const res = await ctx.request
        .get('/tenant/games/code/mock_fruit_fiesta')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token);
      expect(res.status).toBe(404);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Admin
  // ──────────────────────────────────────────────────────────────────────

  describe('admin', () => {
    it('admin GET / lista con total', async () => {
      const res = await ctx.request
        .get('/tenant/games')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.status).toBe(200);
      const body = res.body as { data: unknown[]; total: number };
      expect(body.total).toBeGreaterThanOrEqual(8);
    });

    it('cajero sin games.edit → 403', async () => {
      const res = await ctx.request
        .get('/tenant/games')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajeroToken);
      expect(res.status).toBe(403);
    });

    it('admin POST crea + audit', async () => {
      const res = await ctx.request
        .post('/tenant/games')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          code: 'custom_test_game',
          name: 'Test Custom',
          category: 'slots',
          config: { rtp: 0.97 },
        });
      expect(res.status).toBe(201);
      expect(res.body.code).toBe('custom_test_game');

      const audit = await ctx.tenantDb.execute(
        sql`SELECT action_code FROM audit_log WHERE target_id = ${res.body.id} ORDER BY created_at DESC LIMIT 1`,
      );
      const arows = audit as unknown as Array<{ action_code: string }>;
      expect(arows[0]!.action_code).toBe('games.create');
    });

    it('admin POST conflict code → 409', async () => {
      await ctx.request
        .post('/tenant/games')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          code: 'dup_test_game',
          name: 'First',
          category: 'slots',
        });
      const res = await ctx.request
        .post('/tenant/games')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          code: 'dup_test_game',
          name: 'Second',
          category: 'crash',
        });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('GAME_CODE_CONFLICT');
    });

    it('admin PATCH actualiza name + featured', async () => {
      const create = await ctx.request
        .post('/tenant/games')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          code: 'patch_test_game',
          name: 'Old Name',
          category: 'table',
        });
      const id = create.body.id;
      const res = await ctx.request
        .patch(`/tenant/games/${id}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ name: 'New Name', featured: true });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('New Name');
      expect(res.body.featured).toBe(true);
    });

    it('admin POST :id/archive → isActive=false, idempotente', async () => {
      const create = await ctx.request
        .post('/tenant/games')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          code: 'archive_test_game',
          name: 'To Archive',
          category: 'slots',
        });
      const id = create.body.id;
      const r1 = await ctx.request
        .post(`/tenant/games/${id}/archive`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(r1.status).toBe(200);
      expect(r1.body.isActive).toBe(false);

      const r2 = await ctx.request
        .post(`/tenant/games/${id}/archive`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(r2.status).toBe(200);
      expect(r2.body.isActive).toBe(false);
    });

    // Auditoría economía (2026-07): clamp barato de `config.rtp`. Un RTP > 1
    // (o ≤ 0) haría que la casa pierda estructuralmente cada ronda. Se valida
    // al crear/editar (games.service.assertValidConfig → 400 GAME_INVALID_CONFIG).
    it('POST con rtp > 1 → 400 GAME_INVALID_CONFIG', async () => {
      const res = await ctx.request
        .post('/tenant/games')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          code: `audit_rtp_hi_${Date.now().toString(36)}`,
          name: 'Audit RTP alto',
          category: 'slots',
          config: { rtp: 1.5 },
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('GAME_INVALID_CONFIG');
    });

    it('POST con rtp <= 0 → 400 GAME_INVALID_CONFIG', async () => {
      const res = await ctx.request
        .post('/tenant/games')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          code: `audit_rtp_zero_${Date.now().toString(36)}`,
          name: 'Audit RTP cero',
          category: 'slots',
          config: { rtp: 0 },
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('GAME_INVALID_CONFIG');
    });

    it('PATCH que sube rtp a 2 → 400 GAME_INVALID_CONFIG', async () => {
      const create = await ctx.request
        .post('/tenant/games')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          code: `audit_rtp_patch_${Date.now().toString(36)}`,
          name: 'Audit RTP patch',
          category: 'slots',
          config: { rtp: 0.95 },
        });
      expect(create.status).toBe(201);
      const res = await ctx.request
        .patch(`/tenant/games/${create.body.id}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ config: { rtp: 2 } });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('GAME_INVALID_CONFIG');
    });
  });
});
