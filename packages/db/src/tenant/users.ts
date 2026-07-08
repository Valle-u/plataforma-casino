/**
 * Tabla `users` (DB de tenant).
 *
 * Usuarios operativos de un tenant: admin del tenant, socios, distribuidores,
 * cajeros, empleados, jugadores. TODOS viven en esta tabla, diferenciados por
 * los roles asignados (ver user_roles).
 *
 * Esquema completo en `docs/04-modelo-datos.md §3` y reglas de jerarquía en
 * `docs/03-jerarquia-roles.md`.
 *
 * En este sprint solo agregamos los campos críticos para que el admin del
 * tenant pueda loguearse. Campos adicionales (status, KYC, 2FA, hierarchy,
 * etc.) se sumarán en sprints posteriores.
 */

import { boolean, numeric, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '../utils/uuid';

/**
 * Estados posibles del usuario dentro del tenant.
 *  - active:    operando normalmente.
 *  - suspended: bloqueado temporalmente (por admin/cajero).
 *  - banned:    bloqueado permanente.
 *  - pending:   recién creado, esperando confirmación / KYC / activación.
 */
export const userStatusEnum = pgEnum('user_status', [
  'active',
  'suspended',
  'banned',
  'pending',
]);

/**
 * Username reservado de la cuenta de SISTEMA "Casa" / tesorería (Blindaje del
 * núcleo económico, Parte B). Es la única fuente de fichas y la contraparte de
 * todo (depósitos, juego, premiaciones). No es un usuario humano: `is_system`,
 * sin roles, password no usable. Ver `docs/16-tesoreria.md`.
 */
export const HOUSE_USERNAME = '__casa__';

export const users = pgTable('users', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => generateUuidV7()),

  /** Username único dentro del tenant. Es el identificador principal. */
  username: text('username').notNull().unique(),

  /** Email opcional (jugadores pueden no tener; admins/cajeros sí lo tienen). */
  email: text('email').unique(),

  /** Teléfono opcional. */
  phone: text('phone'),

  /** Hash Argon2id de password. */
  passwordHash: text('password_hash').notNull(),

  /** Nombre visible en panel y audit log. */
  displayName: text('display_name').notNull(),

  /** Estado actual del usuario en el tenant. */
  status: userStatusEnum('status').notNull().default('active'),

  /**
   * Secret TOTP base32. NULL si todavía no inició setup.
   * Cifrado a nivel app pendiente (sprint hardening Postgres role).
   */
  twoFaSecret: text('two_fa_secret'),

  /**
   * True cuando el user confirmó el setup (envió un código válido tras
   * generar el secret). Si false, el secret existe pero NO se exige 2FA
   * en login ni en operaciones sensibles — el setup quedó a medias.
   */
  twoFaEnabled: boolean('two_fa_enabled').notNull().default(false),

  /** Último login exitoso. NULL si nunca se logueó. */
  lastLoginAt: timestamp('last_login_at', { withTimezone: true, mode: 'date' }),

  // ──────────────────────────────────────────────────────────────────
  // Sprint 51: modo Independent Branch (solo para rol 'socio').
  // Si is_independent_branch=true, el socio opera con su propio banco,
  // compra fichas al tenant a un precio mayorista configurado, y maneja
  // toda la operación de su red como un mini-casino. Las commissions
  // upstream NO se acumulan (ya pagó al comprar fichas).
  //
  // Para socios dependent (default), todos estos campos quedan NULL/false
  // y el socio opera contra el banco del tenant (modelo Sprint 50).
  // ──────────────────────────────────────────────────────────────────

  /** Sprint 51: true si el socio opera como sucursal independiente. */
  isIndependentBranch: boolean('is_independent_branch').notNull().default(false),

  /** Sprint 51: CBU/alias del banco propio del socio independent. NULL si dependent. */
  branchBankAccount: text('branch_bank_account'),

  /**
   * Sprint 51: precio mayorista al que el tenant le vende fichas a este
   * socio independent. Default '1' (1 ficha = 1 unidad fiat). Si el admin
   * pone 0.98, el socio paga $980 reales por 1000 fichas (descuento del 2%).
   * NULL si dependent.
   */
  branchChipsPricePerUnit: numeric('branch_chips_price_per_unit', {
    precision: 10,
    scale: 4,
  }),

  /**
   * Parte B (tesorería): true para cuentas de SISTEMA (la "Casa"/tesorería),
   * no humanas. No se loguean, no aparecen en listados operativos, no tienen
   * roles. Hoy: la Casa (username `__casa__`). Default false = usuario normal.
   */
  isSystem: boolean('is_system').notNull().default(false),

  /**
   * Comisiones por red (modelo operativo, docs/16-tesoreria.md §11): % de la
   * NetWin de SU sub-red que este usuario gana, fijado por su PADRE directo.
   * Markup: el padre garantiza `este% ≤ el suyo`. Default 0 (sin comisión).
   * El admin no usa este campo (su tope es 100% por rol). Numeric 0–100.
   */
  commissionRate: numeric('commission_rate', { precision: 5, scale: 2 })
    .notNull()
    .default('0'),

  /**
   * Comisión — ventaneo por flip (docs/17 §14.4). Delimitan el TRAMO
   * DEPENDIENTE (comisionable) del socio dentro de un período: el engine solo
   * cuenta los game_rounds settled en `[commissionEligibleFrom, commissionEligibleUntil)`.
   * NULL = sin límite por ese lado. Al flipear:
   *   - indep→dep: `from = flip`, `until = NULL` (arranca era dependiente).
   *   - dep→indep: `until = flip` (cierra la era dependiente en el flip).
   * Para socios que nunca fliparon, ambos NULL → cuenta el mes entero (si dep).
   */
  commissionEligibleFrom: timestamp('commission_eligible_from', {
    withTimezone: true,
    mode: 'date',
  }),
  commissionEligibleUntil: timestamp('commission_eligible_until', {
    withTimezone: true,
    mode: 'date',
  }),

  /**
   * Cupo mensual del EMPLEADO para cargas manuales por corrección /
   * bonificación / reintegro (docs/19-cupo-empleado.md). Es un TECHO, no un
   * stock: las fichas salen de la Casa; este número limita cuánto puede
   * mover un empleado por mes. Default '0' = no puede aunque tenga el
   * permiso `wallet.correct`. Se resetea implícitamente el 1° de cada mes
   * vía cómputo del consumo (source='employee_correction' del mes actual).
   */
  employeeCorrectionCapMonthly: numeric('employee_correction_cap_monthly', {
    precision: 20,
    scale: 2,
  })
    .notNull()
    .default('0'),

  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),

  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
