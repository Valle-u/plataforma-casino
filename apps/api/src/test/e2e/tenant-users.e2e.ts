/**
 * E2E: TenantUsersController.
 *
 * Valida:
 *   - GET /tenant/users (lista + filtros).
 *   - GET /tenant/users/:id (detalle con roles + permisos efectivos).
 *   - POST /tenant/users (crear + asignar rol).
 *   - PATCH /tenant/users/:id (update).
 *   - POST /tenant/users/:id/roles/:roleCode (idempotencia).
 *   - DELETE /tenant/users/:id/roles/:roleCode (idempotencia).
 *   - Validación de DTO (campos faltantes, roleCode inválido).
 *   - Gates de permisos (cajero1 sin users.create → 403).
 *   - 404 para userIds inexistentes.
 */

import { sql } from 'drizzle-orm';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin, loginAsCajero1 } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';

describe('TenantUsersController (E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let cajero1Token: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
    cajero1Token = await loginAsCajero1(ctx.request);
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('GET /tenant/users', () => {
    it('admin lista los users del tenant', async () => {
      const res = await ctx.request
        .get('/tenant/users')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      expect(res.status).toBe(200);
      const body = res.body as { data: Array<{ username: string }>; count: number };
      // El listado EXCLUYE al actor por diseño (`ne(users.id, requester.id)`),
      // así que el admin NO aparece en su propia lista; sí ve al resto.
      expect(body.count).toBeGreaterThanOrEqual(1);
      const usernames = body.data.map((u) => u.username);
      expect(usernames).not.toContain(TEST_TENANT.admin.username);
      expect(usernames).toContain(TEST_TENANT.cajero1.username);
    });

    it('cajero1 lista (planilla cajero trae users.view_admin_network → alias)', async () => {
      // Con el modelo de planillas actual (Sprint 47+), la planilla `cajero`
      // incluye `users.view_admin_network` como perm base. Ese comodín se
      // resuelve por alias a `users.view_any` restringido al admin_network
      // (excluye sub-redes indep). Cajero1 ve el listing scopéado.
      const res = await ctx.request
        .get('/tenant/users')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero1Token);

      expect(res.status).toBe(200);
    });

    it('?search filtra por username/displayName/email (ILIKE case-insensitive)', async () => {
      // Buscar por username del cajero1 (lowercase exacto).
      const r1 = await ctx.request
        .get('/tenant/users')
        .query({ search: TEST_TENANT.cajero1.username })
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(r1.status).toBe(200);
      const body1 = r1.body as { data: Array<{ username: string }>; total: number };
      expect(body1.total).toBeGreaterThanOrEqual(1);
      expect(body1.data.map((u) => u.username)).toContain(
        TEST_TENANT.cajero1.username,
      );

      // Buscar uppercase — ILIKE debe matchear igual.
      const r2 = await ctx.request
        .get('/tenant/users')
        .query({ search: TEST_TENANT.cajero1.username.toUpperCase() })
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(r2.status).toBe(200);
      const body2 = r2.body as { data: Array<{ username: string }>; total: number };
      expect(body2.total).toBeGreaterThanOrEqual(1);

      // Buscar substring que no matchea nada.
      const r3 = await ctx.request
        .get('/tenant/users')
        .query({ search: 'zzzz_inexistente_xyz' })
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(r3.status).toBe(200);
      const body3 = r3.body as { total: number; data: unknown[] };
      expect(body3.total).toBe(0);
      expect(body3.data.length).toBe(0);
    });

    it('?status filtra por estado exacto', async () => {
      const res = await ctx.request
        .get('/tenant/users')
        .query({ status: 'active' })
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.status).toBe(200);
      const body = res.body as {
        data: Array<{ status: string }>;
        total: number;
      };
      expect(body.total).toBeGreaterThanOrEqual(3);
      expect(body.data.every((u) => u.status === 'active')).toBe(true);
    });

    it('?limit y ?offset paginan; total queda consistente cross-page', async () => {
      // Pedir todo el set para obtener el total real.
      const all = await ctx.request
        .get('/tenant/users')
        .query({ limit: 200 })
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(all.status).toBe(200);
      const allBody = all.body as { total: number; data: Array<{ id: string }> };
      const total = allBody.total;
      expect(total).toBeGreaterThanOrEqual(3);

      // Pagina 1: limit=2, offset=0.
      const p1 = await ctx.request
        .get('/tenant/users')
        .query({ limit: 2, offset: 0 })
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(p1.status).toBe(200);
      const p1Body = p1.body as {
        data: Array<{ id: string; username: string }>;
        total: number;
        count: number;
      };
      expect(p1Body.total).toBe(total);
      expect(p1Body.count).toBe(p1Body.data.length);
      expect(p1Body.data.length).toBeLessThanOrEqual(2);

      // Pagina 2: limit=2, offset=2 — IDs distintos a los de pagina 1.
      const p2 = await ctx.request
        .get('/tenant/users')
        .query({ limit: 2, offset: 2 })
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(p2.status).toBe(200);
      const p2Body = p2.body as { data: Array<{ id: string }>; total: number };
      expect(p2Body.total).toBe(total);
      const idsP1 = new Set(p1Body.data.map((u) => u.id));
      for (const row of p2Body.data) {
        expect(idsP1.has(row.id)).toBe(false);
      }
    });

    it('?search escapa % y _ del input (no rompe el ILIKE)', async () => {
      // Si el escapado fallara, "%" matcharía todos los rows.
      const res = await ctx.request
        .get('/tenant/users')
        .query({ search: '%' })
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.status).toBe(200);
      const body = res.body as { total: number };
      // Ningún username/email tiene literal '%', así que el total debe ser 0.
      expect(body.total).toBe(0);
    });
  });

  describe('POST /tenant/users', () => {
    it('crea un user con rol válido', async () => {
      const username = `created_${Date.now()}_a`;
      const res = await ctx.request
        .post('/tenant/users')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          username,
          password: 'a-valid-password',
          displayName: 'Created A',
          roleCode: 'cajero',
        });

      expect(res.status).toBe(201);
      const body = res.body as { user: { id: string; username: string } };
      expect(body.user.username).toBe(username);
      expect(body.user.id).toMatch(/^[0-9a-f-]{36}$/i);
    });

    it('400 si roleCode no existe', async () => {
      const res = await ctx.request
        .post('/tenant/users')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          username: `created_${Date.now()}_b`,
          password: 'a-valid-password',
          displayName: 'X',
          roleCode: 'no_existe',
        });

      expect(res.status).toBe(400);
    });

    it('409 si username ya en uso', async () => {
      const username = `dupcheck_${Date.now()}`;
      // Primero creo OK.
      await ctx.request
        .post('/tenant/users')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          username,
          password: 'a-valid-password',
          displayName: 'X',
          roleCode: 'cajero',
        });
      // Repito → 409.
      const dup = await ctx.request
        .post('/tenant/users')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          username,
          password: 'a-valid-password',
          displayName: 'Y',
          roleCode: 'cajero',
        });

      expect(dup.status).toBe(409);
    });

    it('400 si falta password', async () => {
      const res = await ctx.request
        .post('/tenant/users')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          username: `no_pwd_${Date.now()}`,
          displayName: 'X',
          roleCode: 'cajero',
        });

      expect(res.status).toBe(400);
    });

    it('cajero1 sin users.create → 403', async () => {
      const res = await ctx.request
        .post('/tenant/users')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero1Token)
        .send({
          username: `forbidden_${Date.now()}`,
          password: 'a-valid-password',
          displayName: 'X',
          roleCode: 'cajero',
        });

      expect(res.status).toBe(403);
    });

    // ── Bug #3: auto-parent de usuario_final en user_hierarchy ──────────────
    // Al crear un usuario_final, cuelga de su creador operativo con la
    // convención jugador_de_<rol>. Si lo crea el admin, queda huérfano.
    describe('auto-parent en user_hierarchy', () => {
      async function createUser(
        token: string,
        body: Record<string, unknown>,
      ): Promise<{ status: number; userId: string; parentAssigned: unknown }> {
        const res = await ctx.request
          .post('/tenant/users')
          .set('Host', TEST_TENANT.host)
          .set('Authorization', token)
          .send(body);
        const b = res.body as {
          user?: { id: string };
          parentAssigned?: unknown;
        };
        return {
          status: res.status,
          userId: b.user?.id ?? '',
          parentAssigned: b.parentAssigned,
        };
      }

      async function getParent(
        userId: string,
      ): Promise<{ parentUserId: string; relationType: string } | null> {
        const res = await ctx.request
          .get(`/tenant/user-hierarchy/${userId}/parent`)
          .set('Host', TEST_TENANT.host)
          .set('Authorization', adminToken);
        return (
          res.body as {
            parent: { parentUserId: string; relationType: string } | null;
          }
        ).parent;
      }

      it('un cajero que crea un usuario_final lo cuelga con jugador_de_cajero', async () => {
        // El admin crea un cajero con users.create delegado.
        const cajUsername = `caj_creator_${Date.now()}`;
        const cajero = await createUser(adminToken, {
          username: cajUsername,
          password: 'a-valid-password',
          displayName: 'Cajero Creador',
          roleCode: 'cajero',
          permissionOverrides: ['users.create'],
        });
        expect(cajero.status).toBe(201);

        const cajeroToken = await loginAs(
          ctx.request,
          cajUsername,
          'a-valid-password',
        );

        const jugador = await createUser(cajeroToken, {
          username: `jug_de_caj_${Date.now()}`,
          password: 'a-valid-password',
          displayName: 'Jugador de Cajero',
          roleCode: 'usuario_final',
        });
        expect(jugador.status).toBe(201);
        expect(jugador.parentAssigned).toBe(true);

        const parent = await getParent(jugador.userId);
        expect(parent).not.toBeNull();
        expect(parent!.parentUserId).toBe(cajero.userId);
        expect(parent!.relationType).toBe('jugador_de_cajero');
      });

      it('el admin que crea un usuario_final lo cuelga de la Casa (jugador_de_admin)', async () => {
        // La Casa = el admin: un jugador creado por el admin cuelga del admin
        // como `jugador_de_admin` (el motor de comisiones excluye al admin, así
        // que no genera comisiones). Antes quedaba root; el test viejo esperaba
        // eso y quedó desactualizado.
        const jugador = await createUser(adminToken, {
          username: `jug_de_admin_${Date.now()}`,
          password: 'a-valid-password',
          displayName: 'Jugador de Admin',
          roleCode: 'usuario_final',
        });
        expect(jugador.status).toBe(201);
        expect(jugador.parentAssigned).toBe(true);

        const parent = await getParent(jugador.userId);
        expect(parent).not.toBeNull();
        expect(parent!.relationType).toBe('jugador_de_admin');
      });

      it('crear un rol operativo (cajero) NO auto-asigna parent', async () => {
        const nuevo = await createUser(adminToken, {
          username: `caj_root_${Date.now()}`,
          password: 'a-valid-password',
          displayName: 'Cajero Root',
          roleCode: 'cajero',
        });
        expect(nuevo.status).toBe(201);
        expect(nuevo.parentAssigned).toBeUndefined();

        const parent = await getParent(nuevo.userId);
        expect(parent).toBeNull();
      });

      // ── Regresión (2026-08-14): fallback a "única sucursal independiente" ──
      // Bug: si el admin creaba un cajero/distribuidor y existía EXACTAMENTE una
      // sucursal independiente, un fallback lo colgaba AUTOMÁTICAMENTE bajo ella
      // → metía operadores de la red CENTRAL en la sub-red independiente (viola
      // R6/E8) y les escalaba los permisos de mover plata. Corregido: el
      // operador del admin queda root, sin importar cuántos independientes haya.
      async function withSingleIndependentBranch<T>(
        fn: () => Promise<T>,
      ): Promise<T> {
        const socio = await createUser(adminToken, {
          username: `socio_ind_${Date.now()}`,
          password: 'a-valid-password',
          displayName: 'Socio Indep',
          roleCode: 'socio',
        });
        expect(socio.status).toBe(201);
        await ctx.tenantDb.execute(
          sql`UPDATE users SET is_independent_branch = true WHERE id = ${socio.userId}`,
        );
        try {
          return await fn();
        } finally {
          // Restaurar: no dejar la condición "1 indep" para otros tests.
          await ctx.tenantDb.execute(
            sql`UPDATE users SET is_independent_branch = false WHERE id = ${socio.userId}`,
          );
        }
      }

      it('admin crea distribuidor con 1 sucursal independiente → queda root (NO bajo el independiente)', async () => {
        await withSingleIndependentBranch(async () => {
          const distri = await createUser(adminToken, {
            username: `distri_bug_${Date.now()}`,
            password: 'a-valid-password',
            displayName: 'Distri Bug',
            roleCode: 'distribuidor',
          });
          expect(distri.status).toBe(201);
          // Antes del fix: parentAssigned=true y parent=distribuidor_de_socio.
          expect(distri.parentAssigned).toBeUndefined();
          const parent = await getParent(distri.userId);
          expect(parent).toBeNull();
        });
      });

      it('admin crea cajero con 1 sucursal independiente → queda root', async () => {
        await withSingleIndependentBranch(async () => {
          const cajero = await createUser(adminToken, {
            username: `caj_bug_${Date.now()}`,
            password: 'a-valid-password',
            displayName: 'Cajero Bug',
            roleCode: 'cajero',
          });
          expect(cajero.status).toBe(201);
          expect(cajero.parentAssigned).toBeUndefined();
          const parent = await getParent(cajero.userId);
          expect(parent).toBeNull();
        });
      });
    });
  });

  describe('GET /tenant/users/:id', () => {
    it('devuelve user + roles + permisos efectivos', async () => {
      // Crear un user fresco con rol admin_tenant para tener perms efectivos != [].
      const username = `detail_${Date.now()}`;
      const created = await ctx.request
        .post('/tenant/users')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          username,
          password: 'a-valid-password',
          displayName: 'Detail',
          roleCode: 'admin_tenant',
        });
      const userId = (created.body as { user: { id: string } }).user.id;

      const detail = await ctx.request
        .get(`/tenant/users/${userId}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      expect(detail.status).toBe(200);
      const body = detail.body as {
        user: { id: string; username: string };
        roles: Array<{ code: string }>;
        effectivePermissions: string[];
      };
      expect(body.user.id).toBe(userId);
      expect(body.roles.map((r) => r.code)).toContain('admin_tenant');
      expect(body.effectivePermissions.length).toBeGreaterThan(0);
    });

    it('404 si userId no existe', async () => {
      const fake = '019e0000-0000-7000-8000-000000000000';
      const res = await ctx.request
        .get(`/tenant/users/${fake}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /tenant/users/:id', () => {
    it('actualiza status y displayName', async () => {
      const username = `update_${Date.now()}`;
      const created = await ctx.request
        .post('/tenant/users')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          username,
          password: 'a-valid-password',
          displayName: 'Before',
          roleCode: 'cajero',
        });
      const userId = (created.body as { user: { id: string } }).user.id;

      const updated = await ctx.request
        .patch(`/tenant/users/${userId}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ displayName: 'After', status: 'suspended' });

      expect(updated.status).toBe(200);
      const body = updated.body as { user: { displayName: string; status: string } };
      expect(body.user.displayName).toBe('After');
      expect(body.user.status).toBe('suspended');
    });

    it('400 si status es inválido', async () => {
      const username = `update_bad_${Date.now()}`;
      const created = await ctx.request
        .post('/tenant/users')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          username,
          password: 'a-valid-password',
          displayName: 'X',
          roleCode: 'cajero',
        });
      const userId = (created.body as { user: { id: string } }).user.id;

      const res = await ctx.request
        .patch(`/tenant/users/${userId}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ status: 'inventado' });

      expect(res.status).toBe(400);
    });

    it('404 si userId no existe', async () => {
      const fake = '019e0000-0000-7000-8000-000000000000';
      const res = await ctx.request
        .patch(`/tenant/users/${fake}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ displayName: 'X' });

      expect(res.status).toBe(404);
    });
  });

  describe('POST /tenant/users/:id/roles/:roleCode', () => {
    it('asigna rol y es idempotente', async () => {
      const username = `roles_${Date.now()}`;
      const created = await ctx.request
        .post('/tenant/users')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          username,
          password: 'a-valid-password',
          displayName: 'R',
          roleCode: 'cajero',
        });
      const userId = (created.body as { user: { id: string } }).user.id;

      const first = await ctx.request
        .post(`/tenant/users/${userId}/roles/socio`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(first.status).toBe(200);
      expect((first.body as { added: boolean }).added).toBe(true);

      const second = await ctx.request
        .post(`/tenant/users/${userId}/roles/socio`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(second.status).toBe(200);
      expect((second.body as { added: boolean }).added).toBe(false);
    });

    it('400 si roleCode no existe', async () => {
      const username = `roles_bad_${Date.now()}`;
      const created = await ctx.request
        .post('/tenant/users')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          username,
          password: 'a-valid-password',
          displayName: 'R',
          roleCode: 'cajero',
        });
      const userId = (created.body as { user: { id: string } }).user.id;

      const res = await ctx.request
        .post(`/tenant/users/${userId}/roles/no_existe_jaja`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /tenant/users/:id/roles/:roleCode', () => {
    it('remueve rol e idempotencia', async () => {
      const username = `rmrole_${Date.now()}`;
      const created = await ctx.request
        .post('/tenant/users')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          username,
          password: 'a-valid-password',
          displayName: 'R',
          roleCode: 'cajero',
        });
      const userId = (created.body as { user: { id: string } }).user.id;

      const first = await ctx.request
        .delete(`/tenant/users/${userId}/roles/cajero`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(first.status).toBe(200);
      expect((first.body as { removed: boolean }).removed).toBe(true);

      const second = await ctx.request
        .delete(`/tenant/users/${userId}/roles/cajero`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(second.status).toBe(200);
      expect((second.body as { removed: boolean }).removed).toBe(false);
    });
  });
});
