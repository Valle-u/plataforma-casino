/**
 * Tabla `promotions` (DB de tenant).
 *
 * Plantilla genérica para los 6 tipos de sorteos/actividades del doc 15 §B:
 *   - lottery_tickets, lottery_ranking, missions, daily_wheel,
 *     login_streak, level_chests.
 *
 * Diseño:
 *   - `config jsonb` libre por type. Para daily_wheel: `{ segments: [...],
 *     spinsPerDay: 1 }`. Para login_streak: `{ prizes: [day1, day2, ...] }`.
 *     Validación fina por type en cada service.
 *   - `prizes jsonb` redundante con `config.prizes` en algunos types. Por
 *     ahora mantenemos ambos campos (doc lo pide) — el service de cada
 *     type usa el que mejor le sirve.
 *   - `funded_by_user_id` resuelto al crear, NUNCA cambia. Igual pattern
 *     que bonus_definitions.
 *   - Status enum: draft → scheduled → active → closed/cancelled.
 *   - Code unique intra-tenant.
 */

import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '../utils/uuid';
import { users } from './users';

export const promotionTypeEnum = pgEnum('promotion_type', [
  'lottery_tickets',
  'lottery_ranking',
  'missions',
  'daily_wheel',
  'login_streak',
  'level_chests',
]);

export const promotionStatusEnum = pgEnum('promotion_status', [
  'draft',
  'scheduled',
  'active',
  'closed',
  'cancelled',
]);

export const promotionScopeEnum = pgEnum('promotion_scope', ['tenant']);

export const promotions = pgTable(
  'promotions',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),

    code: text('code').notNull(),
    name: text('name').notNull(),
    type: promotionTypeEnum('type').notNull(),
    status: promotionStatusEnum('status').notNull().default('draft'),

    /** Configuración específica del type. Libre — validación en service. */
    config: jsonb('config').notNull().default({}),

    /** Estructura de premios (puede solapar con config.prizes según type). */
    prizes: jsonb('prizes').notNull().default({}),

    /** NULL para promotions perpetuas (e.g. daily_wheel sin fecha de fin). */
    startsAt: timestamp('starts_at', { withTimezone: true, mode: 'date' }),
    endsAt: timestamp('ends_at', { withTimezone: true, mode: 'date' }),
    drawAt: timestamp('draw_at', { withTimezone: true, mode: 'date' }),

    targetSegment: jsonb('target_segment').notNull().default({}),
    visibility: jsonb('visibility').notNull().default({}),

    scope: promotionScopeEnum('scope').notNull().default('tenant'),

    /** Quien paga los premios. Resuelto al crear, NUNCA cambia. */
    fundedByUserId: uuid('funded_by_user_id')
      .notNull()
      .references(() => users.id),

    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('promotions_code_uniq').on(table.code),
    index('promotions_status_idx').on(table.status),
    index('promotions_type_status_idx').on(table.type, table.status),
  ],
);

export type Promotion = typeof promotions.$inferSelect;
export type NewPromotion = typeof promotions.$inferInsert;
