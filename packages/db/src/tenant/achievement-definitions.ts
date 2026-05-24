/**
 * Tabla `achievement_definitions` (DB de tenant).
 *
 * Catálogo de logros desbloqueables por player. Sprint 52.2.
 *
 * Cada def describe:
 *   - `code` unique: identifier estable usado por código (predicates,
 *     seeds, hooks client-side). NO se renombra después de release.
 *   - `label` + `description`: copy mostrado al player.
 *   - `iconName`: nombre del ícono Lucide React (e.g. "Trophy", "Crown")
 *     que el cliente resuelve via lookup map. Decoupling visual de
 *     backend para que cambios de icon no requieran migration.
 *   - `color`: hex string (e.g. "#FFD700") para el styling del badge.
 *   - `category`: agrupa logros en la UI (daily / weekly / milestone / vip).
 *   - `rewardChips`: si > 0, al desbloquear se mintea ese monto al user.
 *     0 = solo cosmético (badge sin recompensa).
 *   - `sortOrder`: para ordenar dentro de cada categoría.
 *   - `isActive`: soft-disable sin perder el histórico de unlocks.
 *
 * Seed: la migration trae un set inicial de ~16 logros que matchea el
 * catálogo client-side previo (Sprint 51.32). Cuando admin quiera sumar
 * nuevos, hace INSERT manual (futuro: panel admin).
 */

import {
  boolean,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '../utils/uuid';

export const achievementCategoryEnum = pgEnum('achievement_category', [
  'daily',
  'weekly',
  'milestone',
  'vip',
]);

export const achievementDefinitions = pgTable(
  'achievement_definitions',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),

    /** Identifier estable usado en código (predicates + client lookup). */
    code: text('code').notNull().unique(),

    label: text('label').notNull(),
    description: text('description').notNull(),

    /** Lucide React icon name (e.g. "Trophy", "Flame"). */
    iconName: text('icon_name').notNull().default('Trophy'),

    /** Hex color para badge (#FFD700, etc.). */
    color: text('color').notNull().default('#FFD700'),

    category: achievementCategoryEnum('category').notNull(),

    /**
     * Chips minted al desbloquear. 0 = sólo cosmético.
     * numeric(20,2) para consistencia con wallet amounts.
     */
    rewardChips: numeric('reward_chips', { precision: 20, scale: 2 })
      .notNull()
      .default('0'),

    sortOrder: integer('sort_order').notNull().default(0),

    isActive: boolean('is_active').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('achievement_definitions_category_sort').on(
      table.category,
      table.sortOrder,
    ),
  ],
);

export type AchievementDefinition = typeof achievementDefinitions.$inferSelect;
export type NewAchievementDefinition =
  typeof achievementDefinitions.$inferInsert;
