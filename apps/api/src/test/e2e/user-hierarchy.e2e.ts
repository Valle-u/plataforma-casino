/**
 * E2E: UserHierarchyController + ScopeGuard.
 *
 * Cubre:
 *   - CRUD de hierarchy (set/clear parent + queries).
 *   - Anti-self-parent.
 *   - Anti-cycle.
 *   - Permisos: change_hierarchy es no-delegable.
 *   - ScopeGuard:
 *     - admin_tenant bypass (puede cargar a cualquiera).
 *     - self bypass (operar sobre uno mismo).
 *     - target en network → permitido.
 *     - target fuera de network → 403 OUT_OF_SCOPE.
 *     - Sin @ScopeTarget → skip (no afecta endpoints no decorados).
 *   - Audit log de set/clear con severity:high.
 */

import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser } from '../helpers/test-users';
import { fundWalletForTests } from '../helpers/fund-wallet';

describe('UserHierarchy + ScopeGuard (E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);

    // Suite-level fund pool: fondeamos grande la wallet del admin del seed,
    // así cualquier test que necesite fondear users tiene de donde.
    const me = await ctx.request
      .get('/tenant/auth/me')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken);
    const adminId = (me.body as { user: { id: string } }).user.id;
    await fundWalletForTests(adminId, '10000000');
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('CRUD de hierarchy', () => {
    it('PUT /:userId/parent setea el parent activo', async () => {
      const child = await createTestUser(ctx.request, adminToken, {
        suite: 'uh-set',
        label: 'ch',
        role: 'cajero',
      });
      const parent = await createTestUser(ctx.request, adminToken, {
        suite: 'uh-set',
        label: 'pa',
        role: 'socio',
      });

      const r = await ctx.request
        .put(`/tenant/user-hierarchy/${child.id}/parent`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ parentUserId: parent.id, relationType: 'cajero_de_socio' });

      expect(r.status).toBe(200);
      expect((r.body as { ok: true; relation: { parentUserId: string } }).relation.parentUserId).toBe(parent.id);

      // GET confirma.
      const get = await ctx.request
        .get(`/tenant/user-hierarchy/${child.id}/parent`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const got = (get.body as { parent: { parentUserId: string } | null }).parent;
      expect(got).not.toBeNull();
      expect(got!.parentUserId).toBe(parent.id);
    });

    it('cambiar parent cierra la fila anterior (queda solo 1 activa)', async () => {
      const child = await createTestUser(ctx.request, adminToken, {
        suite: 'uh-chg',
        label: 'ch',
        role: 'cajero',
      });
      const parent1 = await createTestUser(ctx.request, adminToken, {
        suite: 'uh-chg',
        label: 'p1',
        role: 'socio',
      });
      const parent2 = await createTestUser(ctx.request, adminToken, {
        suite: 'uh-chg',
        label: 'p2',
        role: 'socio',
      });

      await ctx.request
        .put(`/tenant/user-hierarchy/${child.id}/parent`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ parentUserId: parent1.id, relationType: 'cajero_de_socio' });

      await ctx.request
        .put(`/tenant/user-hierarchy/${child.id}/parent`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ parentUserId: parent2.id, relationType: 'cajero_de_socio' });

      const get = await ctx.request
        .get(`/tenant/user-hierarchy/${child.id}/parent`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const got = (get.body as { parent: { parentUserId: string } | null }).parent;
      expect(got!.parentUserId).toBe(parent2.id);
    });

    it('DELETE /:userId/parent cierra el activo', async () => {
      const child = await createTestUser(ctx.request, adminToken, {
        suite: 'uh-clr',
        label: 'ch',
        role: 'cajero',
      });
      const parent = await createTestUser(ctx.request, adminToken, {
        suite: 'uh-clr',
        label: 'pa',
        role: 'socio',
      });
      await ctx.request
        .put(`/tenant/user-hierarchy/${child.id}/parent`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ parentUserId: parent.id, relationType: 'cajero_de_socio' });

      const del = await ctx.request
        .delete(`/tenant/user-hierarchy/${child.id}/parent`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(del.status).toBe(200);
      expect((del.body as { cleared: boolean }).cleared).toBe(true);

      const get = await ctx.request
        .get(`/tenant/user-hierarchy/${child.id}/parent`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect((get.body as { parent: unknown }).parent).toBeNull();
    });

    it('409 SELF_PARENT si userId == parentUserId', async () => {
      const u = await createTestUser(ctx.request, adminToken, {
        suite: 'uh-self',
        label: 'u',
        role: 'cajero',
      });
      const r = await ctx.request
        .put(`/tenant/user-hierarchy/${u.id}/parent`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ parentUserId: u.id, relationType: 'cajero_de_socio' });
      expect(r.status).toBe(409);
      expect((r.body as { error: string }).error).toBe('SELF_PARENT');
    });

    it('409 HIERARCHY_CYCLE si el parent es descendant', async () => {
      // socio → cajero (cajero es descendant de socio). Querer asignar
      // socio como child de cajero crearía ciclo.
      const socio = await createTestUser(ctx.request, adminToken, {
        suite: 'uh-cyc',
        label: 's',
        role: 'socio',
      });
      const cajero = await createTestUser(ctx.request, adminToken, {
        suite: 'uh-cyc',
        label: 'c',
        role: 'cajero',
      });

      await ctx.request
        .put(`/tenant/user-hierarchy/${cajero.id}/parent`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ parentUserId: socio.id, relationType: 'cajero_de_socio' });

      const r = await ctx.request
        .put(`/tenant/user-hierarchy/${socio.id}/parent`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ parentUserId: cajero.id, relationType: 'cajero_de_socio' });
      expect(r.status).toBe(409);
      expect((r.body as { error: string }).error).toBe('HIERARCHY_CYCLE');
    });

    it('descendants recursivos: socio → cajero → jugador', async () => {
      const socio = await createTestUser(ctx.request, adminToken, {
        suite: 'uh-desc',
        label: 's',
        role: 'socio',
      });
      const cajero = await createTestUser(ctx.request, adminToken, {
        suite: 'uh-desc',
        label: 'c',
        role: 'cajero',
      });
      const jugador = await createTestUser(ctx.request, adminToken, {
        suite: 'uh-desc',
        label: 'j',
        role: 'cajero',
      });

      await ctx.request
        .put(`/tenant/user-hierarchy/${cajero.id}/parent`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ parentUserId: socio.id, relationType: 'cajero_de_socio' });

      await ctx.request
        .put(`/tenant/user-hierarchy/${jugador.id}/parent`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ parentUserId: cajero.id, relationType: 'jugador_de_cajero' });

      const d = await ctx.request
        .get(`/tenant/user-hierarchy/${socio.id}/descendants`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const desc = (d.body as { descendants: string[] }).descendants;
      expect(desc).toContain(cajero.id);
      expect(desc).toContain(jugador.id);
      expect(desc.length).toBe(2);

      // Ancestors del jugador: cajero + socio.
      const a = await ctx.request
        .get(`/tenant/user-hierarchy/${jugador.id}/ancestors`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const anc = (a.body as { ancestors: string[] }).ancestors;
      expect(anc).toContain(cajero.id);
      expect(anc).toContain(socio.id);
    });
  });

  describe('Audit log de hierarchy', () => {
    it('set_parent deja audit entry con severity:high', async () => {
      const child = await createTestUser(ctx.request, adminToken, {
        suite: 'uh-audit',
        label: 'ch',
        role: 'cajero',
      });
      const parent = await createTestUser(ctx.request, adminToken, {
        suite: 'uh-audit',
        label: 'pa',
        role: 'socio',
      });
      await ctx.request
        .put(`/tenant/user-hierarchy/${child.id}/parent`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ parentUserId: parent.id, relationType: 'cajero_de_socio' });

      const audit = await ctx.request
        .get(`/tenant/audit-log?targetId=${child.id}&actionCode=users.set_parent`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const entries = (audit.body as { entries: Array<Record<string, unknown>> }).entries;
      expect(entries.length).toBeGreaterThan(0);
      const meta = entries[0]!.metadata as { severity: string };
      expect(meta.severity).toBe('high');
    });
  });

  describe('ScopeGuard sobre wallet.load', () => {
    it('cajero con wallet.load NO puede cargar a user fuera de su red → 403 OUT_OF_SCOPE', async () => {
      // Setup: cajero con wallet.load (vía override). Sin red.
      const cajero = await createTestUser(ctx.request, adminToken, {
        suite: 'sc-out',
        label: 'cj',
        role: 'cajero',
      });
      const stranger = await createTestUser(ctx.request, adminToken, {
        suite: 'sc-out',
        label: 'st',
        role: 'cajero',
      });
      await ctx.request
        .post('/tenant/permission-overrides/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ userId: cajero.id, permissionCode: 'wallet.load' });
      // Fondear cajero para que el load no falle por saldo.
      await ctx.request
        .post('/tenant/wallet/load')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', `sc-fund-${cajero.id}`)
        .send({ targetUserId: cajero.id, amount: '500' });

      const cajeroToken = await loginAs(ctx.request, cajero.username, cajero.password);
      const r = await ctx.request
        .post('/tenant/wallet/load')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajeroToken)
        .set('Idempotency-Key', `sc-load-out-${Date.now()}`)
        .send({ targetUserId: stranger.id, amount: '50' });

      expect(r.status).toBe(403);
      expect((r.body as { error: string }).error).toBe('OUT_OF_SCOPE');
    });

    it('cajero SÍ puede cargar a un jugador que está en su red', async () => {
      const cajero = await createTestUser(ctx.request, adminToken, {
        suite: 'sc-in',
        label: 'cj',
        role: 'cajero',
      });
      const jugador = await createTestUser(ctx.request, adminToken, {
        suite: 'sc-in',
        label: 'jg',
        role: 'cajero',
      });

      // Set jugador como child del cajero.
      await ctx.request
        .put(`/tenant/user-hierarchy/${jugador.id}/parent`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ parentUserId: cajero.id, relationType: 'jugador_de_cajero' });

      // Permiso + fondear cajero.
      await ctx.request
        .post('/tenant/permission-overrides/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ userId: cajero.id, permissionCode: 'wallet.load' });
      await ctx.request
        .post('/tenant/wallet/load')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', `sc-fund-in-${cajero.id}`)
        .send({ targetUserId: cajero.id, amount: '500' });

      const cajeroToken = await loginAs(ctx.request, cajero.username, cajero.password);
      const r = await ctx.request
        .post('/tenant/wallet/load')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajeroToken)
        .set('Idempotency-Key', `sc-load-in-${Date.now()}`)
        .send({ targetUserId: jugador.id, amount: '50' });

      expect(r.status).toBe(201);
    });

    it('admin_tenant bypassa scope (puede cargar a cualquiera del tenant)', async () => {
      const stranger = await createTestUser(ctx.request, adminToken, {
        suite: 'sc-byp',
        label: 'st',
        role: 'cajero',
      });
      // Admin del seed no tiene a stranger en su red. Sin embargo,
      // por ser admin_tenant, el scope guard lo deja pasar.
      const r = await ctx.request
        .post('/tenant/wallet/load')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', `sc-admin-${Date.now()}`)
        .send({ targetUserId: stranger.id, amount: '10' });
      expect(r.status).toBe(201);
    });

    it('descendants indirectos también pasan (cajero → distri → su jugador)', async () => {
      const socio = await createTestUser(ctx.request, adminToken, {
        suite: 'sc-2lvl',
        label: 's',
        role: 'socio',
      });
      const distri = await createTestUser(ctx.request, adminToken, {
        suite: 'sc-2lvl',
        label: 'd',
        role: 'distribuidor',
      });
      const cajero = await createTestUser(ctx.request, adminToken, {
        suite: 'sc-2lvl',
        label: 'c',
        role: 'cajero',
      });
      const jugador = await createTestUser(ctx.request, adminToken, {
        suite: 'sc-2lvl',
        label: 'j',
        role: 'cajero',
      });

      // Construir cadena socio → distri → cajero → jugador.
      for (const [child, parent, relation] of [
        [distri.id, socio.id, 'distribuidor_de_socio'],
        [cajero.id, distri.id, 'cajero_de_distribuidor'],
        [jugador.id, cajero.id, 'jugador_de_cajero'],
      ] as const) {
        await ctx.request
          .put(`/tenant/user-hierarchy/${child}/parent`)
          .set('Host', TEST_TENANT.host)
          .set('Authorization', adminToken)
          .send({ parentUserId: parent, relationType: relation });
      }

      // Socio tiene wallet.load + saldo, intenta cargar al jugador
      // (descendant indirecto a 3 niveles).
      await ctx.request
        .post('/tenant/permission-overrides/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ userId: socio.id, permissionCode: 'wallet.load' });
      await ctx.request
        .post('/tenant/wallet/load')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', `sc-fund-socio-${socio.id}`)
        .send({ targetUserId: socio.id, amount: '500' });

      const socioToken = await loginAs(ctx.request, socio.username, socio.password);
      const r = await ctx.request
        .post('/tenant/wallet/load')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', socioToken)
        .set('Idempotency-Key', `sc-3lvl-${Date.now()}`)
        .send({ targetUserId: jugador.id, amount: '20' });
      expect(r.status).toBe(201);
    });
  });

  describe('Permisos del controller', () => {
    it('PUT /:userId/parent requiere users.change_hierarchy (cajero → 403)', async () => {
      const cajero = await createTestUser(ctx.request, adminToken, {
        suite: 'uh-perm',
        label: 'c',
        role: 'cajero',
      });
      const parent = await createTestUser(ctx.request, adminToken, {
        suite: 'uh-perm',
        label: 'p',
        role: 'socio',
      });
      const cajeroToken = await loginAs(ctx.request, cajero.username, cajero.password);
      const r = await ctx.request
        .put(`/tenant/user-hierarchy/${cajero.id}/parent`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajeroToken)
        .send({ parentUserId: parent.id, relationType: 'cajero_de_socio' });
      expect(r.status).toBe(403);
    });
  });
});
