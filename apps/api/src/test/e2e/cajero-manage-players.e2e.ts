/**
 * E2E: gap #2 jerarquías — el CAJERO gestiona a sus jugadores (edit/ban).
 *
 * El rol cajero ahora trae `users.edit` + `users.ban` (migración 0060). Es
 * gestión comercial (NO mueve plata), scopeada a su sub-red por el ScopeGuard
 * (`@ScopeTarget` en PATCH /tenant/users/:id). Un cajero puede editar/banear a
 * SUS jugadores, pero NO a usuarios fuera de su red.
 */

import { sql } from 'drizzle-orm';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser, type TestUser } from '../helpers/test-users';

describe('Cajero — gestión de sus jugadores (edit/ban, E2E)', () => {
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
      suite: 'cajero-manage',
      label: `${label}${seq++}`,
      role,
    });
  }

  async function setParent(childId: string, parentId: string): Promise<void> {
    const r = await ctx.request
      .put(`/tenant/user-hierarchy/${childId}/parent`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ parentUserId: parentId, relationType: 'jugador_de_cajero' });
    if (r.status !== 200 && r.status !== 201) {
      throw new Error(`setParent falló ${r.status} ${JSON.stringify(r.body)}`);
    }
  }

  function patchUser(
    token: string,
    userId: string,
    body: Record<string, unknown>,
  ) {
    return ctx.request
      .patch(`/tenant/users/${userId}`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', token)
      .send(body);
  }

  it('el cajero EDITA y BANEA a su jugador; NO puede tocar usuarios fuera de su red', async () => {
    const cajero = await mkUser('caj', 'cajero');
    const player = await mkUser('mine', 'usuario_final');
    await setParent(player.id, cajero.id);
    // Jugador de OTRA red (queda root, creado por el admin → no cuelga del cajero).
    const outsider = await mkUser('outsider', 'usuario_final');

    const cajToken = await loginAs(ctx.request, cajero.username, cajero.password);

    // Editar su jugador → OK.
    const edit = await patchUser(cajToken, player.id, {
      displayName: 'Nombre Editado',
    });
    expect(edit.status).toBe(200);
    expect(edit.body.user.displayName).toBe('Nombre Editado');

    // Banear su jugador → OK.
    const ban = await patchUser(cajToken, player.id, { status: 'banned' });
    expect(ban.status).toBe(200);
    expect(ban.body.user.status).toBe('banned');
    const row = await ctx.tenantDb.execute(
      sql`SELECT status FROM users WHERE id = ${player.id}`,
    );
    expect((row as unknown as Array<{ status: string }>)[0]!.status).toBe(
      'banned',
    );

    // Editar un usuario FUERA de su red → 403 (scope).
    const outside = await patchUser(cajToken, outsider.id, {
      displayName: 'No deberías',
    });
    expect(outside.status).toBe(403);
  });
});
