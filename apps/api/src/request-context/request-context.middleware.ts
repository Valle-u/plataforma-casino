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
import {
  requestContextStorage,
  type RequestContext,
  type RequestWithContext,
} from './request-context';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = generateUuidV7();

    // De dónde sale la IP, en orden de confianza.
    //
    // 1. `x-player-ip`, que pone el middleware de la web. **Es el único que
    //    trae la IP del jugador** cuando la llamada viene proxeada por Next:
    //    ahí el cliente somos nosotros mismos y todo lo demás miente. Ver el
    //    comentario largo en `apps/web/middleware.ts`.
    // 2. `CF-Connecting-IP`, para las llamadas que sí entran derecho desde el
    //    navegador. Cloudflare lo escribe y pisa lo que mande el cliente.
    // 3. `X-Forwarded-For`, primer valor.
    // 4. `req.ip` de Express (el peer del socket).
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
    const delProxy = req.header('x-player-ip')?.trim();
    const cf = req.header('cf-connecting-ip')?.trim();
    const fwd = req.header('x-forwarded-for');
    if (delProxy) {
      ip = delProxy;
    } else if (cf) {
      ip = cf;
    } else if (fwd) {
      ip = fwd.split(',')[0]?.trim() ?? null;
    } else if (req.ip) {
      ip = req.ip;
    }

    const userAgent = req.header('user-agent') ?? null;

    const ctx: RequestContext = { requestId, ip, userAgent };
    (req as RequestWithContext).requestContext = ctx;

    // Exponemos también el request_id como response header — útil para
    // que el cliente lo incluya en bug reports y nosotros lo busquemos
    // en audit/logs.
    res.setHeader('X-Request-Id', requestId);

    // El resto del request corre DENTRO del AsyncLocalStorage, así cualquier
    // servicio downstream puede leer el contexto sin recibir el `req`. Es lo
    // que le da `request_id` a cada línea de log sin tocar las 325 llamadas a
    // `this.logger` que hay en el código.
    //
    // Ojo: es el MISMO objeto que `req.requestContext`, no una copia. Los
    // guards que lo enriquecen después (el JWT le agrega `sessionId` e
    // `impersonatorId`) mutan ese objeto, y por ser el mismo la mutación se ve
    // también desde el store. Si acá se copiara, esos dos campos nunca
    // llegarían a los logs.
    requestContextStorage.run(ctx, next);
  }
}
