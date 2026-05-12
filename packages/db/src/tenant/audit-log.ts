/**
 * Tabla `audit_log` (DB de tenant).
 *
 * Registro inmutable de toda acción significativa dentro del tenant.
 * Ver `docs/04-modelo-datos.md §3 audit_log` y `docs/03-jerarquia-roles.md §7.6`.
 *
 * Reglas (parcial en MVP, completo cuando llegue producción):
 *   - **Append-only**: REVOKE UPDATE/DELETE a nivel Postgres role queda pendiente
 *     (necesita un user de app distinto del owner; v1).
 *   - **Particionado mensual** por created_at: pendiente — premature optimization
 *     para MVP con pocos rows. Cuando se acerque la marca de 1M rows, agregar
 *     `PARTITION BY RANGE (created_at)` + jobs de creación de particiones.
 *   - **Retención**: configurable por tenant. No implementado todavía.
 *
 * Para esta primera iteración:
 *   - `ip`, `user_agent`, `request_id`, `session_id`, `impersonator_id` son
 *     nullable. Se rellenan cuando exista middleware que los capture.
 *   - `actor_role_at_time` es el rol "principal" del actor al momento (mejor
 *     esfuerzo: si tiene múltiples roles, el primero o el más alto). Snapshot,
 *     nunca FK — el rol puede borrarse después.
 *
 * Quién escribe acá: el `AuditLogService` (apps/api/src/audit). Llamado
 * explícitamente desde cada handler que muta algo significativo.
 */

import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const auditLog = pgTable(
  'audit_log',
  {
    /** UUIDv7 generado en TS antes del insert. */
    id: uuid('id').primaryKey(),

  /**
   * User que ejecutó la acción. Null solo para eventos de sistema
   * (jobs cron, migraciones, seeds).
   */
  actorUserId: uuid('actor_user_id'),

  /** Snapshot del username del actor (por si el user se borra después). */
  actorUsername: text('actor_username'),

  /** Snapshot del rol "principal" del actor al momento. Best-effort. */
  actorRoleAtTime: text('actor_role_at_time'),

  /**
   * Código de la acción. Convención `<dominio>.<acción>`:
   *   - 'permissions.grant', 'permissions.revoke', 'permissions.clear'
   *   - 'permissions.cascade_revoke' (cuando una cascada borra downstream)
   *   - 'users.create', 'users.update', 'users.role_add', 'users.role_remove'
   *   - 'wallet.load', 'wallet.unload', 'wallet.adjust' (futuro)
   *   - 'auth.login', 'auth.logout', 'auth.refresh' (futuro)
   */
  actionCode: text('action_code').notNull(),

  /** Tipo de entidad afectada: 'user', 'override', 'wallet', etc. */
  targetType: text('target_type'),

  /** ID de la entidad afectada (puede ser uuid de user, override, etc.). */
  targetId: text('target_id'),

  /** Snapshot del estado anterior (campos relevantes). null en creates. */
  before: jsonb('before'),

  /** Snapshot del estado posterior. null en deletes. */
  after: jsonb('after'),

  /** Motivo. Convención: obligatorio para acciones destructivas (revoke, delete). */
  reason: text('reason'),

  /** Metadata extra específica del action_code (ej: cascadedCount, chain). */
  metadata: jsonb('metadata'),

  // ─── Contexto del request (rellenado cuando exista middleware) ─────────────
  /** IP del actor. Pendiente: middleware. */
  ip: text('ip'),
  /** User-Agent. */
  userAgent: text('user_agent'),
  /** Correlation ID del request HTTP (mismo en toda la cadena). */
  requestId: uuid('request_id'),
  /** Sesión del actor (refresh token id). */
  sessionId: uuid('session_id'),
  /**
   * Si se ejecuta en modo impersonate, ID del actor real. NULL si no.
   * Cuando exista feature de impersonate.
   */
  impersonatorId: uuid('impersonator_id'),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Índices compuestos para filtros típicos del panel admin:
    //   - "timeline del actor X": (actor_user_id, created_at desc)
    //   - "todo lo que pasó sobre permission Y": (action_code, created_at desc)
    //   - "qué pasó con la entidad X": (target_id, created_at desc)
    index('audit_log_actor_created').on(table.actorUserId, table.createdAt),
    index('audit_log_action_created').on(table.actionCode, table.createdAt),
    index('audit_log_target_created').on(table.targetId, table.createdAt),
  ],
);

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
