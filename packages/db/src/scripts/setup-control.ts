/**
 * Script: crear la DB `platform_control` si no existe.
 *
 * Uso: pnpm --filter @casino/db db:setup:control
 *
 * Conecta a la DB default `postgres` (la admin que viene con cualquier instalación)
 * y emite `CREATE DATABASE platform_control`. Si ya existe, no falla — log y sigue.
 *
 * Después de correr esto, podés correr migraciones:
 *   pnpm --filter @casino/db db:migrate:control
 */

import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import postgres from 'postgres';

// El env real vive en apps/api/.env.local (centralizado en MVP).
// process.cwd() al correr `pnpm --filter @casino/db ...` es packages/db/.
loadEnv({ path: path.resolve(process.cwd(), '../../apps/api/.env.local') });

async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL_CONTROL;
  if (!url) {
    throw new Error(
      'DATABASE_URL_CONTROL no está definido. Copiá apps/api/.env.example a apps/api/.env.local y completalo.',
    );
  }

  // Reemplazamos la última parte del path por '/postgres' (DB admin default)
  // para poder ejecutar CREATE DATABASE.
  // Ej: postgresql://user:pass@host:5432/platform_control
  //  →  postgresql://user:pass@host:5432/postgres
  const adminUrl = url.replace(/\/[^/?]+(\?.*)?$/, '/postgres$1');

  // Extraemos el nombre de la DB target del URL original.
  const match = url.match(/\/([^/?]+)(?:\?.*)?$/);
  const dbName = match?.[1];
  if (!dbName) {
    throw new Error(`No se pudo parsear el nombre de DB desde DATABASE_URL_CONTROL: ${url}`);
  }

  console.log(`🔧 Conectando a la DB admin para crear "${dbName}"...`);

  const sql = postgres(adminUrl, { max: 1 });

  try {
    // Postgres no permite CREATE DATABASE en una transacción ni con parámetros bind.
    // Tenemos que usar SQL crudo y validamos el nombre nosotros.
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(dbName)) {
      throw new Error(`Nombre de DB inválido (chars permitidos): ${dbName}`);
    }

    await sql.unsafe(`CREATE DATABASE ${dbName}`);
    console.log(`✅ DB "${dbName}" creada.`);
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === '42P04') {
      // 42P04 = duplicate_database
      console.log(`ℹ️  DB "${dbName}" ya existe. Continuamos.`);
    } else {
      throw err;
    }
  } finally {
    await sql.end();
  }

  console.log('✅ Setup de control DB completado.');
  console.log('   Próximo paso: pnpm --filter @casino/db db:migrate:control');
}

setup().catch((err: unknown) => {
  console.error('❌ Error en setup-control:', err);
  process.exit(1);
});
