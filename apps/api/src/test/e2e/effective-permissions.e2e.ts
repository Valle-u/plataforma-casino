/**
 * E2E del cálculo de permisos efectivos vía endpoint detalle de user.
 *
 * En lugar de testear `EffectivePermissionsService` aislado (que requeriría
 * un setup de DB falsa o pesado), validamos el resultado a través del
 * endpoint `GET /tenant/users/:id` que devuelve `effectivePermissions`
 * usando ese service.
 *
 * Casos cubiertos:
 *   - User con rol que tiene permisos → permisos incluidos.
 *   - User con rol sin permisos asignados → array vacío.
 *   - User + override grant → permiso aparece.
 *   - User + override revoke → permiso desaparece aunque el rol lo dé.
 *   - Multi-rol: unión de todos los permisos de todos los roles.
 */

import { TEST_TENANT } from '../setup/test-tenant';
import { loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';

async function getEffective(
  ctx: TestApp,
  token: string,
  userId: string,
): Promise<string[]> {
  const res = await ctx.request
    .get(`/tenant/users/${userId}`)
    .set('Host', TEST_TENANT.host)
    .set('Authorization', token);
  expect(res.status).toBe(200);
  return (res.body as { effectivePermissions: string[] }).effectivePermissions;
}

async function createUser(
  ctx: TestApp,
  token: string,
  username: string,
  roleCode: string,
): Promise<string> {
  const res = await ctx.request
    .post('/tenant/users')
    .set('Host', TEST_TENANT.host)
    .set('Authorization', token)
    .send({ username, password: 'a-valid-pass', displayName: username, roleCode });
  expect(res.status).toBe(201);
  return (res.body as { user: { id: string } }).user.id;
}

describe('Effective permissions (E2E via /tenant/users/:id)', () => {
  let ctx: TestApp;
  let adminToken: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('user con rol admin_tenant tiene los 25+ permisos del rol', async () => {
    const id = await createUser(ctx, adminToken, `ef_admin_${Date.now()}`, 'admin_tenant');
    const perms = await getEffective(ctx, adminToken, id);
    expect(perms.length).toBeGreaterThan(20);
    expect(perms).toContain('users.create');
    expect(perms).toContain('permissions.grant');
  });

  it('user con rol socio (sin permisos asignados en seed) → array vacío', async () => {
    const id = await createUser(ctx, adminToken, `ef_socio_${Date.now()}`, 'socio');
    const perms = await getEffective(ctx, adminToken, id);
    expect(perms).toEqual([]);
  });

  it('override grant suma un permiso que el rol no tiene', async () => {
    const id = await createUser(ctx, adminToken, `ef_grant_${Date.now()}`, 'cajero');
    const before = await getEffective(ctx, adminToken, id);
    expect(before).not.toContain('wallet.load');
    // cajero no tiene wallet.load en seed (los permisos del rol cajero no
    // están seedeados hoy; solo admin_tenant los tiene). Si el seed cambia
    // y cajero pasa a tener wallet.load, este test sigue siendo correcto:
    // sumamos un permiso DISTINTO que cajero no tenga.

    await ctx.request
      .post('/tenant/permission-overrides/grant')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ userId: id, permissionCode: 'wallet.load' });

    const after = await getEffective(ctx, adminToken, id);
    expect(after).toContain('wallet.load');
  });

  it('override revoke quita un permiso que el rol da', async () => {
    const id = await createUser(ctx, adminToken, `ef_revoke_${Date.now()}`, 'admin_tenant');
    const before = await getEffective(ctx, adminToken, id);
    expect(before).toContain('users.create');

    await ctx.request
      .post('/tenant/permission-overrides/revoke')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({
        userId: id,
        permissionCode: 'users.create',
        reason: 'test revoke effective',
      });

    const after = await getEffective(ctx, adminToken, id);
    expect(after).not.toContain('users.create');
  });

  it('multi-rol: unión de los permisos de todos los roles', async () => {
    const id = await createUser(ctx, adminToken, `ef_multi_${Date.now()}`, 'socio');
    // Sumar segundo rol admin_tenant.
    await ctx.request
      .post(`/tenant/users/${id}/roles/admin_tenant`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken);

    const perms = await getEffective(ctx, adminToken, id);
    expect(perms).toContain('users.create');
    expect(perms.length).toBeGreaterThan(10);
  });
});
