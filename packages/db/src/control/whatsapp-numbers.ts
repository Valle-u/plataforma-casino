/**
 * Tabla `whatsapp_numbers` (DB de control) — el mapeo que exige **D23**.
 *
 * ## Por qué esta tabla no puede vivir en la base del tenant
 *
 * **Meta configura UNA sola URL de callback por App.** Todos los mensajes de
 * todos los socios caen en el mismo endpoint, y lo único que dice de quién es
 * cada uno es el `phone_number_id` que viene **adentro del payload**.
 *
 * O sea que para abrir la base de un casino hay que saber **cuál es** antes de
 * poder abrirla. Buscar el mapeo en la base del tenant sería necesitar la
 * respuesta para poder hacer la pregunta.
 *
 * Es la **única excepción que P4 permite** —"nunca una conexión global a la DB
 * de un tenant; la DB de control es la única excepción"— y es exactamente para
 * lo que la DB de control existe: el registro de a quién pertenece qué.
 *
 * Es el mismo patrón que ya usan los callbacks de los proveedores de juego, que
 * tampoco pueden resolver el tenant por `Host`: Gregmorn lleva su token en la
 * URL y Forever su agent code en un header, y los dos se resuelven contra una
 * columna de `tenants`.
 *
 * ## ⚠️ Esto es la superficie de aislamiento entre casinos
 *
 * Un `phone_number_id` apuntado al tenant equivocado **manda la conversación de
 * un jugador a la bandeja de otro casino**. No es un bug de ruteo: es P4 roto,
 * del lado peor. Por eso `phone_number_id` es **único** a nivel global y no por
 * tenant — dos casinos no pueden reclamar el mismo número, y si alguien lo
 * intenta, falla al escribir en vez de fallar al enrutar.
 *
 * ## Por qué guarda también el canal
 *
 * Porque hace falta saber **de qué bandeja** es (**D1**, **D2**), no sólo de qué
 * casino. Es el equivalente de los dos segmentos que Telegram lleva en la URL
 * (`/webhook/:tenantSlug/:channelId`): uno dice el casino, el otro la bandeja.
 *
 * `channel_id` apunta a `crm_channels` de la base **de ese tenant**, así que no
 * puede haber FK: son dos bases distintas. La integridad la sostiene el código
 * al vincular el número, y el webhook trata un canal que no existe como un
 * número no reclamado.
 */

import { pgTable, text, uuid, timestamp, boolean } from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '../utils/uuid';
import { tenants } from './tenants';

export const whatsappNumbers = pgTable('whatsapp_numbers', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => generateUuidV7()),

  /**
   * El id que Meta le da al número, y **la llave de todo esto**: es lo único que
   * viaja en el payload y permite saber de quién es el mensaje.
   *
   * Único a nivel global a propósito. Ver la advertencia de arriba.
   */
  phoneNumberId: text('phone_number_id').notNull().unique(),

  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),

  /**
   * La fila de `crm_channels` **en la base de ese tenant**. Sin FK: es otra base.
   *
   * Es lo que dice a qué bandeja va el mensaje (**D1**, **D2**).
   */
  channelId: uuid('channel_id').notNull(),

  /**
   * El WABA (cuenta de WhatsApp Business) al que pertenece el número.
   *
   * Por **D13** el WABA **es del socio**, no nuestro: es su cuenta verificada,
   * con sus papeles y su costo, y se la lleva si se va. Se guarda para poder
   * mirar de qué cuenta vino algo cuando Meta avise de un problema — que avisa
   * por WABA, no por número.
   */
  wabaId: text('waba_id'),

  /** El número como lo muestra Meta (`+54 9 341 555-1234`). Sólo para leerlo. */
  displayNumber: text('display_number'),

  /**
   * Un número desvinculado se marca inactivo, **no se borra**.
   *
   * Mismo criterio que al desvincular un bot de Telegram: las conversaciones que
   * entraron por ese canal lo siguen apuntando. Y mientras Meta no se entere,
   * los mensajes van a seguir llegando: con la fila presente e inactiva se los
   * puede descartar sabiendo por qué, en vez de verlos como un número
   * desconocido.
   */
  isActive: boolean('is_active').notNull().default(true),

  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export type WhatsappNumber = typeof whatsappNumbers.$inferSelect;
export type NewWhatsappNumber = typeof whatsappNumbers.$inferInsert;
