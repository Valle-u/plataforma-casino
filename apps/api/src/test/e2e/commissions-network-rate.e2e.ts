/**
 * E2E: comisiones por red — C1 (config en cascada).
 * docs/16-tesoreria.md §11.
 *
 * Verifica `PATCH /tenant/commissions/network-rate/:childUserId`:
 *   - El admin fija la comisión de un operador top-level (socio).
 *   - Un operador fija la de su HIJO DIRECTO dentro del tope.
 *   - Tope (bloqueo): no se puede pagar a un hijo MÁS de lo que uno cobra
 *     → 409 RATE_EXCEEDS_PARENT.
 *   - No se puede fijar la tasa de quien no es hijo directo → 403
 *     NOT_DIRECT_CHILD.
 *   - Tasa fuera de rango [0,100] → 400 (validación DTO).
 */

import { sql } from 'drizzle-orm';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { createTestUser } from '../helpers/test-users';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { TEST_TENANT } from '../setup/test-tenant';

describe('Commissions network-rate (C1, E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function getRate(userId: string): Promise<string> {
    const r = await ctx.tenantDb.execute(
      sql`SELECT commission_rate FROM users WHERE id = ${userId} LIMIT 1`,
    );
    return (
      (r as unknown as Array<{ commission_rate: string }>)[0]?.commission_rate ??
      '0.00'
    );
  }

  function setRate(token: string, childId: string, rate: number) {
    return ctx.request
      .patch(`/tenant/commissions/network-rate/${childId}`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', token)
      .send({ rate });
  }

  async function setParent(
    childId: string,
    parentId: string,
    relationType: string,
  ): Promise<void> {
    const r = await ctx.request
      .put(`/tenant/user-hierarchy/${childId}/parent`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ parentUserId: parentId, relationType });
    if (r.status !== 200 && r.status !== 201) {
      throw new Error(`setParent falló: ${r.status} ${JSON.stringify(r.body)}`);
    }
  }

  it('cascada: admin→socio→distribuidor, con tope y validaciones', async () => {
    // Setup: socio → distribuidor → cajero.
    const socio = await createTestUser(ctx.request, adminToken, {
      suite: 'comm-net-rate',
      label: 'socio',
      role: 'socio',
    });
    const distrib = await createTestUser(ctx.request, adminToken, {
      suite: 'comm-net-rate',
      label: 'distrib',
      role: 'distribuidor',
    });
    const cajero = await createTestUser(ctx.request, adminToken, {
      suite: 'comm-net-rate',
      label: 'cajero',
      role: 'cajero',
    });
    await setParent(distrib.id, socio.id, 'distribuidor_de_socio');
    await setParent(cajero.id, distrib.id, 'cajero_de_distribuidor');

    // 1. El admin fija la comisión del socio (top-level) → 10%.
    const r1 = await setRate(adminToken, socio.id, 10);
    expect(r1.status).toBe(200);
    expect(Number(await getRate(socio.id))).toBeCloseTo(10, 2);

    // 2. El socio fija la de su distribuidor dentro del tope (5 ≤ 10) → OK.
    const socioToken = await loginAs(
      ctx.request,
      socio.username,
      socio.password,
    );
    const r2 = await setRate(socioToken, distrib.id, 5);
    expect(r2.status).toBe(200);
    expect(Number(await getRate(distrib.id))).toBeCloseTo(5, 2);

    // 3. El socio intenta pagarle al distribuidor MÁS de lo que él cobra
    //    (15 > 10) → 409 RATE_EXCEEDS_PARENT, sin cambiar nada.
    const r3 = await setRate(socioToken, distrib.id, 15);
    expect(r3.status).toBe(409);
    expect(r3.body.error).toBe('RATE_EXCEEDS_PARENT');
    expect(Number(await getRate(distrib.id))).toBeCloseTo(5, 2);

    // 4. El socio intenta fijar la del cajero (NO es su hijo directo) → 403.
    const r4 = await setRate(socioToken, cajero.id, 3);
    expect(r4.status).toBe(403);
    expect(r4.body.error).toBe('NOT_DIRECT_CHILD');

    // 5. Tasa fuera de rango (150) → 400 (validación DTO).
    const r5 = await setRate(socioToken, distrib.id, 150);
    expect(r5.status).toBe(400);

    // Limpiar jerarquía creada.
    await ctx.tenantDb.execute(
      sql`DELETE FROM user_hierarchy WHERE user_id IN (${distrib.id}, ${cajero.id})`,
    );
  });
});
