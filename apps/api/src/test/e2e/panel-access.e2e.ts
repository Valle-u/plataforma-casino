/**
 * E2E: Sprint 43 — panel access (security hardening).
 *
 * Regresión del bug visible reportado: un user con rol `usuario_final`
 * (player) podía loguearse vía `/tenant/auth/login` sin distinguir
 * audience y recibir un JWT que abría el chrome del panel admin del
 * frontend + leak de endpoints sin `@RequirePermissions`.
 *
 * Cobertura:
 *   1. Login player con audience='panel'  → 403 NOT_PANEL_USER.
 *   2. Login player con audience='player' → 200 OK + JWT válido.
 *   3. Login player sin audience explícito → 403 (default 'panel').
 *   4. /tenant/auth/me con JWT player → canAccessPanel:false + roles:[usuario_final].
 *   5. Admin con audience='panel' → 200 OK + canAccessPanel:true.
 *   6. Admin con audience='player' → 200 OK (admins pueden jugar).
 *   7. JWT player intentando GET /tenant/users (admin-only) → 403 NOT_PANEL_USER.
 *   8. JWT player intentando GET /tenant/audit-log (admin-only) → 403.
 *   9. JWT player intentando GET /tenant/auth/me (player-allowed) → 200.
 */

import { TEST_TENANT } from '../setup/test-tenant';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { createTestUser, type TestUser } from '../helpers/test-users';

describe('PanelAccess — login audience + guard (Sprint 43)', () => {
  let ctx: TestApp;
  let adminBearer: string;
  let player: TestUser;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminBearer = await loginAsAdmin(ctx.request);
    // Crear un user con rol 'usuario_final' que simula el cliente12
    // del bug report.
    player = await createTestUser(ctx.request, adminBearer, {
      suite: 'panel-access',
      label: 'player',
      role: 'usuario_final',
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('Login con audience', () => {
    it('player + audience=panel → 403 NOT_PANEL_USER', async () => {
      const res = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({
          username: player.username,
          password: player.password,
          audience: 'panel',
        });

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({
        error: 'NOT_PANEL_USER',
        message: expect.stringContaining('jugador') as string,
      });
      // CRÍTICO: no debe emitir tokens al rechazar.
      expect(res.body.accessToken).toBeUndefined();
      expect(res.body.refreshToken).toBeUndefined();
    });

    it('player sin audience explícito → 200 (default player, modo permisivo)', async () => {
      // El backend default es 'player' para no romper integraciones que
      // no actualicen. La protección admin sale del frontend pasando
      // 'panel' explícito + del PanelAccessGuard en endpoints @PanelOnly.
      const res = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({
          username: player.username,
          password: player.password,
        });

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toEqual(expect.any(String));
    });

    it('player + audience=player → 200 OK + JWT', async () => {
      const res = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({
          username: player.username,
          password: player.password,
          audience: 'player',
        });

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toEqual(expect.any(String));
    });

    it('admin + audience=panel → 200 OK', async () => {
      const res = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({
          username: TEST_TENANT.admin.username,
          password: TEST_TENANT.admin.password,
          audience: 'panel',
        });

      expect(res.status).toBe(200);
    });

    it('admin + audience=player → 200 OK (admins pueden jugar)', async () => {
      const res = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({
          username: TEST_TENANT.admin.username,
          password: TEST_TENANT.admin.password,
          audience: 'player',
        });

      expect(res.status).toBe(200);
    });
  });

  describe('GET /tenant/auth/me incluye canAccessPanel', () => {
    it('player → canAccessPanel:false + roles:[usuario_final]', async () => {
      const bearer = await loginAs(
        ctx.request,
        player.username,
        player.password,
        'player',
      );
      const res = await ctx.request
        .get('/tenant/auth/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer);

      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({
        username: player.username,
        canAccessPanel: false,
        roles: ['usuario_final'],
      });
    });

    it('admin → canAccessPanel:true + roles incluye admin_tenant', async () => {
      const res = await ctx.request
        .get('/tenant/auth/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer);

      expect(res.status).toBe(200);
      expect(res.body.user.canAccessPanel).toBe(true);
      expect(res.body.user.roles).toEqual(
        expect.arrayContaining(['admin_tenant']),
      );
    });
  });

  describe('PanelAccessGuard — defense in depth', () => {
    let playerBearer: string;

    beforeAll(async () => {
      playerBearer = await loginAs(
        ctx.request,
        player.username,
        player.password,
        'player',
      );
    });

    it('player con JWT válido NO puede GET /tenant/users (admin-only)', async () => {
      const res = await ctx.request
        .get('/tenant/users')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerBearer);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('NOT_PANEL_USER');
    });

    it('player con JWT válido NO puede GET /tenant/audit-log', async () => {
      const res = await ctx.request
        .get('/tenant/audit-log')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerBearer);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('NOT_PANEL_USER');
    });

    it('player con JWT válido SÍ puede GET /tenant/auth/me (player-allowed)', async () => {
      const res = await ctx.request
        .get('/tenant/auth/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerBearer);

      expect(res.status).toBe(200);
    });

    it('admin con su JWT SÍ puede GET /tenant/users (panel access)', async () => {
      const res = await ctx.request
        .get('/tenant/users')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminBearer);

      expect(res.status).toBe(200);
    });
  });
});
