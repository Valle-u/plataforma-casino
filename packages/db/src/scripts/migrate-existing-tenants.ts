/**
 * Script: aplica todas las migraciones tenant pendientes a TODOS los tenants
 * registrados en la DB de control.
 *
 * Útil cuando agregamos un schema nuevo a tenant — se invoca para que
 * todos los tenants existentes se actualicen al state actual.
 *
 * Para tenants nuevos, esto se hace automáticamente en `tenants.service.ts.create()`.
 *
 * Uso: pnpm --filter @casino/db db:migrate:tenants
 */

import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { createControlDb } from '../client';
import { tenants } from '../control';
import { migrateTenantDatabase } from '../migrate-tenant';

loadEnv({ path: path.resolve(process.cwd(), '../../apps/api/.env.local') });

/**
 * Codigo de error de Postgres, buscando en la cadena de causas.
 *
 * Drizzle envuelve el PostgresError en un DrizzleQueryError, asi que el
 * `code` no esta en el error de arriba.
 */
function pgCode(err: unknown): string | undefined {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur; i += 1) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL_CONTROL;
  if (!url) throw new Error('DATABASE_URL_CONTROL no definido.');

  const controlDb = createControlDb(url);
  const allTenants = await controlDb.select().from(tenants);

  if (allTenants.length === 0) {
    console.log('No hay tenants registrados.');
    return;
  }

  console.log(`Migrando ${allTenants.length} tenant(s)...`);
  for (const t of allTenants) {
    if (t.deletedAt !== null) {
      console.log(`  ⏭  ${t.slug} (deleted, skip)`);
      continue;
    }
    const tenantUrl = url.replace(/\/[^/?]+(\?.*)?$/, `/${t.dbName}$1`);
    process.stdout.write(`  ▶  ${t.slug} (${t.dbName})... `);
    try {
      await migrateTenantDatabase(tenantUrl);
      console.log('OK');
    } catch (err: unknown) {
      // 3D000 = la base no existe. Pasa siempre con el tenant de tests,
      // cuya DB la crea y la borra la suite: entre corridas no esta. Volcar
      // un stack de 20 lineas por algo esperado entrena a ignorar la salida
      // del script, y ahi se cuelan los errores que si importan.
      if (pgCode(err) === '3D000') {
        console.log('SKIP — la base no existe (normal si es un tenant efimero)');
        continue;
      }
      console.log('ERROR');
      console.error(err);
    }
  }
  console.log('✅ Listo.');
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
