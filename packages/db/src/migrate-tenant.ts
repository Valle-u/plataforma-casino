/**
 * Helper para aplicar las migraciones del schema de tenant a una DB específica.
 *
 * Usado por:
 *   - apps/api: cuando crea un tenant nuevo (en tenants.service.ts).
 *   - seed-control.ts: para migrar la DB del tenant demo.
 *
 * Idempotente: si ya están aplicadas, no hace nada.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { TENANT_MIGRATIONS_PATH } from './migrations-paths';

export async function migrateTenantDatabase(connectionUrl: string): Promise<void> {
  const sql = postgres(connectionUrl, { max: 1 });
  const db = drizzle(sql);
  try {
    await migrate(db, { migrationsFolder: TENANT_MIGRATIONS_PATH });
  } finally {
    await sql.end();
  }
}
