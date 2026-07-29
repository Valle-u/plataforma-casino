/**
 * `RateLimitGuard` — chequea el rate-limit configurado por `@RateLimit()`
 * en el handler.
 *
 * Orden de guards: si el endpoint hace pre-auth (login), este guard puede
 * correr primero (no necesita JWT). Si es post-auth (regenerate), tiene
 * que correr DESPUÉS de TenantJwtGuard porque la clave usa `actor.id`
 * desde `req.tenantUser`.
 *
 * Construcción de clave (centralizada para que no se pierda lógica
 * comparando guards distintos):
 *   - 'ip' → "<rule>:ip:<ip>"
 *   - 'ip+body.<field>' → "<rule>:ip:<ip>:b:<bodyValue>" (lowercase trim)
 *   - 'user' → "<rule>:u:<actorId>"
 *
 * Respuesta cuando se excede: HTTP 429 con `Retry-After` header (segundos
 * hasta el reset). El body incluye también `retryAfterMs` para clients
 * que prefieran granularidad fina.
 *
 * Bypass: si el handler NO tiene `@RateLimit()`, el guard no hace nada
 * y devuelve true.
 */

import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { extractRequestContext } from '../request-context/request-context';
import {
  RATE_LIMIT_METADATA,
  type RateLimitMetadata,
  type RateLimitOptions,
} from './rate-limit.decorator';
import { RateLimiterService } from './rate-limiter.service';

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiterService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rules = this.reflector.get<RateLimitMetadata | undefined>(
      RATE_LIMIT_METADATA,
      context.getHandler(),
    );
    if (!rules || rules.length === 0) return true;

    const req = context.switchToHttp().getRequest<RequestWithExtras>();

    let firstKey: string | null = null;
    for (const opts of rules) {
      const key = this.buildKey(opts, req);
      if (!key) {
        this.logger.warn(
          `RateLimit rule=${opts.rule} sin clave construible (scope=${opts.scope}). Skip.`,
        );
        continue;
      }
      if (firstKey === null) firstKey = key;

      const result = await this.limiter.check(key, {
        rule: opts.rule,
        limit: opts.limit,
        windowSec: opts.windowSec,
      });

      if (!result.ok) {
        const retryAfterSec = Math.max(
          Math.ceil(result.retryAfterMs / 1000),
          1,
        );
        const res = context
          .switchToHttp()
          .getResponse<{ setHeader: (k: string, v: string) => void }>();
        try {
          res.setHeader('Retry-After', String(retryAfterSec));
        } catch {
          /* ignore */
        }
        this.logger.warn(
          `RateLimit BLOCK rule=${opts.rule} key=${key} hits=${result.current} retryAfter=${retryAfterSec}s`,
        );
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message:
              'Demasiados intentos. Esperá un momento antes de reintentar.',
            error: 'RATE_LIMITED',
            retryAfterMs: result.retryAfterMs,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    if (firstKey) req.rateLimitKey = firstKey;
    return true;
  }

  private buildKey(opts: RateLimitOptions, req: RequestWithExtras): string | null {
    const ip = this.resolveIp(req);

    if (opts.scope === 'ip') {
      if (!ip) return null;
      return `${opts.rule}:ip:${ip}`;
    }

    if (opts.scope === 'user') {
      const actorId = req.tenantUser?.id ?? req.platformUser?.id;
      if (!actorId) return null;
      return `${opts.rule}:u:${actorId}`;
    }

    if (opts.scope.startsWith('ip+body.')) {
      if (!ip) return null;
      const field = opts.scope.slice('ip+body.'.length);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const raw = body[field];
      if (typeof raw !== 'string' || raw.length === 0) return null;
      // Normalizamos: lowercase + trim, para que "Foo " y "foo" colisionen
      // (anti-evasion barato — un atacante que rote casing pelea contra
      // misma key).
      const normalized = raw.trim().toLowerCase();
      return `${opts.rule}:ip:${ip}:b:${normalized}`;
    }

    return null;
  }

  /**
   * Resuelve la IP del cliente. Prioridad:
   *   1. requestContext.ip (que ya respetó X-Forwarded-For).
   *   2. req.ip (Express).
   */
  private resolveIp(req: Request): string | null {
    const fromCtx = extractRequestContext(req).ip;
    if (fromCtx) return fromCtx;
    return req.ip ?? null;
  }
}

interface RequestWithExtras extends Request {
  tenantUser?: { id: string };
  platformUser?: { id: string };
  /**
   * Clave que el guard consumió para este request. Los handlers (login,
   * etc.) pueden `limiter.reset(req.rateLimitKey)` tras un success para
   * no penalizar al user legítimo por intentos fallidos previos.
   */
  rateLimitKey?: string;
}
