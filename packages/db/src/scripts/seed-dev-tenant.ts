/**
 * seed-dev-tenant — provisiona un tenant "demo" en la control DB de dev
 * para que el frontend pueda apuntar a un Host real y operar.
 *
 * Crea (idempotente):
 *   1. Fila en `tenants` con slug `demo`, status `active`, plan `basic`.
 *   2. Fila en `tenant_domains` con domain `demo.localhost` (es lo que
 *      el web va a setear como `X-Forwarded-Host`).
 *   3. DB Postgres `tenant_demo_dev` (si no existe).
 *   4. Migra schema de tenant.
 *   5. Seed: roles + permisos + admin (`demo_admin` / `demo-pwd-2026`).
 *
 * Uso:
 *   pnpm --filter @casino/db db:seed:dev-tenant
 *
 * Reqs:
 *   - Control DB ya levantada y migrada (`pnpm db:setup:control`).
 *   - Plan `basic` ya seedeado (`pnpm db:seed:control`).
 *
 * Si el tenant ya existe, refresca su row (lo deja `active`) y re-seedea
 * el admin (el password queda updated al `DEMO_ADMIN_PASSWORD` env o
 * al default). Las migrations son no-op si ya están aplicadas.
 */

import 'dotenv/config';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import {
  createControlDb,
  deriveAdminUrl,
  migrateTenantDatabase,
  provisionTenantDatabase,
  seedTenantDatabase,
  tenantDomains,
  tenantPlans,
  tenants,
} from '../index';

const DEMO = {
  slug: 'demo',
  dbName: 'tenant_demo_dev',
  host: 'demo.localhost',
  name: 'Demo Tenant (Dev)',
  contactEmail: 'demo@dev.local',
  planCode: 'basic',
  admin: {
    username: 'demo_admin',
    email: 'admin@demo.dev',
    displayName: 'Demo Admin',
    password: process.env.DEMO_ADMIN_PASSWORD ?? 'demo-pwd-2026',
  },
} as const;

function getControlUrl(): string {
  const url = process.env.DATABASE_URL_CONTROL;
  if (!url) {
    throw new Error(
      'DATABASE_URL_CONTROL no configurada. Verificá apps/api/.env.local o exportá la var.',
    );
  }
  return url;
}

function getTenantUrl(): string {
  const template = process.env.DATABASE_URL_TENANT_TEMPLATE;
  if (!template) {
    throw new Error(
      'DATABASE_URL_TENANT_TEMPLATE no configurada. Verificá apps/api/.env.local.',
    );
  }
  return template.replace('<tenant_db>', DEMO.dbName);
}

async function ensureControlRows(): Promise<void> {
  const db = createControlDb(getControlUrl());

  // Plan
  const planRows = await db
    .select()
    .from(tenantPlans)
    .where(eq(tenantPlans.code, DEMO.planCode))
    .limit(1);
  const plan = planRows[0];
  if (!plan) {
    throw new Error(
      `Plan '${DEMO.planCode}' no existe. Corré: pnpm --filter @casino/db db:seed:control`,
    );
  }

  // Tenant upsert
  const existing = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, DEMO.slug))
    .limit(1);

  let tenantId: string;
  if (existing[0]) {
    tenantId = existing[0].id;
    await db
      .update(tenants)
      .set({
        status: 'active',
        dbName: DEMO.dbName,
        name: DEMO.name,
        contactEmail: DEMO.contactEmail,
        planId: plan.id,
      })
      .where(eq(tenants.id, tenantId));
    // eslint-disable-next-line no-console
    console.log(`[seed-dev] Tenant '${DEMO.slug}' actualizado (id=${tenantId}).`);
  } else {
    const inserted = await db
      .insert(tenants)
      .values({
        slug: DEMO.slug,
        name: DEMO.name,
        contactEmail: DEMO.contactEmail,
        dbName: DEMO.dbName,
        planId: plan.id,
        status: 'active',
      })
      .returning({ id: tenants.id });
    tenantId = inserted[0]!.id;
    // eslint-disable-next-line no-console
    console.log(`[seed-dev] Tenant '${DEMO.slug}' creado (id=${tenantId}).`);
  }

  // Domain upsert
  await db
    .insert(tenantDomains)
    .values({
      tenantId,
      domain: DEMO.host,
      isPrimary: true,
    })
    .onConflictDoUpdate({
      target: tenantDomains.domain,
      set: { tenantId, isPrimary: true },
    });
  // eslint-disable-next-line no-console
  console.log(`[seed-dev] Domain '${DEMO.host}' → tenant ${tenantId}.`);
}

async function ensureTenantDb(): Promise<void> {
  const adminUrl = deriveAdminUrl(getControlUrl());

  // Verificar si la DB ya existe (provisionTenantDatabase asume que NO,
  // así que verificamos primero).
  const sql = postgres(adminUrl, { max: 1 });
  let exists = false;
  try {
    const rows = await sql<{ datname: string }[]>`
      SELECT datname FROM pg_database WHERE datname = ${DEMO.dbName}
    `;
    exists = rows.length > 0;
  } finally {
    await sql.end();
  }

  if (!exists) {
    await provisionTenantDatabase(adminUrl, DEMO.dbName);
    // eslint-disable-next-line no-console
    console.log(`[seed-dev] DB '${DEMO.dbName}' creada.`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`[seed-dev] DB '${DEMO.dbName}' ya existe, salteando creación.`);
  }

  const tenantUrl = getTenantUrl();
  await migrateTenantDatabase(tenantUrl);
  // eslint-disable-next-line no-console
  console.log(`[seed-dev] Migraciones aplicadas a '${DEMO.dbName}'.`);

  await seedTenantDatabase(tenantUrl, {
    adminUsername: DEMO.admin.username,
    adminEmail: DEMO.admin.email,
    adminPassword: DEMO.admin.password,
    adminDisplayName: DEMO.admin.displayName,
  });
  // eslint-disable-next-line no-console
  console.log(`[seed-dev] Admin '${DEMO.admin.username}' seedeado.`);
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('[seed-dev] Iniciando provisionamiento del tenant demo...');
  await ensureControlRows();
  await ensureTenantDb();
  // eslint-disable-next-line no-console
  console.log('\n✓ Tenant demo listo.');
  // eslint-disable-next-line no-console
  console.log(`  Host:     ${DEMO.host}`);
  // eslint-disable-next-line no-console
  console.log(`  Usuario:  ${DEMO.admin.username}`);
  // eslint-disable-next-line no-console
  console.log(`  Password: ${DEMO.admin.password}`);
  // eslint-disable-next-line no-console
  console.log(`\nApuntá el web a este host:`);
  // eslint-disable-next-line no-console
  console.log(`  NEXT_PUBLIC_TENANT_HOST=${DEMO.host}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[seed-dev] FALLÓ:', err);
  process.exit(1);
});
