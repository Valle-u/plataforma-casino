/**
 * E2E: scope check en POST /tenant/house/inject-budget con `operatorUserId`
 * (F5, docs/16-adenda).
 *
 * ACTUALIZADO (mig 0056, modelo docs/20): `house.inject_capital` pasó a ser
 * NO delegable — SOLO el admin puede fondear/mintear (el independiente recibe
 * fichas comprándolas, no se auto-fondea). Los casos originales T-S2/T-S3/T-S4
 * delegaban el permiso a un empleado o socio para ejercitar el scope check;
 * con el permiso no-delegable esos escenarios son inalcanzables, así que se
 * eliminaron. Que la delegación se rechace (403) lo cubre
 * `permission-overrides.e2e.ts`. El scope check `assertInjectScope` queda en el
 * código como defensa en profundidad (su rama OUT_OF_SCOPE ya no es alcanzable
 * por un grant normal). Queda T-S1: el admin inyecta a un indep de su red.
 *
 * ACTUALIZADO (2026-07, modelo "tope mensual"): `injectCapital` (atado a
 * bank_tx) se ELIMINÓ. El único minteo es `injectBudget`. T-S1 ahora ejercita
 * el scope check con inject-budget en vez de inject-capital.
 */

import { sql } from 'drizzle-orm';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser } from '../helpers/test-users';

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

async function getBalance(ctx: TestApp, userId: string): Promise<number> {
  const rows = (await ctx.tenantDb.execute(
    sql`SELECT balance FROM wallets WHERE user_id = ${userId} LIMIT 1`,
  )) as unknown as Array<{ balance: string }>;
  return Number(rows[0]?.balance ?? 0);
}

describe('HouseController inject-budget — scope check con operatorUserId (E2E)', () => {
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

  it('T-S1: admin_tenant injectBudget(operatorUserId=indepA) → 201 OK', async () => {
    const suite = `hisc-t1-${Date.now().toString(36)}`;
    const indepA = await createTestUser(ctx.request, adminToken, {
      suite,
      label: 'indepA',
      role: 'socio',
    });
    await makeIndependent(ctx, indepA.id, `CBU-T1-${suite}`);

    const indepBefore = await getBalance(ctx, indepA.id);

    const r = await ctx.request
      .post('/tenant/house/inject-budget')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({
        amount: '500',
        reason: 'presupuesto a indep de la red',
        operatorUserId: indepA.id,
        idempotencyKey: freshKey('scope-budget'),
      });

    expect([200, 201]).toContain(r.status);
    const body = r.body as InjectionApiRow;
    expect(body.operatorUserId).toBe(indepA.id);

    const indepAfter = await getBalance(ctx, indepA.id);
    expect(indepAfter - indepBefore).toBeCloseTo(500, 2);
  });

  // T-S2/T-S3/T-S4 eliminados: delegaban house.inject_capital a empleado/socio
  // para ejercitar el scope check. Con mig 0056 el permiso es NO delegable
  // (solo el admin mintea — modelo docs/20), así que esos escenarios ya no
  // existen. El rechazo de la delegación lo cubre permission-overrides.e2e.ts.
});
