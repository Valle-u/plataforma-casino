/**
 * E2E: permisos de MOVER plata por rol DEPENDIENTE (LEYES R3).
 *
 * Verifica el estado actual del "modelo limpio" (migraciones 0059 + 0074 +
 * EffectivePermissionsService): un operador de la red DEPENDIENTE no tiene los
 * 7 permisos de mover plata por rol; solo se otorgan dinámicamente a la sub-red
 * INDEPENDIENTE. La única excepción es `wallet.load` para el SOCIO (0074, R3:
 * canal de reventa).
 *
 * Estado esperado (red dependiente, sin overrides):
 *   - distribuidor: NO puede cargar (load) ni retirar (unload) fichas → 403.
 *   - cajero:       NO puede cargar (load) ni retirar (unload) fichas → 403.
 *   - socio:        SÍ puede cargar (load, R3) pero NO retirar (unload) → 403.
 */

import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser } from '../helpers/test-users';
import { fundWalletForTests } from '../helpers/fund-wallet';

function key(l: string): string {
  return `${l}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe('Permisos de plata por rol dependiente (R3) — E2E', () => {
  let ctx: TestApp;
  let adminToken: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function makeUser(role: string, label: string) {
    const u = await createTestUser(ctx.request, adminToken, {
      suite: 'depmoney',
      label,
      role,
    });
    const token = await loginAs(ctx.request, u.username, u.password);
    return { ...u, token };
  }

  /** Cuelga `childId` de `parentId` (para que esté en el scope del operador). */
  async function setParent(childId: string, parentId: string, relationType: string) {
    await ctx.request
      .put(`/tenant/user-hierarchy/${childId}/parent`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ parentUserId: parentId, relationType });
  }

  function attemptLoad(token: string, targetUserId: string) {
    return ctx.request
      .post('/tenant/wallet/load')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', token)
      .set('Idempotency-Key', key('load'))
      .send({ targetUserId, amount: '10', reason: 'test money-perms' });
  }

  function attemptUnload(token: string, targetUserId: string) {
    return ctx.request
      .post('/tenant/wallet/unload')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', token)
      .set('Idempotency-Key', key('unload'))
      .send({ targetUserId, amount: '10', reason: 'test money-perms' });
  }

  it('distribuidor DEPENDIENTE: no puede cargar ni retirar fichas (403)', async () => {
    const distri = await makeUser('distribuidor', 'distri');
    const player = await makeUser('usuario_final', 'p-distri');
    await setParent(player.id, distri.id, 'jugador_de_distribuidor');

    const load = await attemptLoad(distri.token, player.id);
    const unload = await attemptUnload(distri.token, player.id);
    expect(load.status).toBe(403);
    expect(unload.status).toBe(403);
  });

  it('cajero DEPENDIENTE: no puede cargar ni retirar fichas (403)', async () => {
    const cajero = await makeUser('cajero', 'cajero');
    const player = await makeUser('usuario_final', 'p-cajero');
    await setParent(player.id, cajero.id, 'jugador_de_cajero');

    const load = await attemptLoad(cajero.token, player.id);
    const unload = await attemptUnload(cajero.token, player.id);
    expect(load.status).toBe(403);
    expect(unload.status).toBe(403);
  });

  it('socio DEPENDIENTE: PUEDE cargar (R3, reventa) pero NO retirar (403)', async () => {
    const socio = await makeUser('socio', 'socio');
    const player = await makeUser('usuario_final', 'p-socio');
    await setParent(player.id, socio.id, 'jugador_de_socio');
    await fundWalletForTests(socio.id, '1000');

    // Carga: el socio dependiente SÍ tiene wallet.load (R3) → 201.
    const load = await attemptLoad(socio.token, player.id);
    expect(load.status).toBe(201);

    // Retiro/unload: el socio dependiente NO tiene wallet.unload → 403.
    const unload = await attemptUnload(socio.token, player.id);
    expect(unload.status).toBe(403);
  });
});
