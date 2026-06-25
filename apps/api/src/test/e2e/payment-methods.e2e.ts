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

  // ──────────────────────────────────────────────────────────────────────
  // Mutations (admin)
  // ──────────────────────────────────────────────────────────────────────

  describe('POST /tenant/payment-methods', () => {
    it('admin → 201 con el método creado', async () => {
      const res = await ctx.request
        .post('/tenant/payment-methods')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          code: 'test_bank',
          name: 'Test Bank',
          type: 'bank_transfer',
          config: { cbu: '0000000000000000000000', alias: 'test.alias' },
        });
      expect(res.status).toBe(201);
      const body = res.body as {
        id: string;
        code: string;
        name: string;
        type: string;
        isActive: boolean;
      };
      expect(body.id).toBeDefined();
      expect(body.code).toBe('test_bank');
      expect(body.isActive).toBe(true);
    });

    it('rechaza code duplicado con 409', async () => {
      await ctx.request
        .post('/tenant/payment-methods')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ code: 'dup_method', name: 'First', type: 'other' });
      const res = await ctx.request
        .post('/tenant/payment-methods')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ code: 'dup_method', name: 'Second', type: 'other' });
      expect(res.status).toBe(409);
      expect((res.body as { error: string }).error).toBe(
        'PAYMENT_METHOD_CODE_CONFLICT',
      );
    });

    it('rechaza code inválido (uppercase) con 400', async () => {
      const res = await ctx.request
        .post('/tenant/payment-methods')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ code: 'INVALID_UPPER', name: 'X name', type: 'other' });
      expect(res.status).toBe(400);
    });

    it('cajero1 sin payment_methods.edit → 403', async () => {
      const cajeroToken = await loginAs(
        ctx.request,
        TEST_TENANT.cajero1.username,
        TEST_TENANT.cajero1.password,
      );
      const res = await ctx.request
        .post('/tenant/payment-methods')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajeroToken)
        .send({ code: 'cajero_attempt', name: 'X name', type: 'other' });
      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /tenant/payment-methods/:id', () => {
    it('admin actualiza name + config + isActive', async () => {
      const created = await ctx.request
        .post('/tenant/payment-methods')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          code: 'patch_test',
          name: 'Old name',
          type: 'crypto',
          config: { network: 'TRC20' },
        });
      const id = (created.body as { id: string }).id;

      const res = await ctx.request
        .patch(`/tenant/payment-methods/${id}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          name: 'New name',
          config: { network: 'BEP20', address: 'updated' },
          isActive: false,
        });
      expect(res.status).toBe(200);
      const body = res.body as {
        name: string;
        config: Record<string, unknown>;
        isActive: boolean;
      };
      expect(body.name).toBe('New name');
      expect(body.config.network).toBe('BEP20');
      expect(body.isActive).toBe(false);
    });

    it('404 si el id no existe', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const res = await ctx.request
        .patch(`/tenant/payment-methods/${fakeId}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ name: 'X name' });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /tenant/payment-methods/:id/archive', () => {
    it('admin archiva (isActive=false) y es idempotente', async () => {
      const created = await ctx.request
        .post('/tenant/payment-methods')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ code: 'archive_test', name: 'To archive', type: 'other' });
      const id = (created.body as { id: string }).id;

      const r1 = await ctx.request
        .post(`/tenant/payment-methods/${id}/archive`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(r1.status).toBe(200);
      expect((r1.body as { isActive: boolean }).isActive).toBe(false);

      // Idempotente: re-archive no cambia nada.
      const r2 = await ctx.request
        .post(`/tenant/payment-methods/${id}/archive`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(r2.status).toBe(200);
      expect((r2.body as { isActive: boolean }).isActive).toBe(false);
    });
  });
});
