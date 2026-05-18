/**
 * E2E: Scope de jerarquía en listings de deposits/withdrawals/bonuses.
 *
 * Modelo: socio → distribuidor → cajero → cliente. El que tiene
 * `<entity>.view_all` ve todo; el que solo tiene `<entity>.view` ve
 * solo `[actor.id, ...descendants(actor.id)]`.
 *
 * Setup por test:
 *   - clientA, clientB son usuarios_final del tenant.
 *   - clientA es hijo del cajero1 (en user_hierarchy).
 *   - clientB es independiente (sin parent).
 *   - cajero1 recibe `deposits.view` / `withdrawals.view` / `bonuses.view_any`
 *     via permission_override (rol cajero del seed no tiene esos perms
 *     por default — el admin se los delega per-user).
 *
 * Validaciones:
 *   - admin (con `view_all`) ve los registros de ambos clients.
 *   - cajero1 (sin `view_all`) ve solo los de clientA.
 */

import { sql } from 'drizzle-orm';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { createTestUser } from '../helpers/test-users';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { TEST_TENANT } from '../setup/test-tenant';

describe('Scope filtering en listings (deposits/withdrawals/bonuses)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let cajeroToken: string;
  let cajeroId: string;
  let clientAId: string;
  let clientBId: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
    cajeroToken = await loginAs(
      ctx.request,
      TEST_TENANT.cajero1.username,
      TEST_TENANT.cajero1.password,
    );
    // Resolver cajeroId del seed.
    const cajeroRow = await ctx.tenantDb.execute(
      sql`SELECT id FROM users WHERE username = ${TEST_TENANT.cajero1.username} LIMIT 1`,
    );
    cajeroId = (cajeroRow as unknown as Array<{ id: string }>)[0]!.id;

    // Otorgar al cajero los perms de view (sin view_all).
    for (const perm of [
      'deposits.view',
      'withdrawals.view',
      'bonuses.view_any',
    ]) {
      await ctx.request
        .post('/tenant/permission-overrides/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ userId: cajeroId, permissionCode: perm, reason: 'test setup scope' });
    }

    // Crear clientes.
    const clientA = await createTestUser(ctx.request, adminToken, {
      suite: 'scope',
      label: 'clientA',
      role: 'usuario_final',
    });
    const clientB = await createTestUser(ctx.request, adminToken, {
      suite: 'scope',
      label: 'clientB',
      role: 'usuario_final',
    });
    clientAId = clientA.id;
    clientBId = clientB.id;

    // Asignar clientA al cajero (downstream).
    await ctx.request
      .put(`/tenant/user-hierarchy/${clientAId}/parent`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ parentUserId: cajeroId, relationType: 'jugador_de_cajero' });

    // clientB NO recibe parent — queda fuera del scope del cajero.
  });

  afterAll(async () => {
    await ctx.close();
  });

  /** Helper: inserta payment_method si no existe (uno solo, lo reusamos). */
  async function ensurePaymentMethod(): Promise<string> {
    const existing = await ctx.tenantDb.execute(
      sql`SELECT id FROM payment_methods WHERE code = 'scope_test' LIMIT 1`,
    );
    const rows = existing as unknown as Array<{ id: string }>;
    if (rows[0]) return rows[0].id;
    const inserted = await ctx.tenantDb.execute(
      sql`INSERT INTO payment_methods (id, code, name, type, config, is_active)
          VALUES (gen_random_uuid(), 'scope_test', 'Scope Test', 'bank_transfer', '{}'::jsonb, true)
          RETURNING id`,
    );
    return (inserted as unknown as Array<{ id: string }>)[0]!.id;
  }

  // ──────────────────────────────────────────────────────────────────────
  // DEPOSITS
  // ──────────────────────────────────────────────────────────────────────

  describe('GET /tenant/deposits — scope', () => {
    let depositAId: string;
    let depositBId: string;

    beforeAll(async () => {
      const methodId = await ensurePaymentMethod();
      // Crear deposits via SQL directo (más rápido que login+POST por cada cliente).
      const insA = await ctx.tenantDb.execute(
        sql`INSERT INTO deposits (id, user_id, method_id, amount_fiat, currency_fiat, amount_chips, status)
            VALUES (gen_random_uuid(), ${clientAId}, ${methodId}, '1000', 'ARS', '1000', 'pending')
            RETURNING id`,
      );
      const insB = await ctx.tenantDb.execute(
        sql`INSERT INTO deposits (id, user_id, method_id, amount_fiat, currency_fiat, amount_chips, status)
            VALUES (gen_random_uuid(), ${clientBId}, ${methodId}, '2000', 'ARS', '2000', 'pending')
            RETURNING id`,
      );
      depositAId = (insA as unknown as Array<{ id: string }>)[0]!.id;
      depositBId = (insB as unknown as Array<{ id: string }>)[0]!.id;
    });

    it('admin (con view_all) ve ambos deposits', async () => {
      const res = await ctx.request
        .get('/tenant/deposits')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.status).toBe(200);
      const body = res.body as { data: Array<{ id: string; userId: string }> };
      const ids = body.data.map((d) => d.id);
      expect(ids).toContain(depositAId);
      expect(ids).toContain(depositBId);
    });

    it('cajero1 (solo deposits.view, sin view_all) ve SOLO el de su cliente', async () => {
      const res = await ctx.request
        .get('/tenant/deposits')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajeroToken);
      expect(res.status).toBe(200);
      const body = res.body as { data: Array<{ id: string; userId: string }> };
      const ids = body.data.map((d) => d.id);
      expect(ids).toContain(depositAId);
      expect(ids).not.toContain(depositBId);
      // Todas las filas devueltas tienen que ser del cajero (yo) o de
      // sus descendants. Acá: solo clientA.
      expect(body.data.every((d) => d.userId === clientAId || d.userId === cajeroId)).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // WITHDRAWALS
  // ──────────────────────────────────────────────────────────────────────

  describe('GET /tenant/withdrawals — scope', () => {
    let wA: string;
    let wB: string;

    beforeAll(async () => {
      const methodId = await ensurePaymentMethod();
      const insA = await ctx.tenantDb.execute(
        sql`INSERT INTO withdrawals (id, user_id, method_id, amount_chips, amount_fiat, currency_fiat, target_account, status)
            VALUES (gen_random_uuid(), ${clientAId}, ${methodId}, '500', '500', 'ARS', '{}'::jsonb, 'pending')
            RETURNING id`,
      );
      const insB = await ctx.tenantDb.execute(
        sql`INSERT INTO withdrawals (id, user_id, method_id, amount_chips, amount_fiat, currency_fiat, target_account, status)
            VALUES (gen_random_uuid(), ${clientBId}, ${methodId}, '700', '700', 'ARS', '{}'::jsonb, 'pending')
            RETURNING id`,
      );
      wA = (insA as unknown as Array<{ id: string }>)[0]!.id;
      wB = (insB as unknown as Array<{ id: string }>)[0]!.id;
    });

    it('admin ve ambos retiros', async () => {
      const res = await ctx.request
        .get('/tenant/withdrawals')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.status).toBe(200);
      const body = res.body as { data: Array<{ id: string }> };
      const ids = body.data.map((w) => w.id);
      expect(ids).toContain(wA);
      expect(ids).toContain(wB);
    });

    it('cajero1 ve SOLO el de su cliente', async () => {
      const res = await ctx.request
        .get('/tenant/withdrawals')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajeroToken);
      expect(res.status).toBe(200);
      const body = res.body as { data: Array<{ id: string; userId: string }> };
      const ids = body.data.map((w) => w.id);
      expect(ids).toContain(wA);
      expect(ids).not.toContain(wB);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // BONUSES
  // ──────────────────────────────────────────────────────────────────────

  describe('GET /tenant/bonuses — scope', () => {
    let bonusDefId: string;
    let bA: string;
    let bB: string;

    beforeAll(async () => {
      // Crear bonus_definition de soporte.
      const defRow = await ctx.tenantDb.execute(
        sql`INSERT INTO bonus_definitions (id, code, name, type, status, config, wagering, expiration_days, funded_by_user_id, created_by_user_id)
            VALUES (gen_random_uuid(), 'scope_def', 'Scope Test Def', 'manual', 'active', '{}'::jsonb, '{}'::jsonb, 30,
                    (SELECT id FROM users WHERE username = ${TEST_TENANT.admin.username}),
                    (SELECT id FROM users WHERE username = ${TEST_TENANT.admin.username}))
            RETURNING id`,
      );
      bonusDefId = (defRow as unknown as Array<{ id: string }>)[0]!.id;

      const insA = await ctx.tenantDb.execute(
        sql`INSERT INTO user_bonuses (id, user_id, definition_id, granted_amount, remaining_amount, status, funded_by_user_id, grant_idempotency_key, expires_at)
            VALUES (gen_random_uuid(), ${clientAId}, ${bonusDefId}, '100', '100', 'active',
                    (SELECT id FROM users WHERE username = ${TEST_TENANT.admin.username}),
                    'scope-test-a', NOW() + INTERVAL '30 days')
            RETURNING id`,
      );
      const insB = await ctx.tenantDb.execute(
        sql`INSERT INTO user_bonuses (id, user_id, definition_id, granted_amount, remaining_amount, status, funded_by_user_id, grant_idempotency_key, expires_at)
            VALUES (gen_random_uuid(), ${clientBId}, ${bonusDefId}, '200', '200', 'active',
                    (SELECT id FROM users WHERE username = ${TEST_TENANT.admin.username}),
                    'scope-test-b', NOW() + INTERVAL '30 days')
            RETURNING id`,
      );
      bA = (insA as unknown as Array<{ id: string }>)[0]!.id;
      bB = (insB as unknown as Array<{ id: string }>)[0]!.id;
    });

    it('admin (con view_all) ve ambos bonos', async () => {
      const res = await ctx.request
        .get('/tenant/bonuses')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.status).toBe(200);
      const body = res.body as { data: Array<{ id: string }> };
      const ids = body.data.map((b) => b.id);
      expect(ids).toContain(bA);
      expect(ids).toContain(bB);
    });

    it('cajero1 ve SOLO el de su cliente', async () => {
      const res = await ctx.request
        .get('/tenant/bonuses')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajeroToken);
      expect(res.status).toBe(200);
      const body = res.body as { data: Array<{ id: string; userId: string }> };
      const ids = body.data.map((b) => b.id);
      expect(ids).toContain(bA);
      expect(ids).not.toContain(bB);
    });
  });
});
