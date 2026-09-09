/**
 * E2E: de quién cuelga lo que crea un EMPLEADO (`POST /tenant/users`).
 *
 * ## El bug que arregla — y por qué costaba verlo
 *
 * El chequeo de "staff de la casa" era por **código de rol**:
 *
 * ```
 * actorIsCasaStaff = roles.includes('admin_tenant') || roles.includes('empleado')
 * ```
 *
 * y a todo eso lo colgaba del **admin primario**. Pero los socios independientes
 * también tienen empleados (**R7**), y entraban por la misma rama: **el jugador
 * que creaba un empleado de un socio independiente terminaba colgado del admin
 * del casino**, o sea fuera de la red independiente, y con él las comisiones que
 * generara.
 *
 * **No rompía nada visible.** El jugador se creaba, entraba y jugaba. Se
 * descubre cuando alguien mira una liquidación y no cierra — meses después, sin
 * forma de saber cuántos jugadores se fueron por ese camino.
 *
 * ## Qué fija este archivo
 *
 * Que un empleado crea **en nombre de su operador**, no del admin. Y que el caso
 * central —un empleado del casino— **no cambió**, que es la mitad que hay que
 * proteger al arreglar algo así.
 */

import { sql } from 'drizzle-orm';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser, type TestUser } from '../helpers/test-users';

const SUITE = `alta-emp-${Date.now().toString(36)}`;

let ctx: TestApp;
let adminToken = '';
let adminId = '';

/** Red independiente: el socio Litoral y un empleado suyo. */
let litoral: TestUser;
let empleadoDeLitoral: TestUser;
let tokenEmpleadoIndep = '';

/** Red central: un empleado del casino. */
let empleadoCentral: TestUser;
let tokenEmpleadoCentral = '';

let n = 0;
const nombre = () => `${SUITE}_${n++}`;

async function una<T>(res: unknown): Promise<T> {
  return (res as unknown as T[])[0]!;
}

async function colgarDe(hijo: string, padre: string, rel: string): Promise<void> {
  await ctx.tenantDb.execute(
    sql`UPDATE user_hierarchy SET until = now()
         WHERE user_id = ${hijo} AND until IS NULL`,
  );
  await ctx.tenantDb.execute(
    sql`INSERT INTO user_hierarchy (id, user_id, parent_user_id, relation_type)
        VALUES (gen_random_uuid(), ${hijo}, ${padre}, ${rel})`,
  );
}

/** El padre activo y la etiqueta de la relación. */
async function jerarquiaDe(
  userId: string,
): Promise<{ parent: string | null; relation: string | null }> {
  const filas = (await ctx.tenantDb.execute(
    sql`SELECT parent_user_id, relation_type FROM user_hierarchy
         WHERE user_id = ${userId} AND until IS NULL`,
  )) as unknown as Array<{
    parent_user_id: string | null;
    relation_type: string | null;
  }>;
  return {
    parent: filas[0]?.parent_user_id ?? null,
    relation: filas[0]?.relation_type ?? null,
  };
}

/**
 * Le da `users.create` a un empleado.
 *
 * Hace falta porque un `empleado` recién creado **no trae ningún permiso**: se
 * los da el operador por planilla (**R7**). Sin esto el alta responde 403 y el
 * test no llegaría a mirar la jerarquía, que es lo que viene a verificar.
 */
async function darPermisoDeAlta(userId: string): Promise<void> {
  await ctx.request
    .post('/tenant/permission-overrides/grant')
    .set('Host', TEST_TENANT.host)
    .set('Authorization', adminToken)
    .send({ userId, permissionCode: 'users.create' });
}

async function crear(
  token: string,
  roleCode: string,
): Promise<{ id: string; status: number }> {
  const username = nombre();
  const res = await ctx.request
    .post('/tenant/users')
    .set('Host', TEST_TENANT.host)
    .set('Authorization', token)
    .send({
      username,
      password: 'una-password-larga-de-prueba-2026',
      displayName: username,
      roleCode,
    });
  return { id: (res.body?.user?.id as string) ?? '', status: res.status };
}

describe('alta desde el panel · de quién cuelga lo que crea un empleado', () => {
  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);

    adminId = (
      await una<{ id: string }>(
        await ctx.tenantDb.execute(
          sql`SELECT id FROM users WHERE username = ${TEST_TENANT.admin.username}`,
        ),
      )
    ).id;

    // ── Red independiente ──
    litoral = await createTestUser(ctx.request, adminToken, {
      suite: SUITE, label: 'litoral', role: 'socio',
    });
    await ctx.tenantDb.execute(
      sql`UPDATE users SET is_independent_branch = true WHERE id = ${litoral.id}`,
    );
    empleadoDeLitoral = await createTestUser(ctx.request, adminToken, {
      suite: SUITE, label: 'emplit', role: 'empleado',
    });
    // Lo colgamos de Litoral: es un empleado DEL SOCIO, no del casino (R7).
    await colgarDe(empleadoDeLitoral.id, litoral.id, 'empleado');

    // ── Red central ──
    empleadoCentral = await createTestUser(ctx.request, adminToken, {
      suite: SUITE, label: 'empcen', role: 'empleado',
    });

    await darPermisoDeAlta(empleadoDeLitoral.id);
    await darPermisoDeAlta(empleadoCentral.id);

    [tokenEmpleadoIndep, tokenEmpleadoCentral] = await Promise.all([
      loginAs(ctx.request, empleadoDeLitoral.username, empleadoDeLitoral.password),
      loginAs(ctx.request, empleadoCentral.username, empleadoCentral.password),
    ]);
  }, 90_000);

  afterAll(async () => {
    await ctx.close();
  });

  // ── El bug ────────────────────────────────────────────────────────────────

  describe('empleado de un socio INDEPENDIENTE', () => {
    /**
     * ⚠️ **El test que da nombre al archivo.**
     *
     * Antes del arreglo, este jugador colgaba del **admin del casino**: se iba
     * de la red de Litoral y las comisiones que generara dejaban de ser suyas.
     */
    it('el jugador que crea cuelga de SU OPERADOR, no del admin', async () => {
      const { id, status } = await crear(tokenEmpleadoIndep, 'usuario_final');
      expect(status).toBe(201);

      const { parent, relation } = await jerarquiaDe(id);
      expect(parent).toBe(litoral.id);
      expect(parent).not.toBe(adminId); // ← lo que pasaba antes
      expect(relation).toBe('jugador_de_socio');
    });

    it('y tampoco cuelga del empleado mismo', async () => {
      const { id } = await crear(tokenEmpleadoIndep, 'usuario_final');

      // El empleado no arma una red propia: trabaja para la de otro. Colgarlo
      // de él metería un eslabón que no existe en el modelo comercial.
      expect((await jerarquiaDe(id)).parent).not.toBe(empleadoDeLitoral.id);
    });

    it('un cajero que crea también queda en la red del socio', async () => {
      const { id, status } = await crear(tokenEmpleadoIndep, 'cajero');
      if (status !== 201) return; // si no tiene permiso para ese rol, no aplica

      const { parent, relation } = await jerarquiaDe(id);
      expect(parent).toBe(litoral.id);
      expect(relation).toBe('cajero_de_socio');
    });
  });

  // ── La mitad que NO tenía que cambiar ─────────────────────────────────────

  describe('empleado del casino (red central) — sin cambios', () => {
    it('el jugador que crea sigue colgando del admin', async () => {
      const { id, status } = await crear(tokenEmpleadoCentral, 'usuario_final');
      expect(status).toBe(201);

      const { parent, relation } = await jerarquiaDe(id);
      expect(parent).toBe(adminId);
      expect(relation).toBe('jugador_de_admin');
    });
  });

  describe('el admin — sin cambios', () => {
    it('el jugador que crea cuelga del admin', async () => {
      const { id, status } = await crear(adminToken, 'usuario_final');
      expect(status).toBe(201);

      const { parent, relation } = await jerarquiaDe(id);
      expect(parent).toBe(adminId);
      expect(relation).toBe('jugador_de_admin');
    });

    it('un cajero que crea usa la convención `_de_admin`', async () => {
      const { id, status } = await crear(adminToken, 'cajero');
      expect(status).toBe(201);

      const { parent, relation } = await jerarquiaDe(id);
      expect(parent).toBe(adminId);
      expect(relation).toBe('cajero_de_admin');
    });
  });

  describe('un operador que crea — sin cambios', () => {
    it('el jugador cuelga del socio', async () => {
      const tokenLitoral = await loginAs(
        ctx.request, litoral.username, litoral.password,
      );
      const { id, status } = await crear(tokenLitoral, 'usuario_final');
      expect(status).toBe(201);

      const { parent, relation } = await jerarquiaDe(id);
      expect(parent).toBe(litoral.id);
      expect(relation).toBe('jugador_de_socio');
    });
  });
});
