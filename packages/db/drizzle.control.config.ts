/**
 * Configuración de drizzle-kit para la DB de CONTROL.
 *
 * La DB de control vive en `platform_control` y contiene el registro
 * de tenants, planes, super-admins, comisiones globales y audit log
 * de la plataforma. NO contiene datos operativos de jugadores.
 *
 * Usado por los scripts:
 *   pnpm db:gen:control      → generar migraciones SQL
 *   pnpm db:migrate:control  → aplicarlas a la DB
 *   pnpm db:studio:control   → abrir GUI web de Drizzle Studio
 */

import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { defineConfig } from 'drizzle-kit';

// Centralizamos env en apps/api/.env.local. drizzle-kit corre con cwd=packages/db.
loadEnv({ path: path.resolve(process.cwd(), '../../apps/api/.env.local') });

if (!process.env.DATABASE_URL_CONTROL) {
  throw new Error(
    'DATABASE_URL_CONTROL no está definido. Copiá apps/api/.env.example a apps/api/.env.local y completalo.',
  );
}

export default defineConfig({
  schema: './src/control/index.ts',
  out: './migrations/control',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL_CONTROL,
  },
  verbose: true,
  strict: true,
});
