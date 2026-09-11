/**
 * Tabla `promotion_spin_commitments` — el sobre cerrado del giro.
 *
 * Ver `docs/27-ruleta-diaria.md` §8.
 *
 * ## Qué resuelve
 *
 * El premio lo decide el servidor. El jugador tiene que poder comprobar que no
 * se decidió **al ver quién era** — que no le dieron menos por ser el que más
 * deposita. Sin esto sólo puede creernos.
 *
 * ## Por qué una fila, y por qué antes
 *
 * **Lo que hace que sirva es el orden.** La semilla se guarda y su huella se
 * publica ANTES de que el servidor sepa qué va a salir. Si se generara en el
 * momento del giro, no probaría nada: nada impediría elegirla después de mirar
 * quién giró. Por eso la fila existe desde que el jugador abre la ruleta, no
 * desde que gira.
 *
 * `serverSeed` es **secreto hasta que se revela**. No puede salir en ninguna
 * respuesta antes de `revealedAt`: si se filtra, el jugador conoce el resultado
 * antes de girar y la ruleta deja de ser una ruleta.
 *
 * ## La semilla del jugador
 *
 * `clientSeed` la puede fijar él. Sin ella, el servidor podría generar muchas
 * semillas y quedarse con la que da el peor premio — el compromiso seguiría
 * siendo válido y la trampa también. Con ella no puede, porque el resultado
 * depende de algo que eligió el jugador.
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
import { promotions } from './promotions';
import { users } from './users';

export const promotionSpinCommitments = pgTable(
  'promotion_spin_commitments',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),

    promotionId: uuid('promotion_id')
      .notNull()
      .references(() => promotions.id),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),

    /**
     * El día del casino al que corresponde, `YYYY-MM-DD`. Es la misma ancla
     * que la clave de idempotencia del giro: un compromiso por día y por
     * jugador, igual que un giro por día y por jugador.
     */
    dayAnchor: text('day_anchor').notNull(),

    /** ⚠️ SECRETO hasta `revealedAt`. Nunca en una respuesta antes de eso. */
    serverSeed: text('server_seed').notNull(),

    /** SHA-256 de `serverSeed`. Esto sí se publica antes del giro. */
    serverSeedHash: text('server_seed_hash').notNull(),

    /** La que aporta el jugador. Ver la cabecera. */
    clientSeed: text('client_seed').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),

    /** Cuándo se reveló. NULL = todavía cerrado. */
    revealedAt: timestamp('revealed_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    // Un compromiso por jugador y por día. Es lo que impide que alguien pida
    // muchos y se quede con el que más le guste.
    uniqueIndex('promotion_spin_commitments_uniq').on(
      table.promotionId,
      table.userId,
      table.dayAnchor,
    ),
    index('promotion_spin_commitments_promo_idx').on(table.promotionId),
  ],
);

export type PromotionSpinCommitment =
  typeof promotionSpinCommitments.$inferSelect;
export type NewPromotionSpinCommitment =
  typeof promotionSpinCommitments.$inferInsert;
