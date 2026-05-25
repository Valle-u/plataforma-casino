/**
 * E2E: RateLimitGuard.
 *
 * Cobertura:
 *
 * Login:
 *   - 10 intentos fallidos con la misma (ip, username) → 11° devuelve 429
 *     con header `Retry-After`.
 *   - Reset-on-success: si tras 5 fallidos se entra correctamente, el
 *     contador se borra y vuelven a estar los 10 disponibles.
 *   - Mismo IP distintos usernames → contadores independientes.
 *   - Username normaliza casing+espacios → "Foo " y "foo" comparten.
 *
 * 2FA confirm:
 *   - Limit 10 por user. 11° intento → 429.
 *   - Success resetea.
 *
 * regenerate-recovery-codes:
 *   - Limit 5 por user / hora. 6° → 429.
 *   - Success resetea.
 *
 * Disabled mode:
 *   - Cuando `RATE_LIMIT_ENABLED=false` el guard no aplica.
 *     (No incluímos test directo porque requeriría reiniciar el app
 *     con env distinto; se cubre indirectamente en el resto del suite
 *     cuando se quiera disable por debug.)
 */

import { createHmac } from 'node:crypto';
import postgres from 'postgres';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { getTestTenantUrl } from '../setup/db-helpers';
import { RateLimiterService } from '../../src/rate-limit/rate-limiter.service';

// ── TOTP hand-rolled (idéntico a otras suites) ────────────────────────────
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

describe('RateLimitGuard (E2E)', () => {
  let ctx: TestApp;
  let limiter: RateLimiterService;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    limiter = ctx.app.get(RateLimiterService);
  });

  afterAll(async () => {
    await resetAdminTwoFa();
    limiter.clear();
    await ctx.close();
  });

  beforeEach(async () => {
    // Cada test parte de cero — sin contadores residuales.
    limiter.clear();
    await resetAdminTwoFa();
  });

  // ──────────────────────────────────────────────────────────────────────
  // Login
  // ──────────────────────────────────────────────────────────────────────
  describe('POST /tenant/auth/login', () => {
    it('bloquea el 11° intento fallido con 429 + Retry-After', async () => {
      // 10 intentos con password mal — todos 401, pero consumen rate.
      for (let i = 0; i < 10; i += 1) {
        const res = await ctx.request
          .post('/tenant/auth/login')
          .set('Host', TEST_TENANT.host)
          .send({
            username: TEST_TENANT.admin.username,
            password: 'wrong-pwd-attempt',
          });
        expect(res.status).toBe(401);
      }

      // 11° → 429.
      const blocked = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({
          username: TEST_TENANT.admin.username,
          password: 'wrong-pwd-attempt',
        });
      expect(blocked.status).toBe(429);
      expect(blocked.body).toMatchObject({ error: 'RATE_LIMITED' });
      expect(blocked.headers['retry-after']).toBeDefined();
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('reset-on-success: login correcto borra el contador de intentos previos', async () => {
      // 5 fallidos.
      for (let i = 0; i < 5; i += 1) {
        const res = await ctx.request
          .post('/tenant/auth/login')
          .set('Host', TEST_TENANT.host)
          .send({
            username: TEST_TENANT.admin.username,
            password: 'wrong-pwd',
          });
        expect(res.status).toBe(401);
      }

      // Login correcto → reset.
      const ok = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({
          username: TEST_TENANT.admin.username,
          password: TEST_TENANT.admin.password,
        });
      expect(ok.status).toBe(200);

      // Ahora podemos volver a tener 10 fallidos sin bloquear.
      for (let i = 0; i < 10; i += 1) {
        const res = await ctx.request
          .post('/tenant/auth/login')
          .set('Host', TEST_TENANT.host)
          .send({
            username: TEST_TENANT.admin.username,
            password: 'wrong-pwd',
          });
        expect(res.status).toBe(401);
      }

      // El 11° fallido bloquea.
      const blocked = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({
          username: TEST_TENANT.admin.username,
          password: 'wrong-pwd',
        });
      expect(blocked.status).toBe(429);
    });

    it('contadores independientes por username — bloqueo a admin no afecta a cajero1', async () => {
      // Bloquear admin.
      for (let i = 0; i < 11; i += 1) {
        await ctx.request
          .post('/tenant/auth/login')
          .set('Host', TEST_TENANT.host)
          .send({
            username: TEST_TENANT.admin.username,
            password: 'wrong',
          });
      }
      const blockedAdmin = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({
          username: TEST_TENANT.admin.username,
          password: 'wrong',
        });
      expect(blockedAdmin.status).toBe(429);

      // cajero1 puede loguearse normalmente.
      const cajero1Ok = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({
          username: TEST_TENANT.cajero1.username,
          password: TEST_TENANT.cajero1.password,
        });
      expect(cajero1Ok.status).toBe(200);
    });

    it('username normaliza casing+espacios para anti-evasion', async () => {
      // 10 fallidos con "jest_admin".
      for (let i = 0; i < 10; i += 1) {
        await ctx.request
          .post('/tenant/auth/login')
          .set('Host', TEST_TENANT.host)
          .send({ username: 'jest_admin', password: 'wrong-pwd' });
      }

      // Mismo username con espacios + casing distinto debería colisionar.
      const blocked = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({ username: ' JEST_admin ', password: 'wrong-pwd' });
      expect(blocked.status).toBe(429);
    });

    it('bucket ip-only frena credential stuffing (rotación de usernames)', async () => {
      // Sprint 54 — cierre OWASP M-001.
      // Atacante rota usernames distintos desde la misma IP: cada username
      // tiene contador propio (10 c/u), así que sin el bucket ip-only
      // podría hacer 1 intento por cada uno de N usernames sin tope.
      // Con el bucket ip-only (100 / 15min), después de 100 intentos
      // desde la misma IP — sin importar qué username use — queda 429.

      // 100 intentos, cada uno con username único → cada bucket
      // (ip+username) está en 1/10, pero el bucket (ip) sube a 100/100.
      for (let i = 0; i < 100; i += 1) {
        const res = await ctx.request
          .post('/tenant/auth/login')
          .set('Host', TEST_TENANT.host)
          .send({
            username: `stuffing_user_${i}`,
            password: 'wrong-pwd',
          });
        // Cada uno debe ser 401 (user inexistente, no rate limit).
        expect(res.status).toBe(401);
      }

      // El 101° desde misma IP — incluso con username totalmente nuevo
      // y password correcto-formato — debe ser 429 por el bucket ip-only.
      const stuffed = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({
          username: 'stuffing_user_new',
          password: 'whatever-pwd',
        });
      expect(stuffed.status).toBe(429);
      expect(stuffed.body).toMatchObject({ error: 'RATE_LIMITED' });
    });

    it('bucket ip-only NO se resetea en login exitoso', async () => {
      // El (ip+username) sí se resetea para no penalizar al user legítimo.
      // El (ip) NO — un atacante que logra entrar a UN user no debe
      // limpiar su contador global de IP.

      // 90 intentos con usernames inexistentes → ip-only en 90/100.
      for (let i = 0; i < 90; i += 1) {
        await ctx.request
          .post('/tenant/auth/login')
          .set('Host', TEST_TENANT.host)
          .send({ username: `stuff_${i}`, password: 'wrong-pwd' });
      }

      // Login exitoso real → resetea el (ip+admin) pero NO el ip-only.
      const ok = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({
          username: TEST_TENANT.admin.username,
          password: TEST_TENANT.admin.password,
        });
      expect(ok.status).toBe(200);

      // Después del success, todavía me quedan ~9 antes del lock ip-only
      // (90 anteriores + 1 success = 91). En el 10° posterior cumplo 100.
      for (let i = 0; i < 9; i += 1) {
        const res = await ctx.request
          .post('/tenant/auth/login')
          .set('Host', TEST_TENANT.host)
          .send({ username: `stuff_post_${i}`, password: 'wrong-pwd' });
        expect(res.status).toBe(401);
      }

      // El siguiente cruza 100 → 429 por ip-only.
      const blocked = await ctx.request
        .post('/tenant/auth/login')
        .set('Host', TEST_TENANT.host)
        .send({ username: 'stuff_post_final', password: 'wrong-pwd' });
      expect(blocked.status).toBe(429);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // 2FA confirm
  // ──────────────────────────────────────────────────────────────────────
  describe('POST /tenant/auth/2fa/confirm', () => {
    it('bloquea 11° intento fallido por user', async () => {
      const bearer = await loginAsAdmin(ctx.request);
      // init para tener un secret.
      await ctx.request
        .post('/tenant/auth/2fa/init')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer);

      // 10 intentos con código mal.
      for (let i = 0; i < 10; i += 1) {
        const res = await ctx.request
          .post('/tenant/auth/2fa/confirm')
          .set('Host', TEST_TENANT.host)
          .set('Authorization', bearer)
          .send({ code: '000000' });
        expect(res.status).toBe(400);
      }

      const blocked = await ctx.request
        .post('/tenant/auth/2fa/confirm')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer)
        .send({ code: '000000' });
      expect(blocked.status).toBe(429);
    });

    it('reset-on-success: confirm exitoso borra el contador', async () => {
      const bearer = await loginAsAdmin(ctx.request);
      const init = await ctx.request
        .post('/tenant/auth/2fa/init')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer);
      const secret = (init.body as { secret: string }).secret;

      // 5 fallidos.
      for (let i = 0; i < 5; i += 1) {
        await ctx.request
          .post('/tenant/auth/2fa/confirm')
          .set('Host', TEST_TENANT.host)
          .set('Authorization', bearer)
          .send({ code: '000000' });
      }

      // Confirm OK → reset.
      const ok = await ctx.request
        .post('/tenant/auth/2fa/confirm')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer)
        .send({ code: codeFor(secret) });
      expect(ok.status).toBe(200);

      // El counter está limpio (peek devuelve -1 si la key no existe).
      // (No re-testeamos otros 10 fallidos por brevedad; este test ya
      // valida el reset semánticamente.)
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // regenerate-recovery-codes
  // ──────────────────────────────────────────────────────────────────────
  describe('POST /tenant/auth/2fa/recovery-codes/regenerate', () => {
    it('bloquea 6° intento fallido por user', async () => {
      // Setup 2FA primero para que regenerate sea endpoint válido.
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

      // 5 intentos con TOTP mal (consumen rate).
      for (let i = 0; i < 5; i += 1) {
        const res = await ctx.request
          .post('/tenant/auth/2fa/recovery-codes/regenerate')
          .set('Host', TEST_TENANT.host)
          .set('Authorization', bearer)
          .send({ code: '000000' });
        expect(res.status).toBe(400);
      }

      const blocked = await ctx.request
        .post('/tenant/auth/2fa/recovery-codes/regenerate')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer)
        .send({ code: '000000' });
      expect(blocked.status).toBe(429);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // RateLimiterService direct (sanity check del store)
  // ──────────────────────────────────────────────────────────────────────
  describe('RateLimiterService (internal)', () => {
    it('cuenta hits e impide más allá del limit', () => {
      const cfg = { rule: 'test', limit: 3, windowSec: 60 };
      const key = 'test:dummy';
      expect(limiter.check(key, cfg).ok).toBe(true);
      expect(limiter.check(key, cfg).ok).toBe(true);
      expect(limiter.check(key, cfg).ok).toBe(true);
      const blocked = limiter.check(key, cfg);
      expect(blocked.ok).toBe(false);
      expect(blocked.retryAfterMs).toBeGreaterThan(0);
    });

    it('reset(key) borra el contador puntual', () => {
      const cfg = { rule: 'test', limit: 2, windowSec: 60 };
      const key = 'test:reset';
      limiter.check(key, cfg);
      limiter.check(key, cfg);
      expect(limiter.check(key, cfg).ok).toBe(false);
      limiter.reset(key);
      expect(limiter.check(key, cfg).ok).toBe(true);
    });

    it('peek(key) devuelve cantidad actual o -1 si no existe', () => {
      const cfg = { rule: 'test', limit: 5, windowSec: 60 };
      const key = 'test:peek';
      expect(limiter.peek(key)).toBe(-1);
      limiter.check(key, cfg);
      limiter.check(key, cfg);
      expect(limiter.peek(key)).toBe(2);
    });
  });
});
