/**
 * `crm_operator_alerts` — el Telegram de cada operador, para avisarle (**4.5**).
 *
 * ## Qué tapa esto
 *
 * El hueco que **D16** y **D17** dejan juntos, y que D16 escribió de frente:
 *
 * ```
 * 03:14  Juan escribe.
 *        → Juan no recibe nada        (D17: sin respuestas automáticas)
 *        → Pérez no se entera         (D16: sólo el panel, y está cerrado)
 * 09:20  Pérez abre el panel y recién ahí existe el mensaje.
 * ```
 *
 * Seis horas en las que **ninguna de las dos partes tiene señal de nada**. Y si
 * Pérez no abre el panel en dos días, nadie en el sistema lo sabe: por **D10** el
 * socio tampoco lo ve.
 *
 * ## Por qué el operador tiene que escribir primero
 *
 * No es una decisión nuestra: **un bot de Telegram sólo puede hablarle a quien le
 * escribió a él**. No hay forma de que inicie la conversación. Por eso hace falta
 * el código de un solo uso — el operador lo saca del panel y le manda
 * `/start <código>` al bot, y recién ahí tenemos su `chat_id`.
 *
 * ## El código lleva el slug del casino adentro
 *
 * El bot de alertas es **uno solo para toda la plataforma**, así que cuando llega
 * un `/start` hay que saber **de qué casino es antes de poder abrir su base** —
 * el mismo problema que **D23** con WhatsApp.
 *
 * Ahí se resolvió con una tabla en la DB de control; acá alcanza con meter el
 * slug en el código (`demo-A3F9K2`), porque el código es **efímero y lo tipea una
 * persona**. Una tabla de control para algo que vive cinco minutos sería más
 * máquinaria de la que el problema pide.
 */

import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

export const crmOperatorAlerts = pgTable('crm_operator_alerts', {
  id: uuid('id').primaryKey().defaultRandom(),

  /** El operador. Uno solo por persona: su Telegram es uno. */
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),

  /**
   * El chat de Telegram del operador. `null` mientras no haya escrito al bot.
   *
   * Una fila con `chat_id` en `null` es un vínculo **pendiente**: el código está
   * generado y todavía nadie lo usó.
   */
  chatId: text('chat_id'),

  /**
   * El código de un solo uso, con el slug del casino adentro.
   *
   * Se borra al usarlo. Un código que sigue vivo después de vincular sería una
   * segunda llave a la misma puerta, y no hay razón para tener dos.
   */
  linkCode: text('link_code'),

  /**
   * Cuándo deja de servir el código.
   *
   * Vence a propósito: un código eterno tirado en un chat o en una captura sigue
   * sirviendo para desviar los avisos de ese operador a otro Telegram.
   */
  linkCodeExpiresAt: timestamp('link_code_expires_at', { withTimezone: true }),

  /**
   * Se puede apagar sin desvincular.
   *
   * Es distinto de borrar la fila: apagar es "ahora no", desvincular es "este
   * Telegram ya no es mío". El segundo caso pide volver a escribirle al bot.
   */
  enabled: boolean('enabled').notNull().default(true),

  linkedAt: timestamp('linked_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type CrmOperatorAlert = typeof crmOperatorAlerts.$inferSelect;
