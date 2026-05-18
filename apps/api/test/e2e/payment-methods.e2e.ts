/**
 * E2E: PaymentMethodsController.
 *
 * Cubre:
 *   - Sin JWT → 401.
 *   - JWT cualquier user → 200 con array `data`.
 *   - ?activeOnly=false trae también inactivos (si los hay).
 *
 * Los tests insertan un payment_method de prueba directo en DB porque
 * el módulo NO expone create endpoint (MVP). El seed tampoco crea
 * methods por default.
 */

import { sql } from 'drizzle-orm';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';

describe('PaymentMethodsController (E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    // Limpiar payment_methods entre tests.
    await ctx.tenantDb.execute(sql`DELETE FROM payment_methods`);
  });

  it('sin JWT → 401', async () => {
    const res = await ctx.request
      .get('/tenant/payment-methods')
      .set('Host', TEST_TENANT.host);
    expect(res.status).toBe(401);
  });

  it('admin → 200 con lista activa por default', async () => {
    // Insertamos 2 active + 1 inactive.
    await ctx.tenantDb.execute(
      sql`INSERT INTO payment_methods (id, code, name, type, config, is_active)
          VALUES
            (gen_random_uuid(), 'arg_brubank', 'Brubank ARS', 'bank_transfer', '{"cbu":"123"}'::jsonb, true),
            (gen_random_uuid(), 'usdt_trc20', 'USDT TRC20', 'crypto', '{"address":"T..."}'::jsonb, true),
            (gen_random_uuid(), 'legacy_btc', 'BTC legacy', 'crypto', '{}'::jsonb, false)`,
    );

    const res = await ctx.request
      .get('/tenant/payment-methods')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken);

    expect(res.status).toBe(200);
    const body = res.body as {
      data: Array<{ code: string; name: string; isActive: boolean }>;
    };
    expect(body.data.length).toBe(2);
    expect(body.data.every((m) => m.isActive === true)).toBe(true);
    const codes = body.data.map((m) => m.code).sort();
    expect(codes).toEqual(['arg_brubank', 'usdt_trc20']);
  });

  it('?activeOnly=false trae también inactivos', async () => {
    await ctx.tenantDb.execute(
      sql`INSERT INTO payment_methods (id, code, name, type, config, is_active)
          VALUES
            (gen_random_uuid(), 'm1', 'Method 1', 'bank_transfer', '{}'::jsonb, true),
            (gen_random_uuid(), 'm2', 'Method 2', 'crypto', '{}'::jsonb, false)`,
    );

    const res = await ctx.request
      .get('/tenant/payment-methods')
      .query({ activeOnly: 'false' })
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken);

    expect(res.status).toBe(200);
    const body = res.body as { data: unknown[] };
    expect(body.data.length).toBe(2);
  });

  it('cualquier user logueado puede ver (no requiere permiso especial)', async () => {
    const cajeroToken = await loginAs(
      ctx.request,
      TEST_TENANT.cajero1.username,
      TEST_TENANT.cajero1.password,
    );
    const res = await ctx.request
      .get('/tenant/payment-methods')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', cajeroToken);
    expect(res.status).toBe(200);
  });
});
