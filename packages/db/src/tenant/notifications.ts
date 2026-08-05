/**
 * Tabla `notifications` (DB de tenant).
 *
 * Soporta múltiples channels (in_app, email, sms) con un único modelo.
 * El dispatcher cron procesa entries con `status='pending'` y
 * `channel != 'in_app'` (las in_app se marcan 'sent' inmediatamente al
 * enqueue — no hay envío externo).
 *
 * Diseño:
 *   - `payload`: jsonb libre con datos crudos del evento (e.g. score,
 *     bonusCode, blockedReason). El renderer del subject/body lo usa.
 *   - `subject` + `body`: pre-renderizados al enqueue. Si los templates
 *     cambian después, las notifs viejas conservan el render del momento
 *     (snapshot semántico — el user vio "X" cuando recibió la notif).
 *   - `status` enum: pending → sent → read (in_app) / pending → sent
 *     (email/sms) o pending → failed (con `error` poblado).
 *   - `read_at` solo aplica a in_app. email/sms se consideran "vistos"
 *     fuera de nuestro sistema.
 *   - Indexes diseñados para los dos hot paths:
 *       a) listForUser → (user_id, created_at DESC).
 *       b) dispatcher → (status, channel, created_at) para pickear pending
 *          email/sms en orden FIFO.
 */

import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '../utils/uuid';
import { users } from './users';

export const notificationChannelEnum = pgEnum('notification_channel', [
  'in_app',
  'email',
  'sms',
  'web_push',
]);

export const notificationStatusEnum = pgEnum('notification_status', [
  'pending',
  'sent',
  'failed',
  'read',
]);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),

    /**
     * Discriminador del tipo de evento. Ejemplos:
     *   - 'welcome_bonus_blocked' (antifraude bloqueó welcome)
     *   - 'fraud_cluster_detected' (admin notif)
     *   - 'deposit_approved'
     *   - 'withdrawal_paid'
     *
     * Sin enum acá — agregar kinds nuevos no debería requerir migración.
     */
    kind: text('kind').notNull(),

    channel: notificationChannelEnum('channel').notNull(),

    /** Datos crudos del evento, para template rendering y forensics. */
    payload: jsonb('payload').notNull().default({}),

    /** Pre-renderizado al enqueue — snapshot del subject visto por user. */
    subject: text('subject').notNull(),

    /** Pre-renderizado al enqueue. */
    body: text('body').notNull(),

    status: notificationStatusEnum('status').notNull().default('pending'),

    /** Solo poblado si status='failed'. */
    error: text('error'),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),

    /** Cuándo el dispatcher la marcó 'sent'. NULL para in_app pending. */
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }),

    /** Solo aplica a in_app cuando user clickea "marcar leída". */
    readAt: timestamp('read_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    // Hot path 1: listForUser ordenado DESC.
    index('notifications_user_created_idx').on(table.userId, table.createdAt),
    // Hot path 2: dispatcher pickea pending email/sms FIFO.
    index('notifications_status_channel_created_idx').on(
      table.status,
      table.channel,
      table.createdAt,
    ),
  ],
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
