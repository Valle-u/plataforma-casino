/**
 * Tabla `idempotency_keys` (DB de tenant).
 *
 * Cache de respuestas a requests con header `Idempotency-Key`. Cuando el
 * cliente reintenta la misma operación (retry de red, doble click), el
 * servidor devuelve la respuesta original en lugar de procesar dos veces.
 *
 * Reglas (`docs/05 §11`):
 *   - PK = `key` (text). El cliente puede usar UUID, ULID, lo que quiera —
 *     la única restricción es que sea estable para la operación.
 *   - `request_hash`: hash SHA-256 del body normalizado del request.
 *     Sirve para detectar abuso: misma key con payload distinto → 409
 *     IDEMPOTENCY_CONFLICT.
 *   - `response_body` + `status_code`: cacheamos la respuesta literal para
 *     poder reproducirla sin re-ejecutar la operación.
 *   - `expires_at`: TTL 24h por default (configurable). Después de eso, la
 *     key se puede limpiar con un job nocturno.
 *
 * Vida del registro:
 *   1. Cliente manda POST con `Idempotency-Key: abc-123`.
 *   2. Interceptor mira si existe.
 *      - SI existe + hash coincide → devuelve `response_body` + `status_code`.
 *      - SI existe + hash difiere → 409.
 *      - SI no existe → procesa la request normalmente, al final inserta.
 *
 * Diseño:
 *   - Una sola tabla compartida por todo el tenant. El campo `endpoint`
 *     diferencia entre operaciones (`POST /tenant/wallet/mint` vs
 *     `POST /tenant/wallet/load`).
 *   - El interceptor inserta DESPUÉS de que la operación termine OK.
 *     Si la operación tira, no se inserta y un retry posterior con la
 *     misma key se considera "primer intento".
 *   - **Race**: si dos requests llegan simultáneo con misma key, el segundo
 *     puede entrar antes de que el primero termine. Para MVP aceptamos
 *     este pequeño hueco (el UNIQUE en `wallet_transactions.idempotency_key`
 *     atrapa el doble-insert real). Para hardening v1, usar SELECT FOR
 *     UPDATE o INSERT ... ON CONFLICT (key) DO NOTHING al INICIO de la
 *     request para "reservar" la key.
 */

import { integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const idempotencyKeys = pgTable('idempotency_keys', {
  /** La key tal cual la mandó el cliente. */
  key: text('key').primaryKey(),

  /** Ruta del endpoint para distinguir mismas keys en operaciones distintas. */
  endpoint: text('endpoint').notNull(),

  /** SHA-256 hex del body normalizado (JSON stringify ordenado). */
  requestHash: text('request_hash').notNull(),

  /** Status code HTTP de la response original. */
  statusCode: integer('status_code').notNull(),

  /** Body de la response original, tal cual se devolvió. */
  responseBody: jsonb('response_body').notNull(),

  /**
   * Cuando la key deja de ser válida. Después de esto, un retry con
   * la misma key se considera nuevo intento (la fila quedará en el DB
   * hasta que un job la limpie).
   */
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),

  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export type IdempotencyKeyEntry = typeof idempotencyKeys.$inferSelect;
export type NewIdempotencyKeyEntry = typeof idempotencyKeys.$inferInsert;
