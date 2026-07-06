/**
 * Tabla `employee_salaries` (DB de tenant).
 *
 * F1 · Sueldos por empleado en socios dependientes.
 *
 * El admin fija un sueldo mensual (o pago único) por cada empleado que un
 * socio dep creó. Al momento del settle de comisiones (F1 socios-dep), este
 * monto se descuenta del NetWin del socio dep dueño de la rama del empleado.
 *
 * PK = user_id (relación 1:1 con users). Se piensa como el "sueldo actual".
 * Para historial completo del cambio de sueldo, ver `audit_log` con
 * `action_code = 'employee_salaries.update'` (severity: medium).
 *
 * `monthly_amount` = 0 se permite (representa "sin sueldo" explícito).
 *
 * `currency` default 'ARS'. Idx para query eventual "todos los que cobran
 * en X". Multimoneda no es prioritario en MVP.
 *
 * Nota: este schema NO enforce que el user sea 'empleado' bajo un socio dep.
 * Esa validación vive en el service (evita seteos sobre users que no
 * aplican). El schema modela la relación pura: 1 user → 1 sueldo.
 */

import {
  check,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';

export const employeeSalaries = pgTable(
  'employee_salaries',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),

    monthlyAmount: numeric('monthly_amount', { precision: 20, scale: 2 })
      .notNull()
      .default('0'),

    currency: text('currency').notNull().default('ARS'),

    updatedBy: uuid('updated_by').references(() => users.id, {
      onDelete: 'set null',
    }),

    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),

    notes: text('notes'),
  },
  (table) => [
    check(
      'employee_salaries_amount_nonneg',
      sql`${table.monthlyAmount} >= 0`,
    ),
    index('employee_salaries_currency_idx').on(table.currency),
  ],
);

export type EmployeeSalary = typeof employeeSalaries.$inferSelect;
export type NewEmployeeSalary = typeof employeeSalaries.$inferInsert;
