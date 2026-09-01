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

    // De dónde sale la IP, en orden de confianza.
    //
    // 1. `CF-Connecting-IP`. Cloudflare SIEMPRE lo escribe con la IP real del
    //    visitante y pisa lo que haya mandado el cliente.
    // 2. `X-Forwarded-For`, primer valor.
    // 3. `req.ip` de Express (el peer del socket).
    //
    // ⚠️ Antes se usaba (2) directamente y **guardábamos IPs de Cloudflare, no
    // de jugadores**. La prueba está en los datos: una misma IP aparecía
    // asociada a 5–8 usuarios distintos, y todos los rangos (172.68/69/71,
    // 104.22/23) son de Cloudflare. Con `api.miamihub.vip` detrás de CF, el
    // primer valor de XFF no es el cliente.
    //
    // Esto rompía cualquier control por IP: antifraude, geo, y la IP que le
    // mandamos a los proveedores de juego en el launch.
    //
    // ⚠️ Confiar en el header supone que **todo el tráfico entra por**
    // **Cloudflare**. Hoy el origen todavía acepta conexiones directas: blindar
    // el firewall del VPS a los rangos de CF es la fase 2 de
    // `docs/25-seguridad-cloudflare.md`. Hasta que eso esté, quien le pegue
    // directo al origen puede falsear el header — igual que ya podía falsear
    // `X-Forwarded-For`, así que esto no empeora nada.
    let ip: string | null = null;
    const cf = req.header('cf-connecting-ip')?.trim();
    const fwd = req.header('x-forwarded-for');
    if (cf) {
      ip = cf;
    } else if (fwd) {
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
