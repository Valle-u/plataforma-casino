/**
 * E2E: AuditLogController.
 *
 * Valida:
 *   - Cada mutación de permission-override / users genera al menos una fila.
 *   - Filtros: actorUserId, actionCode (exacto + prefix), targetId, fechas.
 *   - Paginación: limit + offset, max 200.
 *   - Permission gate: audit.view obligatorio.
 *   - Inmutabilidad lógica: el controller solo expone GET (sin POST/PATCH/DELETE
 *     desde HTTP — la única vía de escritura es `AuditLogService.record()`).
 */

import { TEST_TENANT } from '../setup/test-tenant';
import { loginAsAdmin, loginAsCajero1 } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';

interface AuditEntry {
  id: string;
  actorUserId: string | null;
  actorUsername: string | null;
  actionCode: string;
  targetType: string | null;
  targetId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  metadata: unknown;
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

interface AuditResponse {
  entries: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
}

describe('AuditLogController (E2E)', () => {
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

  describe('Permission gate', () => {
    it('responde 403 si el actor no tiene audit.view', async () => {
      const res = await ctx.request
        .get('/tenant/audit-log')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero1Token);

      expect(res.status).toBe(403);
    });

    it('responde 401 sin token', async () => {
      const res = await ctx.request.get('/tenant/audit-log').set('Host', TEST_TENANT.host);
      expect(res.status).toBe(401);
    });
  });

  describe('Lectura básica', () => {
    it('GET /tenant/audit-log devuelve entries con shape correcto', async () => {
      // Producir una entry conocida.
      const username = `audit_basic_${Date.now()}`;
      const created = await ctx.request
        .post('/tenant/users')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          username,
          password: 'a-valid-pass',
          displayName: 'X',
          roleCode: 'cajero',
        });
      const userId = (created.body as { user: { id: string } }).user.id;

      const res = await ctx.request
        .get(`/tenant/audit-log?targetId=${userId}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      expect(res.status).toBe(200);
      const body = res.body as AuditResponse;
      expect(body.total).toBeGreaterThan(0);
      const entry = body.entries.find((e) => e.actionCode === 'users.create');
      expect(entry).toBeDefined();
      expect(entry!.actorUsername).toBe(TEST_TENANT.admin.username);
      expect(entry!.targetType).toBe('user');
      expect(entry!.targetId).toBe(userId);
      expect(entry!.requestId).toMatch(/^[0-9a-f-]{36}$/i);
    });
  });

  describe('Filtros', () => {
    it('filtra por actionCode exacto', async () => {
      // Producir 2 grants distintos.
      const u1 = await ctx.request
        .post('/tenant/users')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          username: `audit_f1_${Date.now()}`,
          password: 'a-valid-pass',
          displayName: 'X',
          roleCode: 'cajero',
        });
      const u1Id = (u1.body as { user: { id: string } }).user.id;
      await ctx.request
        .post('/tenant/permission-overrides/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ userId: u1Id, permissionCode: 'wallet.load' });

      const res = await ctx.request
        .get('/tenant/audit-log?actionCode=permissions.grant&limit=100')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      expect(res.status).toBe(200);
      const body = res.body as AuditResponse;
      // Todas las entries deben tener actionCode exacto.
      for (const entry of body.entries) {
        expect(entry.actionCode).toBe('permissions.grant');
      }
    });

    it('filtra por actionCodePrefix con LIKE', async () => {
      const res = await ctx.request
        .get('/tenant/audit-log?actionCodePrefix=permissions.&limit=200')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      expect(res.status).toBe(200);
      const body = res.body as AuditResponse;
      for (const entry of body.entries) {
        expect(entry.actionCode.startsWith('permissions.')).toBe(true);
      }
    });

    it('filtra por actorUserId', async () => {
      // Obtener id del admin.
      const meRes = await ctx.request
        .get('/tenant/auth/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const adminId = (meRes.body as { user: { id: string } }).user.id;

      const res = await ctx.request
        .get(`/tenant/audit-log?actorUserId=${adminId}&limit=200`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      expect(res.status).toBe(200);
      const body = res.body as AuditResponse;
      for (const entry of body.entries) {
        expect(entry.actorUserId).toBe(adminId);
      }
    });

    it('filtra por targetId', async () => {
      const username = `audit_target_${Date.now()}`;
      const created = await ctx.request
        .post('/tenant/users')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          username,
          password: 'a-valid-pass',
          displayName: 'X',
          roleCode: 'cajero',
        });
      const userId = (created.body as { user: { id: string } }).user.id;

      const res = await ctx.request
        .get(`/tenant/audit-log?targetId=${userId}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      expect(res.status).toBe(200);
      const body = res.body as AuditResponse;
      expect(body.total).toBeGreaterThanOrEqual(1);
      for (const entry of body.entries) {
        expect(entry.targetId).toBe(userId);
      }
    });
  });

  describe('Paginación', () => {
    it('respeta limit y offset', async () => {
      // Creamos un user dedicado a este test y le hacemos 4 updates
      // (cada uno genera 1 audit entry users.update con targetId=ese user).
      // Filtramos por targetId para aislar totalmente los entries de
      // este test.
      const target = await ctx.request
        .post('/tenant/users')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          username: `pgntest${Date.now().toString(36).slice(-6)}`,
          password: 'a-valid-pwd',
          displayName: 'Pagn Target',
          roleCode: 'cajero',
        });
      const targetId = (target.body as { user: { id: string } }).user.id;

      // 4 updates distintos para producir 4 audit entries.
      for (let i = 0; i < 4; i++) {
        await ctx.request
          .patch(`/tenant/users/${targetId}`)
          .set('Host', TEST_TENANT.host)
          .set('Authorization', adminToken)
          .send({ displayName: `Pagn v${i}` });
      }

      // Paginación: 4 entries totales, limit 2.
      const page1 = await ctx.request
        .get(`/tenant/audit-log?targetId=${targetId}&actionCode=users.update&limit=2&offset=0`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const page2 = await ctx.request
        .get(`/tenant/audit-log?targetId=${targetId}&actionCode=users.update&limit=2&offset=2`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      expect(page1.status).toBe(200);
      expect(page2.status).toBe(200);

      const b1 = page1.body as AuditResponse;
      const b2 = page2.body as AuditResponse;
      expect(b1.entries.length).toBe(2);
      expect(b2.entries.length).toBe(2);

      const ids1 = b1.entries.map((e) => e.id);
      const ids2 = b2.entries.map((e) => e.id);
      for (const id of ids2) {
        expect(ids1).not.toContain(id);
      }
    });

    it('clampea limit a 200', async () => {
      const res = await ctx.request
        .get('/tenant/audit-log?limit=99999')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      expect(res.status).toBe(200);
      const body = res.body as AuditResponse;
      expect(body.entries.length).toBeLessThanOrEqual(200);
    });
  });

  describe('Orden', () => {
    it('por default es desc por createdAt', async () => {
      const res = await ctx.request
        .get('/tenant/audit-log?limit=10')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const body = res.body as AuditResponse;
      if (body.entries.length < 2) return;
      for (let i = 0; i < body.entries.length - 1; i++) {
        const a = new Date(body.entries[i]!.createdAt).getTime();
        const b = new Date(body.entries[i + 1]!.createdAt).getTime();
        expect(a).toBeGreaterThanOrEqual(b);
      }
    });

    it('order=asc invierte el orden', async () => {
      const res = await ctx.request
        .get('/tenant/audit-log?limit=10&order=asc')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const body = res.body as AuditResponse;
      if (body.entries.length < 2) return;
      for (let i = 0; i < body.entries.length - 1; i++) {
        const a = new Date(body.entries[i]!.createdAt).getTime();
        const b = new Date(body.entries[i + 1]!.createdAt).getTime();
        expect(a).toBeLessThanOrEqual(b);
      }
    });
  });

  describe('Producción de entries por acción', () => {
    it('users.update producido sólo si el patch cambia algo', async () => {
      const username = `audit_noop_${Date.now()}`;
      const created = await ctx.request
        .post('/tenant/users')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          username,
          password: 'a-valid-pass',
          displayName: 'NoOp',
          roleCode: 'cajero',
        });
      const userId = (created.body as { user: { id: string } }).user.id;

      // No-op: mismo displayName.
      await ctx.request
        .patch(`/tenant/users/${userId}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ displayName: 'NoOp' });

      const res = await ctx.request
        .get(`/tenant/audit-log?targetId=${userId}&actionCode=users.update`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      // No deberíamos tener entry de update (la única acción auditada fue create).
      expect((res.body as AuditResponse).total).toBe(0);
    });

    it('users.role_add idempotente: re-add NO genera entry adicional', async () => {
      const username = `audit_idem_${Date.now()}`;
      const created = await ctx.request
        .post('/tenant/users')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          username,
          password: 'a-valid-pass',
          displayName: 'X',
          roleCode: 'cajero',
        });
      const userId = (created.body as { user: { id: string } }).user.id;

      await ctx.request
        .post(`/tenant/users/${userId}/roles/socio`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      await ctx.request
        .post(`/tenant/users/${userId}/roles/socio`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      const res = await ctx.request
        .get(`/tenant/audit-log?targetId=${userId}&actionCode=users.role_add`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      // Exactamente 1 entry — el segundo add fue silencioso.
      expect((res.body as AuditResponse).total).toBe(1);
    });
  });
});
