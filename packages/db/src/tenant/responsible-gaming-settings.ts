/**
 * Tabla `responsible_gaming_settings` (DB de tenant).
 *
 * Singleton por user — UNA fila por user con sus límites self-service.
 * Si el user nunca seteó nada, NO hay fila → defaults (sin límites).
 *
 * Spec: `docs/12-seguridad-compliance.md §6.3`.
 *
 * Convenciones:
 *   - Todos los límites son nullable: NULL = sin límite.
 *   - Montos como numeric(20,2) — convención wallet (chips, no fiat).
 *   - `period_unit` aplica al loss_limit: 'day' | 'week' | 'month'.
 *     Los deposit_limit_{daily,weekly,monthly} tienen ventana fija por
 *     el sufijo del nombre → no necesitan unit separado.
 *   - `age_confirmed_at`: timestamp cuando el user confirmó +18.
 *     Acá lo guardamos por compliance audit (no en `users` para no
 *     mezclar identity con responsible gaming).
 *
 * Enforcement (Sprint 33):
 *   - `deposit_limit_daily` chequeado en `DepositsService.create`.
 *   - `deposit_limit_weekly/monthly` ídem.
 *   - `bet_limit_per_round` + `loss_limit_period` quedan en schema +
 *     service; el hook real en wallet.bet llega cuando exista
 *     `MockGameProvider` (post-Sprint 33).
 */

import {
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users';

export const lossLimitPeriodUnitEnum = pgEnum(
  'loss_limit_period_unit',
  ['day', 'week', 'month'],
);

export const responsibleGamingSettings = pgTable(
  'responsible_gaming_settings',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** Cap diario de depósito en chips. NULL = sin límite. */
    depositLimitDaily: numeric('deposit_limit_daily', {
      precision: 20,
      scale: 2,
    }),
    depositLimitWeekly: numeric('deposit_limit_weekly', {
      precision: 20,
      scale: 2,
    }),
    depositLimitMonthly: numeric('deposit_limit_monthly', {
      precision: 20,
      scale: 2,
    }),

    /** Cap por round de apuesta en chips. NULL = sin límite. */
    betLimitPerRound: numeric('bet_limit_per_round', {
      precision: 20,
      scale: 2,
    }),

    /** Cap de pérdida acumulada en el período `lossLimitPeriodUnit`. */
    lossLimitPeriod: numeric('loss_limit_period', {
      precision: 20,
      scale: 2,
    }),
    lossLimitPeriodUnit: lossLimitPeriodUnitEnum('loss_limit_period_unit'),

    /** Confirmación de mayoría de edad. */
    ageConfirmedAt: timestamp('age_confirmed_at', {
      withTimezone: true,
      mode: 'date',
    }),
    /** Edad mínima vigente en el momento de la confirmación. */
    ageConfirmedMin: smallint('age_confirmed_min'),

    /** Quién hizo el último cambio: el user mismo o un admin. */
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id),

    /** Reason solo si el admin pisó el setting (audit trail). */
    updatedByReason: text('updated_by_reason'),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
);

export type ResponsibleGamingSettings =
  typeof responsibleGamingSettings.$inferSelect;
export type NewResponsibleGamingSettings =
  typeof responsibleGamingSettings.$inferInsert;
