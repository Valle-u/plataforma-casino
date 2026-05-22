/**
 * Unit tests para `redact.ts`.
 *
 * Cobertura:
 *   - Keys conocidas → reemplazadas por '[REDACTED]'.
 *   - Keys insensitive case (PasswordHash, PASSWORD, password_hash).
 *   - Nesting profundo.
 *   - Arrays.
 *   - Primitives → no se tocan.
 *   - Circular refs → no rompen.
 *   - Options.extra agrega keys.
 *   - Options.redactEmailPhone activa email/phone.
 *   - hashForLog estable + prefijo configurable.
 */

import { hashForLog, redactHttpRequest, redactSensitive } from './redact';

describe('redactSensitive', () => {
  it('reemplaza keys sensibles del set por defecto', () => {
    const out = redactSensitive({
      username: 'alice',
      password: 'super-secret-123',
      passwordHash: 'argon2id$...',
      twoFaSecret: 'JBSWY3DPEHPK3PXP',
      refreshToken: 'rt_abc.def.ghi',
    });
    expect(out).toEqual({
      username: 'alice',
      password: '[REDACTED]',
      passwordHash: '[REDACTED]',
      twoFaSecret: '[REDACTED]',
      refreshToken: '[REDACTED]',
    });
  });

  it('es case-insensitive en keys (PasswordHash, PASSWORD, password_hash)', () => {
    const out = redactSensitive({
      PasswordHash: 'x',
      PASSWORD: 'y',
      password_hash: 'z',
      TwoFA_Secret: 'w',
    });
    // password_hash + PasswordHash + PASSWORD todos matchean.
    // TwoFA_Secret no matchea exacto pero `two_fa_secret` sí — ojo
    // que el lookup es por toLowerCase: 'twofa_secret' != 'two_fa_secret'.
    // Documentado: solo matchean los aliases registrados.
    expect(out).toEqual({
      PasswordHash: '[REDACTED]',
      PASSWORD: '[REDACTED]',
      password_hash: '[REDACTED]',
      TwoFA_Secret: 'w', // no matchea ningún alias
    });
  });

  it('recorre nested deep', () => {
    const out = redactSensitive({
      user: {
        id: '123',
        credentials: {
          password: 'x',
          token: 'y',
        },
      },
    });
    expect(out).toEqual({
      user: {
        id: '123',
        credentials: {
          password: '[REDACTED]',
          token: '[REDACTED]',
        },
      },
    });
  });

  it('recorre arrays', () => {
    const out = redactSensitive([
      { password: 'a', name: 'alice' },
      { password: 'b', name: 'bob' },
    ]);
    expect(out).toEqual([
      { password: '[REDACTED]', name: 'alice' },
      { password: '[REDACTED]', name: 'bob' },
    ]);
  });

  it('no toca primitives', () => {
    expect(redactSensitive('hello')).toBe('hello');
    expect(redactSensitive(42)).toBe(42);
    expect(redactSensitive(null)).toBe(null);
    expect(redactSensitive(undefined)).toBe(undefined);
    expect(redactSensitive(true)).toBe(true);
  });

  it('no rompe con referencias circulares', () => {
    const a: Record<string, unknown> = { name: 'a', password: 'x' };
    a.self = a;
    const out = redactSensitive(a) as Record<string, unknown>;
    expect(out.name).toBe('a');
    expect(out.password).toBe('[REDACTED]');
    expect(out.self).toBe('[CIRCULAR]');
  });

  it('options.extra agrega keys', () => {
    const out = redactSensitive(
      { name: 'alice', cbu: '0000111122223333' },
      { extra: ['cbu'] },
    );
    expect(out).toEqual({ name: 'alice', cbu: '[REDACTED]' });
  });

  it('options.redactEmailPhone activa email/phone', () => {
    const out = redactSensitive(
      { name: 'alice', email: 'a@b.com', phone: '+541112345' },
      { redactEmailPhone: true },
    );
    expect(out).toEqual({
      name: 'alice',
      email: '[REDACTED]',
      phone: '[REDACTED]',
    });
  });

  it('por default NO redacta email/phone', () => {
    const out = redactSensitive({
      email: 'a@b.com',
      phone: '+541112345',
    });
    expect(out).toEqual({
      email: 'a@b.com',
      phone: '+541112345',
    });
  });

  it('redacta headers HTTP sensibles (authorization, cookie)', () => {
    const out = redactSensitive({
      authorization: 'Bearer eyJhbGc...',
      cookie: 'session=abc',
      'set-cookie': ['session=xyz'],
      'user-agent': 'Mozilla/5.0',
    });
    expect(out).toEqual({
      authorization: '[REDACTED]',
      cookie: '[REDACTED]',
      'set-cookie': '[REDACTED]',
      'user-agent': 'Mozilla/5.0',
    });
  });

  it('no muta el input original', () => {
    const input = { password: 'x', name: 'alice' };
    const out = redactSensitive(input);
    expect(input.password).toBe('x');
    expect(out).not.toBe(input);
  });
});

describe('redactHttpRequest', () => {
  it('sanitiza body, headers, query, params', () => {
    const out = redactHttpRequest({
      body: { username: 'alice', password: 'secret' },
      headers: {
        authorization: 'Bearer x',
        'content-type': 'application/json',
      },
      query: { token: 'q-tok', search: 'foo' },
      params: { id: '123' },
    });
    expect(out.body).toEqual({ username: 'alice', password: '[REDACTED]' });
    expect(out.headers).toEqual({
      authorization: '[REDACTED]',
      'content-type': 'application/json',
    });
    expect(out.query).toEqual({ token: '[REDACTED]', search: 'foo' });
    expect(out.params).toEqual({ id: '123' });
  });

  it('tolera body/headers/query/params undefined', () => {
    const out = redactHttpRequest({});
    expect(out).toEqual({
      body: null,
      headers: null,
      query: null,
      params: null,
    });
  });
});

describe('hashForLog', () => {
  it('produce un hash estable para el mismo input', () => {
    expect(hashForLog('alice')).toBe(hashForLog('alice'));
  });

  it('produce hashes diferentes para inputs diferentes', () => {
    expect(hashForLog('alice')).not.toBe(hashForLog('bob'));
  });

  it('usa prefijo configurable', () => {
    expect(hashForLog('a@b.com')).toMatch(/^usr_/);
    expect(hashForLog('a@b.com', 'email')).toMatch(/^email_/);
  });

  it('siempre devuelve 8 hex chars (+ prefijo + underscore)', () => {
    const h = hashForLog('cualquier-cosa');
    // 'usr_' + 8 hex
    expect(h).toMatch(/^usr_[a-f0-9]{8}$/);
  });
});
