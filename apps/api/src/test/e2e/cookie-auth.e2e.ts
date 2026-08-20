/**
 * E2E: fallback de autenticación por cookie httpOnly (Item A, Etapa 1, Phase 0).
 *
 * El guard del tenant lee el token del header `Authorization: Bearer` y, si no
 * viene, cae a la cookie `casino_{panel}_at` (panel por header `X-Panel`). Este
 * suite valida el LADO BACKEND del gate: que el guard autentique por cookie.
 * (El reenvío del header Cookie por el rewrite de Next/Vercel se valida aparte,
 * en deploy.)
 */

import { loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { TEST_TENANT } from '../setup/test-tenant';

describe('Cookie auth fallback (E2E)', () => {
  let ctx: TestApp;
  let bearer: string; // "Bearer <token>"
  let rawToken: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    bearer = await loginAsAdmin(ctx.request);
    rawToken = bearer.replace(/^Bearer\s+/, '');
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('autentica SIN header Authorization, leyendo la cookie casino_admin_at', async () => {
    const res = await ctx.request
      .get('/tenant/auth/me')
      .set('Host', TEST_TENANT.host)
      .set('X-Panel', 'admin')
      .set('Cookie', `casino_admin_at=${rawToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.username).toBe(TEST_TENANT.admin.username);
  });

  it('sin token (ni header ni cookie) → 401', async () => {
    const res = await ctx.request
      .get('/tenant/auth/me')
      .set('Host', TEST_TENANT.host)
      .set('X-Panel', 'admin');
    expect(res.status).toBe(401);
  });

  it('cookie del panel equivocado → 401 (X-Panel=player pero cookie es admin)', async () => {
    // El guard lee casino_player_at (por X-Panel=player), que no existe → 401.
    const res = await ctx.request
      .get('/tenant/auth/me')
      .set('Host', TEST_TENANT.host)
      .set('X-Panel', 'player')
      .set('Cookie', `casino_admin_at=${rawToken}`);
    expect(res.status).toBe(401);
  });

  it('lee la cookie del panel player cuando X-Panel=player', async () => {
    const res = await ctx.request
      .get('/tenant/auth/me')
      .set('Host', TEST_TENANT.host)
      .set('X-Panel', 'player')
      .set('Cookie', `casino_player_at=${rawToken}`);
    // El admin de test puede o no tener acceso al panel player, pero el guard
    // (auth) sí resuelve el token de la cookie player → NO es 401 de token.
    // Aceptamos 200 (autenticado) o 403 (autenticado pero sin panel), nunca 401.
    expect(res.status).not.toBe(401);
  });

  it('cookie con token basura → 401', async () => {
    const res = await ctx.request
      .get('/tenant/auth/me')
      .set('Host', TEST_TENANT.host)
      .set('X-Panel', 'admin')
      .set('Cookie', 'casino_admin_at=no-es-un-jwt-valido');
    expect(res.status).toBe(401);
  });

  it('regresión: el header Authorization Bearer sigue funcionando', async () => {
    const res = await ctx.request
      .get('/tenant/auth/me')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', bearer);
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe(TEST_TENANT.admin.username);
  });

  it('el header Bearer tiene PRECEDENCIA sobre la cookie', async () => {
    // Bearer válido + cookie basura → gana el Bearer → 200.
    const res = await ctx.request
      .get('/tenant/auth/me')
      .set('Host', TEST_TENANT.host)
      .set('X-Panel', 'admin')
      .set('Authorization', bearer)
      .set('Cookie', 'casino_admin_at=basura');
    expect(res.status).toBe(200);
  });
});
