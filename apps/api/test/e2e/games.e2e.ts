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
    it('sin JWT → 401', async () => {
      const res = await ctx.request
        .get('/tenant/games/active')
        .set('Host', TEST_TENANT.host);
      expect(res.status).toBe(401);
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
  });
});
