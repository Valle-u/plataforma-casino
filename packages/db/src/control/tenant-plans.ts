/**
 * Tabla `tenant_plans` (DB de control).
 *
 * Define los planes comerciales que un tenant puede tener.
 * Cada plan describe: comisión sobre NGR, features habilitadas, fee mensual.
 *
 * Referencia en docs/04-modelo-datos.md §2.
 */

import { pgTable, text, numeric, jsonb, timestamp, uuid } from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '../utils/uuid';

export const tenantPlans = pgTable('tenant_plans', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => generateUuidV7()),

  /** Código corto único del plan (ej: 'basic', 'pro', 'enterprise'). */
  code: text('code').notNull().unique(),

  /** Nombre comercial visible (ej: 'Plan Básico'). */
  name: text('name').notNull(),

  /**
   * Porcentaje de comisión que cobra el super-admin sobre el NGR del tenant.
   * Ej: 0.1500 = 15%.
   */
  commissionPct: numeric('commission_pct', { precision: 5, scale: 4 }).notNull(),

  /**
   * Fee mensual fijo que paga el tenant (independiente del netwin).
   * En USD por convención. 0 si no hay fee fijo.
   */
  monthlyFee: numeric('monthly_fee', { precision: 10, scale: 2 }).notNull().default('0'),

  /**
   * JSON con las features habilitadas en este plan.
   * Ej: { kyc_provider: false, salesbot: true, max_socios: 50, ... }
   * Estructura libre; cada feature se valida en su módulo correspondiente.
   */
  features: jsonb('features').notNull().default({}),

  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),

  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export type TenantPlan = typeof tenantPlans.$inferSelect;
export type NewTenantPlan = typeof tenantPlans.$inferInsert;
