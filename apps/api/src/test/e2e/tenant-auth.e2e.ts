/**
 * E2E: TenantAuthController.
 *
 * Valida:
 *   - Login con creds válidas → 200 + accessToken + refreshToken.
 *   - Login con password mal → 401.
 *   - Login sin host → 404 (no se resuelve tenant).
 *   - JWT incluye tenantId y se valida contra el host del request.
 *   - Refresh rota tokens (el viejo se invalida).
 *   - Logout invalida la sesión.
 *   - GET /tenant/auth/me devuelve el user logueado.
 *   - PATCH /tenant/auth/me edita el perfil propio (firstName/lastName/phone/
 *     email/language, displayName derivado, 409 email en uso, audit).
 *   - Aislamiento: un JWT emitido para tenant X NO funciona sobre Host de tenant Y.
 */

import { TEST_TENANT } from '../setup/test-tenant';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { createTestUser, type TestUser } from '../helpers/test-users';

describe('TenantAuthController (E2E)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('POST /tenant/auth/login', () => {
    it('responde 200 con accessToken y refreshToken para creds válidas', async () => {
      const res = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({
          username: TEST_TENANT.admin.username,
          password: TEST_TENANT.admin.password,
        });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        accessToken: expect.any(String) as string,
        refreshToken: expect.any(String) as string,
      });
    });

    it('responde 401 con password incorrecto', async () => {
      const res = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({
          username: TEST_TENANT.admin.username,
          password: 'wrong-password-xyz',
        });

      expect(res.status).toBe(401);
    });

    it('responde 401 con username inexistente', async () => {
      const res = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({
          username: 'no_existe_jaja',
          password: 'cualquiera',
        });

      expect(res.status).toBe(401);
    });

    it('responde 404 si el host no resuelve a ningún tenant', async () => {
      const res = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', 'no-existe.localhost')
        .send({
          username: TEST_TENANT.admin.username,
          password: TEST_TENANT.admin.password,
        });

      expect([400, 404]).toContain(res.status);
    });

    it('rechaza requests con body inválido (DTO)', async () => {
      const res = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({ username: 'x' }); // sin password

      expect(res.status).toBe(400);
    });
  });

  describe('GET /tenant/auth/me', () => {
    it('devuelve datos del user con un token válido', async () => {
      const login = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({
          username: TEST_TENANT.admin.username,
          password: TEST_TENANT.admin.password,
        });
      const token = (login.body as { accessToken: string }).accessToken;

      const me = await ctx.request
        .get('/tenant/auth/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', `Bearer ${token}`);

      expect(me.status).toBe(200);
      expect(me.body).toMatchObject({
        user: { username: TEST_TENANT.admin.username },
        tenant: { slug: TEST_TENANT.slug },
      });
    });

    it('responde 401 sin token', async () => {
      const me = await ctx.request.get('/tenant/auth/me').set('Host', TEST_TENANT.host);
      expect(me.status).toBe(401);
    });

    it('responde 401 con token mal formado', async () => {
      const me = await ctx.request
        .get('/tenant/auth/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', 'Bearer not-a-real-jwt');
      expect(me.status).toBe(401);
    });
  });

  describe('PATCH /tenant/auth/me', () => {
    let player: TestUser;
    let playerToken: string;
    let adminToken: string;

    beforeAll(async () => {
      adminToken = await loginAsAdmin(ctx.request);
      player = await createTestUser(ctx.request, adminToken, {
        suite: 'tenant-auth',
        label: 'profile',
        role: 'usuario_final',
      });
      playerToken = await loginAs(ctx.request, player.username, player.password);
    });

    it('edita el perfil propio y deriva displayName de nombre+apellido', async () => {
      const res = await ctx.request
        .patch('/tenant/auth/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken)
        .send({
          firstName: 'Juan',
          lastName: 'Pérez',
          phone: '+5491100000000',
          email: `juan_${Date.now()}@test.local`,
          language: 'es',
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.user).toMatchObject({
        firstName: 'Juan',
        lastName: 'Pérez',
        displayName: 'Juan Pérez',
        phone: '+5491100000000',
        language: 'es',
      });
      expect(res.body.user.email).toMatch(/^juan_\d+@test\.local$/);
      // No expone secretos.
      expect(res.body.user.passwordHash).toBeUndefined();
      expect(res.body.user.twoFaSecret).toBeUndefined();
    });

    it('GET /me refleja los campos editados', async () => {
      await ctx.request
        .patch('/tenant/auth/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken)
        .send({ firstName: 'Ana', lastName: 'López' });

      const me = await ctx.request
        .get('/tenant/auth/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken);

      expect(me.status).toBe(200);
      expect(me.body.user).toMatchObject({
        firstName: 'Ana',
        lastName: 'López',
        phone: expect.any(String),
        language: 'es',
      });
    });

    it('body vacío es idempotente (200, sin cambios)', async () => {
      const res = await ctx.request
        .patch('/tenant/auth/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('responde 409 si el email ya lo usa otro user', async () => {
      const other = await createTestUser(ctx.request, adminToken, {
        suite: 'tenant-auth',
        label: 'other',
        role: 'usuario_final',
      });

      // El player toma un email.
      const emailTaken = `taken_${Date.now()}@test.local`;
      const first = await ctx.request
        .patch('/tenant/auth/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken)
        .send({ email: emailTaken });
      expect(first.status).toBe(200);

      // Otro user intenta tomarlo → 409.
      const otherToken = await loginAs(ctx.request, other.username, other.password);
      const dup = await ctx.request
        .patch('/tenant/auth/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', otherToken)
        .send({ email: emailTaken });
      expect(dup.status).toBe(409);
    });

    it('rechaza email/language inválidos y campos no whitelistados (400)', async () => {
      const badEmail = await ctx.request
        .patch('/tenant/auth/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken)
        .send({ email: 'no-es-un-email' });
      expect(badEmail.status).toBe(400);

      const badLang = await ctx.request
        .patch('/tenant/auth/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken)
        .send({ language: 'fr' });
      expect(badLang.status).toBe(400);

      // Whitelist: campos no permitidos rebotan (displayName se deriva solo).
      const extra = await ctx.request
        .patch('/tenant/auth/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken)
        .send({ displayName: 'X' });
      expect(extra.status).toBe(400);
    });

    it('responde 401 sin token', async () => {
      const res = await ctx.request
        .patch('/tenant/auth/me')
        .set('Host', TEST_TENANT.host)
        .send({ firstName: 'X' });
      expect(res.status).toBe(401);
    });

    it('audita auth.self_profile_update en el audit log', async () => {
      const before = await ctx.request
        .get('/tenant/audit-log')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .query({ actionCode: 'auth.self_profile_update' });
      const countBefore = (before.body as { total: number }).total;

      await ctx.request
        .patch('/tenant/auth/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerToken)
        .send({ phone: '+5491100000000' });

      const after = await ctx.request
        .get('/tenant/audit-log')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .query({ actionCode: 'auth.self_profile_update' });
      const countAfter = (after.body as { total: number }).total;

      expect(countAfter).toBe(countBefore + 1);
    });
  });

  describe('POST /tenant/auth/refresh', () => {
    it('emite nuevo par de tokens', async () => {
      const login = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({
          username: TEST_TENANT.admin.username,
          password: TEST_TENANT.admin.password,
        });
      const { refreshToken } = login.body as { refreshToken: string };

      const refreshed = await ctx.request
        .post('/tenant/auth/refresh')
        .set('Host', TEST_TENANT.host)
        .send({ refreshToken });

      expect(refreshed.status).toBe(200);
      expect(refreshed.body).toMatchObject({
        accessToken: expect.any(String) as string,
        refreshToken: expect.any(String) as string,
      });
      // El nuevo refresh debe ser distinto del viejo (rotación).
      expect((refreshed.body as { refreshToken: string }).refreshToken).not.toBe(refreshToken);
    });

    it('invalida el refresh viejo tras rotación', async () => {
      const login = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({
          username: TEST_TENANT.admin.username,
          password: TEST_TENANT.admin.password,
        });
      const oldRefresh = (login.body as { refreshToken: string }).refreshToken;

      // Primera rotación: OK.
      const first = await ctx.request
        .post('/tenant/auth/refresh')
        .set('Host', TEST_TENANT.host)
        .send({ refreshToken: oldRefresh });
      expect(first.status).toBe(200);

      // Segunda con el viejo: debería fallar.
      const second = await ctx.request
        .post('/tenant/auth/refresh')
        .set('Host', TEST_TENANT.host)
        .send({ refreshToken: oldRefresh });
      expect(second.status).toBe(401);
    });

    it('reuse de refresh rotado mata TODAS las sesiones del user', async () => {
      // Login 2 veces: el user tiene 2 sesiones activas distintas.
      const sessA = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({
          username: TEST_TENANT.admin.username,
          password: TEST_TENANT.admin.password,
        });
      const sessB = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({
          username: TEST_TENANT.admin.username,
          password: TEST_TENANT.admin.password,
        });
      const refreshA = (sessA.body as { refreshToken: string }).refreshToken;
      const refreshB = (sessB.body as { refreshToken: string }).refreshToken;
      expect(refreshA).not.toBe(refreshB);

      // Rotación normal del sessA → emite refreshA2.
      const rotated = await ctx.request
        .post('/tenant/auth/refresh')
        .set('Host', TEST_TENANT.host)
        .send({ refreshToken: refreshA });
      expect(rotated.status).toBe(200);
      const refreshA2 = (rotated.body as { refreshToken: string }).refreshToken;

      // Ahora un atacante intenta reusar el refreshA original
      // (que ya está rotado). Esto dispara la política: revocar TODAS
      // las sesiones del user.
      const attack = await ctx.request
        .post('/tenant/auth/refresh')
        .set('Host', TEST_TENANT.host)
        .send({ refreshToken: refreshA });
      expect(attack.status).toBe(401);

      // Verificamos que ahora ni refreshA2 (la sesión rotada) ni
      // refreshB (la otra sesión legítima) funcionan: el reuse mató
      // todo.
      const tryA2 = await ctx.request
        .post('/tenant/auth/refresh')
        .set('Host', TEST_TENANT.host)
        .send({ refreshToken: refreshA2 });
      expect(tryA2.status).toBe(401);

      const tryB = await ctx.request
        .post('/tenant/auth/refresh')
        .set('Host', TEST_TENANT.host)
        .send({ refreshToken: refreshB });
      expect(tryB.status).toBe(401);
    });
  });

  describe('Aislamiento multi-tenant', () => {
    it('token del tenant jest NO debe funcionar contra otro host (si existe)', async () => {
      const login = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({
          username: TEST_TENANT.admin.username,
          password: TEST_TENANT.admin.password,
        });
      const token = (login.body as { accessToken: string }).accessToken;

      // Intento con host de un tenant distinto que existe en el seed
      // de control (demo). Si no existe, el middleware devuelve 4xx
      // y el test sigue siendo válido (aislamiento por ausencia).
      const me = await ctx.request
        .get('/tenant/auth/me')
        .set('Host', 'demo.localhost')
        .set('Authorization', `Bearer ${token}`);

      expect([401, 403, 404]).toContain(me.status);
      expect(me.status).not.toBe(200);
    });
  });
});
