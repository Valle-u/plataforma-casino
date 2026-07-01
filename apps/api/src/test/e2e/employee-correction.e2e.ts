/**
 * E2E: EmployeeCorrection (docs/19).
 *
 * Cubre:
 *   - GET  /tenant/correction/status  — cupo del actor.
 *   - POST /tenant/correction         — aplica una corrección (Casa → cliente).
 *   - PATCH /tenant/correction/user/:userId/cap — admin fija el cupo.
 *
 * Casos:
 *   1. Validación DTO (amount 0/neg/>2dec, reasonType inválido, targetUserId
 *      no UUID) → 400.
 *   2. Acceso: sin permiso wallet.correct → 403.
 *   3. Sin cupo (0) → 403 NO_CAP_CONFIGURED.
 *   4. Cupo excedido → 409 EMPLOYEE_CAP_EXCEEDED (con cap/used/remaining/requested).
 *   5. Target = actor → 400 INVALID_CORRECTION_TARGET.
 *   6. Target = Casa → 400 INVALID_CORRECTION_TARGET.
 *   7. Motivo 'other' sin notes → 400.
 *   8. Funcional: aplica corrección → cliente sube exact, Casa baja exact,
 *      wallet_tx source='employee_correction', audit severity high, cupo
 *      restante correcto.
 *   9. Múltiples correcciones dentro del cupo cuadran (suma del mes).
 *  10. PATCH cupo: admin fija, sube y baja; audit registra.
 */

import { sql } from 'drizzle-orm';
import { TEST_TENANT } from '../setup/test-tenant';
import {
  loginAs,
  loginAsAdmin,
  loginAsCajero1,
} from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser } from '../helpers/test-users';

interface CorrectionStatus {
  cap: string;
  used: string;
  remaining: string;
}

interface CorrectionResponse {
  transaction: { id: string; type: string; amount: string; balanceAfter: string };
  status: CorrectionStatus;
}

async function getWalletBalance(
  ctx: TestApp,
  userId: string,
): Promise<string> {
  const r = await ctx.tenantDb.execute(
    sql`SELECT balance FROM wallets WHERE user_id = ${userId} LIMIT 1`,
  );
  const rows = r as unknown as Array<{ balance: string }>;
  return rows[0]?.balance ?? '0';
}

async function getHouseBalance(ctx: TestApp): Promise<string> {
  const r = await ctx.tenantDb.execute(
    sql`SELECT w.balance FROM wallets w
        JOIN users u ON u.id = w.user_id
        WHERE u.username = '__casa__' LIMIT 1`,
  );
  const rows = r as unknown as Array<{ balance: string }>;
  return rows[0]!.balance;
}

async function getHouseUserId(ctx: TestApp): Promise<string> {
  const r = await ctx.tenantDb.execute(
    sql`SELECT id FROM users WHERE username = '__casa__' LIMIT 1`,
  );
  const rows = r as unknown as Array<{ id: string }>;
  return rows[0]!.id;
}

async function setCap(
  ctx: TestApp,
  adminToken: string,
  userId: string,
  cap: string,
): Promise<void> {
  const r = await ctx.request
    .patch(`/tenant/correction/user/${userId}/cap`)
    .set('Host', TEST_TENANT.host)
    .set('Authorization', adminToken)
    .send({ cap });
  expect(r.status).toBe(200);
}

async function grantOverride(
  ctx: TestApp,
  adminToken: string,
  userId: string,
  permission: string,
): Promise<void> {
  const r = await ctx.request
    .post('/tenant/permission-overrides/grant')
    .set('Host', TEST_TENANT.host)
    .set('Authorization', adminToken)
    .send({ userId, permissionCode: permission, reason: 'e2e test' });
  expect([200, 201]).toContain(r.status);
}

describe('EmployeeCorrection (E2E)', () => {
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

  beforeEach(async () => {
    // Fondear la Casa con presupuesto suficiente para todos los tests.
    await ctx.tenantDb.execute(sql`
      DELETE FROM house_capital_injections;
    `);
    await ctx.tenantDb.execute(sql`
      DELETE FROM wallet_transactions
      WHERE source IN ('house_budget', 'house_capital', 'employee_correction');
    `);
    await ctx.tenantDb.execute(sql`
      UPDATE wallets SET balance = '1000000'
      WHERE user_id = (SELECT id FROM users WHERE username = '__casa__');
    `);
  });

  describe('validaciones', () => {
    const bad: Array<[string, Record<string, unknown>]> = [
      [
        'amount = 0',
        {
          targetUserId: '00000000-0000-0000-0000-000000000000',
          amount: '0',
          reasonType: 'correction',
        },
      ],
      [
        'amount negativo',
        {
          targetUserId: '00000000-0000-0000-0000-000000000000',
          amount: '-100',
          reasonType: 'correction',
        },
      ],
      [
        'amount > 2 decimales',
        {
          targetUserId: '00000000-0000-0000-0000-000000000000',
          amount: '100.123',
          reasonType: 'correction',
        },
      ],
      [
        'reasonType inválido',
        {
          targetUserId: '00000000-0000-0000-0000-000000000000',
          amount: '100',
          reasonType: 'random',
        },
      ],
      [
        'targetUserId no UUID',
        {
          targetUserId: 'not-a-uuid',
          amount: '100',
          reasonType: 'correction',
        },
      ],
    ];
    it.each(bad)('400 si %s', async (_label, body) => {
      const r = await ctx.request
        .post('/tenant/correction')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send(body);
      expect(r.status).toBe(400);
    });
  });

  describe('acceso', () => {
    it('403 si cajero1 (sin wallet.correct) intenta aplicar', async () => {
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'corr-403',
        label: 'p',
        role: 'usuario_final',
      });
      const r = await ctx.request
        .post('/tenant/correction')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero1Token)
        .send({
          targetUserId: player.id,
          amount: '100',
          reasonType: 'correction',
        });
      expect(r.status).toBe(403);
    });
  });

  describe('cupo', () => {
    it('403 NO_CAP_CONFIGURED si el empleado tiene cap=0', async () => {
      // Crear un empleado con permiso wallet.correct pero cupo 0.
      const emp = await createTestUser(ctx.request, adminToken, {
        suite: 'corr-nocap',
        label: 'emp',
        role: 'empleado',
      });
      await grantOverride(ctx, adminToken, emp.id, 'wallet.correct');
      const empToken = await loginAs(ctx.request, emp.username, emp.password);

      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'corr-nocap',
        label: 'p',
        role: 'usuario_final',
      });

      const r = await ctx.request
        .post('/tenant/correction')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', empToken)
        .send({
          targetUserId: player.id,
          amount: '100',
          reasonType: 'correction',
        });
      expect(r.status).toBe(403);
      expect((r.body as { error: string }).error).toBe('NO_CAP_CONFIGURED');
    });

    it('409 EMPLOYEE_CAP_EXCEEDED si supera el cupo', async () => {
      const emp = await createTestUser(ctx.request, adminToken, {
        suite: 'corr-exc',
        label: 'emp',
        role: 'empleado',
      });
      await grantOverride(ctx, adminToken, emp.id, 'wallet.correct');
      await setCap(ctx, adminToken, emp.id, '500');
      const empToken = await loginAs(ctx.request, emp.username, emp.password);

      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'corr-exc',
        label: 'p',
        role: 'usuario_final',
      });

      const r = await ctx.request
        .post('/tenant/correction')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', empToken)
        .send({
          targetUserId: player.id,
          amount: '600',
          reasonType: 'correction',
        });
      expect(r.status).toBe(409);
      const body = r.body as {
        error: string;
        cap: string;
        used: string;
        remaining: string;
        requested: string;
      };
      expect(body.error).toBe('EMPLOYEE_CAP_EXCEEDED');
      expect(body.cap).toBe('500.00');
      expect(body.remaining).toBe('500.00');
      expect(body.requested).toBe('600');
    });
  });

  describe('target válido', () => {
    it('400 si target = actor', async () => {
      const emp = await createTestUser(ctx.request, adminToken, {
        suite: 'corr-self',
        label: 'emp',
        role: 'empleado',
      });
      await grantOverride(ctx, adminToken, emp.id, 'wallet.correct');
      await setCap(ctx, adminToken, emp.id, '1000');
      const empToken = await loginAs(ctx.request, emp.username, emp.password);

      const r = await ctx.request
        .post('/tenant/correction')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', empToken)
        .send({
          targetUserId: emp.id,
          amount: '100',
          reasonType: 'correction',
        });
      expect(r.status).toBe(400);
      expect((r.body as { error: string }).error).toBe(
        'INVALID_CORRECTION_TARGET',
      );
    });

    it('400 si target = Casa', async () => {
      const emp = await createTestUser(ctx.request, adminToken, {
        suite: 'corr-house',
        label: 'emp',
        role: 'empleado',
      });
      await grantOverride(ctx, adminToken, emp.id, 'wallet.correct');
      await setCap(ctx, adminToken, emp.id, '1000');
      const empToken = await loginAs(ctx.request, emp.username, emp.password);

      const houseId = await getHouseUserId(ctx);
      const r = await ctx.request
        .post('/tenant/correction')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', empToken)
        .send({
          targetUserId: houseId,
          amount: '100',
          reasonType: 'correction',
        });
      expect(r.status).toBe(400);
      expect((r.body as { error: string }).error).toBe(
        'INVALID_CORRECTION_TARGET',
      );
    });

    it('400 si reasonType="other" sin reasonNotes', async () => {
      const emp = await createTestUser(ctx.request, adminToken, {
        suite: 'corr-other',
        label: 'emp',
        role: 'empleado',
      });
      await grantOverride(ctx, adminToken, emp.id, 'wallet.correct');
      await setCap(ctx, adminToken, emp.id, '1000');
      const empToken = await loginAs(ctx.request, emp.username, emp.password);

      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'corr-other',
        label: 'p',
        role: 'usuario_final',
      });

      const r = await ctx.request
        .post('/tenant/correction')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', empToken)
        .send({
          targetUserId: player.id,
          amount: '100',
          reasonType: 'other',
        });
      expect(r.status).toBe(400);
      expect((r.body as { error: string }).error).toBe(
        'INVALID_CORRECTION_TARGET',
      );
    });
  });

  describe('funcional', () => {
    it('aplica: cliente sube, Casa baja, wallet_tx correcto, audit high, cupo restante', async () => {
      const emp = await createTestUser(ctx.request, adminToken, {
        suite: 'corr-ok',
        label: 'emp',
        role: 'empleado',
      });
      await grantOverride(ctx, adminToken, emp.id, 'wallet.correct');
      await setCap(ctx, adminToken, emp.id, '5000');
      const empToken = await loginAs(ctx.request, emp.username, emp.password);

      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'corr-ok',
        label: 'p',
        role: 'usuario_final',
      });

      const houseBefore = Number(await getHouseBalance(ctx));
      const playerBefore = Number(await getWalletBalance(ctx, player.id));

      const r = await ctx.request
        .post('/tenant/correction')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', empToken)
        .send({
          targetUserId: player.id,
          amount: '250.50',
          reasonType: 'bonus',
          reasonNotes: 'Cortesía por retraso del sistema',
        });
      expect(r.status).toBe(201);
      const body = r.body as CorrectionResponse;
      expect(body.transaction.type).toBe('adjustment');
      expect(body.transaction.amount).toBe('250.50');
      expect(body.status.cap).toBe('5000.00');
      expect(body.status.used).toBe('250.50');
      expect(body.status.remaining).toBe('4749.50');

      // Cliente sube exacto, Casa baja exacto.
      const houseAfter = Number(await getHouseBalance(ctx));
      const playerAfter = Number(await getWalletBalance(ctx, player.id));
      expect(playerAfter - playerBefore).toBeCloseTo(250.5, 2);
      expect(houseBefore - houseAfter).toBeCloseTo(250.5, 2);

      // Audit severity high, action wallet.correct, contra el cliente.
      const audit = await ctx.request
        .get(
          `/tenant/audit-log?targetId=${player.id}&actionCode=wallet.correct&limit=10`,
        )
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const entries = (audit.body as {
        entries: Array<{
          actionCode: string;
          metadata: { severity?: string; reasonType?: string; amount?: string };
        }>;
      }).entries;
      const entry = entries.find((e) => e.actionCode === 'wallet.correct');
      expect(entry).toBeDefined();
      expect(entry!.metadata.severity).toBe('high');
      expect(entry!.metadata.reasonType).toBe('bonus');
      expect(entry!.metadata.amount).toBe('250.50');
    });

    it('múltiples correcciones suman el cupo del mes', async () => {
      const emp = await createTestUser(ctx.request, adminToken, {
        suite: 'corr-sum',
        label: 'emp',
        role: 'empleado',
      });
      await grantOverride(ctx, adminToken, emp.id, 'wallet.correct');
      await setCap(ctx, adminToken, emp.id, '1000');
      const empToken = await loginAs(ctx.request, emp.username, emp.password);

      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'corr-sum',
        label: 'p',
        role: 'usuario_final',
      });

      // Tres correcciones de 300; la cuarta de 200 llevaría a 1100 > 1000.
      for (let i = 0; i < 3; i++) {
        const r = await ctx.request
          .post('/tenant/correction')
          .set('Host', TEST_TENANT.host)
          .set('Authorization', empToken)
          .send({
            targetUserId: player.id,
            amount: '300',
            reasonType: 'refund',
          });
        expect(r.status).toBe(201);
      }
      // Estado tras 3×300 = 900 usado, 100 restante.
      const st = await ctx.request
        .get('/tenant/correction/status')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', empToken);
      expect(st.status).toBe(200);
      const status = st.body as CorrectionStatus;
      // SUM de numeric(20,2) devuelve string sin ceros a la derecha; remaining
      // pasa por mi subDecimal que formatea a .00 solo si no es entero exacto.
      expect(Number(status.used)).toBeCloseTo(900, 2);
      expect(Number(status.remaining)).toBeCloseTo(100, 2);

      // La cuarta de 200 debe fallar con 409.
      const bad = await ctx.request
        .post('/tenant/correction')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', empToken)
        .send({
          targetUserId: player.id,
          amount: '200',
          reasonType: 'refund',
        });
      expect(bad.status).toBe(409);
    });
  });

  describe('PATCH cupo (admin)', () => {
    it('admin fija el cupo → 200 + audit', async () => {
      const emp = await createTestUser(ctx.request, adminToken, {
        suite: 'corr-patch',
        label: 'emp',
        role: 'empleado',
      });

      const r = await ctx.request
        .patch(`/tenant/correction/user/${emp.id}/cap`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ cap: '2500' });
      expect(r.status).toBe(200);
      expect((r.body as { cap: string }).cap).toBe('2500');

      const audit = await ctx.request
        .get(
          `/tenant/audit-log?targetId=${emp.id}&actionCode=employee.set_correction_cap&limit=10`,
        )
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const entries = (audit.body as {
        entries: Array<{ metadata: { before?: string; after?: string } }>;
      }).entries;
      expect(entries.length).toBeGreaterThan(0);
      expect(entries[0]!.metadata.after).toBe('2500');
    });

    it('400 TARGET_NOT_EMPLOYEE si el target NO tiene rol empleado y cap > 0', async () => {
      // usuario_final (jugador) no puede recibir cupo.
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'corr-not-emp',
        label: 'p',
        role: 'usuario_final',
      });

      const r = await ctx.request
        .patch(`/tenant/correction/user/${player.id}/cap`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ cap: '1000' });
      expect(r.status).toBe(400);
      expect((r.body as { error: string }).error).toBe('TARGET_NOT_EMPLOYEE');
    });

    it('cap=0 sobre un no-empleado sigue funcionando (cleanup / clear legacy)', async () => {
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'corr-clear-legacy',
        label: 'p',
        role: 'usuario_final',
      });
      // Simular legacy: seteo cap > 0 directo por DB (el endpoint lo bloquearía).
      await ctx.tenantDb.execute(
        sql`UPDATE users SET employee_correction_cap_monthly = '500' WHERE id = ${player.id}`,
      );

      // Clear del legacy vía endpoint debe funcionar (no bloquea cap=0).
      const r = await ctx.request
        .patch(`/tenant/correction/user/${player.id}/cap`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ cap: '0' });
      expect(r.status).toBe(200);
      expect((r.body as { cap: string }).cap).toBe('0');
    });
  });
});
