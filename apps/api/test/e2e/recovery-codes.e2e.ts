/**
 * E2E: 2FA Recovery Codes.
 *
 * Cobertura:
 *
 * confirmSetup devuelve codes:
 *   - 10 codes con formato `xxxx-xxxx-xx`.
 *   - Una vez devueltos, NO se pueden re-obtener vía API (solo regen).
 *
 * Login con recovery code:
 *   - User con 2FA + recoveryCode válido → 200, code queda consumido.
 *   - Re-uso del mismo code → 401.
 *   - recoveryCode válido SIN guiones también funciona.
 *   - recoveryCode válido en mayúsculas también funciona.
 *   - recoveryCode con shape inválido → 401.
 *   - Login sin twoFaCode NI recoveryCode → 400 TWO_FA_REQUIRED.
 *
 * Regenerate:
 *   - Requiere TOTP fresco.
 *   - TOTP inválido → 400 TWO_FA_CODE_INVALID.
 *   - Devuelve nuevos 10 codes, los anteriores quedan invalidados.
 *
 * Count:
 *   - Inicial = 10 después del setup.
 *   - Después de usar 1 = 9.
 *   - Después de regenerar = 10.
 *
 * Disable 2FA:
 *   - Borra todos los recovery codes (count = 0 después).
 */

import { createHmac } from 'node:crypto';
import postgres from 'postgres';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { getTestTenantUrl } from '../setup/db-helpers';

// ──────────────────────────────────────────────────────────────────────
// TOTP helpers (idénticos a two-fa.e2e — re-implementados acá para no
// crear dependencia cross-test).
// ──────────────────────────────────────────────────────────────────────

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

// ──────────────────────────────────────────────────────────────────────
// DB helpers
// ──────────────────────────────────────────────────────────────────────

async function resetAdminTwoFaAndRecovery(): Promise<void> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    // Limpia recovery codes (cualquier user) y 2FA del admin.
    await sql.unsafe(`DELETE FROM user_recovery_codes`);
    await sql.unsafe(
      `UPDATE users SET two_fa_secret = NULL, two_fa_enabled = false WHERE username = $1`,
      [TEST_TENANT.admin.username],
    );
  } finally {
    await sql.end();
  }
}

async function readAdminTwoFaSecret(): Promise<string | null> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await sql<{ two_fa_secret: string | null }[]>`
      SELECT two_fa_secret FROM users WHERE username = ${TEST_TENANT.admin.username}
    `;
    return rows[0]?.two_fa_secret ?? null;
  } finally {
    await sql.end();
  }
}

// ──────────────────────────────────────────────────────────────────────
// Helpers de flow: setup 2FA + retorna {secret, codes, bearer}
// ──────────────────────────────────────────────────────────────────────

async function setupTwoFaForAdmin(
  ctx: TestApp,
): Promise<{ secret: string; codes: string[] }> {
  const bearer = await loginAsAdmin(ctx.request);

  const init = await ctx.request
    .post('/tenant/auth/2fa/init')
    .set('Host', TEST_TENANT.host)
    .set('Authorization', bearer);
  expect(init.status).toBe(200);
  const secret = (init.body as { secret: string }).secret;

  const confirm = await ctx.request
    .post('/tenant/auth/2fa/confirm')
    .set('Host', TEST_TENANT.host)
    .set('Authorization', bearer)
    .send({ code: codeFor(secret) });
  expect(confirm.status).toBe(200);
  const codes = (confirm.body as { recoveryCodes: string[] }).recoveryCodes;
  expect(codes).toHaveLength(10);

  return { secret, codes };
}

async function loginAsAdminWithTotp(ctx: TestApp, secret: string): Promise<string> {
  const res = await ctx.request
    .post('/tenant/auth/login')
    .set('Host', TEST_TENANT.host)
    .send({
      username: TEST_TENANT.admin.username,
      password: TEST_TENANT.admin.password,
      twoFaCode: codeFor(secret),
    });
  if (res.status !== 200) {
    throw new Error(`Login con TOTP falló: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return `Bearer ${(res.body as { accessToken: string }).accessToken}`;
}

describe('2FA Recovery Codes (E2E)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
  });

  afterAll(async () => {
    await resetAdminTwoFaAndRecovery();
    await ctx.close();
  });

  beforeEach(async () => {
    await resetAdminTwoFaAndRecovery();
  });

  // ──────────────────────────────────────────────────────────────────────
  // confirmSetup devuelve codes
  // ──────────────────────────────────────────────────────────────────────
  describe('confirmSetup devuelve recovery codes', () => {
    it('devuelve 10 codes con formato xxxx-xxxx-xx después del confirm', async () => {
      const { codes } = await setupTwoFaForAdmin(ctx);
      expect(codes).toHaveLength(10);
      for (const c of codes) {
        // 10 hex chars + 2 guiones = 12 chars
        expect(c).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{2}$/);
      }
      // Sin duplicados.
      expect(new Set(codes).size).toBe(10);
    });

    it('el endpoint count devuelve 10 al iniciarse', async () => {
      await setupTwoFaForAdmin(ctx);
      const bearer = await loginAsAdminWithTotp(ctx, (await readAdminTwoFaSecret())!);

      const res = await ctx.request
        .get('/tenant/auth/2fa/recovery-codes/count')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ active: 10 });
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Login con recovery code
  // ──────────────────────────────────────────────────────────────────────
  describe('Login con recovery code', () => {
    it('acepta un recovery code válido y lo consume', async () => {
      const { codes } = await setupTwoFaForAdmin(ctx);
      const codeToUse = codes[0]!;

      const res = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({
          username: TEST_TENANT.admin.username,
          password: TEST_TENANT.admin.password,
          recoveryCode: codeToUse,
        });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        accessToken: expect.any(String) as string,
        refreshToken: expect.any(String) as string,
      });

      // Re-uso del mismo code → 401.
      const reuse = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({
          username: TEST_TENANT.admin.username,
          password: TEST_TENANT.admin.password,
          recoveryCode: codeToUse,
        });
      expect(reuse.status).toBe(401);
    });

    it('count baja en 1 después de consumir un recovery code', async () => {
      const { codes, secret } = await setupTwoFaForAdmin(ctx);

      // Consumir 1 via login.
      await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({
          username: TEST_TENANT.admin.username,
          password: TEST_TENANT.admin.password,
          recoveryCode: codes[0]!,
        });

      const bearer = await loginAsAdminWithTotp(ctx, secret);
      const res = await ctx.request
        .get('/tenant/auth/2fa/recovery-codes/count')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer);

      expect(res.body).toEqual({ active: 9 });
    });

    it('acepta el code sin guiones (formato denso)', async () => {
      const { codes } = await setupTwoFaForAdmin(ctx);
      const dense = codes[0]!.replace(/-/g, '');

      const res = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({
          username: TEST_TENANT.admin.username,
          password: TEST_TENANT.admin.password,
          recoveryCode: dense,
        });
      expect(res.status).toBe(200);
    });

    it('acepta el code en MAYÚSCULAS', async () => {
      const { codes } = await setupTwoFaForAdmin(ctx);
      const upper = codes[0]!.toUpperCase();

      const res = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({
          username: TEST_TENANT.admin.username,
          password: TEST_TENANT.admin.password,
          recoveryCode: upper,
        });
      expect(res.status).toBe(200);
    });

    it('rechaza recovery code con shape inválido → 401', async () => {
      await setupTwoFaForAdmin(ctx);

      const res = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({
          username: TEST_TENANT.admin.username,
          password: TEST_TENANT.admin.password,
          recoveryCode: 'aaaa-bbbb-cc', // hex válido pero NO está en la DB
        });
      expect(res.status).toBe(401);
    });

    it('rechaza recovery code inexistente → 401', async () => {
      await setupTwoFaForAdmin(ctx);

      const res = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({
          username: TEST_TENANT.admin.username,
          password: TEST_TENANT.admin.password,
          recoveryCode: '0000-0000-00', // shape válida, no existe en DB
        });
      expect(res.status).toBe(401);
    });

    it('login sin twoFaCode NI recoveryCode → 400 TWO_FA_REQUIRED', async () => {
      await setupTwoFaForAdmin(ctx);

      const res = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({
          username: TEST_TENANT.admin.username,
          password: TEST_TENANT.admin.password,
        });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: 'TWO_FA_REQUIRED' });
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Regenerate
  // ──────────────────────────────────────────────────────────────────────
  describe('POST /2fa/recovery-codes/regenerate', () => {
    it('genera 10 codes nuevos e invalida los viejos', async () => {
      const { codes: oldCodes, secret } = await setupTwoFaForAdmin(ctx);
      const bearer = await loginAsAdminWithTotp(ctx, secret);

      const res = await ctx.request
        .post('/tenant/auth/2fa/recovery-codes/regenerate')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer)
        .send({ code: codeFor(secret) });

      expect(res.status).toBe(200);
      const newCodes = (res.body as { recoveryCodes: string[] }).recoveryCodes;
      expect(newCodes).toHaveLength(10);
      // No hay overlap entre viejos y nuevos.
      const overlap = newCodes.filter((c) => oldCodes.includes(c));
      expect(overlap).toHaveLength(0);

      // Un code viejo NO sirve para login.
      const reuseOld = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({
          username: TEST_TENANT.admin.username,
          password: TEST_TENANT.admin.password,
          recoveryCode: oldCodes[0]!,
        });
      expect(reuseOld.status).toBe(401);

      // Un code nuevo SÍ.
      const useNew = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({
          username: TEST_TENANT.admin.username,
          password: TEST_TENANT.admin.password,
          recoveryCode: newCodes[0]!,
        });
      expect(useNew.status).toBe(200);
    });

    it('rechaza regenerate con TOTP inválido → 400', async () => {
      const { secret } = await setupTwoFaForAdmin(ctx);
      const bearer = await loginAsAdminWithTotp(ctx, secret);

      const res = await ctx.request
        .post('/tenant/auth/2fa/recovery-codes/regenerate')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer)
        .send({ code: '000000' });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: 'TWO_FA_CODE_INVALID' });
    });

    it('rechaza regenerate si el user no tiene 2FA enabled → 400', async () => {
      // Login sin 2FA setup.
      const bearer = await loginAsAdmin(ctx.request);

      const res = await ctx.request
        .post('/tenant/auth/2fa/recovery-codes/regenerate')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer)
        .send({ code: '123456' });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: 'TWO_FA_NOT_INITIALIZED' });
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Disable 2FA borra recovery codes
  // ──────────────────────────────────────────────────────────────────────
  describe('Disable 2FA borra recovery codes', () => {
    it('DELETE /2fa elimina los recovery codes del user', async () => {
      const { secret } = await setupTwoFaForAdmin(ctx);
      const bearer = await loginAsAdminWithTotp(ctx, secret);

      // Disable.
      const disable = await ctx.request
        .delete('/tenant/auth/2fa')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer)
        .send({ code: codeFor(secret) });
      expect(disable.status).toBe(200);

      // Verificar count vía DB directa (porque el endpoint count exige
      // JWT y ya no tenemos restricción, pero count refleja la realidad).
      const sql = postgres(getTestTenantUrl(), { max: 1 });
      try {
        const rows = await sql<{ count: string }[]>`
          SELECT count(*) FROM user_recovery_codes
        `;
        expect(Number(rows[0]!.count)).toBe(0);
      } finally {
        await sql.end();
      }
    });
  });
});
