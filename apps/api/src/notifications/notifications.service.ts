/**
 * NotificationsService — enqueue, listForUser, markAsRead, dispatch.
 *
 * Diseño:
 *   - **In-app** se crea con `status='sent'` directo (no requiere
 *     envío externo — vive en DB y el user la lee del endpoint).
 *   - **Email/SMS** se crean con `status='pending'`. El dispatcher cron
 *     los procesa y marca 'sent' o 'failed'.
 *   - **Render snapshot**: el subject/body se calcula en enqueue y se
 *     persiste. Cambios futuros en templates NO afectan notifs viejas.
 *   - **Sin reintentos automáticos** en MVP. Si una email falla, queda
 *     'failed' con error. Sprint futuro: max_attempts column + backoff.
 *   - **Email channel sin email destinatario**: tomamos `users.email`.
 *     Si el user no tiene email, marcamos 'failed' con error explicit
 *     (en lugar de skip silencioso).
 */

import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import {
  notifications,
  users,
  type NewNotification,
  type Notification,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import {
  EMAIL_PROVIDER,
  type EmailProvider,
} from './providers/email-provider.interface';
import { renderTemplate } from './notifications.templates';

export interface EnqueueParams {
  userId: string;
  kind: string;
  channel: 'in_app' | 'email' | 'sms';
  payload?: Record<string, unknown>;
}

export interface ListOptions {
  limit?: number;
  offset?: number;
  /** Solo no-leídas / no-vistas (status != 'read'). */
  onlyUnread?: boolean;
}

export interface DispatchResult {
  processed: number;
  sent: number;
  failed: number;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
  ) {}

  /**
   * Crea una notification y la persiste. Para in_app es síncrono
   * (status='sent' al instante). Para email/sms queda 'pending' y la
   * procesa el dispatcher cron.
   *
   * Falla si el kind no tiene template registrado (protección contra typos).
   */
  async enqueue(
    db: TenantDb,
    params: EnqueueParams,
  ): Promise<Notification> {
    const payload = params.payload ?? {};
    // Render snapshot. Tira si kind no registrado.
    const { subject, body } = renderTemplate(params.kind, payload);

    const isInApp = params.channel === 'in_app';
    const row: NewNotification = {
      userId: params.userId,
      kind: params.kind,
      channel: params.channel,
      payload: payload as object,
      subject,
      body,
      // in_app: directamente 'sent' (sin envío externo).
      status: isInApp ? 'sent' : 'pending',
      sentAt: isInApp ? new Date() : null,
    };
    const inserted = await db.insert(notifications).values(row).returning();
    return inserted[0]!;
  }

  /**
   * Lista notifs del user, paginado, ordenado DESC por created_at.
   * Si `onlyUnread=true`, filtra status != 'read'.
   */
  async listForUser(
    db: TenantDb,
    userId: string,
    opts: ListOptions = {},
  ): Promise<Notification[]> {
    const limit = Math.min(100, opts.limit ?? 50);
    const offset = Math.max(0, opts.offset ?? 0);
    const whereClause = opts.onlyUnread
      ? and(eq(notifications.userId, userId), sql`${notifications.status} <> 'read'`)
      : eq(notifications.userId, userId);
    return db
      .select()
      .from(notifications)
      .where(whereClause)
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .offset(offset);
  }

  /**
   * Cuenta no-leídas. Útil para badge UI.
   */
  async countUnreadForUser(db: TenantDb, userId: string): Promise<number> {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(eq(notifications.userId, userId), sql`${notifications.status} <> 'read'`),
      );
    return rows[0]?.count ?? 0;
  }

  /**
   * Marca una notif como leída. Solo aplica si:
   *   - Es del user (autorización).
   *   - channel='in_app' y status='sent'.
   *
   * Otros casos: 404 (notif no encontrada para este user) o no-op
   * (ya leída → idempotent).
   */
  async markAsRead(
    db: TenantDb,
    notificationId: string,
    userId: string,
  ): Promise<Notification> {
    const rows = await db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.id, notificationId), eq(notifications.userId, userId)),
      )
      .limit(1);
    const current = rows[0];
    if (!current) {
      throw new NotFoundException({
        message: 'Notification no encontrada.',
        error: 'NOTIFICATION_NOT_FOUND',
      });
    }
    if (current.status === 'read') return current; // idempotent
    if (current.channel !== 'in_app') {
      // Solo in_app es "leíble" desde la app. email/sms no se marcan
      // read (se "ven" fuera del sistema). Devolvemos sin cambios.
      return current;
    }
    const updated = await db
      .update(notifications)
      .set({ status: 'read', readAt: new Date() })
      .where(eq(notifications.id, notificationId))
      .returning();
    return updated[0]!;
  }

  /**
   * Marca TODAS las pending in_app del user como read. Útil para
   * botón "marcar todas leídas". Devuelve count afectado.
   *
   * Solo afecta status='sent' (las in_app pasaron a 'sent' al enqueue).
   */
  async markAllAsReadForUser(db: TenantDb, userId: string): Promise<number> {
    const updated = await db
      .update(notifications)
      .set({ status: 'read', readAt: new Date() })
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.channel, 'in_app'),
          eq(notifications.status, 'sent'),
        ),
      )
      .returning({ id: notifications.id });
    return updated.length;
  }

  /**
   * Procesa pendings de email/sms. Llamado por el dispatcher cron.
   *
   * Pickea hasta `batchSize` entries en orden FIFO (created_at ASC).
   * Por cada una:
   *   - email: llama provider.send. Marca 'sent' o 'failed' con error.
   *   - sms: por ahora SIEMPRE marca 'failed' (no hay provider). Cuando
   *     se agregue SMS provider, mismo patrón.
   *
   * Devuelve resumen para el cron loguear.
   */
  async dispatch(
    db: TenantDb,
    tenantSlug: string,
    batchSize = 100,
  ): Promise<DispatchResult> {
    const pending = await db
      .select({
        id: notifications.id,
        userId: notifications.userId,
        channel: notifications.channel,
        subject: notifications.subject,
        body: notifications.body,
      })
      .from(notifications)
      .where(eq(notifications.status, 'pending'))
      .orderBy(notifications.createdAt)
      .limit(batchSize);

    let sent = 0;
    let failed = 0;

    for (const n of pending) {
      try {
        if (n.channel === 'email') {
          // Buscar email del user.
          const userRow = await db
            .select({ email: users.email })
            .from(users)
            .where(eq(users.id, n.userId))
            .limit(1);
          const email = userRow[0]?.email;
          if (!email) {
            await this.markFailed(db, n.id, 'user_has_no_email');
            failed += 1;
            continue;
          }
          await this.emailProvider.send({
            to: email,
            subject: n.subject,
            body: n.body,
            tenantSlug,
          });
          await this.markSent(db, n.id);
          sent += 1;
        } else if (n.channel === 'sms') {
          // No provider de SMS aún — marcar failed con error explícito.
          await this.markFailed(db, n.id, 'sms_provider_not_implemented');
          failed += 1;
        } else {
          // in_app llega acá solo si enqueue tuvo un bug — defensivo.
          this.logger.warn(
            `Dispatcher recibió notif in_app pending (id=${n.id}). Marco sent.`,
          );
          await this.markSent(db, n.id);
          sent += 1;
        }
      } catch (err) {
        await this.markFailed(db, n.id, (err as Error).message);
        failed += 1;
      }
    }

    return { processed: pending.length, sent, failed };
  }

  /**
   * Purga notifs viejas. Aplicado a sent/read/failed con created_at
   * más antiguo que `retentionDays`. Pending NO se purga — si está
   * pending hace meses es bug del dispatcher y queremos verlo.
   *
   * `retentionDays <= 0` → no-op defensivo.
   */
  async purgeOld(db: TenantDb, retentionDays: number): Promise<number> {
    if (retentionDays <= 0) return 0;
    const cutoff = new Date(Date.now() - retentionDays * 24 * 3600 * 1000);
    const deleted = await db
      .delete(notifications)
      .where(
        and(
          lt(notifications.createdAt, cutoff),
          sql`${notifications.status} IN ('sent', 'read', 'failed')`,
          // Defensivo: solo borrar las que tienen sentAt o readAt
          // (las pending podrían haber quedado fuera del filtro anterior
          // si hubo race, pero esta condición las excluye doble).
          sql`(${notifications.sentAt} IS NOT NULL OR ${notifications.readAt} IS NOT NULL OR ${notifications.status} = 'failed')`,
        ),
      )
      .returning({ id: notifications.id });
    return deleted.length;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Helpers privados
  // ──────────────────────────────────────────────────────────────────────

  private async markSent(db: TenantDb, id: string): Promise<void> {
    await db
      .update(notifications)
      .set({ status: 'sent', sentAt: new Date(), error: null })
      .where(eq(notifications.id, id));
  }

  private async markFailed(
    db: TenantDb,
    id: string,
    error: string,
  ): Promise<void> {
    await db
      .update(notifications)
      .set({ status: 'failed', error })
      .where(eq(notifications.id, id));
  }

}
