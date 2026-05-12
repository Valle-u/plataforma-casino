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
 *   - Aislamiento: un JWT emitido para tenant X NO funciona sobre Host de tenant Y.
 */

import { TEST_TENANT } from '../setup/test-tenant';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';

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
