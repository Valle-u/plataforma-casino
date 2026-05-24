/**
 * Tabla `vip_tiers` (DB de tenant). Sprint 52.3.
 *
 * Catálogo de tiers VIP. Define umbrales + perks reales aplicados por el
 * sistema. Admin puede editar perks/thresholds via INSERT/UPDATE manual
 * (panel admin no incluido en este sprint).
 *
 * Tiers default seedeados:
 *   - bronze (0 chips threshold, sin perks)
 *   - silver (10K, +10% bonus depo)
 *   - gold (100K, +20% bonus depo + cashback semanal 3%)
 *   - platinum (500K, +30% bonus depo + cashback 5% + flag VIP support)
 *
 * `perksJson` deja espacio para perks futuros sin agregar columnas:
 *   {
 *     "support_priority": true,
 *     "exclusive_promos": true,
 *     "fast_withdrawals": true,
 *     ...
 *   }
 * Estos son metadata para UI/marketing — el subsystem que los aplique
 * los lee de ahí. depositBonusPct y cashbackPct son las únicas que
 * tienen lógica server-side concreta en este sprint.
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '../utils/uuid';

export const vipTiers = pgTable(
  'vip_tiers',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),

    /** Identifier estable usado en código (bronze/silver/gold/platinum). */
    code: text('code').notNull().unique(),

    label: text('label').notNull(),

    /** Display color hex (#FFD700 gold, etc.). */
    color: text('color').notNull().default('#CD7F32'),

    /**
     * Umbral mínimo de volumen apostado en chips (sum |bet| últimos 30d)
     * para alcanzar este tier. Tier máximo aplicable = el tier con mayor
     * threshold tal que threshold <= user.volume.
     */
    thresholdChips: numeric('threshold_chips', { precision: 20, scale: 2 })
      .notNull()
      .default('0'),

    /**
     * % bonus al aprobar deposit (10 = +10% extra chips minted on top).
     * 0 = sin bonus. Aplicado por VipService.applyDepositBonus.
     */
    depositBonusPct: numeric('deposit_bonus_pct', { precision: 5, scale: 2 })
      .notNull()
      .default('0'),

    /**
     * % cashback semanal sobre net losses (5 = 5% de las pérdidas netas
     * de la semana). Aplicado por VipService.runWeeklyCashback (cron,
     * futuro sprint).
     */
    cashbackPct: numeric('cashback_pct', { precision: 5, scale: 2 })
      .notNull()
      .default('0'),

    /** Perks extra como flags/marketing copy. JSON libre. */
    perksJson: jsonb('perks_json').notNull().default({}),

    sortOrder: integer('sort_order').notNull().default(0),

    isActive: boolean('is_active').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('vip_tiers_threshold').on(table.thresholdChips),
  ],
);

export type VipTier = typeof vipTiers.$inferSelect;
export type NewVipTier = typeof vipTiers.$inferInsert;
