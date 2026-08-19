/**
 * E2E: permisos de MOVER plata por rol DEPENDIENTE (LEYES R3).
 *
 * Verifica el "modelo limpio" (migraciones 0059 + 0097 +
 * EffectivePermissionsService): un operador de la red DEPENDIENTE no tiene los
 * 7 permisos de mover plata por rol; solo se otorgan dinámicamente a la sub-red
 * INDEPENDIENTE (R4).
 *
 * Post-0097 (2026-08-19, R3): los TRES roles dependientes son comerciales puros
 *   - distribuidor: NO carga (load) ni retira (unload) fichas → 403.
 *   - cajero:       NO carga (load) ni retira (unload) fichas → 403.
 *   - socio:        NO carga ni retira → 403 (se revirtió la reventa de 0074).
 */

import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser } from '../helpers/test-users';

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

  it('socio DEPENDIENTE: ya NO puede cargar ni retirar fichas (403) — R3 revertida (0097)', async () => {
    const socio = await makeUser('socio', 'socio');
    const player = await makeUser('usuario_final', 'p-socio');
    await setParent(player.id, socio.id, 'jugador_de_socio');

    // Post-0097 (2026-08-19): el socio dependiente es comercial puro — sin
    // wallet.load (se revirtió la reventa de 0074) ni wallet.unload.
    const load = await attemptLoad(socio.token, player.id);
    const unload = await attemptUnload(socio.token, player.id);
    expect(load.status).toBe(403);
    expect(unload.status).toBe(403);
  });
});
