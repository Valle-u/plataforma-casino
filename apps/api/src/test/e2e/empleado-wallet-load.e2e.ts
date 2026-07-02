/**
 * E2E: ¿un empleado del admin puede cargar fichas a usuarios finales de la
 * red del admin?
 *
 * Setup:
 *   - Un empleado hijo directo del admin, con override `wallet.load` +
 *     `wallet.view_any` (el rol viene "a la carta", sin defaults).
 *   - Wallet del empleado fondeada (mint de la Casa).
 *   - playerA: usuario_final cuyo parent es el empleado.
 *   - playerB: usuario_final en otra rama de la red del admin (bajo un
 *     cajero paralelo al empleado). Está en la red del admin, pero NO es
 *     descendiente del empleado.
 *
 * Comportamiento esperado (según ScopeGuard):
 *   ✓ empleado → playerA (descendiente propio) → 201 OK, balance sube.
 *   ✗ empleado → playerB (mismo admin network, no descendiente) → 403
 *     OUT_OF_SCOPE. Este caso responde a "puede cargarle a CUALQUIER
 *     jugador de la red del admin?" — la respuesta es: solo si el jugador
 *     está en su propia sub-red. El admin_tenant bypassa scope; el
 *     empleado NO.
 */

import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser } from '../helpers/test-users';
import { fundWalletForTests } from '../helpers/fund-wallet';

interface WalletView {
  balance: string;
}
interface TransferResponse {
  ok: true;
  targetWallet: WalletView;
  sourceWallet: WalletView;
}

function freshKey(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

describe('empleado del admin — wallet.load a la red del admin (E2E)', () => {
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

    // Grant de wallet.load (delegable) + wallet.view_any al empleado.
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
    // para transferir.
    await fundWalletForTests(empleadoId, '50000');
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('empleado carga fichas a un usuario_final DE SU SUB-RED → OK', async () => {
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

    expect(r.status).toBe(201);
    const body = r.body as TransferResponse;
    expect(body.ok).toBe(true);
    expect(body.targetWallet.balance).toBe('1500.00');
    // El source (empleado) baja 1500 del fondeo inicial de 50000.
    expect(body.sourceWallet.balance).toBe('48500.00');
  });

  it('empleado NO puede cargar a un usuario_final de la red del admin pero fuera de su sub-red → 403 OUT_OF_SCOPE', async () => {
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
    // El error code usado por el ScopeGuard.
    expect((r.body as { error?: string }).error).toBe('OUT_OF_SCOPE');
  });
});
