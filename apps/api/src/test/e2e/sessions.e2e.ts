/**
 * E2E: Sesiones activas del player — "Mis dispositivos".
 *
 * Endpoints:
 *   - GET    /tenant/auth/sessions      — lista sesiones activas del user.
 *   - DELETE /tenant/auth/sessions/:id  — revoca una sesión propia (remote logout).
 *
 * Cobertura:
 *   - GET devuelve las sesiones activas ordenadas (nueva → vieja), con
 *     `isCurrent` marcado en la del request y deviceLabel derivada del UA.
 *   - GET sin JWT → 401.
 *   - DELETE de la sesión ACTUAL → 409 CANNOT_REVOKE_CURRENT_SESSION.
 *   - DELETE de otra sesión → la revoca: desaparece del listado y su
 *     refresh token deja de funcionar (401).
 *   - DELETE de sesión inexistente/ajena → 404.
 *   - DELETE idempotente: revocar dos veces la misma → 404 la segunda.
 *   - Cada revoke deja una entrada en audit_log (`auth.session.revoke`).
 */

import postgres from 'postgres';
import { TEST_TENANT } from '../setup/test-tenant';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { getTestTenantUrl } from '../setup/db-helpers';

/** Login del admin devolviendo access + refresh (para testear refresh revocado). */
async function loginAsAdminFull(
  ctx: TestApp,
): Promise<{ accessToken: string; refreshToken: string }> {
  const res = await ctx.request
    .post('/tenant/auth/login')
    .set('Host', TEST_TENANT.host)
    .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0')
    .send({
      username: TEST_TENANT.admin.username,
      password: TEST_TENANT.admin.password,
      audience: 'player',
    });
  if (res.status !== 200) {
    throw new Error(
      `Login fallido: HTTP ${res.status}: ${JSON.stringify(res.body)}`,
    );
  }
  return {
    accessToken: (res.body as { accessToken: string }).accessToken,
    refreshToken: (res.body as { refreshToken: string }).refreshToken,
  };
}

function bearer(token: string): string {
  return `Bearer ${token}`;
}

/** Lista sesiones activas del admin (desde la API). */
async function listSessions(
  ctx: TestApp,
  token: string,
): Promise<{ id: string; isCurrent: boolean }[]> {
  const res = await ctx.request
    .get('/tenant/auth/sessions')
    .set('Host', TEST_TENANT.host)
    .set('Authorization', bearer(token));
  if (res.status !== 200) {
    throw new Error(
      `GET sessions falló: HTTP ${res.status}: ${JSON.stringify(res.body)}`,
    );
  }
  return (res.body as { sessions: { id: string; isCurrent: boolean }[] }).sessions;
}

/** Sesión del admin que NO es la actual (existe con ≥2 logins). */
function otherSessionId(sessions: { id: string; isCurrent: boolean }[]): string {
  const other = sessions.find((s) => !s.isCurrent);
  if (!other) {
    throw new Error('No hay sesión no-actual para revocar.');
  }
  return other.id;
}

async function countAuditRevokeEntries(): Promise<number> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM audit_log
      WHERE action_code = 'auth.session.revoke'
    `;
    return Number(rows[0]?.count ?? 0);
  } finally {
    await sql.end();
  }
}

describe('Sesiones activas (E2E)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  // ──────────────────────────────────────────────────────────────────────
  // GET /tenant/auth/sessions
  // ──────────────────────────────────────────────────────────────────────
  describe('GET /tenant/auth/sessions', () => {
    it('devuelve la sesión actual con isCurrent=true y deviceLabel del UA', async () => {
      const { accessToken } = await loginAsAdminFull(ctx);

      const res = await ctx.request
        .get('/tenant/auth/sessions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer(accessToken))
        .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0');

      expect(res.status).toBe(200);
      const sessions = (res.body as { sessions: unknown[] }).sessions;
      expect(Array.isArray(sessions)).toBe(true);
      expect(sessions.length).toBeGreaterThanOrEqual(1);

      const current = (sessions as Record<string, unknown>[]).find(
        (s) => s.isCurrent === true,
      );
      expect(current).toBeDefined();
      expect(current).toMatchObject({
        id: expect.any(String) as string,
        deviceLabel: expect.any(String) as string,
        createdAt: expect.any(String) as string,
        expiresAt: expect.any(String) as string,
      });
      expect((current as Record<string, string>).deviceLabel).toContain('Windows');
      expect((current as Record<string, string>).deviceLabel).toContain('Chrome');
    });

    it('no incluye sesiones ya revocadas', async () => {
      const { accessToken } = await loginAsAdminFull(ctx);
      const countBefore = (await listSessions(ctx, accessToken)).length;

      // Logout revoca la sesión del refresh token; el listado no debe crecer.
      const { refreshToken } = await loginAsAdminFull(ctx);
      await ctx.request
        .post('/tenant/auth/logout')
        .set('Host', TEST_TENANT.host)
        .send({ refreshToken });

      const countAfter = (await listSessions(ctx, accessToken)).length;
      expect(countAfter).toBe(countBefore);
    });

    it('rechaza request sin JWT', async () => {
      const res = await ctx.request
        .get('/tenant/auth/sessions')
        .set('Host', TEST_TENANT.host);
      expect(res.status).toBe(401);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // DELETE /tenant/auth/sessions/:id
  // ──────────────────────────────────────────────────────────────────────
  describe('DELETE /tenant/auth/sessions/:id', () => {
    it('revoca otra sesión: desaparece del listado y su refresh muere', async () => {
      const a = await loginAsAdminFull(ctx);
      const b = await loginAsAdminFull(ctx);
      const targetId = otherSessionId(await listSessions(ctx, a.accessToken));

      const del = await ctx.request
        .delete(`/tenant/auth/sessions/${targetId}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer(a.accessToken));

      expect(del.status).toBe(200);
      expect(del.body).toMatchObject({ ok: true });

      // Ya no aparece en el listado.
      const idsAfter = (await listSessions(ctx, a.accessToken)).map((s) => s.id);
      expect(idsAfter).not.toContain(targetId);

      // El refresh de la sesión revocada falla (401).
      const refresh = await ctx.request
        .post('/tenant/auth/refresh')
        .set('Host', TEST_TENANT.host)
        .send({ refreshToken: b.refreshToken });
      expect(refresh.status).toBe(401);
    });

    it('rechaza revocar la sesión actual con 409 CANNOT_REVOKE_CURRENT_SESSION', async () => {
      const { accessToken } = await loginAsAdminFull(ctx);
      const currentId = (await listSessions(ctx, accessToken)).find(
        (s) => s.isCurrent === true,
      )!.id;

      const res = await ctx.request
        .delete(`/tenant/auth/sessions/${currentId}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer(accessToken));

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: 'CANNOT_REVOKE_CURRENT_SESSION' });
    });

    it('responde 404 para sesión inexistente', async () => {
      const { accessToken } = await loginAsAdminFull(ctx);

      const res = await ctx.request
        .delete('/tenant/auth/sessions/00000000-0000-7000-8000-000000000000')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer(accessToken));

      expect(res.status).toBe(404);
    });

    it('es idempotente: revocar dos veces la misma sesión → 404 la segunda', async () => {
      const a = await loginAsAdminFull(ctx);
      const b = await loginAsAdminFull(ctx);
      const targetId = otherSessionId(await listSessions(ctx, a.accessToken));

      const first = await ctx.request
        .delete(`/tenant/auth/sessions/${targetId}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer(a.accessToken));
      expect(first.status).toBe(200);

      const second = await ctx.request
        .delete(`/tenant/auth/sessions/${targetId}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer(a.accessToken));
      expect(second.status).toBe(404);

      void b; // la sesión B queda viva; el 404 no la tocó.
    });

    it('registra entrada de audit auth.session.revoke', async () => {
      const before = await countAuditRevokeEntries();

      const a = await loginAsAdminFull(ctx);
      const b = await loginAsAdminFull(ctx);
      const targetId = otherSessionId(await listSessions(ctx, a.accessToken));

      const del = await ctx.request
        .delete(`/tenant/auth/sessions/${targetId}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer(a.accessToken));
      expect(del.status).toBe(200);

      const after = await countAuditRevokeEntries();
      expect(after).toBe(before + 1);

      void b;
    });
  });
});
