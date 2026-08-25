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
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser, type TestUser } from '../helpers/test-users';
import { fundWalletForTests } from '../helpers/fund-wallet';
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

/**
 * Método de pago bancario PROPIO de un socio (owner_id = socioId). Desde
 * 2026-08-14 el flip dep→indep ya NO recibe `branchBankAccount` en el body
 * — el backend lo resuelve de acá (ver `resolveBankAccountFromPaymentMethods`
 * en `branches.service.ts`). Sin esto, el toggle a independiente rechaza con
 * 400 BRANCH_NO_BANK_PAYMENT_METHOD.
 */
async function createOwnerPaymentMethod(ownerId: string, cbu: string): Promise<void> {
  const client = postgres(getTestTenantUrl(), { max: 1 });
  try {
    await client`
      INSERT INTO payment_methods (id, owner_id, code, name, type, config, is_active)
      VALUES (gen_random_uuid(), ${ownerId}, ${'own-' + ownerId}, 'CBU propio', 'bank_transfer',
              ${JSON.stringify({ cbu })}::jsonb, true)
    `;
  } finally {
    await client.end();
  }
}

describe('Branch flip preconditions — in-flight block (D3, E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let methodId: string;
  let casaId: string;
  let seq = 0;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
    methodId = await createPaymentMethod(`flip-pm-${Date.now().toString(36)}`);
    const cRow = await ctx.tenantDb.execute(
      sql`SELECT id FROM users WHERE username = '__casa__' LIMIT 1`,
    );
    casaId = (cRow as unknown as Array<{ id: string }>)[0]!.id;
  });

  async function getBalance(userId: string): Promise<number> {
    const r = await ctx.tenantDb.execute(
      sql`SELECT balance FROM wallets WHERE user_id = ${userId} LIMIT 1`,
    );
    return Number(
      (r as unknown as Array<{ balance: string }>)[0]?.balance ?? '0',
    );
  }

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
    await createOwnerPaymentMethod(socio.id, 'CBU-FLIP-DEP');

    // Intento de subir a independiente → bloqueado.
    const blocked = await toggle(socio.id, {
      isIndependent: true,
      branchChipsPricePerUnit: '1.0000',
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('BRANCH_FLIP_PENDING_REQUESTS');
    expect(blocked.body.pending.depositsPending).toBeGreaterThanOrEqual(1);

    // force NO alcanza (bloqueo duro).
    const forced = await toggle(socio.id, {
      isIndependent: true,
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
      branchChipsPricePerUnit: '1.0000',
    });
    expect([200, 201]).toContain(ok.status);
    // La respuesta NO debe filtrar credenciales (regresión: antes devolvía el
    // user crudo con passwordHash + twoFaSecret).
    expect(ok.body.user.passwordHash).toBeUndefined();
    expect(ok.body.user.twoFaSecret).toBeUndefined();

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

  it('dep→indep: el socio COMPRA el saldo en circulación (Casa→socio del base)', async () => {
    const socio = await makeUser('s_buy', 'socio');
    const player = await makeUser('p_buy', 'usuario_final');
    await setParent(player.id, socio.id, 'jugador_de_socio');
    // La sub-red tiene 1000 fichas en circulación (el jugador), que hoy banca la
    // Casa. base = 1000.
    await fundWalletForTests(player.id, '1000');
    // La Casa necesita stock para venderle al socio.
    await fundWalletForTests(casaId, '5000');
    await createOwnerPaymentMethod(socio.id, 'CBU-BUY');

    const casaBefore = await getBalance(casaId);
    const socioBefore = await getBalance(socio.id);

    const ok = await toggle(socio.id, {
      isIndependent: true,
      branchChipsPricePerUnit: '1.0000',
    });
    expect([200, 201]).toContain(ok.status);

    // El socio recibió 1000 de stock; la Casa entregó 1000. Transfer, no mint.
    expect(await getBalance(socio.id)).toBeCloseTo(socioBefore + 1000, 2);
    expect(await getBalance(casaId)).toBeCloseTo(casaBefore - 1000, 2);
    // El saldo del jugador NO se toca (sigue en circulación).
    expect(await getBalance(player.id)).toBeCloseTo(1000, 2);
  });

  it('indep→dep: el stock propio sin vender del socio se QUEMA (balance → 0)', async () => {
    const socio = await makeUser('s_burn', 'socio');
    await ctx.tenantDb.execute(
      sql`UPDATE users
          SET is_independent_branch = true,
              branch_bank_account = 'CBU-BURN',
              branch_chips_price_per_unit = '1.0000'
          WHERE id = ${socio.id}`,
    );
    // El socio tiene 800 de stock propio sin vender.
    await fundWalletForTests(socio.id, '800');
    const casaBefore = await getBalance(casaId);

    const ok = await toggle(socio.id, { isIndependent: false });
    expect([200, 201]).toContain(ok.status);

    // Stock quemado: balance del socio → 0. La Casa NO lo recibe (es quema).
    expect(await getBalance(socio.id)).toBeCloseTo(0, 2);
    expect(await getBalance(casaId)).toBeCloseTo(casaBefore, 2);

    // Quedó una wallet_tx 'burn' con el source del flip.
    const burnRows = await ctx.tenantDb.execute(
      sql`SELECT wt.type, wt.source, wt.amount
          FROM wallet_transactions wt
          JOIN wallets w ON w.id = wt.wallet_id
          WHERE w.user_id = ${socio.id} AND wt.type = 'burn'
            AND wt.source = 'branch_flip_burn'
          LIMIT 1`,
    );
    const burn = (
      burnRows as unknown as Array<{ type: string; source: string; amount: string }>
    )[0];
    expect(burn).toBeTruthy();
    expect(Number(burn!.amount)).toBeCloseTo(800, 2);
  });

  it('bloquea el doble flip dep→indep→dep en el mismo período (§14.4 guard)', async () => {
    const socio = await makeUser('s_dbl', 'socio');
    await createOwnerPaymentMethod(socio.id, 'CBU-DBL');
    // Sin sub-red → base=0, sin buy-back. El flip setea commission_eligible_until.
    const up = await toggle(socio.id, {
      isIndependent: true,
      branchChipsPricePerUnit: '1.0000',
    });
    expect([200, 201]).toContain(up.status);

    // Volver a dependiente EN EL MISMO MES perdería el tramo dependiente → 409.
    const back = await toggle(socio.id, { isIndependent: false });
    expect(back.status).toBe(409);
    expect(back.body.error).toBe('BRANCH_FLIP_SAME_PERIOD');

    // Si el flip dep→indep hubiera sido el mes PASADO, volver sí se permite.
    await ctx.tenantDb.execute(
      sql`UPDATE users SET commission_eligible_until = '2020-01-15T00:00:00Z'
          WHERE id = ${socio.id}`,
    );
    const backOld = await toggle(socio.id, { isIndependent: false });
    expect([200, 201]).toContain(backOld.status);
  });

  it('indep→dep: respeta los overrides que el admin otorgó a mano (grantedBy no nulo)', async () => {
    const socio = await makeUser('s_perm', 'socio');
    await createOwnerPaymentMethod(socio.id, 'CBU-PERM');

    // El admin le otorga A MANO un permiso del set independiente ANTES de activar
    // (granted_by = un user real, NO nulo). Debe SOBREVIVIR a la degradación.
    await ctx.tenantDb.execute(
      sql`INSERT INTO user_permission_overrides
            (user_id, permission_code, effect, granted_by, reason)
          VALUES
            (${socio.id}, 'bank_tx.upload', 'grant', ${casaId}, 'manual admin grant (test)')`,
    );

    // Activar: el auto-grant agrega todo el set (bank_tx.view con granted_by=null;
    // bank_tx.upload ya existe → upsert conserva granted_by=casaId). Sin precio en
    // el body: el backend defaultea a paridad (cambio 2026-08-25).
    const up = await toggle(socio.id, { isIndependent: true });
    expect([200, 201]).toContain(up.status);

    // Mover el flip al mes pasado para que el guard §14.4 no bloquee la degradación.
    await ctx.tenantDb.execute(
      sql`UPDATE users SET commission_eligible_until = '2020-01-15T00:00:00Z'
          WHERE id = ${socio.id}`,
    );

    // Degradar: revoca SOLO los auto-grants (granted_by IS NULL).
    const back = await toggle(socio.id, { isIndependent: false });
    expect([200, 201]).toContain(back.status);

    const rows = (await ctx.tenantDb.execute(
      sql`SELECT permission_code, granted_by
          FROM user_permission_overrides
          WHERE user_id = ${socio.id}
            AND permission_code IN ('bank_tx.upload', 'bank_tx.view')`,
    )) as unknown as Array<{
      permission_code: string;
      granted_by: string | null;
    }>;
    const byCode = new Map(rows.map((r) => [r.permission_code, r.granted_by]));

    // El manual (granted_by = casaId) SOBREVIVE a la degradación.
    expect(byCode.has('bank_tx.upload')).toBe(true);
    expect(byCode.get('bank_tx.upload')).toBe(casaId);
    // El auto (granted_by = null) se BORRÓ.
    expect(byCode.has('bank_tx.view')).toBe(false);
  });

  it('Opción C: activa SIN CBU; el indep-sin-CBU NO ve el extracto; cargar el CBU sincroniza', async () => {
    const socio = await makeUser('s_optc', 'socio');
    // Sin createOwnerPaymentMethod → el socio NO tiene CBU.

    // 1. Activar SIN CBU → 200 (antes daba 400 BRANCH_NO_BANK_PAYMENT_METHOD).
    const up = await toggle(socio.id, { isIndependent: true });
    expect([200, 201]).toContain(up.status);

    // branchBankAccount quedó null (independiente sin CBU).
    const acct0 = (await ctx.tenantDb.execute(
      sql`SELECT branch_bank_account AS acct FROM users WHERE id = ${socio.id}`,
    )) as unknown as Array<{ acct: string | null }>;
    expect(acct0[0]?.acct).toBeNull();

    // Sembramos una bank_tx del tenant (cuenta NO independiente): un impl con
    // fuga la mostraría al socio-sin-CBU.
    await ctx.tenantDb.execute(
      sql`INSERT INTO bank_transactions (id, amount, received_at, uploaded_by, bank_account, direction, status)
          VALUES (gen_random_uuid(), '1000.00', now(), ${casaId}, 'CBU-TENANT-OPTC', 'incoming', 'unmatched')`,
    );

    // 2. Aislamiento: el socio indep SIN CBU NO ve NINGUNA transferencia.
    const socioToken = await loginAs(ctx.request, socio.username, socio.password);
    const list = await ctx.request
      .get('/tenant/bank-transactions?limit=50')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', socioToken);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(0); // sin fuga del extracto del tenant.

    // 3. El socio (ya independiente) carga su CBU en su panel → se sincroniza
    //    branchBankAccount (auto-cura el deadlock).
    const pm = await ctx.request
      .post('/tenant/branches/payment-methods')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', socioToken)
      .send({
        code: `cbu-optc-${socio.id.slice(0, 6)}`,
        name: 'CBU test',
        type: 'bank_transfer',
        config: { cbu: '2222222222222222222222' },
      });
    expect([200, 201]).toContain(pm.status);

    const acct1 = (await ctx.tenantDb.execute(
      sql`SELECT branch_bank_account AS acct FROM users WHERE id = ${socio.id}`,
    )) as unknown as Array<{ acct: string | null }>;
    expect(acct1[0]?.acct).toBe('2222222222222222222222');
  });

  it('Fix crítico: aislar por uploaded_by — un indep NO ve el extracto del admin aunque reclame su CBU', async () => {
    const socio = await makeUser('s_crit', 'socio');
    await createOwnerPaymentMethod(socio.id, 'CBU-SOCIO-CRIT');
    const up = await toggle(socio.id, {
      isIndependent: true,
      branchChipsPricePerUnit: '1.0000',
    });
    expect([200, 201]).toContain(up.status);

    // El admin sube una bank_tx a SU cuenta (uploaded_by = casa/admin).
    await ctx.tenantDb.execute(
      sql`INSERT INTO bank_transactions (id, amount, received_at, uploaded_by, bank_account, direction, status)
          VALUES (gen_random_uuid(), '5000.00', now(), ${casaId}, 'CBU-ADMIN', 'incoming', 'unmatched')`,
    );

    // El socio, malicioso, carga un método reclamando el CBU del admin.
    const socioToken = await loginAs(ctx.request, socio.username, socio.password);
    const pm = await ctx.request
      .post('/tenant/branches/payment-methods')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', socioToken)
      .send({
        code: `cbu-crit-${socio.id.slice(0, 6)}`,
        name: 'rob',
        type: 'bank_transfer',
        config: { cbu: 'CBU-ADMIN' },
      });
    expect([200, 201]).toContain(pm.status);

    // El sync escribió branchBankAccount = 'CBU-ADMIN' (metadata, ya NO es frontera).
    const acct = (await ctx.tenantDb.execute(
      sql`SELECT branch_bank_account AS a FROM users WHERE id = ${socio.id}`,
    )) as unknown as Array<{ a: string | null }>;
    expect(acct[0]?.a).toBe('CBU-ADMIN');

    // PERO el aislamiento es por uploaded_by → NO ve la bank_tx del admin.
    const list = await ctx.request
      .get('/tenant/bank-transactions?limit=50')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', socioToken);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(0); // sin fuga, aunque reclame el CBU del admin.
  });

  it('flip: un REVOKE manual de un código del set no queda como grant permanente al degradar', async () => {
    const socio = await makeUser('s_rev', 'socio');
    await createOwnerPaymentMethod(socio.id, 'CBU-REV');

    // Admin revoca A MANO bank_tx.upload (granted_by = casa/admin, no nulo).
    await ctx.tenantDb.execute(
      sql`INSERT INTO user_permission_overrides (user_id, permission_code, effect, granted_by, reason)
          VALUES (${socio.id}, 'bank_tx.upload', 'revoke', ${casaId}, 'manual revoke (test)')`,
    );

    // Activar: el independiente NECESITA el set → el revoke se limpia y queda
    // como auto-grant (granted_by null), no como grant del admin.
    const up = await toggle(socio.id, { isIndependent: true });
    expect([200, 201]).toContain(up.status);
    const active = (await ctx.tenantDb.execute(
      sql`SELECT effect, granted_by AS gb FROM user_permission_overrides
          WHERE user_id = ${socio.id} AND permission_code = 'bank_tx.upload'`,
    )) as unknown as Array<{ effect: string; gb: string | null }>;
    expect(active[0]?.effect).toBe('grant');
    expect(active[0]?.gb).toBeNull();

    // Degradar (mes pasado para saltar §14.4).
    await ctx.tenantDb.execute(
      sql`UPDATE users SET commission_eligible_until = '2020-01-15T00:00:00Z' WHERE id = ${socio.id}`,
    );
    const back = await toggle(socio.id, { isIndependent: false });
    expect([200, 201]).toContain(back.status);

    // No queda NINGÚN override (vuelve a la base del rol). Antes: grant
    // permanente atribuido al admin que lo había revocado.
    const after = (await ctx.tenantDb.execute(
      sql`SELECT count(*)::int AS n FROM user_permission_overrides
          WHERE user_id = ${socio.id} AND permission_code = 'bank_tx.upload'`,
    )) as unknown as Array<{ n: number }>;
    expect(after[0]?.n).toBe(0);
  });

  it('sellChips: idempotente por key (doble-click no dobla) y exige la key', async () => {
    const socio = await makeUser('s_sell', 'socio');
    await createOwnerPaymentMethod(socio.id, 'CBU-SELL');
    await toggle(socio.id, { isIndependent: true });
    await fundWalletForTests(casaId, '5000');

    const before = await getBalance(socio.id);
    const key = `sell-idem-${socio.id.slice(0, 8)}`;
    const sell = (body: Record<string, unknown>) =>
      ctx.request
        .post(`/tenant/users/${socio.id}/branch/sell-chips`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send(body);

    const r1 = await sell({ amountChips: '1000', amountFiat: '1000', idempotencyKey: key });
    expect([200, 201]).toContain(r1.status);
    // Segunda con la MISMA key (doble-click). Sea 200 o 409, lo que importa es
    // que NO acredite dos veces.
    await sell({ amountChips: '1000', amountFiat: '1000', idempotencyKey: key });
    expect(await getBalance(socio.id)).toBeCloseTo(before + 1000, 2);

    // Sin idempotencyKey → 400 (DTO la exige).
    const r3 = await sell({ amountChips: '1000', amountFiat: '1000' });
    expect(r3.status).toBe(400);
  });

  it('flip: re-activar un socio YA independiente es no-op (no dobla buyback, no resetea precio)', async () => {
    const socio = await makeUser('s_noop', 'socio');
    const player = await makeUser('p_noop', 'usuario_final');
    await setParent(player.id, socio.id, 'jugador_de_socio');
    await fundWalletForTests(player.id, '1000');
    await fundWalletForTests(casaId, '5000');
    await createOwnerPaymentMethod(socio.id, 'CBU-NOOP');

    // Activar (buyback de 1000 fichas Casa→socio, precio 0.9).
    const up1 = await toggle(socio.id, {
      isIndependent: true,
      branchChipsPricePerUnit: '0.9000',
    });
    expect([200, 201]).toContain(up1.status);
    const balAfter1 = await getBalance(socio.id);

    // Re-activar (MISMO estado) SIN precio → no-op: sin segundo buyback, sin
    // resetear el precio a 1.0000.
    const up2 = await toggle(socio.id, { isIndependent: true });
    expect([200, 201]).toContain(up2.status);
    expect(await getBalance(socio.id)).toBeCloseTo(balAfter1, 2); // no dobló el buyback.

    const price = (await ctx.tenantDb.execute(
      sql`SELECT branch_chips_price_per_unit AS p FROM users WHERE id = ${socio.id}`,
    )) as unknown as Array<{ p: string }>;
    expect(Number(price[0]?.p)).toBeCloseTo(0.9, 4); // precio intacto, no 1.0000.
  });
});
