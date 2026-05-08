/**
 * Helper para generar UUIDs versión 7.
 *
 * UUIDv7 incluye un timestamp como prefijo, lo que los hace ordenables
 * cronológicamente. Esto es mucho mejor que UUIDv4 para índices de Postgres
 * porque:
 *   - Inserciones en orden secuencial → menos page splits.
 *   - Index scans más eficientes.
 *   - Podés extraer el timestamp del UUID si hace falta.
 *
 * Decidido en docs/04-modelo-datos.md §4 (Convenciones generales).
 *
 * Postgres no tiene función nativa para UUIDv7 (gen_random_uuid() es v4),
 * por eso los generamos en TypeScript antes de insertar.
 *
 * Uso en schemas Drizzle:
 *   import { uuid } from 'drizzle-orm/pg-core';
 *   import { generateUuidV7 } from '../utils/uuid';
 *
 *   export const tenants = pgTable('tenants', {
 *     id: uuid('id').primaryKey().$defaultFn(() => generateUuidV7()),
 *     ...
 *   });
 */

import { v7 as uuidv7 } from 'uuid';

export function generateUuidV7(): string {
  return uuidv7();
}
