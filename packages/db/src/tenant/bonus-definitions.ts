/**
 * Tabla `bonus_definitions` (DB de tenant).
 *
 * Plantillas de bono que el Admin Tenant configura. Cada definición es
 * un "tipo" reutilizable: "Bono de bienvenida del Casino X — 100% match
 * hasta 50k fichas, x20 wagering, expira en 30 días". Las instancias
 * (lo que un usuario concreto recibe) viven en `user_bonuses`.
 *
 * Ver `docs/15-engagement-promos.md §A3`.
 *
 * Diseño:
 *   - `config` y `wagering` son JSONB para flexibilidad. La validación
 *     fina se hace en el service (Zod / class-validator) — Postgres solo
 *     guarda lo que el caller le pase.
 *   - `funded_by_user_id` referencia el actor que paga (Admin Tenant o
 *     Socio según la regla del doc). Resuelto al crear, NUNCA cambia.
 *   - `status` permite tener bonos en borrador antes de exponerlos.
 *   - MVP scope = `tenant`. `scope` se mantiene como enum para futuras
 *     extensiones (platform-wide en v2).
 */

import {
  index,
  integer,
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

export const bonusTypeEnum = pgEnum('bonus_type', [
  'welcome',
  'reload',
  'cashback',
  'manual',
  'free_spins',
  'no_deposit',
  'referral',
]);

export const bonusStatusEnum = pgEnum('bonus_definition_status', [
  'draft',
  'active',
  'paused',
  'archived',
]);

export const bonusScopeEnum = pgEnum('bonus_scope', ['tenant']);

export const bonusDefinitions = pgTable(
  'bonus_definitions',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),

    /** Código único intra-tenant, e.g. "welcome_basic_2026". */
    code: text('code').notNull(),

    /** Nombre visible. */
    name: text('name').notNull(),

    type: bonusTypeEnum('type').notNull(),

    status: bonusStatusEnum('status').notNull().default('draft'),

    /**
     * Configuración específica del tipo:
     *   - welcome: { matchPct, maxAmount, minDeposit }
     *   - reload:  { matchPct, maxAmount }
     *   - cashback:{ pct, periodDays }
     *   - manual:  { defaultAmount } (sugerencia para cajero, override permitido)
     *   - free_spins: { gameIds[], spinCount, spinValue }
     *   - no_deposit: { amount }
     *   - referral: { referrerAmount, referredAmount, conditionEvent }
     */
    config: jsonb('config').notNull().default({}),

    /**
     * Reglas de wagering. Ver `docs/15-engagement-promos.md §A2`.
     * MVP: persistimos pero no enforce — la integración con engine de
     * juegos viene en sprint posterior.
     */
    wagering: jsonb('wagering').notNull().default({}),

    /** Default 30 días si no se setea. */
    expirationDays: integer('expiration_days').notNull().default(30),

    /**
     * Filtro de audiencia objetivo. JSONB libre para no acoplar al schema
     * de users. Ejemplo: `{ roleCodes: ['usuario_final'], minDeposits: 0 }`.
     * MVP: no se evalúa en grant manual (el cajero decide). En auto-grant
     * (sprint posterior) se aplica para filtrar candidatos.
     */
    segmentFilter: jsonb('segment_filter').notNull().default({}),

    /**
     * Visibilidad en UI. Sin enforce hoy — campo persistido para que el
     * frontend lo lea cuando llegue.
     */
    visibility: jsonb('visibility').notNull().default({}),

    scope: bonusScopeEnum('scope').notNull().default('tenant'),

    /**
     * Quien paga las fichas del bono. Resuelto al crear según la regla
     * de docs/15 §0 (Admin Tenant / Socio / Empleado del Socio / etc.).
     * Validación al grant: este user debe tener saldo suficiente (excepto
     * admin_tenant que puede mintear).
     */
    fundedByUserId: uuid('funded_by_user_id')
      .notNull()
      .references(() => users.id),

    /** Quién creó la definición. NO cambia (auditoría). */
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
    // Capa 3 Fase 1 (0048): segmentamos el UNIQUE por owner (created_by).
    // Cada casino (admin del tenant + N socios independientes) es su
    // propio namespace: pueden reutilizar codes triviales como
    // 'welcome_basico' sin chocar entre sí. El grant valida el funder,
    // así que dos definiciones con el mismo code no se cruzan en el flujo.
    uniqueIndex('bonus_definitions_code_owner_uniq').on(
      table.code,
      table.createdByUserId,
    ),
    index('bonus_definitions_status_idx').on(table.status),
    index('bonus_definitions_type_idx').on(table.type),
  ],
);

export type BonusDefinition = typeof bonusDefinitions.$inferSelect;
export type NewBonusDefinition = typeof bonusDefinitions.$inferInsert;
