/**
 * E2E: enforcement de las configs nuevas de tenant (site + limits).
 *
 * Cobertura:
 *
 * Registro (site.registration_enabled):
 *   - Default abierto → POST /tenant/auth/register 201.
 *   - Set false → register 403 REGISTRATION_CLOSED (incluso con body válido).
 *   - Re-set true → register vuelve a 201.
 *
 * Depósitos (deposits.min_amount):
 *   - Sin setting → depósito chico se crea (default 0).
 *   - Set 1000 → depósito 500 → 400 DEPOSIT_BELOW_MINIMUM con `minimum`.
 *   - Depósito en el límite (>= min) se crea.
 *
 * Retiros (withdrawals.min_amount):
 *   - Set 500 → retiro 300 → 400 WITHDRAWAL_BELOW_MINIMUM con `minimum`.
 *   - Retiro en el límite (>= min) se crea (status pending, hold).
 */

import postgres from 'postgres';
import supertest from 'supertest';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser } from '../helpers/test-users';
import { fundWalletForTests } from '../helpers/fund-wallet';
import { RateLimiterService } from '../../rate-limit/rate-limiter.service';
import { getTestTenantUrl } from '../setup/db-helpers';

/**
 * Los keys que este suite toca. El cleanup se hace vía API DELETE (no
 * DELETE crudo a DB) porque el TenantSettingsService cachea 5 min in-memory:
 * un delete crudo dejaría el valor viejo en cache y el test siguiente leería
 * un valor fantasma. DELETE → unset() → invalidates cache.
 */
const SUITE_KEYS = [
  'site.registration_enabled',
  'deposits.min_amount',
  'withdrawals.min_amount',
];

async function unsetSuiteKeys(
  request: supertest.Agent,
  adminBearer: string,
): Promise<void> {
  for (const key of SUITE_KEYS) {
    await request
      .delete(`/tenant/settings/${key}`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminBearer);
  }
}

/** Crea un payment method de test directamente en DB (chips_per_unit=1). */
async function createPaymentMethod(code: string): Promise<string> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO payment_methods (id, code, name, type, config, is_active)
      VALUES (gen_random_uuid(), ${code}, ${code + ' display'}, 'bank_transfer', '{"cbu":"0000000000000000000000"}'::jsonb, true)
      RETURNING id
    `;
    return rows[0]!.id;
  } finally {
    await sql.end();
  }
}

function registerBody(username: string): Record<string, unknown> {
  return {
    username,
    password: `pwd-${username}-2026`,
    displayName: 'Register Test',
    // ⚠️ El teléfono es obligatorio: `registration.phone_required` tiene
    // **default `true`** (ver `tenant-auth.controller.ts`, paso 2.5). Sin él el
    // registro devuelve 400 y estos tests fallaban creyendo que el registro
    // estaba cerrado, cuando lo que faltaba era un campo. En el DTO figura como
    // opcional — quien decide es el setting, no la validación.
    phone: `+54911${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`,
    ageConfirmation: true,
    consentDataProcessing: true,
  };
}

describe('Tenant config enforcement (E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let methodId: string;
  let limiter: RateLimiterService;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
    limiter = ctx.app.get(RateLimiterService);
    methodId = await createPaymentMethod(`cfg-method-${Date.now().toString(36)}`);

    // Fondear al admin UNA VEZ para poder fondear players en tests de retiro.
    const me = await ctx.request
      .get('/tenant/auth/me')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken);
    const adminId = (me.body as { user: { id: string } }).user.id;
    await fundWalletForTests(adminId, '10000000');
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await unsetSuiteKeys(ctx.request, adminToken);
    // El register tiene rate limit por IP (5/15min); limpiar evita que
    // corridas previas de esta suite dejen el contador activo en Redis.
    await limiter.clear();
  });

  // ──────────────────────────────────────────────────────────────────────
  // Registro abierto/cerrado (site.registration_enabled)
  // ──────────────────────────────────────────────────────────────────────

  describe('Registro abierto/cerrado', () => {
    it('default (sin setting): register → 201', async () => {
      const suffix = Math.random().toString(36).slice(2, 8);
      const res = await ctx.request
        .post('/tenant/auth/register')
        .set('Host', TEST_TENANT.host)
        .send(registerBody(`r${suffix}`));
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('accessToken');
    });

    it('site.registration_enabled=false → 403 REGISTRATION_CLOSED', async () => {
      await ctx.request
        .patch('/tenant/settings/site.registration_enabled')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: false });
      expect(await readSetting('site.registration_enabled')).toBe(false);

      // Body VÁLIDO — la única razón para el 403 es el cierre de registros.
      const suffix = Math.random().toString(36).slice(2, 8);
      const res = await ctx.request
        .post('/tenant/auth/register')
        .set('Host', TEST_TENANT.host)
        .send(registerBody(`rclosed${suffix}`));
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ error: 'REGISTRATION_CLOSED' });
    });

    it('re-abrir (true) → register vuelve a 201', async () => {
      await ctx.request
        .patch('/tenant/settings/site.registration_enabled')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: false });
      await ctx.request
        .patch('/tenant/settings/site.registration_enabled')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: true });

      const suffix = Math.random().toString(36).slice(2, 8);
      const res = await ctx.request
        .post('/tenant/auth/register')
        .set('Host', TEST_TENANT.host)
        .send(registerBody(`ropen${suffix}`));
      expect(res.status).toBe(201);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Mínimo de depósito (deposits.min_amount)
  // ──────────────────────────────────────────────────────────────────────

  describe('Mínimo de depósito', () => {
    async function createDeposit(token: string, amountFiat: string) {
      return ctx.request
        .post('/tenant/deposits')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token)
        .send({
          methodId,
          amountFiat,
          currencyFiat: 'ARS',
          amountChips: amountFiat, // server recalcula (chips_per_unit=1)
          receiptUrl: 'https://test.local/receipt-cfg.jpg',
          receiptStorageKey: 'test/receipts/cfg.jpg',
        });
    }

    it('sin setting: depósito chico se crea (default sin mínimo)', async () => {
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'cfg-dep-none',
        label: 'p',
        role: 'usuario_final',
      });
      const token = await loginAs(ctx.request, player.username, player.password);
      const r = await createDeposit(token, '50');
      expect(r.status).toBe(201);
    });

    it('deposits.min_amount=1000: depósito 500 → 400 DEPOSIT_BELOW_MINIMUM con minimum', async () => {
      await ctx.request
        .patch('/tenant/settings/deposits.min_amount')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: 1000 });

      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'cfg-dep-low',
        label: 'p',
        role: 'usuario_final',
      });
      const token = await loginAs(ctx.request, player.username, player.password);
      const r = await createDeposit(token, '500');
      expect(r.status).toBe(400);
      expect(r.body).toMatchObject({
        error: 'DEPOSIT_BELOW_MINIMUM',
        minimum: 1000,
      });
    });

    it('deposits.min_amount=1000: depósito en el límite (1000) se crea', async () => {
      await ctx.request
        .patch('/tenant/settings/deposits.min_amount')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: 1000 });

      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'cfg-dep-ok',
        label: 'p',
        role: 'usuario_final',
      });
      const token = await loginAs(ctx.request, player.username, player.password);
      const r = await createDeposit(token, '1000');
      expect(r.status).toBe(201);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Mínimo de retiro (withdrawals.min_amount)
  // ──────────────────────────────────────────────────────────────────────

  describe('Mínimo de retiro', () => {
    async function createFundedUser(
      label: string,
      amount: string,
    ): Promise<string> {
      const user = await createTestUser(ctx.request, adminToken, {
        suite: 'cfg-wd',
        label,
        role: 'usuario_final',
      });
      await ctx.request
        .post('/tenant/wallet/load')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set(
          'Idempotency-Key',
          `cfg-wd-load-${user.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        )
        .send({ targetUserId: user.id, amount });
      return loginAs(ctx.request, user.username, user.password);
    }

    async function createWithdrawal(token: string, amountChips: string) {
      return ctx.request
        .post('/tenant/withdrawals')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token)
        .send({
          methodId,
          amountChips,
          amountFiat: amountChips,
          currencyFiat: 'ARS',
          targetAccount: { cbu: '0000000000000000000000' },
        });
    }

    it('withdrawals.min_amount=500: retiro 300 → 400 WITHDRAWAL_BELOW_MINIMUM con minimum', async () => {
      await ctx.request
        .patch('/tenant/settings/withdrawals.min_amount')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: 500 });

      const token = await createFundedUser('low', '1000');
      const r = await createWithdrawal(token, '300');
      expect(r.status).toBe(400);
      expect(r.body).toMatchObject({
        error: 'WITHDRAWAL_BELOW_MINIMUM',
        minimum: 500,
      });
    });

    it('withdrawals.min_amount=500: retiro en el límite (500) se crea (pending + hold)', async () => {
      await ctx.request
        .patch('/tenant/settings/withdrawals.min_amount')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: 500 });

      const token = await createFundedUser('ok', '1000');
      const r = await createWithdrawal(token, '500');
      expect(r.status).toBe(201);
      expect(r.body.withdrawal.status).toBe('pending');
      expect(r.body.withdrawal.holdId).toBeTruthy();
    });

    it('sin setting: retiro chico se crea (default sin mínimo)', async () => {
      const token = await createFundedUser('none', '1000');
      const r = await createWithdrawal(token, '100');
      expect(r.status).toBe(201);
    });
  });
});

/** Lee un setting directo de DB (evita depender del cache del servicio). */
async function readSetting(key: string): Promise<unknown> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await sql<{ value: unknown }[]>`
      SELECT value FROM tenant_settings WHERE key = ${key} LIMIT 1
    `;
    return rows[0]?.value ?? null;
  } finally {
    await sql.end();
  }
}
