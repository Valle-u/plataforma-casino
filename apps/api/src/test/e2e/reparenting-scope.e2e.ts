/**
 * E2E: gap #2 jerarquías — reparenting SCOPEADO (socio/distribuidor).
 *
 * Un socio/distribuidor puede reorganizar su propia red: mover un usuario a otro
 * punto DE SU sub-red. El endpoint valida scope sobre AMBOS extremos — el hijo
 * movido Y el nuevo padre deben caer en su red (assertScope, bypass admin_tenant).
 * Cierra la escalada entre redes: no puede robar un usuario de otra red ni
 * empujarlo fuera de la suya. El cajero NO tiene el permiso.
 */

import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser, type TestUser } from '../helpers/test-users';

describe('Reparenting scopeado (socio/distribuidor, E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let seq = 0;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function mkUser(label: string, role: string): Promise<TestUser> {
    return createTestUser(ctx.request, adminToken, {
      suite: 'reparent',
      label: `${label}${seq++}`,
      role,
    });
  }

  /** setParent como ADMIN (para armar la topología del test). */
  async function adminSetParent(
    childId: string,
    parentId: string,
    rel: string,
  ): Promise<void> {
    const r = await ctx.request
      .put(`/tenant/user-hierarchy/${childId}/parent`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ parentUserId: parentId, relationType: rel });
    if (r.status !== 200 && r.status !== 201) {
      throw new Error(`adminSetParent falló ${r.status} ${JSON.stringify(r.body)}`);
    }
  }

  function setParentAs(
    token: string,
    childId: string,
    parentId: string,
    rel: string,
  ) {
    return ctx.request
      .put(`/tenant/user-hierarchy/${childId}/parent`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', token)
      .send({ parentUserId: parentId, relationType: rel });
  }

  it('el socio reparenta DENTRO de su red; no puede robar ni empujar fuera; el cajero no puede', async () => {
    // Red del socio A: A → caj1 → p1 ; A → caj2.
    const socioA = await mkUser('socioA', 'socio');
    const caj1 = await mkUser('caj1', 'cajero');
    const caj2 = await mkUser('caj2', 'cajero');
    const p1 = await mkUser('p1', 'usuario_final');
    await adminSetParent(caj1.id, socioA.id, 'cajero_de_socio');
    await adminSetParent(caj2.id, socioA.id, 'cajero_de_socio');
    await adminSetParent(p1.id, caj1.id, 'jugador_de_cajero');

    // Red del socio B: B → cajB → pB.
    const socioB = await mkUser('socioB', 'socio');
    const cajB = await mkUser('cajB', 'cajero');
    const pB = await mkUser('pB', 'usuario_final');
    await adminSetParent(cajB.id, socioB.id, 'cajero_de_socio');
    await adminSetParent(pB.id, cajB.id, 'jugador_de_cajero');

    const aToken = await loginAs(ctx.request, socioA.username, socioA.password);

    // (1) A mueve p1 de caj1 a caj2 (ambos en su red) → OK.
    const ok = await setParentAs(aToken, p1.id, caj2.id, 'jugador_de_cajero');
    expect(ok.status).toBe(200);

    // (2) A intenta ROBAR pB (de la red de B) → 403 (hijo fuera de su red).
    const steal = await setParentAs(aToken, pB.id, caj1.id, 'jugador_de_cajero');
    expect(steal.status).toBe(403);
    expect(steal.body.error).toBe('OUT_OF_SCOPE');

    // (3) A intenta EMPUJAR p1 a la red de B (nuevo padre cajB, fuera) → 403.
    const push = await setParentAs(aToken, p1.id, cajB.id, 'jugador_de_cajero');
    expect(push.status).toBe(403);
    expect(push.body.error).toBe('OUT_OF_SCOPE');

    // (4) El cajero NO tiene users.change_hierarchy → 403 (permiso).
    const cajToken = await loginAs(ctx.request, caj1.username, caj1.password);
    const cajReparent = await setParentAs(
      cajToken,
      p1.id,
      caj2.id,
      'jugador_de_cajero',
    );
    expect(cajReparent.status).toBe(403);
  });
});
