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

import { TEST_TENANT } from '../setup/test-tenant';
import { loginAsAdmin, loginAsCajero1 } from '../helpers/auth';
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
      expect(body.count).toBeGreaterThanOrEqual(3); // admin + cajero1 + cajero2
      const usernames = body.data.map((u) => u.username);
      expect(usernames).toContain(TEST_TENANT.admin.username);
      expect(usernames).toContain(TEST_TENANT.cajero1.username);
    });

    it('cajero1 sin users.view_any → 403', async () => {
      const res = await ctx.request
        .get('/tenant/users')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero1Token);

      expect(res.status).toBe(403);
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
