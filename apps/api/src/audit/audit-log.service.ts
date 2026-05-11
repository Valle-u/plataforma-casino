/**
 * AuditLogService — registra acciones significativas del tenant.
 *
 * Diseño:
 *   - **Llamado explícitamente** desde cada handler que muta algo
 *     significativo. NO interceptor genérico (en MVP) — preferimos control
 *     fino del before/after y del action_code por sitio.
 *   - **Best-effort**: si la inserción falla, se logguea WARN pero NO se
 *     propaga la excepción al handler. Auditoría no debe tirar abajo una
 *     operación legítima.
 *   - **Inmutable**: nadie hace UPDATE/DELETE sobre `audit_log`. El service
 *     solo expone `record()` y `query()`.
 *
 * Más adelante (`docs/04 §3 audit_log`):
 *   - Particionado mensual.
 *   - REVOKE UPDATE/DELETE a nivel role de Postgres.
 *   - Middleware que rellene ip/userAgent/requestId.
 */

import { Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import {
  auditLog,
  generateUuidV7,
  type AuditLogEntry,
  type NewAuditLogEntry,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';

export interface RecordAuditParams {
  actorUserId: string | null;
  actorUsername?: string | null;
  actorRoleAtTime?: string | null;
  actionCode: string;
  targetType?: string | null;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  metadata?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  sessionId?: string | null;
  impersonatorId?: string | null;
}

export interface QueryAuditParams {
  actorUserId?: string;
  actionCode?: string;
  actionCodePrefix?: string;
  targetId?: string;
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  offset?: number;
  order?: 'asc' | 'desc';
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  /**
   * Inserta una entrada de auditoría. Nunca tira: si falla, logguea WARN.
   * Devuelve el id generado (o null si falló).
   */
  async record(db: TenantDb, params: RecordAuditParams): Promise<string | null> {
    const id = generateUuidV7();
    const entry: NewAuditLogEntry = {
      id,
      actorUserId: params.actorUserId,
      actorUsername: params.actorUsername ?? null,
      actorRoleAtTime: params.actorRoleAtTime ?? null,
      actionCode: params.actionCode,
      targetType: params.targetType ?? null,
      targetId: params.targetId ?? null,
      before: (params.before as object | null) ?? null,
      after: (params.after as object | null) ?? null,
      reason: params.reason ?? null,
      metadata: (params.metadata as object | null) ?? null,
      ip: params.ip ?? null,
      userAgent: params.userAgent ?? null,
      requestId: params.requestId ?? null,
      sessionId: params.sessionId ?? null,
      impersonatorId: params.impersonatorId ?? null,
    };

    try {
      await db.insert(auditLog).values(entry);
      return id;
    } catch (err) {
      this.logger.warn(
        `Audit insert falló para action=${params.actionCode}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Lista entradas con filtros opcionales. Paginación offset (simple para MVP).
   * Orden por `created_at` desc por defecto (más nuevo primero).
   */
  async query(
    db: TenantDb,
    params: QueryAuditParams,
  ): Promise<{ entries: AuditLogEntry[]; total: number }> {
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
    const offset = Math.max(params.offset ?? 0, 0);

    const conditions = [];
    if (params.actorUserId) conditions.push(eq(auditLog.actorUserId, params.actorUserId));
    if (params.actionCode) conditions.push(eq(auditLog.actionCode, params.actionCode));
    if (params.actionCodePrefix) {
      conditions.push(sql`${auditLog.actionCode} LIKE ${params.actionCodePrefix + '%'}`);
    }
    if (params.targetId) conditions.push(eq(auditLog.targetId, params.targetId));
    if (params.fromDate) conditions.push(gte(auditLog.createdAt, params.fromDate));
    if (params.toDate) conditions.push(lte(auditLog.createdAt, params.toDate));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const orderFn = params.order === 'asc' ? asc : desc;

    const entries = await db
      .select()
      .from(auditLog)
      .where(whereClause)
      .orderBy(orderFn(auditLog.createdAt))
      .limit(limit)
      .offset(offset);

    const totalRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditLog)
      .where(whereClause);
    const total = totalRows[0]?.count ?? 0;

    return { entries, total };
  }
}
