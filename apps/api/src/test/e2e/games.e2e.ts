/**
 * E2E: GamesController (Sprint 34).
 *
 * El catálogo del seed arranca VACÍO (los juegos reales se pueblan
 * sincronizando desde el proveedor). Este suite siembra sus propios fixtures
 * (`e2e_seed_*`) en beforeAll y los limpia en afterAll.
 *
 * Cubre:
 *   - Fixtures del catálogo: los juegos sembrados quedan activos.
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
import { refreshStudios } from '../../games/refresh-studios';

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

    // Fixtures del suite: 8 juegos activos (4 slots, 1 crash, 2 table, 1 live),
    // 2 destacados. El código empieza con `e2e_seed_` para distinguirlos de los
    // games custom que crean los tests. Idempotente por code.
    await ctx.tenantDb.execute(sql`
      INSERT INTO games (id, code, name, provider_code, category, config, featured, sort_order, is_active) VALUES
        (gen_random_uuid(), 'e2e_seed_slot_1', 'Seed Slot 1', 'palace', 'slots', '{"rtp":0.96,"minBet":"1","maxBet":"500"}'::jsonb, true,  10, true),
        (gen_random_uuid(), 'e2e_seed_slot_2', 'Seed Slot 2', 'palace', 'slots', '{"rtp":0.96}'::jsonb,                            false, 20, true),
        (gen_random_uuid(), 'e2e_seed_slot_3', 'Seed Slot 3', 'palace', 'slots', '{"rtp":0.96}'::jsonb,                            false, 30, true),
        (gen_random_uuid(), 'e2e_seed_slot_4', 'Seed Slot 4', 'palace', 'slots', '{"rtp":0.97}'::jsonb,                            false, 40, true),
        (gen_random_uuid(), 'e2e_seed_crash_1','Seed Crash 1','palace', 'crash', '{"houseEdge":0.01}'::jsonb,                      true,  10, true),
        (gen_random_uuid(), 'e2e_seed_table_1','Seed Table 1','palace', 'table', '{}'::jsonb,                                      false, 10, true),
        (gen_random_uuid(), 'e2e_seed_table_2','Seed Table 2','palace', 'table', '{}'::jsonb,                                      false, 20, true),
        (gen_random_uuid(), 'e2e_seed_live_1', 'Seed Live 1', 'palace', 'live',  '{}'::jsonb,                                      false, 10, true)
      ON CONFLICT (code) DO NOTHING
    `);
  });

  afterAll(async () => {
    await ctx.tenantDb.execute(
      sql`DELETE FROM games WHERE code LIKE 'e2e_seed_%'`,
    );
    await ctx.close();
  });

  beforeEach(async () => {
    // Limpiar games custom creados por tests previos pero PRESERVAR los
    // fixtures del suite (los códigos empiezan con 'e2e_seed_').
    await ctx.tenantDb.execute(
      sql`DELETE FROM games WHERE code NOT LIKE 'e2e_seed_%'`,
    );
    // Re-set isActive=true en los fixtures por si algún test los archivó.
    await ctx.tenantDb.execute(
      sql`UPDATE games SET is_active = true WHERE code LIKE 'e2e_seed_%'`,
    );
  });

  // ──────────────────────────────────────────────────────────────────────
  // Fixtures del catálogo
  // ──────────────────────────────────────────────────────────────────────

  describe('fixtures del catálogo', () => {
    it('los fixtures quedaron activos (al menos 8)', async () => {
      const r = await ctx.tenantDb.execute(
        sql`SELECT COUNT(*)::int AS n FROM games WHERE code LIKE 'e2e_seed_%' AND is_active = true`,
      );
      const n = (r as unknown as Array<{ n: number }>)[0]!.n;
      expect(n).toBeGreaterThanOrEqual(8);
    });

    it('al menos un fixture está marcado como featured', async () => {
      const r = await ctx.tenantDb.execute(
        sql`SELECT COUNT(*)::int AS n FROM games WHERE code LIKE 'e2e_seed_%' AND featured = true`,
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

  describe('búsqueda por proveedor / vendor (search)', () => {
    // Juego de Forever con un vendor reconocible: vendorCode 'slot-pragmatic'
    // (así se puede buscar por "pragmatic" además de por nombre/código).
    beforeEach(async () => {
      await ctx.request
        .post('/tenant/games')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          code: 'e2e_search_forever_prag',
          name: 'Gates Test',
          category: 'slots',
          providerCode: 'forever',
          config: { forever: { vendorCode: 'slot-pragmatic', gameCode: 'gatestest', gameType: 1 } },
        });
      // El estudio no viene en el alta: lo DERIVA el mismo paso que corre al
      // final de cada sync (migración 0107). Llamarlo acá hace que el test
      // ejercite el camino real y no un valor puesto a mano.
      await refreshStudios(ctx.tenantDb);
    });
    afterEach(async () => {
      await ctx.tenantDb.execute(
        sql`DELETE FROM games WHERE code = 'e2e_search_forever_prag'`,
      );
    });

    it('search por provider_code "forever" trae los juegos de Forever', async () => {
      const res = await ctx.request
        .get('/tenant/games/active?search=forever')
        .set('Host', TEST_TENANT.host);
      expect(res.status).toBe(200);
      const data = (res.body as { data: Array<{ code: string; providerCode: string }> }).data;
      expect(data.some((g) => g.code === 'e2e_search_forever_prag')).toBe(true);
      expect(data.every((g) => g.providerCode === 'forever')).toBe(true);
    });

    it('search por ESTUDIO ("pragmatic" derivado del vendorCode slot-pragmatic)', async () => {
      const res = await ctx.request
        .get('/tenant/games/active?search=pragmatic')
        .set('Host', TEST_TENANT.host);
      expect(res.status).toBe(200);
      const codes = (res.body as { data: Array<{ code: string }> }).data.map((g) => g.code);
      expect(codes).toContain('e2e_search_forever_prag');
    });

    it('el estudio se canoniza: `slot-pragmatic` y `Pragmatic` caen en el mismo', async () => {
      // Forever manda codes en minúscula (`slot-pragmatic`) y Gregmorn nombres
      // con mayúscula (`Pragmatic`). Sin canonizar quedaban dos chips para el
      // mismo estudio; peor, Gregmorn mandaba `Pragmatic` Y `pragmatic`.
      await ctx.tenantDb.execute(
        sql`INSERT INTO games (id, code, name, category, provider_code, config)
             VALUES (gen_random_uuid(), 'e2e_studio_greg', 'Otro Test', 'slots',
                     'gregmorn', '{"gregmorn":{"provider":"Pragmatic"}}'::jsonb)`,
      );
      await refreshStudios(ctx.tenantDb);

      const r = await ctx.tenantDb.execute(
        sql`SELECT code, studio FROM games
             WHERE code IN ('e2e_search_forever_prag', 'e2e_studio_greg')`,
      );
      const byCode = new Map(
        (r as unknown as { code: string; studio: string | null }[]).map((x) => [
          x.code,
          x.studio,
        ]),
      );
      // Gana la variante CON mayúsculas, no la más frecuente.
      expect(byCode.get('e2e_studio_greg')).toBe('Pragmatic');
      expect(byCode.get('e2e_search_forever_prag')).toBe('Pragmatic');

      await ctx.tenantDb.execute(
        sql`DELETE FROM games WHERE code = 'e2e_studio_greg'`,
      );
    });

    it('search por nombre del juego sigue funcionando', async () => {
      const res = await ctx.request
        .get('/tenant/games/active?search=gates')
        .set('Host', TEST_TENANT.host);
      const codes = (res.body as { data: Array<{ code: string }> }).data.map((g) => g.code);
      expect(codes).toContain('e2e_search_forever_prag');
    });

    it('search por "palace" trae Palace pero NO el de Forever', async () => {
      const res = await ctx.request
        .get('/tenant/games/active?search=palace')
        .set('Host', TEST_TENANT.host);
      const codes = (res.body as { data: Array<{ code: string }> }).data.map((g) => g.code);
      expect(codes).not.toContain('e2e_search_forever_prag');
      expect(codes).toContain('e2e_seed_slot_1');
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
        .get('/tenant/games/code/e2e_seed_slot_3')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token);
      expect(res.status).toBe(200);
      expect(res.body.code).toBe('e2e_seed_slot_3');
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
      // Archivamos un fixture via SQL para no depender del endpoint admin.
      await ctx.tenantDb.execute(
        sql`UPDATE games SET is_active = false WHERE code = 'e2e_seed_slot_4'`,
      );
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'games',
        label: 'player_archived',
        role: 'usuario_final',
      });
      const token = await loginAs(ctx.request, player.username, player.password);
      const res = await ctx.request
        .get('/tenant/games/code/e2e_seed_slot_4')
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
  describe('facets: conteo de destacados', () => {
    // El lobby decide con este número si muestra la pestaña "Destacados".
    // Si devolviera 0 con destacados existentes, la sección sería inalcanzable;
    // si devolviera >0 sin ninguno, la pestaña llevaría a una grilla vacía.
    let gameId: string | undefined;

    afterEach(async () => {
      await ctx.tenantDb.execute(
        sql`DELETE FROM games WHERE code = 'e2e_featured_tab'`,
      );
      gameId = undefined;
    });

    it('cuenta los destacados y los expone en ?featuredOnly=true', async () => {
      const antes = await ctx.request
        .get('/tenant/games/facets')
        .set('Host', TEST_TENANT.host);
      expect(antes.status).toBe(200);
      const base = (antes.body as { featured: number }).featured;

      const create = await ctx.request
        .post('/tenant/games')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          code: 'e2e_featured_tab',
          name: 'Destacado Test',
          category: 'slots',
          featured: true,
        });
      expect(create.status).toBe(201);
      gameId = (create.body as { id: string }).id;
      expect(gameId).toBeDefined();

      const despues = await ctx.request
        .get('/tenant/games/facets')
        .set('Host', TEST_TENANT.host);
      expect((despues.body as { featured: number }).featured).toBe(base + 1);

      // Y la pestaña tiene que poder listarlo.
      const lista = await ctx.request
        .get('/tenant/games/active?featuredOnly=true')
        .set('Host', TEST_TENANT.host);
      expect(lista.status).toBe(200);
      const codes = (lista.body as { data: Array<{ code: string }> }).data.map(
        (g) => g.code,
      );
      expect(codes).toContain('e2e_featured_tab');
    });

    it('el listado de admin filtra por ?providerCode', async () => {
      // Con tres proveedores y 9462 juegos, poder acotar a uno es la diferencia
      // entre curar el catálogo y scrollear.
      await ctx.request
        .post('/tenant/games')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          code: 'e2e_featured_tab',
          name: 'Destacado Test',
          category: 'slots',
          providerCode: 'forever',
        });

      const res = await ctx.request
        .get('/tenant/games?providerCode=forever&limit=100')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.status).toBe(200);
      const data = (res.body as { data: Array<{ code: string; providerCode: string }> })
        .data;
      expect(data.some((g) => g.code === 'e2e_featured_tab')).toBe(true);
      expect(data.every((g) => g.providerCode === 'forever')).toBe(true);
    });

    it('el listado de admin filtra por ?featuredOnly=true', async () => {
      // Es lo que permite REVISAR la selección: sin esto se podía destacar un
      // juego pero no volver a encontrarlo entre miles del catálogo.
      await ctx.request
        .post('/tenant/games')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          code: 'e2e_featured_tab',
          name: 'Destacado Test',
          category: 'slots',
          featured: true,
        });

      const res = await ctx.request
        .get('/tenant/games?featuredOnly=true&limit=100')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.status).toBe(200);
      const data = (res.body as { data: Array<{ code: string; featured: boolean }> })
        .data;
      expect(data.some((g) => g.code === 'e2e_featured_tab')).toBe(true);
      // Y NADA que no esté destacado.
      expect(data.every((g) => g.featured)).toBe(true);
    });

    it('el conteo NO se acota por categoría — la pestaña vive al lado de ellas', async () => {
      await ctx.request
        .post('/tenant/games')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          code: 'e2e_featured_tab',
          name: 'Destacado Test',
          category: 'slots',
          featured: true,
        });

      // Pidiendo las facetas de OTRA categoría, el conteo de destacados tiene
      // que seguir viéndolo: si se acotara, la pestaña desaparecería al entrar
      // a una categoría sin destacados.
      const otra = await ctx.request
        .get('/tenant/games/facets?category=live')
        .set('Host', TEST_TENANT.host);
      expect(otra.status).toBe(200);
      expect((otra.body as { featured: number }).featured).toBeGreaterThan(0);
    });
  });
});
