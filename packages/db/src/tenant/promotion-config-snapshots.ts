/**
 * Tabla `promotion_config_snapshots` — con qué rueda se jugó cada giro.
 *
 * ## El problema que resuelve
 *
 * La config de una promoción es mutable: el admin edita premios y
 * probabilidades con la ruleta prendida y gente girando. Los giros viejos
 * guardaban sólo el `segmentId`, así que al cambiar la config quedaban
 * apuntando a un gajo que ya no existía. El código devolvía un segmento
 * sintético para no explotar — o sea que el historial **no se podía
 * reconstruir**, y con él se iba la única respuesta a "¿qué probabilidades
 * regían el día que este jugador no ganó nunca?".
 *
 * ## Por qué por huella y no por número de versión
 *
 * La fila se identifica por el **hash del contenido** de la config, no por un
 * contador. Tres razones, en orden de importancia:
 *
 *   1. **No se puede desincronizar.** La huella se deriva de la config misma;
 *      no hay un segundo dato que mantener en sincronía con el primero.
 *   2. **No hay carreras.** Un contador hay que leerlo e incrementarlo, y dos
 *      ediciones simultáneas se pisan. Una huella se calcula sola.
 *   3. **Dedupe gratis.** Editar y volver atrás no crea una versión nueva:
 *      vuelve a la misma huella, que es la verdad — es la misma rueda.
 *
 * Lo que se pierde: "versión 3" se lee mejor que `a1b2c3…`. A cambio, el orden
 * y la historia salen igual de `first_seen_at`.
 *
 * ## Se escribe al GIRAR, no al guardar
 *
 * Así toda fila de `promotion_rewards` tiene su snapshot, incluidas las ruedas
 * configuradas antes de que esto existiera. Si se escribiera sólo al guardar,
 * las ruedas viejas nunca tendrían uno y el agujero seguiría abierto para
 * exactamente los casos más difíciles de reconstruir.
 */

import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '../utils/uuid';
import { promotions } from './promotions';

export const promotionConfigSnapshots = pgTable(
  'promotion_config_snapshots',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),

    promotionId: uuid('promotion_id')
      .notNull()
      .references(() => promotions.id),

    /** SHA-256 de la config canonicalizada (claves ordenadas). */
    configHash: text('config_hash').notNull(),

    /** La config tal cual estaba. Es la copia que permite reconstruir. */
    config: jsonb('config').notNull(),

    /**
     * Cuándo se vio por primera vez. Da el orden histórico sin necesidad de un
     * contador: ordenar por acá es ordenar las versiones.
     */
    firstSeenAt: timestamp('first_seen_at', {
      withTimezone: true,
      mode: 'date',
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // La misma config de la misma promo se guarda UNA vez. Es lo que hace que
    // el insert pueda ser un "si no está, ponelo" sin leer antes.
    uniqueIndex('promotion_config_snapshots_uniq').on(
      table.promotionId,
      table.configHash,
    ),
    index('promotion_config_snapshots_promo_idx').on(table.promotionId),
  ],
);

export type PromotionConfigSnapshot =
  typeof promotionConfigSnapshots.$inferSelect;
export type NewPromotionConfigSnapshot =
  typeof promotionConfigSnapshots.$inferInsert;
