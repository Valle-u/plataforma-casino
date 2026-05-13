/**
 * Tabla `user_recovery_codes` (DB de tenant).
 *
 * Backup one-time codes para 2FA TOTP. Si el user pierde el dispositivo con
 * la app authenticator (Google Authenticator, Authy, etc.), puede usar uno
 * de estos codes en lugar del TOTP para loguearse. Una vez usado, queda
 * inválido para siempre (`used_at` se setea).
 *
 * Política:
 *   - 10 codes generados en `confirmSetup` (o cuando el user llama
 *     `regenerate-recovery-codes`).
 *   - Plain text se devuelve UNA SOLA VEZ — el server solo guarda el hash.
 *   - Si el user gasta todos, debería poder regenerar (con TOTP fresco) o,
 *     en el peor caso, pedir reset por soporte.
 *
 * Esquema:
 *   - `code_hash`: SHA-256 del code en plano. SHA-256 es suficiente porque
 *     el code es de alta entropía (160 bits), no es brute-forceable como
 *     una password humana — no necesita bcrypt/argon2.
 *   - `used_at`: NULL si no se usó. Si ya se usó, NO se borra la fila
 *     (auditoría: queremos saber cuándo y desde dónde se usó cada uno).
 *
 * Índices:
 *   - `(user_id, code_hash)` UNIQUE para evitar duplicados intra-user.
 *   - `(user_id)` simple para la query "listar codes activos del user".
 */

import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '../utils/uuid';
import { users } from './users';

export const userRecoveryCodes = pgTable(
  'user_recovery_codes',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** SHA-256 hex del code en plain. Plain solo se devuelve UNA vez al user. */
    codeHash: text('code_hash').notNull(),

    /** NULL si todavía no se consumió. */
    usedAt: timestamp('used_at', { withTimezone: true, mode: 'date' }),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // Garantiza que no haya dos codes con el mismo hash para el mismo user.
    // (Collision teórica de SHA-256 es despreciable, pero la regla protege
    // contra bugs lógicos donde generemos el mismo code dos veces.)
    uniqUserCode: uniqueIndex('user_recovery_codes_user_hash_uniq').on(
      table.userId,
      table.codeHash,
    ),
    userIdx: index('user_recovery_codes_user_idx').on(table.userId),
  }),
);

export type UserRecoveryCode = typeof userRecoveryCodes.$inferSelect;
export type NewUserRecoveryCode = typeof userRecoveryCodes.$inferInsert;
