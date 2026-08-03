/**
 * E2E: ¿un empleado del admin puede cargar fichas con `wallet.load`?
 *
 * NO (docs/19 + LEYES R7): el rol 'empleado' carga fichas SOLO por
 * corrección contra su cupo mensual. El canal `wallet.load` queda BLOQUEADO
 * para el rol empleado → 403 `EMPLOYEE_LOAD_BLOCKED`, incluso si tiene
 * `wallet.load` por override (el cupo es el control — un load desde su
 * wallet propia no consume cupo y abriría un bypass).
 *
 * Setup:
 *   - Un empleado hijo directo del admin, con override `wallet.load` +
 *     `wallet.view_any` (probamos que el bloqueo es POR ROL, no por falta
 *     de permiso).
 *   - playerA: usuario_final cuyo parent es el empleado.
 *   - playerB: usuario_final en otra rama de la red del admin (bajo un
 *     cajero paralelo al empleado).
 *
 * Comportamiento esperado:
 *   ✗ empleado → playerA (descendiente propio) → 403 EMPLOYEE_LOAD_BLOCKED.
 *   ✗ empleado → playerB (mismo admin network, no descendiente) → 403
 *     EMPLOYEE_LOAD_BLOCKED (el bloqueo por rol corre antes que el scope).
 */

import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser } from '../helpers/test-users';
import { fundWalletForTests } from '../helpers/fund-wallet';

function freshKey(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

describe('empleado del admin — wallet.load bloqueado por rol (E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;

  let empleadoId: string;
  let empleadoToken: string;
  let playerAId: string;
  let playerBId: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);

    const suite = `emp-load-${Date.now().toString(36)}`;

    // Empleado hijo directo del admin (auto-parent al creador).
    const empleado = await createTestUser(ctx.request, adminToken, {
      suite,
      label: 'empl',
      role: 'empleado',
    });
    empleadoId = empleado.id;

    // Cajero paralelo al empleado (también hijo del admin).
    const cajero = await createTestUser(ctx.request, adminToken, {
      suite,
      label: 'caj',
      role: 'cajero',
    });

    // playerA y playerB los crea el admin → quedan root; luego colgamos su
    // parent explícitamente para armar la topología deseada.
    const playerA = await createTestUser(ctx.request, adminToken, {
      suite,
      label: 'pA',
      role: 'usuario_final',
    });
    playerAId = playerA.id;

    const playerB = await createTestUser(ctx.request, adminToken, {
      suite,
      label: 'pB',
      role: 'usuario_final',
    });
    playerBId = playerB.id;

    // playerA → parent = empleado (in-scope del empleado).
    const rA = await ctx.request
      .put(`/tenant/user-hierarchy/${playerA.id}/parent`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ parentUserId: empleadoId, relationType: 'jugador_de_cajero' });
    expect([200, 201]).toContain(rA.status);

    // playerB → parent = cajero (misma red del admin, distinta rama).
    const rB = await ctx.request
      .put(`/tenant/user-hierarchy/${playerB.id}/parent`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ parentUserId: cajero.id, relationType: 'jugador_de_cajero' });
    expect([200, 201]).toContain(rB.status);

    // Grant de wallet.load (delegable) + wallet.view_any al empleado. El
    // bloqueo debe operar A PESAR de tener el permiso.
    for (const code of ['wallet.load', 'wallet.view_any']) {
      const g = await ctx.request
        .post('/tenant/permission-overrides/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ userId: empleadoId, permissionCode: code, reason: 'e2e test' });
      expect([200, 201]).toContain(g.status);
    }

    // Re-login del empleado: el JWT trae los perms cacheados; necesitamos
    // uno nuevo tras el grant.
    empleadoToken = await loginAs(ctx.request, empleado.username, empleado.password);

    // Fondear la wallet del empleado (Casa mint) para que tenga fichas
    // disponibles (aunque el load le esté bloqueado por rol).
    await fundWalletForTests(empleadoId, '50000');
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('empleado NO puede cargar fichas a un usuario_final de SU SUB-RED → 403 EMPLOYEE_LOAD_BLOCKED', async () => {
    const r = await ctx.request
      .post('/tenant/wallet/load')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', empleadoToken)
      .set('Idempotency-Key', freshKey('emp-load-A'))
      .send({
        targetUserId: playerAId,
        amount: '1500.00',
        reason: 'test empleado→playerA',
      });

    expect(r.status).toBe(403);
    expect((r.body as { error?: string }).error).toBe('EMPLOYEE_LOAD_BLOCKED');
  });

  it('empleado NO puede cargar a un usuario_final de otra rama de la red del admin → 403 OUT_OF_SCOPE', async () => {
    const r = await ctx.request
      .post('/tenant/wallet/load')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', empleadoToken)
      .set('Idempotency-Key', freshKey('emp-load-B'))
      .send({
        targetUserId: playerBId,
        amount: '1500.00',
        reason: 'test empleado→playerB (fuera de scope)',
      });

    expect(r.status).toBe(403);
    // El ScopeGuard corre ANTES que el handler: un target fuera de la sub-red
    // del empleado corta acá con OUT_OF_SCOPE. El bloqueo por rol
    // (EMPLOYEE_LOAD_BLOCKED) solo se alcanza para targets in-scope (test 1).
    expect((r.body as { error?: string }).error).toBe('OUT_OF_SCOPE');
  });
});
