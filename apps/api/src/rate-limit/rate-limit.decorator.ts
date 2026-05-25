/**
 * `@RateLimit(...)` — decorator declarativo para endpoints sensibles.
 *
 * Uso single-rule:
 *   @RateLimit({ rule: 'auth.login', limit: 10, windowSec: 900, scope: 'ip+body.username' })
 *   @Post('login')
 *   login(...) { ... }
 *
 * Uso multi-rule (Sprint 54 — para login: una regla por (ip, username)
 * + otra ip-only para frenar credential stuffing donde un atacante rota
 * miles de usernames distintos desde la misma IP):
 *   @RateLimit([
 *     { rule: 'auth.login', limit: 10, windowSec: 900, scope: 'ip+body.username' },
 *     { rule: 'auth.login.ip', limit: 100, windowSec: 900, scope: 'ip' },
 *   ])
 *
 * El `RateLimitGuard` lee la metadata, construye una clave por regla, y
 * consulta `RateLimiterService.check()` para cada una. La primera que
 * bloquea genera el 429 (con el `Retry-After` del que más tarda).
 *
 * `scope` define cómo agrupar requests para contar:
 *   - 'ip': clave = `${rule}:ip:${ip}`. Útil cuando no hay otra señal
 *     (login pre-auth, anti-credential-stuffing).
 *   - 'ip+body.<field>': clave = `${rule}:ip:${ip}:b:${body[field]}`.
 *     Útil para login: limita por (ip, username) — evita que un atacante
 *     desde una IP rote por miles de usernames y los bloquee a todos.
 *   - 'user': clave = `${rule}:u:${actorId}`. Para endpoints post-auth
 *     donde `actor` viene del JWT.
 *
 * Reset-on-success: si el handler hace `limiter.reset(req.rateLimitKey)`,
 * solo se resetea la PRIMERA regla de la lista (típicamente la más
 * específica). Las reglas más amplias (ip-only) NO se resetean — un
 * login exitoso de un atacante no debe limpiar su contador global de IP.
 * Por convención poner siempre la regla más específica primero.
 */

import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_METADATA = 'rate-limit:config';

export type RateLimitScope =
  | 'ip'
  | `ip+body.${string}`
  | 'user';

export interface RateLimitOptions {
  /** Identificador legible de la regla, e.g. "auth.login". */
  rule: string;
  /** Hits permitidos por ventana. */
  limit: number;
  /** Ventana en segundos. */
  windowSec: number;
  /** Cómo computar la clave. */
  scope: RateLimitScope;
}

/** Lo que el guard ve en la metadata: siempre normalizado a array. */
export type RateLimitMetadata = RateLimitOptions[];

/**
 * Marca un handler como rate-limited. El `RateLimitGuard` (registrado en
 * cada controller que lo necesita) lo aplica.
 *
 * Acepta una sola regla o un array. Internamente la metadata siempre se
 * guarda como array para que el guard tenga un solo path.
 */
export const RateLimit = (
  opts: RateLimitOptions | RateLimitOptions[],
): MethodDecorator => {
  const normalized: RateLimitMetadata = Array.isArray(opts) ? opts : [opts];
  if (normalized.length === 0) {
    throw new Error('@RateLimit recibió un array vacío.');
  }
  return SetMetadata(RATE_LIMIT_METADATA, normalized);
};
