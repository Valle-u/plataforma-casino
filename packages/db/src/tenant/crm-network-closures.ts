/**
 * `crm_network_closures` — el cierre de una red independiente (**D14**, **D24**).
 *
 * ## ⚠️ Esta tabla es la frontera de una excepción a la LEY R6
 *
 * **R6** dice que el admin ve de una red independiente sólo agregados, no el
 * detalle interno. **D14 autoriza una excepción**: cuando un socio deja de
 * operar, sus contactos y conversaciones pasan a la bandeja central y el staff
 * —**incluidos los empleados**— lee el historial completo.
 *
 * Y D14 dice también de qué depende que eso sea legítimo:
 *
 * > *El disparador es el **cierre de la red**, no una decisión discrecional.*
 * > *Cerrar una red tiene que ser un evento explícito y auditado —quién y
 * > cuándo—, **porque ese evento es lo único que separa lo permitido de lo
 * > prohibido**.*
 *
 * Una fila acá **es** ese evento. No es un registro de algo que pasó en otro
 * lado: es lo que hace que leer esas conversaciones esté permitido.
 *
 * ## Por qué el cierre no se puede deshacer
 *
 * Es **D24**, y sale directo de la advertencia de D14: *"si el cierre se puede
 * hacer y deshacer sin registro, la excepción se convierte en un interruptor
 * para leer la red de cualquiera"*.
 *
 * Con reversa, un admin puede cerrar una red cinco minutos, leer años de
 * conversaciones privadas y reabrir. Queda auditado — pero **una auditoría sólo
 * sirve si alguien la lee**, y para cuando alguien la lea el daño ya está hecho.
 *
 * El `unique` sobre `socio_user_id` es lo que lo sostiene: **no hay forma de
 * cerrar dos veces**, así que tampoco de abrir y cerrar. Si un cierre fue un
 * error, se arregla a mano en la base — que es fricción a propósito.
 *
 * ## Por qué acá y no una columna en `users`
 *
 * `users` la toca todo el sistema y sus migraciones corren contra la base de
 * cada casino. Esto es un concepto del **CRM**, y además el evento *es* el dato:
 * quién, cuándo y qué se movió van juntos en una fila, no repartidos en columnas
 * de una tabla que habla de otra cosa.
 */

import {
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users';

export const crmNetworkClosures = pgTable('crm_network_closures', {
  id: uuid('id').primaryKey().defaultRandom(),

  /**
   * El socio cuya red se cerró.
   *
   * **Único**: una red se cierra una sola vez, para siempre. Ver el docblock.
   *
   * `restrict` y no `cascade`: borrar al socio no puede llevarse la constancia
   * de que su red se cerró. Sin esa fila, las conversaciones que se movieron
   * quedarían en la bandeja central **sin nada que explique por qué está
   * permitido leerlas**.
   */
  socioUserId: uuid('socio_user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'restrict' }),

  /** Quién lo cerró. Por **R6**, sólo el admin. */
  closedBy: uuid('closed_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),

  /**
   * El motivo que escribió el admin.
   *
   * Obligatorio a propósito: es lo único que, dentro de un año, va a explicar
   * por qué el staff central puede leer las conversaciones de esa red. "Se fue"
   * y "lo echamos" habilitan lo mismo y no significan lo mismo.
   */
  reason: text('reason').notNull(),

  /** Cuántos contactos se movieron. Para poder comparar si algo no cuadra. */
  contactsMoved: integer('contacts_moved').notNull().default(0),

  closedAt: timestamp('closed_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type CrmNetworkClosure = typeof crmNetworkClosures.$inferSelect;
