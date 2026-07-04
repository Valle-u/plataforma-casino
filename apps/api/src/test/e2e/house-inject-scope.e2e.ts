/**
 * E2E: scope check en POST /tenant/house/inject-capital y /inject-budget
 * con `operatorUserId` (F5, docs/16-adenda).
 *
 * Riesgo cerrado (N2):
 *
 *   `house.inject_capital` es `isDelegatable=true` en el seed → un empleado
 *   del admin puede tenerlo por override. Antes de este hardening, ese
 *   empleado podía llamar los endpoints con `operatorUserId=<socio indep
 *   de OTRA red>` y mintear a la wallet ajena. Los endpoints ahora hacen
 *   scope check ANTES de llegar al service (patrón assertMonitoringScope
 *   ya existente para stock-alert / capital-needed).
 *
 * Reglas del scope check (`assertInjectScope`):
 *   - operatorUserId=null (destino=Casa) → sin scope check (regla legacy;
 *     el permiso alcanza).
 *   - operatorUserId!=null:
 *       · admin_tenant                 → bypass.
 *       · self (actor === operator)    → bypass (self-inject del propio indep).
 *       · ancestro del operator        → bypass (dueño de la red del indep).
 *       · otros                        → 403 OUT_OF_SCOPE.
 *
 * Casos cubiertos (mapping con el ticket):
 *   T-S1: admin_tenant + injectCapital(operatorUserId=indepA)                 → 201.
 *   T-S2: empleado del admin con override `house.inject_capital` +
 *         injectCapital(operatorUserId=indepA fuera de su red)                → 403.
 *   T-S3: socio indep S con override `house.inject_capital` +
 *         injectBudget(operatorUserId=S) (self)                                → 201.
 *   T-S4: socio P (ancestro del indep A colgado bajo él) con permiso,
 *         injectBudget(operatorUserId=A) (ancestro bypasea)                    → 201.
 *
 * Nota T-S4: el ticket original decía "empleado del socio S con permiso,
 * injectBudget operatorUserId=S → 200 (ancestro bypasea)". Ese planteo es
 * imposible: un empleado creado POR S queda como HIJO de S, así que E NO
 * es ancestro de S. Reinterpretamos el caso como el escenario real que
 * refleja la intención (delegación descendente): actor P upstream, target
 * A downstream. isAncestorOf(P, A) === true → bypass.
 */

import { sql } from 'drizzle-orm';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser, type TestUser } from '../helpers/test-users';

interface InjectionApiRow {
  id: string;
  type: string;
  amount: string;
  reason: string;
  bankTransactionId: string | null;
  mintTxId: string | null;
  operatorUserId: string | null;
}

function freshKey(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Marca al user como socio INDEPENDIENTE. Usamos el UPDATE directo para no
 * arrastrar el auto-grant de perms del toggle oficial (mantenemos el test
 * enfocado en el scope check, no en los grants automáticos). Los tests que
 * ya usan este patrón: `house-inject-budget.e2e.ts::makeIndependent`.
 */
async function makeIndependent(
  ctx: TestApp,
  socioId: string,
  cbu: string,
): Promise<void> {
  await ctx.tenantDb.execute(
    sql`UPDATE users
        SET is_independent_branch = true,
            branch_bank_account = ${cbu}
        WHERE id = ${socioId}`,
  );
}

/** Grant de un permiso via override (admin como actor). */
async function grantPerm(
  ctx: TestApp,
  adminToken: string,
  userId: string,
  code: string,
): Promise<void> {
  const r = await ctx.request
    .post('/tenant/permission-overrides/grant')
    .set('Host', TEST_TENANT.host)
    .set('Authorization', adminToken)
    .send({ userId, permissionCode: code, reason: 'e2e house-inject-scope' });
  if (![200, 201].includes(r.status)) {
    throw new Error(
      `grantPerm falló ${code} → ${userId}: ${r.status} ${JSON.stringify(r.body)}`,
    );
  }
}

/** Pone `parent` como padre directo de `child` en la jerarquía. */
async function setParent(
  ctx: TestApp,
  adminToken: string,
  childId: string,
  parentId: string,
  relationType = 'jugador_de_cajero',
): Promise<void> {
  const r = await ctx.request
    .put(`/tenant/user-hierarchy/${childId}/parent`)
    .set('Host', TEST_TENANT.host)
    .set('Authorization', adminToken)
    .send({ parentUserId: parentId, relationType });
  if (![200, 201].includes(r.status)) {
    throw new Error(
      `setParent falló ${childId} → ${parentId}: ${r.status} ${JSON.stringify(r.body)}`,
    );
  }
}

/** Crea una bank_transaction INCOMING lista para respaldar un inject-capital. */
async function uploadBankTx(
  ctx: TestApp,
  adminToken: string,
  params: { bankAccount: string; amount: string },
): Promise<string> {
  const ref = freshKey('scope-ref');
  const res = await ctx.request
    .post('/tenant/bank-transactions')
    .set('Host', TEST_TENANT.host)
    .set('Authorization', adminToken)
    .send({
      bankAccount: params.bankAccount,
      amount: params.amount,
      currency: 'ARS',
      bankReference: ref,
      receivedAt: new Date().toISOString(),
      direction: 'incoming',
    });
  if (res.status !== 201) {
    throw new Error(
      `uploadBankTx falló: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  return (res.body as { id: string }).id;
}

async function getBalance(ctx: TestApp, userId: string): Promise<number> {
  const rows = (await ctx.tenantDb.execute(
    sql`SELECT balance FROM wallets WHERE user_id = ${userId} LIMIT 1`,
  )) as unknown as Array<{ balance: string }>;
  return Number(rows[0]?.balance ?? 0);
}

describe('HouseController inject-capital / inject-budget — scope check con operatorUserId (E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
  });

  afterAll(async () => {
    await ctx.close();
  });

  // ────────────────────────────────────────────────────────────────────
  // T-S1 · admin_tenant siempre bypasea → 201 aunque el indep sea de una
  // rama que NO cuelga de él (admin_tenant bypasea per assertScope).
  // ────────────────────────────────────────────────────────────────────

  it('T-S1: admin_tenant injectCapital(operatorUserId=indepA) → 201 OK', async () => {
    const suite = `hisc-t1-${Date.now().toString(36)}`;
    const indepA = await createTestUser(ctx.request, adminToken, {
      suite,
      label: 'indepA',
      role: 'socio',
    });
    await makeIndependent(ctx, indepA.id, `CBU-T1-${suite}`);

    const bankTxId = await uploadBankTx(ctx, adminToken, {
      bankAccount: `CBU-T1-${suite}`,
      amount: '500',
    });

    const indepBefore = await getBalance(ctx, indepA.id);

    const r = await ctx.request
      .post('/tenant/house/inject-capital')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ bankTransactionId: bankTxId, operatorUserId: indepA.id });

    expect([200, 201]).toContain(r.status);
    const body = r.body as InjectionApiRow;
    expect(body.operatorUserId).toBe(indepA.id);

    const indepAfter = await getBalance(ctx, indepA.id);
    expect(indepAfter - indepBefore).toBeCloseTo(500, 2);
  });

  // ────────────────────────────────────────────────────────────────────
  // T-S2 · Empleado del admin con override `house.inject_capital`, tratando
  // de mintear al bankroll de un indep de OTRA red. Antes del fix: 201 y
  // fuga. Con el fix: 403 OUT_OF_SCOPE.
  //
  // Topología:
  //   admin_tenant (root)
  //     ├─ empleado E (auto-parent=admin, hijo directo)
  //     └─ indep A   (hijo del admin, en otra rama)
  //
  // A NO es descendant de E → assertScope tira OUT_OF_SCOPE (E no es
  // admin_tenant, no es self, no es ancestro de A).
  // ────────────────────────────────────────────────────────────────────

  it('T-S2: empleado con house.inject_capital delegado, injectCapital(operatorUserId=indepA fuera de su red) → 403 OUT_OF_SCOPE', async () => {
    const suite = `hisc-t2-${Date.now().toString(36)}`;

    const empleado = await createTestUser(ctx.request, adminToken, {
      suite,
      label: 'empl',
      role: 'empleado',
    });
    const indepA = await createTestUser(ctx.request, adminToken, {
      suite,
      label: 'indepA',
      role: 'socio',
    });
    await makeIndependent(ctx, indepA.id, `CBU-T2-${suite}`);

    // El empleado obtiene el permiso via override (delegable=true en seed).
    await grantPerm(ctx, adminToken, empleado.id, 'house.inject_capital');

    // Re-login para refrescar perms cacheados en el JWT.
    const empleadoToken = await loginAs(
      ctx.request,
      empleado.username,
      empleado.password,
    );

    const bankTxId = await uploadBankTx(ctx, adminToken, {
      bankAccount: `CBU-T2-${suite}`,
      amount: '300',
    });

    const indepBefore = await getBalance(ctx, indepA.id);

    const r = await ctx.request
      .post('/tenant/house/inject-capital')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', empleadoToken)
      .send({ bankTransactionId: bankTxId, operatorUserId: indepA.id });

    expect(r.status).toBe(403);
    expect((r.body as { error?: string }).error).toBe('OUT_OF_SCOPE');

    // Nada minteado: la wallet del indep no cambió.
    const indepAfter = await getBalance(ctx, indepA.id);
    expect(indepAfter).toBeCloseTo(indepBefore, 2);
  });

  // ────────────────────────────────────────────────────────────────────
  // T-S3 · Self-inject: el propio socio indep S llama injectBudget con
  // operatorUserId=S. assertScope hace bypass por `actorId === targetUserId`.
  //
  // Requiere que el indep tenga `house.inject_capital` (no viene por default
  // — se lo grantea el admin explícitamente en este escenario).
  // ────────────────────────────────────────────────────────────────────

  it('T-S3: socio indep S con permiso self, injectBudget(operatorUserId=S) → 201 (self bypasea)', async () => {
    const suite = `hisc-t3-${Date.now().toString(36)}`;

    const socioS: TestUser = await createTestUser(ctx.request, adminToken, {
      suite,
      label: 'socioS',
      role: 'socio',
    });
    await makeIndependent(ctx, socioS.id, `CBU-T3-${suite}`);
    await grantPerm(ctx, adminToken, socioS.id, 'house.inject_capital');

    const socioSToken = await loginAs(
      ctx.request,
      socioS.username,
      socioS.password,
    );

    const before = await getBalance(ctx, socioS.id);

    const r = await ctx.request
      .post('/tenant/house/inject-budget')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', socioSToken)
      .send({
        amount: '250',
        reason: 'self-inject presupuesto',
        operatorUserId: socioS.id,
        idempotencyKey: freshKey('budget-t3'),
      });

    expect(r.status).toBe(201);
    const body = r.body as InjectionApiRow;
    expect(body.operatorUserId).toBe(socioS.id);
    expect(body.type).toBe('budget');

    const after = await getBalance(ctx, socioS.id);
    expect(after - before).toBeCloseTo(250, 2);
  });

  // ────────────────────────────────────────────────────────────────────
  // T-S4 · Ancestro upstream banca a un indep downstream:
  //   P (socio) es ancestro directo del indep A (setParent A→P).
  //   P llama injectBudget con operatorUserId=A.
  //   assertScope bypasa por `isAncestorOf(P, A) === true`.
  //
  // Ver nota al pie del header sobre reinterpretación del caso #4 del ticket.
  // ────────────────────────────────────────────────────────────────────

  it('T-S4: ancestro del indep (P) con permiso, injectBudget(operatorUserId=indepA hijo de P) → 201 (ancestro bypasea)', async () => {
    const suite = `hisc-t4-${Date.now().toString(36)}`;

    // Socio "P" (upstream). El admin lo crea → auto-parent=admin.
    const socioP: TestUser = await createTestUser(ctx.request, adminToken, {
      suite,
      label: 'socioP',
      role: 'socio',
    });
    await grantPerm(ctx, adminToken, socioP.id, 'house.inject_capital');

    // Indep A colgado por DEBAJO de P.
    const indepA = await createTestUser(ctx.request, adminToken, {
      suite,
      label: 'indepA',
      role: 'socio',
    });
    await setParent(ctx, adminToken, indepA.id, socioP.id, 'socio_de_socio');
    await makeIndependent(ctx, indepA.id, `CBU-T4-${suite}`);

    const socioPToken = await loginAs(
      ctx.request,
      socioP.username,
      socioP.password,
    );

    const before = await getBalance(ctx, indepA.id);

    const r = await ctx.request
      .post('/tenant/house/inject-budget')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', socioPToken)
      .send({
        amount: '175',
        reason: 'ancestro banca a su indep',
        operatorUserId: indepA.id,
        idempotencyKey: freshKey('budget-t4'),
      });

    expect(r.status).toBe(201);
    const body = r.body as InjectionApiRow;
    expect(body.operatorUserId).toBe(indepA.id);

    const after = await getBalance(ctx, indepA.id);
    expect(after - before).toBeCloseTo(175, 2);
  });
});
