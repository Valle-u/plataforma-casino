/**
 * E2E: R7 — el socio INDEPENDIENTE tiene sus propios empleados (planillas).
 *
 * Un socio independiente puede crear un empleado y delegarle permisos (su
 * "planilla") CAPADO a su propio techo (P2). Los independientes SÍ pueden
 * delegar perms de plata (no caen en el deny de rama dependiente). El empleado,
 * al NO ser rol operador, no recibe los perms de plata por el cálculo dinámico
 * — solo por la delegación explícita del socio.
 *
 * Verifica que la infra existente (create + permission-overrides + techo +
 * escalada) ya soporta R7, sin código nuevo.
 */

import { sql } from 'drizzle-orm';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser, type TestUser } from '../helpers/test-users';

describe('Socio independiente — empleados propios (R7, E2E)', () => {
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
      suite: 'indep-emp',
      label: `${label}${seq++}`,
      role,
    });
  }

  async function effectivePerms(bearer: string): Promise<string[]> {
    const me = await ctx.request
      .get('/tenant/auth/me')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', bearer);
    return (me.body as { user: { effectivePermissions: string[] } }).user
      .effectivePermissions;
  }

  it('el socio indep crea un empleado y le delega un perm de plata (capado a su techo)', async () => {
    const socio = await mkUser('sIndep', 'socio');
    // Marcamos independiente (baseline por SQL). El rol socio ya trae
    // users.create + permissions.grant; wallet.load lo tiene por el cálculo
    // dinámico (operador en sub-red independiente).
    await ctx.tenantDb.execute(
      sql`UPDATE users
          SET is_independent_branch = true,
              branch_bank_account = 'CBU-R7',
              branch_chips_price_per_unit = '1.0000'
          WHERE id = ${socio.id}`,
    );
    const socioToken = await loginAs(ctx.request, socio.username, socio.password);

    // El socio confirma que tiene wallet.load (dinámico).
    expect(await effectivePerms(socioToken)).toContain('wallet.load');

    // (1) El socio crea su empleado.
    const suf = Date.now().toString(36);
    const empUser = `empr7${suf}`;
    const empPass = `pwd-empr7-${suf}-2026`;
    const create = await ctx.request
      .post('/tenant/users')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', socioToken)
      .send({
        username: empUser,
        password: empPass,
        displayName: 'Empleado R7',
        roleCode: 'empleado',
      });
    expect(create.status).toBe(201);
    const empId = (create.body as { user: { id: string } }).user.id;

    // (2) El socio le delega wallet.load (su "planilla de Caja"). Independiente
    //     → NO cae en el deny; el techo pasa (el socio tiene wallet.load).
    const grant = await ctx.request
      .post('/tenant/permission-overrides/grant')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', socioToken)
      .send({ userId: empId, permissionCode: 'wallet.load', reason: 'planilla caja' });
    expect([200, 201]).toContain(grant.status);

    // (3) El empleado efectivamente tiene wallet.load — y NO más que lo delegado
    //     (no es operador → el cálculo dinámico no le suma nada).
    const empPerms = await effectivePerms(
      await loginAs(ctx.request, empUser, empPass),
    );
    expect(empPerms).toContain('wallet.load');
    expect(empPerms).not.toContain('wallet.unload'); // no delegado → no lo tiene

    // (4) Techo (P2): el socio NO puede delegar un perm que él no tiene.
    const overreach = await ctx.request
      .post('/tenant/permission-overrides/grant')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', socioToken)
      .send({ userId: empId, permissionCode: 'house.inject_capital' });
    expect(overreach.status).toBe(403);
  });
});
