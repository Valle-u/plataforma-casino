/**
 * Tabla `push_subscriptions` (DB de tenant).
 *
 * Suscripciones Web Push por dispositivo. Un usuario puede tener varias
 * (iPhone + desktop + etc.). El dispatcher de notificaciones usa esta
 * tabla para saber a qué endpoints enviar cuando hay una notif
 * `channel='web_push'` pendiente para ese usuario.
 *
 * Diseño:
 *   - `endpoint`: URL única que el browser/OS registra contra el push
 *     service (FCM/APNs). Es la clave de dedupe natural: el mismo
 *     dispositivo siempre genera la misma endpoint (upsert idempotente).
 *   - `p256dh` + `auth`: claves de cifrado del mensaje (base64url).
 *   - `deviceLabel`: user-agent recortado, para que el user reconozca
 *     el dispositivo en la UI.
 *   - `lastSeenAt`: se actualiza cuando el dispatcher envía con éxito
 *     a este endpoint. Permite purgar suscripciones zombies (endpoints
 *     que el push service ya no reconoce → 404/410) si el user no las
 *     desregistra por su cuenta.
 *   - `endpoint` es UNIQUE por tenant: el mismo dispositivo no puede
 *     estar suscrito dos veces (aunque cambie de user, la vieja
 *     suscripción se re-asigna).
 */

import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '../utils/uuid';
import { users } from './users';

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),

    /** URL única del endpoint registrado por el push service. */
    endpoint: text('endpoint').notNull(),

    /** Clave pública de cifrado (base64url). */
    p256dh: text('p256dh').notNull(),

    /** Secreto de autenticación (base64url). */
    auth: text('auth').notNull(),

    /** Label legible del dispositivo (user-agent recortado). */
    deviceLabel: text('device_label'),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),

    /** Última entrega exitosa del dispatcher a este endpoint. */
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Dedupe natural: el mismo dispositivo siempre registra la misma URL.
    uniqueIndex('push_subscriptions_endpoint_unique').on(table.endpoint),
    // Hot path del dispatcher: todas las suscripciones de un user.
    index('push_subscriptions_user_idx').on(table.userId),
  ],
);

export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscription = typeof pushSubscriptions.$inferInsert;
