/**
 * RequestContextMiddleware — asigna a cada request un identificador único
 * (request_id UUIDv7) y captura ip + user-agent en `req.requestContext`.
 *
 * Corre antes que `TenantResolverMiddleware` (registrado primero en
 * `AppModule.configure`), así cualquier código downstream — incluyendo
 * `TenantResolverMiddleware`, guards, interceptors, handlers — puede
 * leer `req.requestContext.requestId` para correlacionar.
 *
 * Hoy lo consume el audit log. Próximos consumidores: logger con
 * request_id, exception filter, tracing (cuando exista OpenTelemetry).
 */

import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { generateUuidV7 } from '@casino/db';
import type { RequestWithContext } from './request-context';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = generateUuidV7();

    // X-Forwarded-For tiene prioridad (proxies/CDN), sino `req.ip` de Express.
    // El header puede traer múltiples IPs ("clientIP, proxy1, proxy2") —
    // tomamos la primera (el cliente original).
    let ip: string | null = null;
    const fwd = req.header('x-forwarded-for');
    if (fwd) {
      ip = fwd.split(',')[0]?.trim() ?? null;
    } else if (req.ip) {
      ip = req.ip;
    }

    const userAgent = req.header('user-agent') ?? null;

    (req as RequestWithContext).requestContext = {
      requestId,
      ip,
      userAgent,
    };

    // Exponemos también el request_id como response header — útil para
    // que el cliente lo incluya en bug reports y nosotros lo busquemos
    // en audit/logs.
    res.setHeader('X-Request-Id', requestId);

    next();
  }
}
