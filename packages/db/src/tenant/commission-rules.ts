/**
 * Tabla `commission_rules` (DB de tenant).
 *
 * Reglas de comisión: cuánto cobra cada rol upstream cuando ocurre un
 * evento (depósito aprobado, retiro pagado, etc.).
 *
 * Modelo conceptual:
 *   - clienteA pertenece a cajero1 → distribuidor1 → socio1 (via user_hierarchy).
 *   - Cuando clienteA hace un deposit de $1000 que el admin aprueba, el
 *     sistema busca `commission_rules` activas para `event=deposit_approved`
 *     y aplica una por cada rol ancestral del cliente:
 *       - rule { role: 'cajero', event: 'deposit_approved', pct: 5 } → $50 al cajero1
 *       - rule { role: 'distribuidor', ..., pct: 3 } → $30 al distribuidor1
 *       - rule { role: 'socio', ..., pct: 2 } → $20 al socio1
 *   - El resto ($895) queda en el tenant.
 *
 * Diseño:
 *   - 1 rule por (role, event_type) — UNIQUE. Cambios via UPDATE.
 *   - `pct` decimal con 2 decimales (0.00 a 100.00).
 *   - `event_type` text libre — futuro: bet_settled, withdrawal_paid, etc.
 *     MVP: solo `deposit_approved` y `withdrawal_paid`.
 *   - `active` boolean — soft-delete; si false el cron de apply la saltea.
 *   - Sin condiciones complejas (por monto threshold, por funder, etc.) —
 *     post-MVP cuando emerja la necesidad.
 */

import {
  boolean,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '../utils/uuid';

export const commissionRules = pgTable(
  'commission_rules',
  {
    id: uuid('id').primaryKey().$defaultFn(generateUuidV7),

    /**
     * Rol del beneficiario en la cadena ancestral del cliente. Si el rol
     * no aparece en los ancestors del cliente al momento del evento, la
     * rule simplemente NO aplica (skip silencioso, no error).
     *
     * Valores típicos: 'cajero', 'distribuidor', 'socio', 'empleado'.
     */
    role: text('role').notNull(),

    /**
     * Discriminador del evento que dispara la commission.
     *   - 'deposit_approved': cuando un cajero/admin aprueba un deposit.
     *   - 'withdrawal_paid':  cuando un cajero/admin marca paid un retiro.
     *
     * Futuro: 'bet_settled', 'bonus_cleared', etc.
     */
    eventType: text('event_type').notNull(),

    /**
     * Porcentaje sobre el `source_amount` del evento. Decimal 0.00 a 100.00
     * con 2 decimales. Ej: 5.50 = 5.5%. El cálculo es:
     *   payout = source_amount * (pct / 100)
     */
    pct: numeric('pct', { precision: 5, scale: 2 }).notNull(),

    /** Si false, el `apply` salta esta rule. */
    active: boolean('active').notNull().default(true),

    /** Notas internas del admin que la creó. */
    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Una rule única por (role, event_type). Cambios via UPDATE.
    uniqueIndex('commission_rules_role_event_unique').on(
      table.role,
      table.eventType,
    ),
  ],
);

export type CommissionRule = typeof commissionRules.$inferSelect;
export type NewCommissionRule = typeof commissionRules.$inferInsert;
