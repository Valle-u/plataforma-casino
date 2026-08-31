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
  const sql = postgres(connectionUrl, {
    max: 1,
    // El runner de drizzle hace `CREATE TABLE IF NOT EXISTS` sobre su tabla de
    // migraciones y su esquema, y Postgres avisa «ya existe, omitiendo» en CADA
    // tenant. El
    // cliente lo vuelca como un objeto de varias lineas: con varios tenants la
    // salida se llena de un aviso esperado y los errores reales se pierden en
    // el medio. El resto de los notices SI se muestran.
    onnotice: (notice) => {
      // 42P07 = tabla duplicada, 42P06 = esquema duplicado.
      if (notice.code === '42P07' || notice.code === '42P06') return;
      console.warn(`[migrate] ${notice.severity}: ${notice.message}`);
    },
  });
  const db = drizzle(sql);
  try {
    await migrate(db, { migrationsFolder: TENANT_MIGRATIONS_PATH });
  } finally {
    await sql.end();
  }
}
