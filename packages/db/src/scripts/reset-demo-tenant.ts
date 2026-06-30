/**
 * reset-demo-tenant — RESET TOTAL del tenant demo (`tenant_demo_casino`).
 *
 * ⚠️ DESTRUCTIVO E IRREVERSIBLE: dropea la DB del tenant y la recrea desde cero.
 * Borra TODO: usuarios, wallets, fichas, depósitos, retiros, historial de juego,
 * comisiones, audit. Deja solo: roles + permisos + admin + la Casa (saldo 0).
 *
 * NO toca la control DB (la fila del tenant + el domain demo.localhost quedan,
 * así que el web sigue resolviendo el host al tenant recreado).
 *
 * Uso: pnpm --filter @casino/db exec tsx src/scripts/reset-demo-tenant.ts
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
loadEnv({ path: path.resolve(process.cwd(), '../../apps/api/.env.local') });
import postgres from 'postgres';
import {
  deriveAdminUrl,
  migrateTenantDatabase,
  provisionTenantDatabase,
  seedTenantDatabase,
} from '../index';

const DEMO = {
  dbName: 'tenant_demo_casino',
  host: 'demo.localhost',
  admin: {
    username: 'demo_admin',
    email: 'admin@demo.casino',
    displayName: 'Demo Admin',
    password: process.env.DEMO_ADMIN_PASSWORD ?? 'demo-pwd-2026',
  },
} as const;

async function main(): Promise<void> {
  const controlUrl = process.env.DATABASE_URL_CONTROL;
  const template = process.env.DATABASE_URL_TENANT_TEMPLATE;
  if (!controlUrl || !template) {
    throw new Error('DATABASE_URL_CONTROL / DATABASE_URL_TENANT_TEMPLATE faltan.');
  }
  const tenantUrl = template.replace('<tenant_db>', DEMO.dbName);
  const adminUrl = deriveAdminUrl(controlUrl);

  // 1. DROP (terminando conexiones vivas primero).
  const adminSql = postgres(adminUrl, { max: 1 });
  try {
    await adminSql.unsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = '${DEMO.dbName}' AND pid <> pg_backend_pid()`,
    );
    await adminSql.unsafe(`DROP DATABASE IF EXISTS ${DEMO.dbName}`);
  } finally {
    await adminSql.end();
  }
  console.log(`[reset-demo] DB '${DEMO.dbName}' dropeada.`);

  // 2. CREATE.
  await provisionTenantDatabase(adminUrl, DEMO.dbName);
  console.log(`[reset-demo] DB '${DEMO.dbName}' recreada.`);

  // 3. MIGRATE (todas las migraciones 0000–0039).
  await migrateTenantDatabase(tenantUrl);
  console.log('[reset-demo] Migraciones aplicadas.');

  // 4. SEED (roles + permisos + admin + Casa en 0).
  await seedTenantDatabase(tenantUrl, {
    adminUsername: DEMO.admin.username,
    adminEmail: DEMO.admin.email,
    adminPassword: DEMO.admin.password,
    adminDisplayName: DEMO.admin.displayName,
  });
  console.log('[reset-demo] Seed aplicado (admin + Casa).');

  console.log('\n✓ Tenant demo reseteado a CERO.');
  console.log(`  Host:     ${DEMO.host}`);
  console.log(`  Usuario:  ${DEMO.admin.username}`);
  console.log(`  Password: ${DEMO.admin.password}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[reset-demo] FALLÓ:', err);
  process.exit(1);
});
