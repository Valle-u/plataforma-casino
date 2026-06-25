/**
 * E2E: impersonate (Sprint 37).
 *
 * Cubre:
 *   - Admin con `users.impersonate` puede emitir tokens "como" otro user.
 *   - JWT del impersonate trae claim `impersonatedBy`.
 *   - /auth/me devuelve `user.impersonatedBy = adminId`.
 *   - user_sessions row tiene `impersonated_by_user_id` seteado.
 *   - Audit entry severity:high con actionCode `users.impersonate.start`.
 *   - 400 si admin se impersona a sí mismo.
 *   - 400 si target no existe.
 *   - 400 si target no está active.
 *   - 403 si actor sin permission.
 *   - El access token emitido funciona como cualquier otro (acciones del
 *     target user OK).
 */

import { sql } from 'drizzle-orm';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { createTestUser } from '../helpers/test-users';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { TEST_TENANT } from '../setup/test-tenant';

describe('Impersonate (E2E, Sprint 37)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let adminId: string;
  let cajeroToken: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
    cajeroToken = await loginAs(
      ctx.request,
      TEST_TENANT.cajero1.username,
      TEST_TENANT.cajero1.password,
    );
    const adminRow = await ctx.tenantDb.execute(
      sql`SELECT id FROM users WHERE username = ${TEST_TENANT.admin.username} LIMIT 1`,
    );
    adminId = (adminRow as unknown as Array<{ id: string }>)[0]!.id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('admin impersona a otro user → recibe tokens válidos', async () => {
    const target = await createTestUser(ctx.request, adminToken, {
      suite: 'imp',
      label: 'happy',
      role: 'usuario_final',
    });

    const res = await ctx.request
      .post(`/tenant/auth/impersonate/${target.id}`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken);
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.user.id).toBe(target.id);
    expect(res.body.user.username).toBe(target.username);

    // /me con el token impersonado devuelve user del target + impersonatedBy=admin.
    const me = await ctx.request
      .get('/tenant/auth/me')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(target.id);
    expect(me.body.user.impersonatedBy).toBe(adminId);

    // user_sessions row tiene el FK.
    const sess = await ctx.tenantDb.execute(
      sql`SELECT impersonated_by_user_id FROM user_sessions WHERE user_id = ${target.id} AND impersonated_by_user_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
    );
    const sessRows = sess as unknown as Array<{
      impersonated_by_user_id: string;
    }>;
    expect(sessRows[0]?.impersonated_by_user_id).toBe(adminId);

    // Audit entry severity:high.
    const audit = await ctx.tenantDb.execute(
      sql`SELECT action_code, target_id, metadata FROM audit_log WHERE action_code = 'users.impersonate.start' AND target_id = ${target.id} ORDER BY created_at DESC LIMIT 1`,
    );
    const arows = audit as unknown as Array<{
      action_code: string;
      target_id: string;
      metadata: { severity?: string };
    }>;
    expect(arows[0]).toBeDefined();
    expect(arows[0]!.metadata.severity).toBe('high');
  });

  it('admin impersona y el token funciona para acciones del target', async () => {
    const target = await createTestUser(ctx.request, adminToken, {
      suite: 'imp',
      label: 'actions',
      role: 'usuario_final',
    });
    const imp = await ctx.request
      .post(`/tenant/auth/impersonate/${target.id}`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken);
    const impToken = `Bearer ${imp.body.accessToken}`;

    // El target puede listar sus notifs (player-facing endpoint).
    const myNotifs = await ctx.request
      .get('/tenant/notifications/me')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', impToken);
    expect(myNotifs.status).toBe(200);
  });

  it('admin no puede impersonarse a sí mismo → 400', async () => {
    const res = await ctx.request
      .post(`/tenant/auth/impersonate/${adminId}`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('IMPERSONATE_SELF');
  });

  it('target inexistente → 400', async () => {
    const fakeUuid = '00000000-0000-0000-0000-000000000000';
    const res = await ctx.request
      .post(`/tenant/auth/impersonate/${fakeUuid}`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('IMPERSONATE_TARGET_NOT_FOUND');
  });

  it('target inactivo → 400', async () => {
    const target = await createTestUser(ctx.request, adminToken, {
      suite: 'imp',
      label: 'inactive',
      role: 'usuario_final',
    });
    // Lo deactivamos vía SQL para no depender de un endpoint admin para esto.
    await ctx.tenantDb.execute(
      sql`UPDATE users SET status = 'suspended' WHERE id = ${target.id}`,
    );
    const res = await ctx.request
      .post(`/tenant/auth/impersonate/${target.id}`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('IMPERSONATE_TARGET_INACTIVE');
  });

  it('cajero sin users.impersonate → 403', async () => {
    const target = await createTestUser(ctx.request, adminToken, {
      suite: 'imp',
      label: 'forbidden',
      role: 'usuario_final',
    });
    const res = await ctx.request
      .post(`/tenant/auth/impersonate/${target.id}`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', cajeroToken);
    expect(res.status).toBe(403);
  });
});
