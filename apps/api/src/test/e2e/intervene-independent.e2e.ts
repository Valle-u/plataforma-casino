/**
 * E2E: R6/E8 — intervención super-admin (impersonate en sub-red independiente).
 *
 * Impersonar a un usuario que cae en una sub-red INDEPENDIENTE es el ÚNICO cruce
 * permitido al aislamiento (E8/P3), y es más estricto que un impersonate normal:
 *   - exige el permiso dedicado `users.intervene_independent` (403 si no),
 *   - exige un MOTIVO (400 si falta),
 *   - audita con severity critical.
 * Impersonar dentro de la red central sigue como estaba (sin motivo, severity high).
 */

import { sql } from 'drizzle-orm';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser, type TestUser } from '../helpers/test-users';

describe('Intervención super-admin — impersonate independiente (R6/E8, E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let seq = 0;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function mkUser(label: string, role: string): Promise<TestUser> {
    return createTestUser(ctx.request, adminToken, {
      suite: 'intervene',
      label: `${label}${seq++}`,
      role,
    });
  }

  function impersonate(
    token: string,
    targetId: string,
    body?: Record<string, unknown>,
  ) {
    const r = ctx.request
      .post(`/tenant/auth/impersonate/${targetId}`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', token);
    return body ? r.send(body) : r.send();
  }

  it('impersonar a un socio INDEPENDIENTE exige motivo; con motivo funciona; red central sin motivo OK', async () => {
    const socioIndep = await mkUser('sIndep', 'socio');
    await ctx.tenantDb.execute(
      sql`UPDATE users SET is_independent_branch = true WHERE id = ${socioIndep.id}`,
    );
    const centralPlayer = await mkUser('central', 'usuario_final');

    // (1) admin impersona al independiente SIN motivo → 400.
    const noReason = await impersonate(adminToken, socioIndep.id);
    expect(noReason.status).toBe(400);
    expect(noReason.body.error).toBe('INTERVENE_REASON_REQUIRED');

    // (2) admin impersona al independiente CON motivo → OK.
    const withReason = await impersonate(adminToken, socioIndep.id, {
      reason: 'Soporte por fraude reportado',
    });
    expect(withReason.status).toBe(200);
    expect(withReason.body.user.id).toBe(socioIndep.id);

    // (3) admin impersona a un user de la red CENTRAL sin motivo → OK (normal).
    const central = await impersonate(adminToken, centralPlayer.id);
    expect(central.status).toBe(200);
    expect(central.body.user.id).toBe(centralPlayer.id);
  });

  it('sin el permiso dedicado, no se puede cruzar al independiente (403)', async () => {
    const socioIndep = await mkUser('sIndep2', 'socio');
    await ctx.tenantDb.execute(
      sql`UPDATE users SET is_independent_branch = true WHERE id = ${socioIndep.id}`,
    );

    // Auditor: empleado con `users.impersonate` (override directo, ya que no es
    // delegable por endpoint) pero SIN `users.intervene_independent`.
    const auditor = await mkUser('auditor', 'empleado');
    await ctx.tenantDb.execute(
      sql`INSERT INTO user_permission_overrides
            (user_id, permission_code, effect, granted_by, granted_by_chain, reason)
          VALUES
            (${auditor.id}, 'users.impersonate', 'grant', NULL, ARRAY[]::uuid[], 'test')`,
    );
    const auditorToken = await loginAs(
      ctx.request,
      auditor.username,
      auditor.password,
    );

    // Tiene impersonate → puede impersonar en la central, pero al independiente
    // le falta el permiso dedicado → 403.
    const blocked = await impersonate(auditorToken, socioIndep.id, {
      reason: 'intento',
    });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe('INTERVENE_INDEPENDENT_REQUIRED');
  });
});
