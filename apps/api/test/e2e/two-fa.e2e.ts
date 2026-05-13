/**
 * E2E: 2FA TOTP.
 *
 * Cobertura:
 *
 * Flow init/confirm/disable:
 *   - POST /tenant/auth/2fa/init devuelve secret + otpauthUrl, deja
 *     two_fa_enabled = false hasta el confirm.
 *   - init re-llamado sobre user con 2FA enabled → 409 TWO_FA_ALREADY_ENABLED.
 *   - confirm con código válido → two_fa_enabled = true + audit entry.
 *   - confirm con código inválido → 400 TWO_FA_CODE_INVALID.
 *   - DELETE /tenant/auth/2fa con código válido → desactiva.
 *   - DELETE sin código válido → 401 TWO_FA_CODE_INVALID.
 *
 * Login con 2FA:
 *   - Login sin twoFaCode con user que tiene 2FA → 400 TWO_FA_REQUIRED.
 *   - Login con twoFaCode incorrecto → 401.
 *   - Login con twoFaCode válido → 200 + accessToken.
 *   - Login con user SIN 2FA + twoFaCode → 200 (campo se ignora).
 *
 * Mint con 2FA:
 *   - Mint sin twoFaCode con admin que tiene 2FA → 400 TWO_FA_REQUIRED.
 *   - Mint con twoFaCode válido → 201.
 *   - Mint sobre admin sin 2FA → no exige código.
 */

import { createHmac } from 'node:crypto';
import postgres from 'postgres';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { getTestTenantUrl } from '../setup/db-helpers';

/** Limpia el 2FA del admin para asegurar partir de estado conocido. */
async function resetAdminTwoFa(): Promise<void> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    await sql.unsafe(
      `UPDATE users SET two_fa_secret = NULL, two_fa_enabled = false WHERE username = $1`,
      [TEST_TENANT.admin.username],
    );
  } finally {
    await sql.end();
  }
}

/** Lee el secret 2FA actual del admin (después de init). */
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

/** Lee enabled flag del admin. */
async function readAdminTwoFaEnabled(): Promise<boolean> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await sql<{ two_fa_enabled: boolean }[]>`
      SELECT two_fa_enabled FROM users WHERE username = ${TEST_TENANT.admin.username}
    `;
    return rows[0]?.two_fa_enabled ?? false;
  } finally {
    await sql.end();
  }
}

/**
 * Decodifica un secret Base32 (RFC 4648) a Buffer.
 * Implementación inline para no depender de otplib en el test process
 * (otplib usa @scure/base ESM-only que rompe el module loader de jest).
 */
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

/**
 * Genera código TOTP RFC 6238 con los defaults estándar (period=30, digits=6,
 * SHA-1), que es lo que usa otplib en el server.
 */
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

/**
 * Helper end-to-end: init + confirm 2FA en el admin. Deja al admin con 2FA
 * enabled y devuelve el secret para que el test pueda generar códigos.
 */
async function enableTwoFaForAdmin(ctx: TestApp): Promise<string> {
  const bearer = await loginAsAdmin(ctx.request);
  const initRes = await ctx.request
    .post('/tenant/auth/2fa/init')
    .set('Host', TEST_TENANT.host)
    .set('Authorization', bearer);
  expect(initRes.status).toBe(200);
  const secret = (initRes.body as { secret: string }).secret;

  const confirmRes = await ctx.request
    .post('/tenant/auth/2fa/confirm')
    .set('Host', TEST_TENANT.host)
    .set('Authorization', bearer)
    .send({ code: codeFor(secret) });
  expect(confirmRes.status).toBe(200);
  return secret;
}

describe('2FA TOTP (E2E)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
  });

  afterAll(async () => {
    await resetAdminTwoFa();
    await ctx.close();
  });

  beforeEach(async () => {
    await resetAdminTwoFa();
  });

  // ──────────────────────────────────────────────────────────────────────
  // init / confirm / disable
  // ──────────────────────────────────────────────────────────────────────
  describe('POST /tenant/auth/2fa/init', () => {
    it('devuelve secret + otpauthUrl y deja two_fa_enabled = false', async () => {
      const bearer = await loginAsAdmin(ctx.request);
      const res = await ctx.request
        .post('/tenant/auth/2fa/init')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        secret: expect.any(String) as string,
        otpauthUrl: expect.stringContaining('otpauth://') as string,
      });

      const enabled = await readAdminTwoFaEnabled();
      expect(enabled).toBe(false);

      const persisted = await readAdminTwoFaSecret();
      expect(persisted).toBe((res.body as { secret: string }).secret);
    });

    it('responde 409 TWO_FA_ALREADY_ENABLED si el user ya tiene 2FA activo', async () => {
      await enableTwoFaForAdmin(ctx);
      const bearer = await loginAsAdminWith2Fa(ctx);

      const res = await ctx.request
        .post('/tenant/auth/2fa/init')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer);

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: 'TWO_FA_ALREADY_ENABLED' });
    });

    it('rechaza request sin JWT', async () => {
      const res = await ctx.request
        .post('/tenant/auth/2fa/init')
        .set('Host', TEST_TENANT.host);
      expect(res.status).toBe(401);
    });
  });

  describe('POST /tenant/auth/2fa/confirm', () => {
    it('habilita 2FA con código válido', async () => {
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
      expect(confirm.body).toMatchObject({ ok: true });

      const enabled = await readAdminTwoFaEnabled();
      expect(enabled).toBe(true);
    });

    it('rechaza código inválido con 400 TWO_FA_CODE_INVALID', async () => {
      const bearer = await loginAsAdmin(ctx.request);
      await ctx.request
        .post('/tenant/auth/2fa/init')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer);

      const res = await ctx.request
        .post('/tenant/auth/2fa/confirm')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer)
        .send({ code: '000000' });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: 'TWO_FA_CODE_INVALID' });

      const enabled = await readAdminTwoFaEnabled();
      expect(enabled).toBe(false);
    });

    it('responde 400 TWO_FA_NOT_INITIALIZED si nunca se llamó init', async () => {
      const bearer = await loginAsAdmin(ctx.request);
      const res = await ctx.request
        .post('/tenant/auth/2fa/confirm')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer)
        .send({ code: '123456' });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: 'TWO_FA_NOT_INITIALIZED' });
    });

    it('rechaza body sin code (DTO)', async () => {
      const bearer = await loginAsAdmin(ctx.request);
      const res = await ctx.request
        .post('/tenant/auth/2fa/confirm')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer)
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /tenant/auth/2fa', () => {
    it('desactiva 2FA con código válido', async () => {
      const secret = await enableTwoFaForAdmin(ctx);
      const bearer = await loginAsAdminWith2FaSecret(ctx, secret);

      const res = await ctx.request
        .delete('/tenant/auth/2fa')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer)
        .send({ code: codeFor(secret) });

      expect(res.status).toBe(200);
      const enabled = await readAdminTwoFaEnabled();
      expect(enabled).toBe(false);
    });

    it('responde 401 TWO_FA_CODE_INVALID con código incorrecto', async () => {
      await enableTwoFaForAdmin(ctx);
      const bearer = await loginAsAdminWith2Fa(ctx);

      const res = await ctx.request
        .delete('/tenant/auth/2fa')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer)
        .send({ code: '000000' });

      expect(res.status).toBe(401);
      const enabled = await readAdminTwoFaEnabled();
      expect(enabled).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Login con 2FA
  // ──────────────────────────────────────────────────────────────────────
  describe('Login con 2FA', () => {
    it('sin twoFaCode + user con 2FA → 400 TWO_FA_REQUIRED', async () => {
      await enableTwoFaForAdmin(ctx);

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

    it('con twoFaCode incorrecto → 401', async () => {
      await enableTwoFaForAdmin(ctx);

      const res = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({
          username: TEST_TENANT.admin.username,
          password: TEST_TENANT.admin.password,
          twoFaCode: '000000',
        });

      expect(res.status).toBe(401);
    });

    it('con twoFaCode válido → 200 + accessToken', async () => {
      const secret = await enableTwoFaForAdmin(ctx);

      const res = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({
          username: TEST_TENANT.admin.username,
          password: TEST_TENANT.admin.password,
          twoFaCode: codeFor(secret),
        });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        accessToken: expect.any(String) as string,
        refreshToken: expect.any(String) as string,
      });
    });

    it('user SIN 2FA acepta login con o sin twoFaCode (campo ignorado)', async () => {
      // admin sin 2FA — beforeEach ya garantiza ese estado.
      const res = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({
          username: TEST_TENANT.admin.username,
          password: TEST_TENANT.admin.password,
          twoFaCode: '123456',
        });

      expect(res.status).toBe(200);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Mint con 2FA
  // ──────────────────────────────────────────────────────────────────────
  describe('Mint con 2FA', () => {
    it('sin twoFaCode + admin con 2FA → 400 TWO_FA_REQUIRED', async () => {
      const secret = await enableTwoFaForAdmin(ctx);
      const bearer = await loginAsAdminWith2FaSecret(ctx, secret);

      const res = await ctx.request
        .post('/tenant/wallet/mint')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer)
        .set('Idempotency-Key', `mint-2fa-no-${Date.now()}`)
        .send({ amount: '100', reason: 'mint 2fa test sin codigo' });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: 'TWO_FA_REQUIRED' });
    });

    it('con twoFaCode válido → 201 OK', async () => {
      const secret = await enableTwoFaForAdmin(ctx);
      const bearer = await loginAsAdminWith2FaSecret(ctx, secret);

      const res = await ctx.request
        .post('/tenant/wallet/mint')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer)
        .set('Idempotency-Key', `mint-2fa-ok-${Date.now()}`)
        .send({
          amount: '100',
          reason: 'mint 2fa test con codigo valido',
          twoFaCode: codeFor(secret),
        });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ ok: true });
    });

    it('con twoFaCode incorrecto → 400 TWO_FA_CODE_INVALID', async () => {
      const secret = await enableTwoFaForAdmin(ctx);
      const bearer = await loginAsAdminWith2FaSecret(ctx, secret);

      const res = await ctx.request
        .post('/tenant/wallet/mint')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer)
        .set('Idempotency-Key', `mint-2fa-bad-${Date.now()}`)
        .send({
          amount: '100',
          reason: 'mint 2fa test con codigo invalido',
          twoFaCode: '000000',
        });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: 'TWO_FA_CODE_INVALID' });
    });

    it('admin sin 2FA mintea sin pedir código', async () => {
      const bearer = await loginAsAdmin(ctx.request);
      const res = await ctx.request
        .post('/tenant/wallet/mint')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer)
        .set('Idempotency-Key', `mint-2fa-off-${Date.now()}`)
        .send({ amount: '50', reason: 'mint sin 2fa test admin' });

      expect(res.status).toBe(201);
    });
  });
});

// ──────────────────────────────────────────────────────────────────────
// Helpers locales: login con 2FA cuando el admin ya tiene 2FA habilitado
// ──────────────────────────────────────────────────────────────────────
async function loginAsAdminWith2Fa(ctx: TestApp): Promise<string> {
  // Re-leemos el secret de DB (el flow init+confirm lo dejó persistido).
  const secret = await readAdminTwoFaSecret();
  if (!secret) {
    throw new Error('readAdminTwoFaSecret devolvió null — el admin no tiene 2FA setup.');
  }
  return loginAsAdminWith2FaSecret(ctx, secret);
}

async function loginAsAdminWith2FaSecret(ctx: TestApp, secret: string): Promise<string> {
  const res = await ctx.request
    .post('/tenant/auth/login')
    .set('Host', TEST_TENANT.host)
    .send({
      username: TEST_TENANT.admin.username,
      password: TEST_TENANT.admin.password,
      twoFaCode: codeFor(secret),
    });
  if (res.status !== 200) {
    throw new Error(`Login con 2FA falló: HTTP ${res.status} ${JSON.stringify(res.body)}`);
  }
  return `Bearer ${(res.body as { accessToken: string }).accessToken}`;
}
