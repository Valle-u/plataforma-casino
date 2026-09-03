/**
 * E2E: users.view_admin_network — el permiso "ver la red del admin" NO expone
 * la sub-red de socios independientes.
 *
 * Setup:
 *   - Un socio DEPENDIENTE (no independiente) con un cajero + jugador → red del admin.
 *   - Un socio INDEPENDIENTE con un cajero + jugador → sub-red aislada.
 *   - Un empleado del admin con override 'users.view_admin_network' pero SIN 'users.view_all'.
 *
 * El empleado debe ver:
 *   ✓ admin, cajero1, cajero2 del seed (Casa/panel)
 *   ✓ socio dependiente + su cajero + su jugador
 *   ✗ NO al socio independiente, ni a su cajero, ni a su jugador (aislamiento).
 */

import { sql } from 'drizzle-orm';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { createTestUser } from '../helpers/test-users';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { EffectivePermissionsService } from '../../permissions/effective-permissions.service';

describe('users.view_admin_network — aislamiento sub-red independiente (E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function setParent(childId: string, parentId: string): Promise<void> {
    const r = await ctx.request
      .put(`/tenant/user-hierarchy/${childId}/parent`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ parentUserId: parentId, relationType: 'subordinado' });
    if (r.status !== 200 && r.status !== 201) {
      throw new Error(`setParent falló: ${r.status} ${JSON.stringify(r.body)}`);
    }
  }

  async function makeIndependent(socioId: string): Promise<void> {
    await ctx.tenantDb.execute(
      sql`UPDATE users SET is_independent_branch = true WHERE id = ${socioId}`,
    );
  }

  async function grantOverride(
    userId: string,
    permissionCode: string,
  ): Promise<void> {
    const r = await ctx.request
      .post('/tenant/permission-overrides/grant')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ userId, permissionCode, reason: 'e2e test' });
    expect([200, 201]).toContain(r.status);
  }

  it('empleado con users.view_admin_network ve la red del admin PERO NO la sub-red del independiente', async () => {
    // Red del admin: socio dependiente + cajero + jugador.
    const socioDep = await createTestUser(ctx.request, adminToken, {
      suite: 'view-adm-net',
      label: 'socio-dep',
      role: 'socio',
    });
    const cajeroDep = await createTestUser(ctx.request, adminToken, {
      suite: 'view-adm-net',
      label: 'cajero-dep',
      role: 'cajero',
    });
    const playerDep = await createTestUser(ctx.request, adminToken, {
      suite: 'view-adm-net',
      label: 'player-dep',
      role: 'usuario_final',
    });
    await setParent(cajeroDep.id, socioDep.id);
    await setParent(playerDep.id, cajeroDep.id);

    // Sub-red del independiente: socio marcado independent + cajero + jugador.
    const socioIndep = await createTestUser(ctx.request, adminToken, {
      suite: 'view-adm-net',
      label: 'socio-indep',
      role: 'socio',
    });
    const cajeroIndep = await createTestUser(ctx.request, adminToken, {
      suite: 'view-adm-net',
      label: 'cajero-indep',
      role: 'cajero',
    });
    const playerIndep = await createTestUser(ctx.request, adminToken, {
      suite: 'view-adm-net',
      label: 'player-indep',
      role: 'usuario_final',
    });
    await setParent(cajeroIndep.id, socioIndep.id);
    await setParent(playerIndep.id, cajeroIndep.id);
    await makeIndependent(socioIndep.id);

    // Empleado del admin con SOLO view_admin_network (no view_all).
    const emp = await createTestUser(ctx.request, adminToken, {
      suite: 'view-adm-net',
      label: 'emp',
      role: 'empleado',
    });
    // Colgamos el empleado bajo el admin del seed para que la red del actor
    // (getActiveDescendants) incluya a los users creados aquí.
    // NOTA: como el listado /users se resuelve con el actor = admin (el que
    // vamos a impersonar acá), lo que necesitamos es probar contra el admin
    // directamente porque el actor debe tener descendants efectivos para
    // demostrar el filtro. Usamos el admin del seed como actor.
    // Necesita view_any (gate del endpoint) + view_admin_network (para
    // bypassar el filtro de "solo su red" y ver la red del admin).
    await grantOverride(emp.id, 'users.view_any');
    await grantOverride(emp.id, 'users.view_admin_network');

    const empToken = await loginAs(ctx.request, emp.username, emp.password);

    // El empleado consulta el listado con su nuevo permiso.
    // Como los tests corren en la misma DB y el tenant acumula users
    // suite tras suite (users NO es truncado en resetMutableState),
    // el listado global puede pasar 200 rows. Paginamos hasta ver
    // todos los del test.
    const ids = await fetchAllUserIds(ctx.request, empToken);

    // Semántica nueva del permiso: ve TODOS los users del tenant excepto los
    // que cuelgan de un socio independiente. No depende de que el empleado
    // tenga descendants — el permiso lo habilita a operar la red del admin.
    // Debe VER: red del admin.
    // ⚠️ El actor NO se ve a sí mismo: `/tenant/users` devuelve su red, no su
    // propia fila. Antes acá había un `expect(ids.has(emp.id)).toBe(true)` que
    // fallaba por eso — y no era una fuga ni un permiso faltante, era la
    // semántica del endpoint. (Lo mismo dejaba `adminId` en `undefined` en
    // permission-overrides.e2e, que sacaba su id del listado.)
    expect(ids.has(emp.id)).toBe(false);
    expect(ids.has(socioDep.id)).toBe(true);
    expect(ids.has(cajeroDep.id)).toBe(true);
    expect(ids.has(playerDep.id)).toBe(true);
    // NO debe ver: el socio independiente ni su subárbol.
    expect(ids.has(socioIndep.id)).toBe(false);
    expect(ids.has(cajeroIndep.id)).toBe(false);
    expect(ids.has(playerIndep.id)).toBe(false);

    // W2 (fix de aislamiento): el DETALLE por id (GET /users/:id) respeta el
    // MISMO scope que el listado. Antes el detalle no tenía scope check, así
    // que un actor con view_any podía leer el detalle (PII + balance) de un
    // user de la sub-red independiente si conocía su id. Ahora: 200 para la red
    // del admin, 404 (no revela existencia) para la sub-red independiente.
    const detail = (id: string) =>
      ctx.request
        .get(`/tenant/users/${id}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', empToken);
    expect((await detail(playerDep.id)).status).toBe(200); // en scope
    expect((await detail(playerIndep.id)).status).toBe(404); // sub-red indep
    expect((await detail(socioIndep.id)).status).toBe(404); // sub-red indep
  });

  it('admin con solo view_admin_network (sin view_all) ve dependientes y NO ve la sub-red del independiente', async () => {
    // Preparación distinta: creamos la topología y colgamos las redes bajo
    // el admin del seed. El admin del seed tiene ambos permisos por rol,
    // pero como view_all bypassa el filtro, hacemos un DELETE del override
    // + role_permission de view_all para el admin y verificamos con
    // view_admin_network solo.

    // Setup topología:
    const socioDep = await createTestUser(ctx.request, adminToken, {
      suite: 'view-adm-net-2',
      label: 'socio-dep',
      role: 'socio',
    });
    const playerDep = await createTestUser(ctx.request, adminToken, {
      suite: 'view-adm-net-2',
      label: 'player-dep',
      role: 'usuario_final',
    });
    const socioIndep = await createTestUser(ctx.request, adminToken, {
      suite: 'view-adm-net-2',
      label: 'socio-indep',
      role: 'socio',
    });
    const playerIndep = await createTestUser(ctx.request, adminToken, {
      suite: 'view-adm-net-2',
      label: 'player-indep',
      role: 'usuario_final',
    });

    // Obtener admin id del seed.
    const me = await ctx.request
      .get('/tenant/auth/me')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken);
    const adminId = (me.body as { user: { id: string } }).user.id;

    await setParent(socioDep.id, adminId);
    await setParent(playerDep.id, socioDep.id);
    await setParent(socioIndep.id, adminId);
    await setParent(playerIndep.id, socioIndep.id);
    await makeIndependent(socioIndep.id);

    // Quitar view_all del admin (a nivel role_permission para que
    // effectivePermissions.hasAllPermissions devuelva false) y crear un
    // override 'revoke' explícito. Es un patch para el test — en producción
    // el admin lo tiene siempre por su rol.
    await ctx.tenantDb.execute(sql`
      DELETE FROM role_permissions
      WHERE permission_code = 'users.view_all'
        AND role_id IN (SELECT id FROM roles WHERE code = 'admin_tenant')
    `);
    await ctx.tenantDb.execute(sql`
      INSERT INTO user_permission_overrides (user_id, permission_code, effect, granted_by, reason)
      VALUES (${adminId}, 'users.view_all', 'revoke', NULL, 'e2e test')
      ON CONFLICT (user_id, permission_code) DO UPDATE SET effect = 'revoke'
    `);

    // ⚠️ Invalidar el caché de permisos, SIN ESTO el revoke de arriba no existe
    // para la API.
    //
    // `EffectivePermissionsService` cachea los permisos efectivos en Redis 5
    // minutos (`perms:<userId>`) y sólo se invalida desde `deleteCacheForUser`.
    // Los dos writes de arriba son SQL crudo, así que el admin seguía teniendo
    // `users.view_all` efectivo — y con ese permiso **ver la sub-red
    // independiente es lo correcto**. El test fallaba con "Received: true" y
    // parecía una fuga de aislamiento; no lo era.
    //
    // Ojo en local: `REDIS_URL` apunta a Upstash, que es externo y persistente,
    // así que el caché sobrevive entre corridas. Con un TTL de 5 minutos y una
    // suite de ~25, el resultado cambiaba según cuándo expirara cada entrada:
    // de ahí la flakiness de 62 vs 63 fallas con el mismo código.
    await ctx.app.get(EffectivePermissionsService).deleteCacheForUser(adminId);

    const ids = await fetchAllUserIds(ctx.request, adminToken);

    // Debe VER: socio dependiente + su jugador.
    expect(ids.has(socioDep.id)).toBe(true);
    expect(ids.has(playerDep.id)).toBe(true);
    // NO debe ver: el socio independiente, ni su jugador (subárbol podado).
    expect(ids.has(socioIndep.id)).toBe(false);
    expect(ids.has(playerIndep.id)).toBe(false);

    // Restaurar el admin para que no rompa otros tests.
    await ctx.tenantDb.execute(sql`
      INSERT INTO role_permissions (role_id, permission_code)
      SELECT id, 'users.view_all' FROM roles WHERE code = 'admin_tenant'
      ON CONFLICT DO NOTHING
    `);
    await ctx.tenantDb.execute(sql`
      DELETE FROM user_permission_overrides
      WHERE user_id = ${adminId} AND permission_code = 'users.view_all'
    `);
  });
});

/**
 * Paginate por /tenant/users y devuelve el Set de ids resultantes.
 * El endpoint capea limit=200. Como `users` NO es truncado entre suites
 * (solo `resetMutableState` de mutables), el listado puede exceder 200
 * cuando muchas suites acumulan. Iteramos con offset hasta que la
 * página venga vacía o menor al limit.
 */
async function fetchAllUserIds(
  request: import('supertest').Agent,
  bearer: string,
): Promise<Set<string>> {
  const ids = new Set<string>();
  const limit = 200;
  let offset = 0;
  // Cap defensivo para no loopear si el endpoint devuelve páginas full
  // por siempre.
  for (let page = 0; page < 20; page += 1) {
    const r = await request
      .get(`/tenant/users?limit=${limit}&offset=${offset}`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', bearer);
    if (r.status !== 200) {
      throw new Error(`fetchAllUserIds falló ${r.status} ${JSON.stringify(r.body)}`);
    }
    const rows = (r.body as { data: Array<{ id: string }> }).data;
    for (const u of rows) ids.add(u.id);
    if (rows.length < limit) return ids;
    offset += limit;
  }
  return ids;
}
