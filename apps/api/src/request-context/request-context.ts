/**
 * RequestContext — datos del request que el audit (y futuro: logging,
 * rate-limit, tracing) quieren leer en cualquier handler downstream.
 *
 * Se rellena en `RequestContextMiddleware` muy temprano en la pipeline,
 * antes que `TenantResolverMiddleware`, así cualquier capa lo puede
 * consumir.
 *
 * Campos:
 *   - requestId: UUIDv7 único por request HTTP. Sirve para correlacionar
 *     todas las acciones (DB writes, logs, audit entries) de un mismo
 *     request entrante.
 *   - ip: IP del cliente. Si hay X-Forwarded-For (proxy/load balancer),
 *     se respeta el primer valor; sino, `req.ip` de Express.
 *   - userAgent: User-Agent header crudo.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request } from 'express';

export interface RequestContext {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
  /**
   * id de la `user_sessions` row del actor (si está autenticado).
   * Se llena en el guard JWT a partir del payload.sid.
   * Null para requests sin auth.
   */
  sessionId?: string | null;
  /**
   * Sprint 37: id del admin que originó esta sesión vía impersonate.
   * NULL en sesiones normales. Cada audit entry de la sesión guarda
   * automático este id como `impersonatorId` via `extractRequestContext`.
   */
  impersonatorId?: string | null;
}

export interface RequestWithContext extends Request {
  requestContext?: RequestContext;
}

/**
 * El mismo contexto, accesible SIN tener el `req` a mano.
 *
 * `req.requestContext` sirve donde llega el request (controllers, guards,
 * middlewares), pero un logger vive en cualquier servicio del árbol y no puede
 * recibir el `req` por parámetro: son 325 llamadas a `this.logger` en 87
 * archivos. `AsyncLocalStorage` propaga el contexto por la cadena de ejecución
 * async, así que cada línea de log puede llevar su `request_id` sin tocar una
 * sola de esas llamadas.
 *
 * Es de Node (`node:async_hooks`), no una dependencia nueva.
 *
 * ⚠️ Fuera de un request HTTP —los crons, el arranque— el store está vacío y
 * `currentRequestContext()` devuelve `undefined`. Es lo correcto: un job
 * programado no tiene request al que atribuirse.
 */
export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

/** El contexto del request en curso, si estamos dentro de uno. */
export function currentRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

/**
 * Helper para spread en llamadas a `AuditLogService.record()`:
 *   await this.audit.record(db, { ...auditParams, ...extractRequestContext(req) });
 *
 * Devuelve objeto vacío si por alguna razón el middleware no corrió
 * (defensivo: tests, requests internos, etc.).
 */
export function extractRequestContext(req: Request): {
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
  sessionId: string | null;
  impersonatorId: string | null;
} {
  const ctx = (req as RequestWithContext).requestContext;
  if (!ctx) {
    return {
      requestId: null,
      ip: null,
      userAgent: null,
      sessionId: null,
      impersonatorId: null,
    };
  }
  return {
    requestId: ctx.requestId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    sessionId: ctx.sessionId ?? null,
    impersonatorId: ctx.impersonatorId ?? null,
  };
}
