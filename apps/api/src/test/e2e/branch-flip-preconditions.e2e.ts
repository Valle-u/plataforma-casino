/**
 * E2E: D3 · precondiciones del flip de independencia (docs/17 §14.1).
 *
 * Cambiar el modo de un socio (dep↔indep) se BLOQUEA (duro, no bypasseable con
 * force) si su sub-red tiene depósitos/retiros IN-FLIGHT — un flip a mitad de
 * camino dejaría esas solicitudes apuntando a un issuer contradictorio.
 *
 * Casos:
 *   1. dep→indep con un depósito PENDIENTE de un jugador de la red → 409
 *      BRANCH_FLIP_PENDING_REQUESTS. Al resolverlo, el flip procede.
 *   2. indep→dep con un retiro PENDIENTE de un jugador de la red → 409.
 */

import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser, type TestUser } from '../helpers/test-users';
import { getTestTenantUrl } from '../setup/db-helpers';

async function createPaymentMethod(code: string): Promise<string> {
  const client = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await client<{ id: string }[]>`
      INSERT INTO payment_methods (id, code, name, type, config, is_active)
      VALUES (gen_random_uuid(), ${code}, ${code + ' display'}, 'bank_transfer',
              '{"cbu":"0000000000000000000000"}'::jsonb, true)
      RETURNING id
    `;
    return rows[0]!.id;
  } finally {
    await client.end();
  }
}

describe('Branch flip preconditions — in-flight block (D3, E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let methodId: string;
  let seq = 0;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
    methodId = await createPaymentMethod(`flip-pm-${Date.now().toString(36)}`);
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function makeUser(label: string, role: string): Promise<TestUser> {
    return createTestUser(ctx.request, adminToken, {
      suite: 'flip-precond',
      label: `${label}${seq++}`,
      role,
    });
  }

  async function setParent(
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
      throw new Error(`setParent falló ${r.status} ${JSON.stringify(r.body)}`);
    }
  }

  function toggle(socioId: string, body: Record<string, unknown>) {
    return ctx.request
      .post(`/tenant/users/${socioId}/branch/toggle-independence`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send(body);
  }

  async function insertPendingDeposit(playerId: string): Promise<string> {
    const r = await ctx.tenantDb.execute(
      sql`INSERT INTO deposits
            (id, user_id, method_id, amount_fiat, currency_fiat, amount_chips, status)
          VALUES
            (gen_random_uuid(), ${playerId}, ${methodId}, '1000.00', 'ARS', '1000.00', 'pending')
          RETURNING id`,
    );
    return (r as unknown as Array<{ id: string }>)[0]!.id;
  }

  async function insertPendingWithdrawal(playerId: string): Promise<string> {
    const r = await ctx.tenantDb.execute(
      sql`INSERT INTO withdrawals
            (id, user_id, method_id, amount_chips, amount_fiat, currency_fiat, target_account, status)
          VALUES
            (gen_random_uuid(), ${playerId}, ${methodId}, '500.00', '500.00', 'ARS',
             '{"cbu":"0000000000000000000000"}'::jsonb, 'pending')
          RETURNING id`,
    );
    return (r as unknown as Array<{ id: string }>)[0]!.id;
  }

  it('dep→indep se bloquea si hay un depósito pendiente en la red; al resolverlo procede', async () => {
    const socio = await makeUser('s_dep', 'socio');
    const player = await makeUser('p_dep', 'usuario_final');
    await setParent(player.id, socio.id, 'jugador_de_socio');
    const depositId = await insertPendingDeposit(player.id);

    // Intento de subir a independiente → bloqueado.
    const blocked = await toggle(socio.id, {
      isIndependent: true,
      branchBankAccount: 'CBU-FLIP-DEP',
      branchChipsPricePerUnit: '1.0000',
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('BRANCH_FLIP_PENDING_REQUESTS');
    expect(blocked.body.pending.depositsPending).toBeGreaterThanOrEqual(1);

    // force NO alcanza (bloqueo duro).
    const forced = await toggle(socio.id, {
      isIndependent: true,
      branchBankAccount: 'CBU-FLIP-DEP',
      branchChipsPricePerUnit: '1.0000',
      force: true,
    });
    expect(forced.status).toBe(409);
    expect(forced.body.error).toBe('BRANCH_FLIP_PENDING_REQUESTS');

    // Resolvemos el depósito (aprobado) → el flip procede.
    await ctx.tenantDb.execute(
      sql`UPDATE deposits SET status = 'approved' WHERE id = ${depositId}`,
    );
    const ok = await toggle(socio.id, {
      isIndependent: true,
      branchBankAccount: 'CBU-FLIP-DEP',
      branchChipsPricePerUnit: '1.0000',
    });
    expect([200, 201]).toContain(ok.status);

    const row = await ctx.tenantDb.execute(
      sql`SELECT is_independent_branch FROM users WHERE id = ${socio.id}`,
    );
    expect(
      (row as unknown as Array<{ is_independent_branch: boolean }>)[0]!
        .is_independent_branch,
    ).toBe(true);
  });

  it('indep→dep se bloquea si hay un retiro pendiente en la red', async () => {
    const socio = await makeUser('s_ind', 'socio');
    const player = await makeUser('p_ind', 'usuario_final');
    await setParent(player.id, socio.id, 'jugador_de_socio');
    // Marcamos independiente directo por SQL (baseline del modelo).
    await ctx.tenantDb.execute(
      sql`UPDATE users
          SET is_independent_branch = true,
              branch_bank_account = 'CBU-FLIP-IND',
              branch_chips_price_per_unit = '1.0000'
          WHERE id = ${socio.id}`,
    );
    await insertPendingWithdrawal(player.id);

    const blocked = await toggle(socio.id, { isIndependent: false });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('BRANCH_FLIP_PENDING_REQUESTS');
    expect(blocked.body.pending.withdrawalsPending).toBeGreaterThanOrEqual(1);
  });
});
