/**
 * `@RateLimit(...)` — decorator declarativo para endpoints sensibles.
 *
 * Uso:
 *   @RateLimit({ rule: 'auth.login', limit: 10, windowSec: 900, scope: 'ip+body.username' })
 *   @Post('login')
 *   login(...) { ... }
 *
 * El `RateLimitGuard` lee la metadata, construye la clave según `scope`,
 * y consulta `RateLimiterService.check()`.
 *
 * `scope` define cómo agrupar requests para contar:
 *   - 'ip': clave = `${rule}:ip:${ip}`. Útil cuando no hay otra señal
 *     (login pre-auth).
 *   - 'ip+body.<field>': clave = `${rule}:ip:${ip}:b:${body[field]}`.
 *     Útil para login: limita por (ip, username) — evita que un atacante
 *     desde una IP rote por miles de usernames y los bloquee a todos.
 *   - 'user': clave = `${rule}:u:${actorId}`. Para endpoints post-auth
 *     donde `actor` viene del JWT.
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

/**
 * Marca un handler como rate-limited. El `RateLimitGuard` (registrado en
 * cada controller que lo necesita) lo aplica.
 */
export const RateLimit = (opts: RateLimitOptions): MethodDecorator =>
  SetMetadata(RATE_LIMIT_METADATA, opts);
