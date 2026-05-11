/**
 * Configuración de drizzle-kit para DBs de TENANT.
 *
 * Cada cliente (tenant) tiene su propia DB con todos los datos operativos
 * (jugadores, wallet, transacciones, depósitos, retiros, etc.).
 *
 * Esta config es plantilla — apunta a una DB de tenant específica vía
 * env var DATABASE_URL_TENANT_TEMPLATE para generar migraciones.
 *
 * IMPORTANTE: en runtime, el sistema crea conexiones a múltiples DBs de
 * tenants vía el TenantResolver. Esta config es SOLO para generar /
 * aplicar migraciones a UNA DB tenant a la vez.
 *
 * En MVP early este archivo está placeholder — los schemas de tenant se
 * crean en un sprint posterior.
 */

import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { defineConfig } from 'drizzle-kit';

// Centralizamos env en apps/api/.env.local. drizzle-kit corre con cwd=packages/db.
loadEnv({ path: path.resolve(process.cwd(), '../../apps/api/.env.local') });

// Para generar migraciones, drizzle-kit no conecta a la DB (solo lee los
// schemas TS). Para aplicar migraciones (drizzle-kit migrate) sí necesita una
// URL real. En MVP usamos tenant_demo_casino como representante para los
// comandos de drizzle-kit; en runtime cada tenant aplica vía migrateTenantDatabase().
const template = process.env.DATABASE_URL_TENANT_TEMPLATE ?? '';
const url = template.replace('<tenant_db>', 'tenant_demo_casino');

export default defineConfig({
  schema: './src/tenant/index.ts',
  out: './migrations/tenant',
  dialect: 'postgresql',
  dbCredentials: {
    url: url || 'postgresql://placeholder',
  },
  verbose: true,
  strict: true,
});
