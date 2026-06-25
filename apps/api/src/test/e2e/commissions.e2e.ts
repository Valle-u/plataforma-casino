/**
 * E2E: CommissionsController.
 *
 * Cubre:
 *   - Rules CRUD (admin con commissions.configure).
 *   - Conflict 409 al duplicar (role, event_type).
 *   - listRules sin perm extra (cualquier user logueado).
 *   - listPayouts con scope (admin ve todo, cajero solo lo suyo).
 *   - preview compute: walk de ancestors + match de rules + suma 2 roles +
 *     skip si amount = 0 + skip si no hay ancestors.
 *
 * Sprint 24: solo CRUD + compute. El apply automático (hook en
 * deposits.approve / withdrawals.markPaid) es Sprint 25 — acá NO se
 * persisten payouts, los preview son in-memory.
 */

import { sql } from 'drizzle-orm';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { createTestUser } from '../helpers/test-users';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { TEST_TENANT } from '../setup/test-tenant';

describe('CommissionsController (E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let cajeroToken: string;
  let cajeroId: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
    cajeroToken = await loginAs(
      ctx.request,
      TEST_TENANT.cajero1.username,
      TEST_TENANT.cajero1.password,
    );
    const cajeroRow = await ctx.tenantDb.execute(
      sql`SELECT id FROM users WHERE username = ${TEST_TENANT.cajero1.username} LIMIT 1`,
    );
    cajeroId = (cajeroRow as unknown as Array<{ id: string }>)[0]!.id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    // Limpieza entre tests para asegurar aislamiento.
    await ctx.tenantDb.execute(sql`DELETE FROM commission_payouts`);
    await ctx.tenantDb.execute(sql`DELETE FROM commission_rules`);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Rules CRUD
  // ──────────────────────────────────────────────────────────────────────

  describe('GET /tenant/commissions/rules', () => {
    it('sin JWT → 401', async () => {
      const res = await ctx.request
        .get('/tenant/commissions/rules')
        .set('Host', TEST_TENANT.host);
      expect(res.status).toBe(401);
    });

    it('cualquier user logueado puede listar reglas', async () => {
      const res = await ctx.request
        .get('/tenant/commissions/rules')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajeroToken);
      expect(res.status).toBe(200);
      expect(Array.isArray((res.body as { data: unknown[] }).data)).toBe(true);
    });

    it('filtra por eventType + activeOnly', async () => {
      // Crear 3 rules: 2 deposit (1 active, 1 inactive) + 1 withdrawal active.
      await ctx.request
        .post('/tenant/commissions/rules')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ role: 'cajero', eventType: 'deposit_approved', pct: '5.00' });
      await ctx.request
        .post('/tenant/commissions/rules')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          role: 'socio',
          eventType: 'deposit_approved',
          pct: '2.00',
          active: false,
        });
      await ctx.request
        .post('/tenant/commissions/rules')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ role: 'cajero', eventType: 'withdrawal_paid', pct: '1.00' });

      const res = await ctx.request
        .get('/tenant/commissions/rules')
        .query({ eventType: 'deposit_approved', activeOnly: 'true' })
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.status).toBe(200);
      const body = res.body as {
        data: Array<{ role: string; eventType: string; active: boolean }>;
      };
      expect(body.data.length).toBe(1);
      expect(body.data[0]!.role).toBe('cajero');
      expect(body.data[0]!.active).toBe(true);
    });
  });

  describe('POST /tenant/commissions/rules', () => {
    it('admin crea regla → 201', async () => {
      const res = await ctx.request
        .post('/tenant/commissions/rules')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          role: 'cajero',
          eventType: 'deposit_approved',
          pct: '5.00',
          notes: 'MVP cajero 5%',
        });
      expect(res.status).toBe(201);
      const body = res.body as {
        id: string;
        role: string;
        eventType: string;
        pct: string;
        active: boolean;
      };
      expect(body.id).toBeDefined();
      expect(body.role).toBe('cajero');
      expect(body.eventType).toBe('deposit_approved');
      expect(body.pct).toBe('5.00');
      expect(body.active).toBe(true);
    });

    it('cajero sin commissions.configure → 403', async () => {
      const res = await ctx.request
        .post('/tenant/commissions/rules')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajeroToken)
        .send({ role: 'cajero', eventType: 'deposit_approved', pct: '5.00' });
      expect(res.status).toBe(403);
    });

    it('duplicado (role, eventType) → 409', async () => {
      await ctx.request
        .post('/tenant/commissions/rules')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ role: 'socio', eventType: 'deposit_approved', pct: '3.00' });
      const res = await ctx.request
        .post('/tenant/commissions/rules')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ role: 'socio', eventType: 'deposit_approved', pct: '4.00' });
      expect(res.status).toBe(409);
      expect((res.body as { error: string }).error).toBe(
        'COMMISSION_RULE_CONFLICT',
      );
    });

    it('rechaza pct fuera de rango → 400', async () => {
      const res = await ctx.request
        .post('/tenant/commissions/rules')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ role: 'cajero', eventType: 'deposit_approved', pct: '150.00' });
      expect(res.status).toBe(400);
    });

    it('rechaza eventType desconocido → 400', async () => {
      const res = await ctx.request
        .post('/tenant/commissions/rules')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ role: 'cajero', eventType: 'unknown_event', pct: '5.00' });
      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /tenant/commissions/rules/:id', () => {
    it('admin actualiza pct + active', async () => {
      const created = await ctx.request
        .post('/tenant/commissions/rules')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ role: 'cajero', eventType: 'deposit_approved', pct: '5.00' });
      const id = (created.body as { id: string }).id;

      const res = await ctx.request
        .patch(`/tenant/commissions/rules/${id}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ pct: '7.50', active: false });
      expect(res.status).toBe(200);
      const body = res.body as { pct: string; active: boolean };
      expect(body.pct).toBe('7.50');
      expect(body.active).toBe(false);
    });

    it('404 si id no existe', async () => {
      const res = await ctx.request
        .patch(`/tenant/commissions/rules/00000000-0000-0000-0000-000000000000`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ pct: '1.00' });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /tenant/commissions/rules/:id/archive', () => {
    it('admin archiva (active=false) idempotente', async () => {
      const created = await ctx.request
        .post('/tenant/commissions/rules')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ role: 'cajero', eventType: 'deposit_approved', pct: '5.00' });
      const id = (created.body as { id: string }).id;

      const r1 = await ctx.request
        .post(`/tenant/commissions/rules/${id}/archive`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(r1.status).toBe(200);
      expect((r1.body as { active: boolean }).active).toBe(false);

      const r2 = await ctx.request
        .post(`/tenant/commissions/rules/${id}/archive`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(r2.status).toBe(200);
      expect((r2.body as { active: boolean }).active).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Preview compute
  // ──────────────────────────────────────────────────────────────────────

  describe('POST /tenant/commissions/preview', () => {
    let clientId: string;

    beforeEach(async () => {
      // Setup base: rule cajero 5% + jugador asignado al cajero1.
      await ctx.request
        .post('/tenant/commissions/rules')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ role: 'cajero', eventType: 'deposit_approved', pct: '5.00' });

      const client = await createTestUser(ctx.request, adminToken, {
        suite: 'commissions',
        label: 'preview_client',
        role: 'usuario_final',
      });
      clientId = client.id;
      await ctx.request
        .put(`/tenant/user-hierarchy/${clientId}/parent`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ parentUserId: cajeroId, relationType: 'jugador_de_cajero' });
    });

    it('calcula payout para cajero ancestor (5% de 1000 = 50.00)', async () => {
      const res = await ctx.request
        .post('/tenant/commissions/preview')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          eventType: 'deposit_approved',
          sourceUserId: clientId,
          sourceAmount: '1000',
        });
      expect(res.status).toBe(200);
      const body = res.body as {
        plan: Array<{
          beneficiaryUserId: string;
          beneficiaryRoleAtTime: string;
          pct: string;
          payoutAmount: string;
        }>;
        summary: {
          beneficiaries: number;
          sourceAmount: string;
          totalPayout: string;
          tenantKeeps: string;
        };
      };
      expect(body.plan.length).toBe(1);
      expect(body.plan[0]!.beneficiaryUserId).toBe(cajeroId);
      expect(body.plan[0]!.beneficiaryRoleAtTime).toBe('cajero');
      expect(body.plan[0]!.payoutAmount).toBe('50.00');
      expect(body.summary.beneficiaries).toBe(1);
      expect(body.summary.totalPayout).toBe('50.00');
      expect(body.summary.tenantKeeps).toBe('950.00');
    });

    it('sourceAmount = 0 → plan vacío', async () => {
      const res = await ctx.request
        .post('/tenant/commissions/preview')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          eventType: 'deposit_approved',
          sourceUserId: clientId,
          sourceAmount: '0',
        });
      expect(res.status).toBe(200);
      const body = res.body as { plan: unknown[] };
      expect(body.plan.length).toBe(0);
    });

    it('user sin ancestors → plan vacío', async () => {
      const orphan = await createTestUser(ctx.request, adminToken, {
        suite: 'commissions',
        label: 'orphan',
        role: 'usuario_final',
      });
      const res = await ctx.request
        .post('/tenant/commissions/preview')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          eventType: 'deposit_approved',
          sourceUserId: orphan.id,
          sourceAmount: '500',
        });
      expect(res.status).toBe(200);
      const body = res.body as { plan: unknown[] };
      expect(body.plan.length).toBe(0);
    });

    it('eventType sin rules → plan vacío', async () => {
      const res = await ctx.request
        .post('/tenant/commissions/preview')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          eventType: 'withdrawal_paid', // no hay rule activa para esto
          sourceUserId: clientId,
          sourceAmount: '1000',
        });
      expect(res.status).toBe(200);
      const body = res.body as { plan: unknown[] };
      expect(body.plan.length).toBe(0);
    });

    it('cajero sin commissions.configure → 403', async () => {
      const res = await ctx.request
        .post('/tenant/commissions/preview')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajeroToken)
        .send({
          eventType: 'deposit_approved',
          sourceUserId: clientId,
          sourceAmount: '1000',
        });
      expect(res.status).toBe(403);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Payouts list (scope)
  // ──────────────────────────────────────────────────────────────────────

  describe('GET /tenant/commissions/payouts', () => {
    let clientAId: string;
    let clientBId: string;
    let payoutCajeroId: string;
    let payoutOtherId: string;

    beforeEach(async () => {
      // Setup: 2 users finales. clientA asignado a cajero1, clientB
      // independiente. Insertamos 2 payouts directo en DB:
      //   - 1 para cajero1 (beneficiario del payout) por evento sobre clientA.
      //   - 1 para un "otro user" (admin) por evento sobre clientB.
      // Cajero1 con commissions.view + sin view_all → solo ve el suyo.
      const clientA = await createTestUser(ctx.request, adminToken, {
        suite: 'commissions',
        label: 'payouts_a',
        role: 'usuario_final',
      });
      const clientB = await createTestUser(ctx.request, adminToken, {
        suite: 'commissions',
        label: 'payouts_b',
        role: 'usuario_final',
      });
      clientAId = clientA.id;
      clientBId = clientB.id;

      await ctx.request
        .put(`/tenant/user-hierarchy/${clientAId}/parent`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ parentUserId: cajeroId, relationType: 'jugador_de_cajero' });

      // Crear una rule (necesaria por FK).
      const ruleRes = await ctx.request
        .post('/tenant/commissions/rules')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ role: 'cajero', eventType: 'deposit_approved', pct: '5.00' });
      const ruleId = (ruleRes.body as { id: string }).id;

      const adminRow = await ctx.tenantDb.execute(
        sql`SELECT id FROM users WHERE username = ${TEST_TENANT.admin.username} LIMIT 1`,
      );
      const adminId = (adminRow as unknown as Array<{ id: string }>)[0]!.id;

      // El schema NO tiene source_user_id (denormalización innecesaria —
      // joinear con deposits/withdrawals usando source_event_id si hace falta).
      // Marcamos los IDs para confirmar de qué eran clientA/clientB en asserts.
      void clientAId;
      void clientBId;
      void adminId;
      const ins1 = await ctx.tenantDb.execute(
        sql`INSERT INTO commission_payouts
            (id, beneficiary_user_id, beneficiary_role_at_time, rule_id, pct, source_event_type, source_event_id, source_amount, payout_amount, status)
            VALUES (gen_random_uuid(), ${cajeroId}, 'cajero', ${ruleId}, '5.00', 'deposit_approved', gen_random_uuid(), '1000', '50.00', 'paid')
            RETURNING id`,
      );
      const ins2 = await ctx.tenantDb.execute(
        sql`INSERT INTO commission_payouts
            (id, beneficiary_user_id, beneficiary_role_at_time, rule_id, pct, source_event_type, source_event_id, source_amount, payout_amount, status)
            VALUES (gen_random_uuid(), ${adminId}, 'admin', ${ruleId}, '5.00', 'deposit_approved', gen_random_uuid(), '2000', '100.00', 'paid')
            RETURNING id`,
      );
      payoutCajeroId = (ins1 as unknown as Array<{ id: string }>)[0]!.id;
      payoutOtherId = (ins2 as unknown as Array<{ id: string }>)[0]!.id;

      // Otorgar commissions.view al cajero (sin view_all).
      await ctx.request
        .post('/tenant/permission-overrides/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          userId: cajeroId,
          permissionCode: 'commissions.view',
          reason: 'test setup commissions scope',
        });
    });

    it('admin (con view_all implícito) ve ambos payouts', async () => {
      const res = await ctx.request
        .get('/tenant/commissions/payouts')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.status).toBe(200);
      const body = res.body as { data: Array<{ id: string }>; total: number };
      const ids = body.data.map((p) => p.id);
      expect(ids).toContain(payoutCajeroId);
      expect(ids).toContain(payoutOtherId);
    });

    it('cajero (solo commissions.view) ve SOLO sus propios payouts', async () => {
      const res = await ctx.request
        .get('/tenant/commissions/payouts')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajeroToken);
      expect(res.status).toBe(200);
      const body = res.body as {
        data: Array<{ id: string; beneficiaryUserId: string }>;
      };
      const ids = body.data.map((p) => p.id);
      expect(ids).toContain(payoutCajeroId);
      expect(ids).not.toContain(payoutOtherId);
      expect(
        body.data.every((p) => p.beneficiaryUserId === cajeroId),
      ).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // GET /stats (Sprint 32) — widget del dashboard
  // ──────────────────────────────────────────────────────────────────────

  describe('GET /tenant/commissions/stats', () => {
    beforeEach(async () => {
      // Re-otorgamos commissions.view al cajero (el otro describe
      // limpia rules pero los overrides persisten — defensa).
      await ctx.request
        .post('/tenant/permission-overrides/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          userId: cajeroId,
          permissionCode: 'commissions.view',
          reason: 'test stats endpoint',
        });
    });

    it('admin con view_all recibe tenantTotal', async () => {
      // Seed: 2 payouts paid de hoy.
      const ruleRes = await ctx.request
        .post('/tenant/commissions/rules')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ role: 'cajero', eventType: 'deposit_approved', pct: '5.00' });
      const ruleId = (ruleRes.body as { id: string }).id;
      await ctx.tenantDb.execute(
        sql`INSERT INTO commission_payouts
            (id, beneficiary_user_id, beneficiary_role_at_time, rule_id, pct, source_event_type, source_event_id, source_amount, payout_amount, status)
            VALUES (gen_random_uuid(), ${cajeroId}, 'cajero', ${ruleId}, '5.00', 'deposit_approved', gen_random_uuid(), '1000', '50.00', 'paid'),
                   (gen_random_uuid(), ${cajeroId}, 'cajero', ${ruleId}, '5.00', 'deposit_approved', gen_random_uuid(), '2000', '100.00', 'paid')`,
      );

      const res = await ctx.request
        .get('/tenant/commissions/stats')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.status).toBe(200);
      const body = res.body as {
        earnedByMe: { today: string; last7d: string; last30d: string };
        earnedByTeam: { today: string };
        tenantTotal: { today: string } | null;
      };
      expect(body.tenantTotal).not.toBeNull();
      expect(Number(body.tenantTotal!.today)).toBeCloseTo(150, 2);
      // Admin no es beneficiary del payout (cajeroId lo es) → earnedByMe = 0.
      expect(Number(body.earnedByMe.today)).toBeCloseTo(0, 2);
    });

    it('cajero (sin view_all) recibe earnedByMe = 150 y tenantTotal = null', async () => {
      const ruleRes = await ctx.request
        .post('/tenant/commissions/rules')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ role: 'cajero', eventType: 'deposit_approved', pct: '5.00' });
      const ruleId = (ruleRes.body as { id: string }).id;
      await ctx.tenantDb.execute(
        sql`INSERT INTO commission_payouts
            (id, beneficiary_user_id, beneficiary_role_at_time, rule_id, pct, source_event_type, source_event_id, source_amount, payout_amount, status)
            VALUES (gen_random_uuid(), ${cajeroId}, 'cajero', ${ruleId}, '5.00', 'deposit_approved', gen_random_uuid(), '1000', '50.00', 'paid'),
                   (gen_random_uuid(), ${cajeroId}, 'cajero', ${ruleId}, '5.00', 'deposit_approved', gen_random_uuid(), '2000', '100.00', 'paid')`,
      );

      const res = await ctx.request
        .get('/tenant/commissions/stats')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajeroToken);
      expect(res.status).toBe(200);
      const body = res.body as {
        earnedByMe: { today: string };
        tenantTotal: unknown;
      };
      expect(body.tenantTotal).toBeNull();
      expect(Number(body.earnedByMe.today)).toBeCloseTo(150, 2);
    });

    it('sólo cuenta payouts con status=paid (pending/failed/refunded ignorados)', async () => {
      const ruleRes = await ctx.request
        .post('/tenant/commissions/rules')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ role: 'cajero', eventType: 'deposit_approved', pct: '5.00' });
      const ruleId = (ruleRes.body as { id: string }).id;
      await ctx.tenantDb.execute(
        sql`INSERT INTO commission_payouts
            (id, beneficiary_user_id, beneficiary_role_at_time, rule_id, pct, source_event_type, source_event_id, source_amount, payout_amount, status)
            VALUES (gen_random_uuid(), ${cajeroId}, 'cajero', ${ruleId}, '5.00', 'deposit_approved', gen_random_uuid(), '1000', '50.00', 'paid'),
                   (gen_random_uuid(), ${cajeroId}, 'cajero', ${ruleId}, '5.00', 'deposit_approved', gen_random_uuid(), '1000', '50.00', 'pending'),
                   (gen_random_uuid(), ${cajeroId}, 'cajero', ${ruleId}, '5.00', 'deposit_approved', gen_random_uuid(), '1000', '50.00', 'failed')`,
      );

      const res = await ctx.request
        .get('/tenant/commissions/stats')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajeroToken);
      expect(res.status).toBe(200);
      const body = res.body as { earnedByMe: { today: string } };
      // Solo 1 payout paid → 50, no 150.
      expect(Number(body.earnedByMe.today)).toBeCloseTo(50, 2);
    });

    it('sin commissions.view → 403', async () => {
      // Un user nuevo sin overrides.
      const noPerm = await createTestUser(ctx.request, adminToken, {
        suite: 'commissions',
        label: 'stats_noperm',
        role: 'usuario_final',
      });
      const noPermToken = await loginAs(
        ctx.request,
        noPerm.username,
        noPerm.password,
      );
      const res = await ctx.request
        .get('/tenant/commissions/stats')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', noPermToken);
      expect(res.status).toBe(403);
    });
  });
});
