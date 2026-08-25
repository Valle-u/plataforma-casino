/**
 * Tabla `branch_flip_events` (DB de tenant).
 *
 * Historial de flips dep↔indep de cada socio. Una fila por flip REAL (cambio
 * efectivo del flag `is_independent_branch`), escrita dentro de la MISMA
 * transacción que `BranchesService.toggleIndependence`.
 *
 * Por qué existe (bug del double-dip, 2026-08-25): el motor de comisiones
 * ventaneaba el tramo dependiente de un socio usando solo 2 timestamps
 * (`users.commission_eligible_from/until`). Esos 2 campos representan el tramo
 * ACTUAL, no la historia: un flip posterior (mes M+2) los sobreescribe y borra
 * el boundary del flip anterior (mes M). Un recompute del mes M dejaba de
 * ventanear → el socio cobraba comisión dependiente por el mes ENTERO, incluido
 * el tramo que ya había ganado como independiente (double-dip). El bug espejo:
 * un socio hoy independiente, al recomputar un mes viejo en que fue dependiente,
 * cobraba CERO (el subtree quedaba excluido por el flag ACTUAL).
 *
 * Con esta tabla el windowing reconstruye los tramos REALES del período desde
 * el historial, sin depender del estado actual del flag. `mode` es el modo
 * NUEVO que quedó vigente TRAS el flip (a partir de `at`). El estado antes del
 * primer event de un socio se asume 'dependent' (los socios nacen dependientes,
 * `is_independent_branch` default false).
 *
 * Append-only, nunca se borra ni actualiza (auditoría del historial de banca).
 * Fallback: si un socio no tiene ningún event (estado pre-migración), el motor
 * cae al windowing legacy por `from/until` — nunca peor que hoy.
 */

import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { generateUuidV7 } from '../utils/uuid';
import { users } from './users';

export const branchFlipEvents = pgTable(
  'branch_flip_events',
  {
    id: uuid('id').primaryKey().$defaultFn(generateUuidV7),

    /** El socio cuyo flag de banca cambió. */
    socioUserId: uuid('socio_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /**
     * Modo NUEVO vigente TRAS el flip (a partir de `at`):
     *   - 'independent': el socio pasó a bancar su propia red (dep→indep).
     *   - 'dependent':   el socio volvió a ser comercial puro (indep→dep).
     */
    mode: text('mode').notNull(),

    /** Momento exacto del flip (mismo instante que se estampa en from/until). */
    at: timestamp('at', { withTimezone: true, mode: 'date' }).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // El windowing consulta los events de un socio ordenados por `at`.
    index('branch_flip_events_socio_at').on(table.socioUserId, table.at),
    check(
      'branch_flip_events_mode_valid',
      sql`${table.mode} IN ('independent', 'dependent')`,
    ),
  ],
);

export type BranchFlipEvent = typeof branchFlipEvents.$inferSelect;
export type NewBranchFlipEvent = typeof branchFlipEvents.$inferInsert;
