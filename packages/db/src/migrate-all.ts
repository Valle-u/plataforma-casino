/**
 * Orquestador de migraciones "al día": aplica las migraciones pendientes a la
 * DB de control y a TODAS las DB de tenants registradas, reusando el runner de
 * drizzle-orm (idempotente: saltea las ya aplicadas via `__drizzle_migrations`).
 *
 * Se usa desde el boot del api (`apps/api/src/main.ts`, gateado por
 * `MIGRATE_ON_BOOT`) para que el deploy del VPS (Dokploy, cuyo autoDeploy NO
 * corre migraciones) las aplique solo, sin abrir el puerto del Postgres ni
 * pasar credenciales por afuera (el contenedor ya tiene `DATABASE_URL_CONTROL`
 * y llega a la DB por la red interna). Ver `docs/24-entornos-deploy.md`.
 *
 * Equivale a correr `db:migrate:control` + `db:migrate:tenants` a mano, pero
 * con el `migrate()` de runtime (no `drizzle-kit`, que es devDependency y no
 * está en la imagen de prod).
 *
 * ⚠️ Fail-fast: si una migración falla, lanza — así el api NO arranca sobre un
 * schema a medias (mejor caerse que servir con drift). Pensado para 1 réplica
 * del api; con >1 réplica habría que agregar un lock (advisory lock) para
 * evitar que dos boots migren en paralelo.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { createControlDb } from './client';
import { tenants } from './control';
import { migrateTenantDatabase } from './migrate-tenant';
import { CONTROL_MIGRATIONS_PATH } from './migrations-paths';

type Logger = (msg: string) => void;

/** Aplica las migraciones pendientes a la DB de control (`platform_control`). */
export async function migrateControlDatabase(
  connectionUrl: string,
): Promise<void> {
  const sql = postgres(connectionUrl, { max: 1 });
  const db = drizzle(sql);
  try {
    await migrate(db, { migrationsFolder: CONTROL_MIGRATIONS_PATH });
  } finally {
    await sql.end();
  }
}

/**
 * Deriva la URL de una DB de tenant a partir de la URL de control cambiando el
 * nombre de la base (mismo host/credenciales). Igual que en
 * `scripts/migrate-existing-tenants.ts`.
 */
function tenantUrlFromControl(controlUrl: string, dbName: string): string {
  return controlUrl.replace(/\/[^/?]+(\?.*)?$/, `/${dbName}$1`);
}

/**
 * Corre las migraciones pendientes de control + todos los tenants (no borrados).
 * Fail-fast: lanza en el primer error (control o cualquier tenant).
 *
 * @param controlUrl  DATABASE_URL_CONTROL (host de la DB de control).
 * @param log         callback de logging opcional (default: console.log).
 */
export async function migrateAllDatabases(
  controlUrl: string,
  log: Logger = (m) => console.log(m),
): Promise<void> {
  // 1. Control primero (contiene el registro de tenants).
  log('Migrando DB de control…');
  await migrateControlDatabase(controlUrl);
  log('  ✔ control al día.');

  // 2. Todos los tenants registrados y NO borrados.
  const controlDb = createControlDb(controlUrl);
  const allTenants = await controlDb.select().from(tenants);
  const active = allTenants.filter((t) => t.deletedAt === null);

  if (active.length === 0) {
    log('No hay tenants activos para migrar.');
    return;
  }

  log(`Migrando ${active.length} tenant(s)…`);
  for (const t of active) {
    const url = tenantUrlFromControl(controlUrl, t.dbName);
    try {
      await migrateTenantDatabase(url);
      log(`  ✔ ${t.slug} (${t.dbName})`);
    } catch (err) {
      log(`  ✘ ${t.slug} (${t.dbName}) — falló`);
      throw err; // fail-fast: no arrancar con la flota a medias
    }
  }
  log('✅ Migraciones al día.');
}
