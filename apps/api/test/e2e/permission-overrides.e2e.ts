/**
 * E2E: PermissionOverridesController.
 *
 * Cubre el subsistema completo:
 *   - GET /tenant/permission-overrides/user/:userId (lista).
 *   - GET /tenant/permission-overrides/cascade-preview.
 *   - POST grant (con validaciones de techo + is_delegatable + existencia).
 *   - POST revoke (con cascada).
 *   - POST clear (con cascada).
 *   - Cadena admin → cajero1 → cajero2 + cascada elimina downstream.
 *
 * Para validar la "regla de techo", necesitamos un actor que tenga
 * `permissions.grant` pero NO tenga otro permiso específico. Como
 * `permissions.grant` es no-delegable (correcto según docs/03 §7.2),
 * no podemos darlo via endpoint — usamos un helper que inserta el
 * override directo en DB para simular el setup (en producción esto
 * lo haría una UI de gestión de roles).
 */

import postgres from 'postgres';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin, loginAsCajero1 } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser } from '../helpers/test-users';
import { getTestTenantUrl } from '../setup/db-helpers';

/**
 * Inserta directamente en DB un override (bypass del endpoint). Útil
 * para simular escenarios de "user con permissions.grant" que vía
 * endpoint serían rechazados por is_delegatable=false.
 */
async function directInsertOverride(params: {
  userId: string;
  permissionCode: string;
  effect: 'grant' | 'revoke';
  grantedBy: string;
}): Promise<void> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    await sql.unsafe(
      `INSERT INTO user_permission_overrides
       (user_id, permission_code, effect, granted_by, granted_by_chain, reason)
       VALUES ($1, $2, $3, $4, ARRAY[$4]::uuid[], $5)
       ON CONFLICT (user_id, permission_code) DO UPDATE SET effect = EXCLUDED.effect`,
      [params.userId, params.permissionCode, params.effect, params.grantedBy, 'bypass test'],
    );
  } finally {
    await sql.end();
  }
}

/**
 * Verifica via el endpoint público que un user tiene un permiso específico
 * en su effective set. Hace polling corto (max 1s) para tolerar races de
 * commit entre la conexión externa (directInsertOverride) y el pool de
 * la app. Tira si tras retries no aparece.
 */
async function waitForEffectivePermission(
  ctx: TestApp,
  adminBearer: string,
  userId: string,
  expectedPermission: string,
): Promise<void> {
  const maxAttempts = 10;
  const intervalMs = 100;
  for (let i = 0; i < maxAttempts; i++) {
    const res = await ctx.request
      .get(`/tenant/users/${userId}`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminBearer);
    if (res.status === 200) {
      const perms = (res.body as { effectivePermissions: string[] }).effectivePermissions;
      if (perms.includes(expectedPermission)) return;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `waitForEffectivePermission: ${expectedPermission} no apareció en effective set de ${userId} tras ${maxAttempts * intervalMs}ms`,
  );
}

/** Ayuda: lista users del tenant y devuelve mapa username → id. */
async function getUserMap(
  ctx: TestApp,
  token: string,
): Promise<Record<string, string>> {
  const res = await ctx.request
    .get('/tenant/users')
    .set('Host', TEST_TENANT.host)
    .set('Authorization', token);
  const data = (res.body as { data: Array<{ id: string; username: string }> }).data;
  const map: Record<string, string> = {};
  for (const u of data) map[u.username] = u.id;
  return map;
}

describe('PermissionOverridesController (E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let adminId: string;
  let cajero1Id: string;
  let cajero2Id: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
    const users = await getUserMap(ctx, adminToken);
    adminId = users[TEST_TENANT.admin.username]!;
    cajero1Id = users[TEST_TENANT.cajero1.username]!;
    cajero2Id = users[TEST_TENANT.cajero2.username]!;
  });

  afterAll(async () => {
    await ctx.close();
  });

  /**
   * Reset entre describes que comparten estado de overrides.
   * Usamos clear() para no acumular estado entre tests.
   */
  async function clearAllOverridesFor(userIds: string[]): Promise<void> {
    const perms = ['wallet.load', 'wallet.unload', 'wallet.adjust', 'permissions.grant'];
    for (const userId of userIds) {
      for (const permissionCode of perms) {
        await ctx.request
          .post('/tenant/permission-overrides/clear')
          .set('Host', TEST_TENANT.host)
          .set('Authorization', adminToken)
          .send({ userId, permissionCode });
      }
    }
  }

  describe('POST /grant', () => {
    afterEach(async () => {
      await clearAllOverridesFor([cajero1Id, cajero2Id]);
    });

    it('admin otorga permiso delegable → 201 + chain = [admin]', async () => {
      const res = await ctx.request
        .post('/tenant/permission-overrides/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ userId: cajero1Id, permissionCode: 'wallet.load' });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        ok: true,
        effect: 'grant',
        chain: [adminId],
      });
    });

    it('rechaza permission_code inexistente con 400', async () => {
      const res = await ctx.request
        .post('/tenant/permission-overrides/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ userId: cajero1Id, permissionCode: 'no.existe' });

      expect(res.status).toBe(400);
    });

    it('rechaza permiso no-delegable con 403 (wallet.adjust)', async () => {
      const res = await ctx.request
        .post('/tenant/permission-overrides/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ userId: cajero1Id, permissionCode: 'wallet.adjust' });

      expect(res.status).toBe(403);
      expect((res.body as { message: string }).message).toMatch(/no es delegable/);
    });

    it('rechaza permiso no-delegable con 403 (users.impersonate)', async () => {
      const res = await ctx.request
        .post('/tenant/permission-overrides/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ userId: cajero1Id, permissionCode: 'users.impersonate' });

      expect(res.status).toBe(403);
    });

    it('regla de techo: actor con permissions.grant pero sin wallet.unload → 403', async () => {
      // User aislado: cajero fresco que solo este test usa. Evita
      // contaminación con cleanups de otros describes.
      const actor = await createTestUser(ctx.request, adminToken, {
        suite: 'po-techo',
        label: 'a',
        role: 'cajero',
      });
      const target = await createTestUser(ctx.request, adminToken, {
        suite: 'po-techo',
        label: 't',
        role: 'cajero',
      });

      // Bypass: darle permissions.grant al actor directamente en DB
      // (el endpoint lo rechazaría por is_delegatable=false).
      await directInsertOverride({
        userId: actor.id,
        permissionCode: 'permissions.grant',
        effect: 'grant',
        grantedBy: adminId,
      });
      await waitForEffectivePermission(ctx, adminToken, actor.id, 'permissions.grant');

      const actorToken = await loginAs(ctx.request, actor.username, actor.password);
      const res = await ctx.request
        .post('/tenant/permission-overrides/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', actorToken)
        .send({ userId: target.id, permissionCode: 'wallet.unload' });

      expect(res.status).toBe(403);
      expect((res.body as { message: string }).message).toMatch(/no lo tenés/);
    });

    it('cajero1 sin permissions.grant → 403 antes del techo', async () => {
      const cajero1Token = await loginAsCajero1(ctx.request);
      const res = await ctx.request
        .post('/tenant/permission-overrides/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero1Token)
        .send({ userId: cajero2Id, permissionCode: 'wallet.load' });

      expect(res.status).toBe(403);
    });
  });

  describe('Cadena de delegación + cascada', () => {
    /**
     * Helper que arma un escenario completamente aislado de chain de
     * delegación de profundidad 2: ownAdmin → delegator → receiver.
     * Cada llamada crea 3 users con usernames únicos. Cero comparte con
     * el resto de la suite.
     */
    async function buildIsolatedChain(): Promise<{
      ownAdminId: string;
      delegatorId: string;
      receiverId: string;
      ownAdminToken: string;
      delegatorToken: string;
    }> {
      const ownAdmin = await createTestUser(ctx.request, adminToken, {
        suite: 'po-chain',
        label: 'owner',
        role: 'admin_tenant',
      });
      const delegator = await createTestUser(ctx.request, adminToken, {
        suite: 'po-chain',
        label: 'deleg',
        role: 'cajero',
      });
      const receiver = await createTestUser(ctx.request, adminToken, {
        suite: 'po-chain',
        label: 'recv',
        role: 'cajero',
      });
      const ownAdminToken = await loginAs(ctx.request, ownAdmin.username, ownAdmin.password);

      // ownAdmin grant wallet.load al delegator.
      const g = await ctx.request
        .post('/tenant/permission-overrides/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', ownAdminToken)
        .send({ userId: delegator.id, permissionCode: 'wallet.load' });
      expect(g.status).toBe(201);

      // Bypass DB: dar permissions.grant al delegator para que pueda delegar.
      // En producción esto lo haría una UI de roles; via endpoint sería
      // 403 porque permissions.grant es no-delegable.
      await directInsertOverride({
        userId: delegator.id,
        permissionCode: 'permissions.grant',
        effect: 'grant',
        grantedBy: ownAdmin.id,
      });

      // Race guard: esperamos que el effective set del delegator
      // (calculado por la app via su pool) refleje el override que
      // acabamos de insertar desde una conexión externa.
      await waitForEffectivePermission(ctx, adminToken, delegator.id, 'permissions.grant');
      await waitForEffectivePermission(ctx, adminToken, delegator.id, 'wallet.load');

      const delegatorToken = await loginAs(
        ctx.request,
        delegator.username,
        delegator.password,
      );
      return {
        ownAdminId: ownAdmin.id,
        delegatorId: delegator.id,
        receiverId: receiver.id,
        ownAdminToken,
        delegatorToken,
      };
    }

    it('owner → delegator → receiver: chain de profundidad 2 se arma', async () => {
      const s = await buildIsolatedChain();

      const res = await ctx.request
        .post('/tenant/permission-overrides/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', s.delegatorToken)
        .send({ userId: s.receiverId, permissionCode: 'wallet.load' });

      expect(res.status).toBe(201);
      expect((res.body as { chain: string[] }).chain).toEqual([s.ownAdminId, s.delegatorId]);
    });

    it('cascade-preview muestra los downstream sin mutar', async () => {
      const s = await buildIsolatedChain();

      // Delegator grant wallet.load al receiver.
      await ctx.request
        .post('/tenant/permission-overrides/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', s.delegatorToken)
        .send({ userId: s.receiverId, permissionCode: 'wallet.load' });

      const preview = await ctx.request
        .get('/tenant/permission-overrides/cascade-preview')
        .query({ userId: s.ownAdminId, permissionCode: 'wallet.load' })
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      expect(preview.status).toBe(200);
      const body = preview.body as {
        count: number;
        affected: Array<{ userId: string }>;
      };
      // Exactamente 2 downstream: delegator + receiver. Sin contaminación
      // posible porque ownAdmin es un user fresco que solo este test usó.
      expect(body.count).toBe(2);
      const ids = body.affected.map((a) => a.userId);
      expect(ids).toContain(s.delegatorId);
      expect(ids).toContain(s.receiverId);
    });

    it('clear sobre delegator cascadea receiver', async () => {
      const s = await buildIsolatedChain();
      await ctx.request
        .post('/tenant/permission-overrides/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', s.delegatorToken)
        .send({ userId: s.receiverId, permissionCode: 'wallet.load' });

      const cleared = await ctx.request
        .post('/tenant/permission-overrides/clear')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ userId: s.delegatorId, permissionCode: 'wallet.load' });

      expect(cleared.status).toBe(200);
      expect((cleared.body as { cascadedCount: number }).cascadedCount).toBe(1);

      const receiverOverrides = await ctx.request
        .get(`/tenant/permission-overrides/user/${s.receiverId}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const codes = (
        receiverOverrides.body as { overrides: Array<{ permissionCode: string }> }
      ).overrides.map((o) => o.permissionCode);
      expect(codes).not.toContain('wallet.load');
    });

    it('revoke explícito sobre delegator también cascadea', async () => {
      const s = await buildIsolatedChain();
      const dlgGrant = await ctx.request
        .post('/tenant/permission-overrides/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', s.delegatorToken)
        .send({ userId: s.receiverId, permissionCode: 'wallet.load' });
      expect(dlgGrant.status).toBe(201);
      // Sanity check: la chain del nuevo override incluye delegator.
      expect((dlgGrant.body as { chain: string[] }).chain).toContain(s.delegatorId);

      const revoked = await ctx.request
        .post('/tenant/permission-overrides/revoke')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          userId: s.delegatorId,
          permissionCode: 'wallet.load',
          reason: 'test cascade revoke',
        });

      expect(revoked.status).toBe(201);
      expect((revoked.body as { cascadedCount: number }).cascadedCount).toBe(1);
    });
  });

  describe('GET /user/:userId (listar overrides)', () => {
    afterEach(async () => {
      await clearAllOverridesFor([cajero1Id, cajero2Id]);
    });

    it('lista los overrides del user, ordenados por permissionCode', async () => {
      // User fresco → count exacto, sin contaminación de otras suites/tests.
      const target = await createTestUser(ctx.request, adminToken, {
        suite: 'po-list',
        label: 'tgt',
        role: 'cajero',
      });
      await ctx.request
        .post('/tenant/permission-overrides/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ userId: target.id, permissionCode: 'wallet.load' });
      await ctx.request
        .post('/tenant/permission-overrides/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ userId: target.id, permissionCode: 'wallet.unload' });

      const res = await ctx.request
        .get(`/tenant/permission-overrides/user/${target.id}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      expect(res.status).toBe(200);
      const body = res.body as {
        count: number;
        overrides: Array<{ permissionCode: string }>;
      };
      expect(body.count).toBe(2);
      expect(body.overrides[0]?.permissionCode).toBe('wallet.load');
      expect(body.overrides[1]?.permissionCode).toBe('wallet.unload');
    });
  });

  describe('GET /catalog (listar permisos disponibles)', () => {
    it('admin → 200 con lista ordenada por category, code + flags isDelegatable/auditRequired', async () => {
      const res = await ctx.request
        .get('/tenant/permission-overrides/catalog')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.status).toBe(200);
      const body = res.body as {
        count: number;
        data: Array<{
          code: string;
          category: string | null;
          description: string | null;
          isDelegatable: boolean;
          auditRequired: boolean;
        }>;
      };
      expect(body.count).toBeGreaterThan(20);
      expect(body.data.length).toBe(body.count);

      // Algunos perms canónicos deben estar.
      const codes = body.data.map((p) => p.code);
      expect(codes).toContain('wallet.load');
      expect(codes).toContain('users.view_any');
      expect(codes).toContain('audit.export');

      // Flag isDelegatable es honesto: wallet.adjust NO es delegable.
      const adjust = body.data.find((p) => p.code === 'wallet.adjust');
      expect(adjust).toBeDefined();
      expect(adjust!.isDelegatable).toBe(false);

      // wallet.load SÍ es delegable.
      const load = body.data.find((p) => p.code === 'wallet.load');
      expect(load!.isDelegatable).toBe(true);
      expect(load!.auditRequired).toBe(true);

      // Sort: dentro de cada category, codes ascendentes.
      // Tomamos las del category 'wallet' y verificamos orden ASC.
      const walletPerms = body.data.filter((p) => p.category === 'wallet');
      const walletCodes = walletPerms.map((p) => p.code);
      const sortedWallet = [...walletCodes].sort();
      expect(walletCodes).toEqual(sortedWallet);
    });

    it('cajero1 sin users.view_any → 403', async () => {
      const cajeroToken = await loginAsCajero1(ctx.request);
      const res = await ctx.request
        .get('/tenant/permission-overrides/catalog')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajeroToken);
      expect(res.status).toBe(403);
    });
  });

  describe('Hardening: audit enrichment', () => {
    it('revoke de permiso NO-delegable marca severity:high en audit', async () => {
      const target = await createTestUser(ctx.request, adminToken, {
        suite: 'po-sev',
        label: 'tgt',
        role: 'cajero',
      });
      // Damos un grant primero (delegable) para que el revoke tenga qué tocar.
      await ctx.request
        .post('/tenant/permission-overrides/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ userId: target.id, permissionCode: 'wallet.load' });

      // Revoke de un no-delegable.
      const r = await ctx.request
        .post('/tenant/permission-overrides/revoke')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          userId: target.id,
          permissionCode: 'wallet.adjust',
          reason: 'revoke sensible para testing',
        });
      expect(r.status).toBe(201);
      expect((r.body as { severity: string }).severity).toBe('high');

      const audit = await ctx.request
        .get(`/tenant/audit-log?targetId=${target.id}&actionCode=permissions.revoke`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const entries = (audit.body as { entries: Array<Record<string, unknown>> }).entries;
      expect(entries.length).toBeGreaterThan(0);
      const meta = entries[0]!.metadata as { severity: string; sensitive: boolean };
      expect(meta.severity).toBe('high');
      expect(meta.sensitive).toBe(true);
    });

    it('actor_role_at_time se popula en audit_log (admin → admin_tenant)', async () => {
      // El admin del seed tiene rol admin_tenant — verificamos que el audit
      // de un grant tiene actor_role_at_time = 'admin_tenant'.
      const target = await createTestUser(ctx.request, adminToken, {
        suite: 'po-role',
        label: 'tgt',
        role: 'cajero',
      });
      await ctx.request
        .post('/tenant/permission-overrides/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ userId: target.id, permissionCode: 'wallet.load' });

      const audit = await ctx.request
        .get(`/tenant/audit-log?targetId=${target.id}&actionCode=permissions.grant`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const entries = (audit.body as { entries: Array<Record<string, unknown>> }).entries;
      expect(entries.length).toBeGreaterThan(0);
      expect(entries[0]!.actorRoleAtTime).toBe('admin_tenant');
    });
  });

  describe('Aislamiento de permisos', () => {
    it('cajero1 sin audit.view → 403 al consultar audit-log', async () => {
      const cajero1Token = await loginAsCajero1(ctx.request);
      const res = await ctx.request
        .get('/tenant/audit-log')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero1Token);

      expect(res.status).toBe(403);
    });
  });
});
