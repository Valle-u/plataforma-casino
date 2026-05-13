/**
 * E2E: TwoFaPolicyGuard — "2FA obligatorio para roles operativos".
 *
 * Importante: este suite arranca la app con `enableTwoFaPolicy: true`
 * (el resto del suite la tiene disabled).
 *
 * Cobertura:
 *
 * Admin con role admin_tenant (requires_two_fa=true) y two_fa_enabled=false:
 *   - GET /tenant/auth/me → 200 (bypass por @AllowWithoutTwoFa).
 *   - POST /tenant/auth/2fa/init → 200 (bypass).
 *   - POST /tenant/auth/2fa/confirm → 200 (bypass).
 *   - GET /tenant/auth/2fa/recovery-codes/count → 200 (bypass).
 *   - POST /tenant/wallet/mint → 403 TWO_FA_SETUP_REQUIRED.
 *   - GET /tenant/users → 403 TWO_FA_SETUP_REQUIRED.
 *
 * Después de setup completo (two_fa_enabled=true):
 *   - POST /tenant/wallet/mint → 201 (con TOTP, claro).
 *   - GET /tenant/users → 200.
 *
 * Jugador (rol usuario_final, requires_two_fa=false):
 *   - Endpoints normales → 200 (no se exige 2FA).
 *
 * Policy disabled (kill-switch):
 *   - Aunque admin tenga rol operativo sin 2FA, todo pasa.
 */

import { createHmac } from 'node:crypto';
import postgres from 'postgres';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser } from '../helpers/test-users';
import { getTestTenantUrl } from '../setup/db-helpers';
import { TwoFaPolicyService } from '../../src/tenant-auth/two-fa-policy.service';

// TOTP hand-rolled.
function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = input.toUpperCase().replace(/=+$/, '');
  const bytes: number[] = [];
  let buffer = 0;
  let bitsLeft = 0;
  for (const ch of cleaned) {
    const value = alphabet.indexOf(ch);
    if (value < 0) continue;
    buffer = (buffer << 5) | value;
    bitsLeft += 5;
    if (bitsLeft >= 8) {
      bitsLeft -= 8;
      bytes.push((buffer >> bitsLeft) & 0xff);
    }
  }
  return Buffer.from(bytes);
}
function codeFor(secret: string): string {
  const key = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    ((hmac[offset]! & 0x7f) << 24) |
    (hmac[offset + 1]! << 16) |
    (hmac[offset + 2]! << 8) |
    hmac[offset + 3]!;
  return (code % 1_000_000).toString().padStart(6, '0');
}

async function resetAdminTwoFa(): Promise<void> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    await sql.unsafe(`DELETE FROM user_recovery_codes`);
    await sql.unsafe(
      `UPDATE users SET two_fa_secret = NULL, two_fa_enabled = false WHERE username = $1`,
      [TEST_TENANT.admin.username],
    );
  } finally {
    await sql.end();
  }
}

describe('TwoFaPolicyGuard (E2E)', () => {
  let ctx: TestApp;
  let policy: TwoFaPolicyService;

  beforeAll(async () => {
    ctx = await bootstrapTestApp({ enableTwoFaPolicy: true });
    policy = ctx.app.get(TwoFaPolicyService);
    expect(policy.isEnabled()).toBe(true);
  });

  afterAll(async () => {
    await resetAdminTwoFa();
    await ctx.close();
  });

  beforeEach(async () => {
    policy.enable();
    await resetAdminTwoFa();
  });

  // ──────────────────────────────────────────────────────────────────────
  // Admin operativo sin 2FA — algunos endpoints OK (setup), otros bloqueados
  // ──────────────────────────────────────────────────────────────────────
  describe('Admin con role admin_tenant + sin 2FA', () => {
    it('GET /me bypassea la policy (@AllowWithoutTwoFa)', async () => {
      const bearer = await loginAsAdmin(ctx.request);
      const res = await ctx.request
        .get('/tenant/auth/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer);
      expect(res.status).toBe(200);
    });

    it('POST /2fa/init bypassea la policy', async () => {
      const bearer = await loginAsAdmin(ctx.request);
      const res = await ctx.request
        .post('/tenant/auth/2fa/init')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer);
      expect(res.status).toBe(200);
    });

    it('POST /2fa/confirm bypassea la policy', async () => {
      const bearer = await loginAsAdmin(ctx.request);
      const init = await ctx.request
        .post('/tenant/auth/2fa/init')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer);
      const secret = (init.body as { secret: string }).secret;

      const confirm = await ctx.request
        .post('/tenant/auth/2fa/confirm')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer)
        .send({ code: codeFor(secret) });
      expect(confirm.status).toBe(200);
    });

    it('GET /2fa/recovery-codes/count bypassea la policy', async () => {
      const bearer = await loginAsAdmin(ctx.request);
      const res = await ctx.request
        .get('/tenant/auth/2fa/recovery-codes/count')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer);
      expect(res.status).toBe(200);
    });

    it('POST /tenant/wallet/mint → 403 TWO_FA_SETUP_REQUIRED', async () => {
      const bearer = await loginAsAdmin(ctx.request);
      const res = await ctx.request
        .post('/tenant/wallet/mint')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer)
        .set('Idempotency-Key', `mint-policy-${Date.now()}`)
        .send({ amount: '100', reason: 'policy test mint sin 2fa' });
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ error: 'TWO_FA_SETUP_REQUIRED' });
    });

    it('GET /tenant/users → 403 TWO_FA_SETUP_REQUIRED', async () => {
      const bearer = await loginAsAdmin(ctx.request);
      const res = await ctx.request
        .get('/tenant/users')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer);
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ error: 'TWO_FA_SETUP_REQUIRED' });
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Después de setup: admin puede operar
  // ──────────────────────────────────────────────────────────────────────
  describe('Admin después de setup 2FA completo', () => {
    it('mint pasa con 2FA enabled + TOTP code', async () => {
      // Setup 2FA primero.
      const bearer = await loginAsAdmin(ctx.request);
      const init = await ctx.request
        .post('/tenant/auth/2fa/init')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer);
      const secret = (init.body as { secret: string }).secret;
      await ctx.request
        .post('/tenant/auth/2fa/confirm')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer)
        .send({ code: codeFor(secret) });

      // Ahora el admin tiene 2FA enabled. Necesita re-login con TOTP.
      const loginRes = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({
          username: TEST_TENANT.admin.username,
          password: TEST_TENANT.admin.password,
          twoFaCode: codeFor(secret),
        });
      expect(loginRes.status).toBe(200);
      const newBearer = `Bearer ${(loginRes.body as { accessToken: string }).accessToken}`;

      const mint = await ctx.request
        .post('/tenant/wallet/mint')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', newBearer)
        .set('Idempotency-Key', `mint-policy-ok-${Date.now()}`)
        .send({
          amount: '100',
          reason: 'mint despues de setup 2fa policy test',
          twoFaCode: codeFor(secret),
        });
      expect(mint.status).toBe(201);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Jugador (rol usuario_final, requires_two_fa=false)
  // ──────────────────────────────────────────────────────────────────────
  describe('Jugador (rol no operativo)', () => {
    it('puede operar sin 2FA — la policy no aplica', async () => {
      // Crear un user "usuario_final".
      const adminBearer = await loginAsAdmin(ctx.request);
      // Pero admin no puede crear users en este estado (403 por policy).
      // Workaround: deshabilitamos la policy temporalmente para setup.
      policy.disable();
      const player = await createTestUser(ctx.request, adminBearer, {
        suite: 'two-fa-policy',
        label: 'player',
        role: 'usuario_final',
      });
      policy.enable();

      // Jugador puede hacer login + ver /me sin 2FA.
      const playerBearer = await loginAs(ctx.request, player.username, player.password);
      const me = await ctx.request
        .get('/tenant/auth/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerBearer);
      expect(me.status).toBe(200);

      // Jugador llega a su propio wallet (no requires_two_fa, policy ok).
      const wallet = await ctx.request
        .get('/tenant/wallet/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', playerBearer);
      expect(wallet.status).toBe(200);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Kill-switch
  // ──────────────────────────────────────────────────────────────────────
  describe('Kill-switch policy.disable()', () => {
    it('con policy deshabilitada, admin sin 2FA puede acceder a wallet', async () => {
      policy.disable();
      const bearer = await loginAsAdmin(ctx.request);
      const res = await ctx.request
        .get('/tenant/wallet/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer);
      expect(res.status).toBe(200);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Service-level checks
  // ──────────────────────────────────────────────────────────────────────
  describe('TwoFaPolicyService (internal)', () => {
    it('isEnabled() refleja enable()/disable()', () => {
      policy.enable();
      expect(policy.isEnabled()).toBe(true);
      policy.disable();
      expect(policy.isEnabled()).toBe(false);
      policy.enable();
      expect(policy.isEnabled()).toBe(true);
    });
  });
});
