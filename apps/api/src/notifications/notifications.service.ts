/**
 * NotificationsService — enqueue, listForUser, markAsRead, dispatch.
 *
 * Diseño:
 *   - **In-app** se crea con `status='sent'` directo (no requiere
 *     envío externo — vive en DB y el user la lee del endpoint).
 *   - **Email/SMS/WebPush** se crean con `status='pending'`. El
 *     dispatcher cron los procesa y marca 'sent' o 'failed'.
 *   - **Render snapshot**: el subject/body se calcula en enqueue y se
 *     persiste. Cambios futuros en templates NO afectan notifs viejas.
 *   - **Sin reintentos automáticos** en MVP. Si una email falla, queda
 *     'failed' con error. Sprint futuro: max_attempts column + backoff.
 *   - **Email channel sin email destinatario**: tomamos `users.email`.
 *     Si el user no tiene email, marcamos 'failed' con error explicit
 *     (en lugar de skip silencioso).
 */

import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import {
  notificationTemplates,
  notifications,
  roles,
  userRoles,
  users,
  type NewNotification,
  type Notification,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import {
  EMAIL_PROVIDER,
  type EmailProvider,
} from './providers/email-provider.interface';
import {
  PUSH_PROVIDER,
  type PushProvider,
} from './providers/push-provider.interface';
import { PushSubscriptionGoneError } from './providers/web-push.provider';
import {
  SMS_PROVIDER,
  type SmsProvider,
} from './providers/sms-provider.interface';
import { renderOverride, renderTemplate } from './notifications.templates';
import { PushSubscriptionsService } from './push-subscriptions.service';

/**
 * Deep links por kind para las push. Cuando el user toca la
 * notificación, el SW navega a esta URL dentro de la SPA.
 *   - Player kinds → /play/...
 *   - Operator kinds → ruta del panel admin (app/(admin)).
 */
const PUSH_DEEP_LINKS: Record<string, string> = {
  deposit_approved: '/play/deposits',
  deposit_rejected: '/play/deposits',
  withdrawal_paid: '/play/withdrawals',
  withdrawal_rejected: '/play/withdrawals',
  withdrawal_failed: '/play/withdrawals',
  new_deposit_for_review: '/deposits',
  new_withdrawal_for_review: '/withdrawals',
};

function pushDeepLink(kind: string): string {
  return PUSH_DEEP_LINKS[kind] ?? '/';
}

export type NotificationChannel = 'in_app' | 'email' | 'sms' | 'web_push';

export interface EnqueueParams {
  userId: string;
  kind: string;
  channel: NotificationChannel;
  payload?: Record<string, unknown>;
}

export interface ListOptions {
  limit?: number;
  offset?: number;
  /** Solo no-leídas / no-vistas (status != 'read'). */
  onlyUnread?: boolean;
}

/**
 * Notification + campos enriquecidos del user. Los usa el panel admin
 * para mostrar nombres legibles en la tabla (evita N+1 client-side).
 */
export interface NotificationWithUser extends Notification {
  userUsername: string | null;
  userDisplayName: string | null;
}

export interface AdminListFilters {
  statuses?: Array<'pending' | 'sent' | 'failed' | 'read'>;
  channels?: NotificationChannel[];
  kind?: string;
  userId?: string;
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  offset?: number;
}

export interface DispatchResult {
  processed: number;
  sent: number;
  failed: number;
}

export interface DispatchOptions {
  /**
   * Channels que el cron está pausando (kill switch via settings).
   * Las notifs de esos channels quedan en `pending` — el cron las
   * reintentará en el próximo run cuando el switch se re-habilite.
   */
  skipChannels?: NotificationChannel[];
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
    @Inject(SMS_PROVIDER) private readonly smsProvider: SmsProvider,
    @Inject(PUSH_PROVIDER) private readonly pushProvider: PushProvider,
    private readonly pushSubscriptionsService: PushSubscriptionsService,
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
    // Resolve template: si hay override en DB con enabled=true, usar ese
    // (substitution simple {{var}}). Si no, usar default hardcoded.
    // Snapshot semántico: rendereamos AL enqueue, persistimos el output;
    // cambios futuros al template no afectan notifs ya creadas.
    const override = await this.findActiveOverride(db, params.kind);
    const { subject, body } = override
      ? renderOverride(override.subjectTemplate, override.bodyTemplate, payload)
      : renderTemplate(params.kind, payload);

    const isInApp = params.channel === 'in_app';
    const row: NewNotification = {
      userId: params.userId,
      kind: params.kind,
      channel: params.channel,
      payload: payload,
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
   * Lookup del override per-kind. Devuelve null si no existe o si está
   * disabled. El render path usa el default en ambos casos.
   *
   * Sin cache para MVP — un lookup por enqueue es O(1) con PK index.
   * Si crece volumen: cache in-memory con TTL corto + invalidación
   * on-set.
   */
  private async findActiveOverride(
    db: TenantDb,
    kind: string,
  ): Promise<{ subjectTemplate: string; bodyTemplate: string } | null> {
    const rows = await db
      .select({
        subjectTemplate: notificationTemplates.subjectTemplate,
        bodyTemplate: notificationTemplates.bodyTemplate,
        enabled: notificationTemplates.enabled,
      })
      .from(notificationTemplates)
      .where(eq(notificationTemplates.kind, kind))
      .limit(1);
    const row = rows[0];
    if (!row || !row.enabled) return null;
    return { subjectTemplate: row.subjectTemplate, bodyTemplate: row.bodyTemplate };
  }

  /**
   * Enqueue para todos los usuarios con un rol específico activos. Útil
   * para notifs cross-user (e.g. admins reciben "cluster confirmado").
   *
   * Si `excludeUserId` está, ese user NO recibe la notif (típicamente
   * el que disparó el evento — no nos auto-notificamos).
   *
   * Devuelve la lista de notifs creadas. Si no hay users con ese rol,
   * devuelve array vacío (no tira).
   */
  async enqueueForRole(
    db: TenantDb,
    params: {
      roleCode: string;
      kind: string;
      channel: NotificationChannel;
      payload?: Record<string, unknown>;
      excludeUserId?: string;
    },
  ): Promise<Notification[]> {
    // Buscar users activos con el rol pedido.
    const recipients = await db
      .select({ id: users.id })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(roles.code, params.roleCode), eq(users.status, 'active')));

    const created: Notification[] = [];
    for (const r of recipients) {
      if (params.excludeUserId && r.id === params.excludeUserId) continue;
      try {
        const n = await this.enqueue(db, {
          userId: r.id,
          kind: params.kind,
          channel: params.channel,
          payload: params.payload,
        });
        created.push(n);
      } catch (err) {
        this.logger.error(
          `enqueueForRole(${params.roleCode}) falló para user=${r.id}: ${(err as Error).message}`,
        );
      }
    }
    return created;
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
   * Lista admin: notifs de TODOS los users con filtros opcionales y
   * LEFT JOIN para enriquecer con username/displayName.
   *
   * Cap default 50, max 200 — para panel admin. Para export (sprint
   * futuro), agregar `listForExport` con cap CSV_EXPORT_MAX_ROWS.
   */
  async listAll(
    db: TenantDb,
    filters: AdminListFilters = {},
  ): Promise<{ data: NotificationWithUser[]; total: number }> {
    const conditions = [];
    if (filters.statuses && filters.statuses.length > 0) {
      conditions.push(inArray(notifications.status, filters.statuses));
    }
    if (filters.channels && filters.channels.length > 0) {
      conditions.push(inArray(notifications.channel, filters.channels));
    }
    if (filters.kind) conditions.push(eq(notifications.kind, filters.kind));
    if (filters.userId) conditions.push(eq(notifications.userId, filters.userId));
    if (filters.fromDate)
      conditions.push(gte(notifications.createdAt, filters.fromDate));
    if (filters.toDate)
      conditions.push(lte(notifications.createdAt, filters.toDate));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const offset = Math.max(filters.offset ?? 0, 0);

    const rows = await db
      .select({
        notification: notifications,
        userUsername: users.username,
        userDisplayName: users.displayName,
      })
      .from(notifications)
      .leftJoin(users, eq(users.id, notifications.userId))
      .where(whereClause)
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(limit)
      .offset(offset);

    const data: NotificationWithUser[] = rows.map((r) => ({
      ...r.notification,
      userUsername: r.userUsername,
      userDisplayName: r.userDisplayName,
    }));

    const totalRows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(whereClause);

    return { data, total: totalRows[0]?.n ?? 0 };
  }

  /**
   * Re-encola una notification que está en `failed` para que el dispatcher
   * la procese de nuevo. Cambia status='pending' + error=null + sentAt=null
   * (snapshot fresh para que el dispatcher pickee).
   *
   * Devuelve la row actualizada. Tira NotFound si:
   *   - El id no existe.
   *   - El status NO es 'failed' (no permitimos reintentar sent/read/pending —
   *     no tiene sentido, podría causar doble envío).
   *
   * **NO** reintenta automáticamente — el cron lo hará en su próximo run.
   * Si necesitás envío inmediato, además de retry hay que disparar el
   * dispatcher manual (sprint futuro).
   */
  async markForRetry(
    db: TenantDb,
    notificationId: string,
  ): Promise<Notification> {
    const existing = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, notificationId))
      .limit(1);
    if (!existing[0]) {
      throw new NotFoundException({
        message: `Notification '${notificationId}' no existe.`,
        error: 'NOTIFICATION_NOT_FOUND',
      });
    }
    if (existing[0].status !== 'failed') {
      throw new NotFoundException({
        message: `Solo se pueden reintentar notifications con status='failed' (actual: '${existing[0].status}').`,
        error: 'NOTIFICATION_NOT_RETRIABLE',
      });
    }
    const updated = await db
      .update(notifications)
      .set({
        status: 'pending',
        error: null,
        sentAt: null,
      })
      .where(eq(notifications.id, notificationId))
      .returning();
    return updated[0]!;
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
   * Procesa pendings de email/sms/web_push. Llamado por el dispatcher cron.
   *
   * Pickea hasta `batchSize` entries en orden FIFO (created_at ASC).
   * Por cada una:
   *   - email: llama provider.send. Marca 'sent' o 'failed' con error.
   *   - sms: por ahora SIEMPRE marca 'failed' (no hay provider). Cuando
   *     se agregue SMS provider, mismo patrón.
   *   - web_push: envía a todas las suscripciones del user; 404/410
   *     borra la suscripción; 'sent' si al menos una llegó.
   *
   * Devuelve resumen para el cron loguear.
   */
  async dispatch(
    db: TenantDb,
    tenantSlug: string,
    batchSize = 100,
    opts: DispatchOptions = {},
  ): Promise<DispatchResult> {
    // Filtrar pendings: status=pending Y channel NO en skipChannels.
    // skipChannels permite kill switch por canal sin perder el queue.
    const skip = opts.skipChannels ?? [];
    const whereClause =
      skip.length > 0
        ? and(
            eq(notifications.status, 'pending'),
            sql`${notifications.channel}::text NOT IN (${sql.join(
              skip.map((c) => sql`${c}`),
              sql`, `,
            )})`,
          )
        : eq(notifications.status, 'pending');
    const pending = await db
      .select({
        id: notifications.id,
        userId: notifications.userId,
        channel: notifications.channel,
        kind: notifications.kind,
        subject: notifications.subject,
        body: notifications.body,
      })
      .from(notifications)
      .where(whereClause)
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
          // Buscar phone del user. SMS no tiene subject — concat
          // subject + body si el subject aporta info, sino solo body.
          const userRow = await db
            .select({ phone: users.phone })
            .from(users)
            .where(eq(users.id, n.userId))
            .limit(1);
          const phone = userRow[0]?.phone;
          if (!phone) {
            await this.markFailed(db, n.id, 'user_has_no_phone');
            failed += 1;
            continue;
          }
          // Composición simple subject+body. El template del kind decide
          // si el subject suma (e.g. "Tu retiro: ID X importe Y") o
          // solo entorpece. MVP: incluir ambos separados por newline.
          await this.smsProvider.send({
            to: phone,
            body: `${n.subject}\n${n.body}`,
            tenantSlug,
          });
          await this.markSent(db, n.id);
          sent += 1;
        } else if (n.channel === 'web_push') {
          // Web push: enviar a TODAS las suscripciones del user.
          // La misma notif se entrega a cada dispositivo (iPhone,
          // desktop, etc.). Si una endpoint respondió 404/410 el
          // dispositivo ya no existe → se borra y se sigue con las
          // demás. Se marca 'sent' si al menos una llegó; si ninguna
          // llegó (o no hay suscripciones), 'failed' con error explícito.
          const subs = await this.pushSubscriptionsService.listForUser(
            db,
            n.userId,
          );
          if (subs.length === 0) {
            await this.markFailed(db, n.id, 'user_has_no_push_subscription');
            failed += 1;
            continue;
          }
          const pushMsg = {
            title: n.subject,
            body: n.body,
            url: pushDeepLink(n.kind),
            tenantSlug,
          };
          let delivered = 0;
          for (const sub of subs) {
            try {
              await this.pushProvider.send(
                {
                  endpoint: sub.endpoint,
                  p256dh: sub.p256dh,
                  auth: sub.auth,
                },
                pushMsg,
              );
              await this.pushSubscriptionsService.touchLastSeen(db, sub.id);
              delivered += 1;
            } catch (err) {
              if (err instanceof PushSubscriptionGoneError) {
                await this.pushSubscriptionsService.deleteById(db, sub.id);
                this.logger.debug(
                  `Push sub eliminada (gone): user=${n.userId} sub=${sub.id}`,
                );
              } else {
                this.logger.warn(
                  `Push send falló user=${n.userId} sub=${sub.id}: ${(err as Error).message}`,
                );
              }
            }
          }
          if (delivered > 0) {
            await this.markSent(db, n.id);
            sent += 1;
          } else {
            await this.markFailed(db, n.id, 'push_delivery_failed');
            failed += 1;
          }
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
