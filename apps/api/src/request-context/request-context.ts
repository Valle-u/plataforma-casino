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
}

export interface RequestWithContext extends Request {
  requestContext?: RequestContext;
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
} {
  const ctx = (req as RequestWithContext).requestContext;
  if (!ctx) {
    return { requestId: null, ip: null, userAgent: null, sessionId: null };
  }
  return {
    requestId: ctx.requestId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    sessionId: ctx.sessionId ?? null,
  };
}
