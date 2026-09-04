/**
 * seed-pilot-tenant — provisiona un tenant nuevo PARAMETRIZABLE para
 * el piloto interno del dueño (Mes 7 del roadmap) o para el primer
 * cliente externo cuando llegue.
 *
 * Diferencia con `seed-dev-tenant`: éste es parametrizable via CLI
 * args / env vars. `seed-dev-tenant` es un atajo opinionado para el
 * demo de dev.
 *
 * Uso:
 *   pnpm --filter @casino/db db:seed:pilot -- \
 *     --slug=mi-casino \
 *     --name="Mi Casino" \
 *     --host=mi-casino.localhost \
 *     --admin-user=admin \
 *     --admin-email=admin@mi-casino.test \
 *     --admin-pass=$(openssl rand -base64 18)
 *
 * O via env (útil para CI/CD):
 *   PILOT_SLUG=mi-casino PILOT_NAME="..." PILOT_HOST=... \
 *     PILOT_ADMIN_USER=... PILOT_ADMIN_EMAIL=... PILOT_ADMIN_PASS=... \
 *     pnpm --filter @casino/db db:seed:pilot
 *
 * Idempotente: si el tenant ya existe, refresca status='active',
 * dbName, name; el admin queda con el password pasado (re-set).
 *
 * NO crea:
 *   - Payment methods (el admin los configura via UI desde /payment-methods).
 *   - Bonus definitions (idem desde /bonus-definitions).
 *   - Promotions / leagues (idem).
 *   - Sucursales / cajeros (el admin los crea cuando arme su estructura).
 *
 * NO touchea otros tenants. Si el slug ya está usado por otro tenant,
 * fail-fast con error claro (no overwrite silent).
 */

import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';

loadEnv({ path: path.resolve(process.cwd(), '../../apps/api/.env.local') });
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

interface PilotConfig {
  slug: string;
  dbName: string;
  name: string;
  host: string;
  contactEmail: string;
  planCode: string;
  admin: {
    username: string;
    email: string;
    displayName: string;
    password: string;
  };
}

function parseArgs(): PilotConfig {
  const argv = process.argv.slice(2);
  const args: Record<string, string> = {};
  for (const a of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) args[m[1]!] = m[2]!;
  }
  const get = (cliKey: string, envKey: string, def?: string): string => {
    const v = args[cliKey] ?? process.env[envKey] ?? def;
    if (v === undefined) {
      throw new Error(
        `Falta arg requerido: --${cliKey}=<val> o env ${envKey}.`,
      );
    }
    return v;
  };
  const slug = get('slug', 'PILOT_SLUG');
  if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(slug)) {
    throw new Error(
      `slug '${slug}' inválido. Debe matchear ^[a-z0-9][a-z0-9-]{1,30}$ (kebab-case, 2-31 chars).`,
    );
  }
  const dbName = `tenant_${slug.replace(/-/g, '_')}`;
  const name = get('name', 'PILOT_NAME', `${slug} Casino`);
  const host = get('host', 'PILOT_HOST', `${slug}.localhost`);
  const contactEmail = get(
    'contact-email',
    'PILOT_CONTACT_EMAIL',
    `contact@${slug}.test`,
  );
  const planCode = get('plan', 'PILOT_PLAN', 'basic');
  const adminUsername = get('admin-user', 'PILOT_ADMIN_USER', `${slug}_admin`);
  const adminEmail = get('admin-email', 'PILOT_ADMIN_EMAIL', `admin@${slug}.test`);
  const adminDisplay = get('admin-display', 'PILOT_ADMIN_DISPLAY', 'Admin');
  const adminPass = get('admin-pass', 'PILOT_ADMIN_PASS');
  if (adminPass.length < 12) {
    throw new Error('admin-pass debe tener >= 12 chars.');
  }
  return {
    slug,
    dbName,
    name,
    host,
    contactEmail,
    planCode,
    admin: {
      username: adminUsername,
      email: adminEmail,
      displayName: adminDisplay,
      password: adminPass,
    },
  };
}

function getControlUrl(): string {
  const url = process.env.DATABASE_URL_CONTROL;
  if (!url) {
    throw new Error('DATABASE_URL_CONTROL no configurada.');
  }
  return url;
}

function getTenantUrl(dbName: string): string {
  const template = process.env.DATABASE_URL_TENANT_TEMPLATE;
  if (!template) {
    throw new Error('DATABASE_URL_TENANT_TEMPLATE no configurada.');
  }
  return template.replace('<tenant_db>', dbName);
}

async function ensureControlRows(
  cfg: PilotConfig,
): Promise<{ tenantId: string; created: boolean }> {
  const db = createControlDb(getControlUrl());

  const planRows = await db
    .select()
    .from(tenantPlans)
    .where(eq(tenantPlans.code, cfg.planCode))
    .limit(1);
  const plan = planRows[0];
  if (!plan) {
    throw new Error(
      `Plan '${cfg.planCode}' no existe. Corré: pnpm --filter @casino/db db:seed:plans`,
    );
  }

  const existing = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, cfg.slug))
    .limit(1);

  let tenantId: string;
  let created = false;
  if (existing[0]) {
    // Sanity: el slug ya existe, pero verificamos que el dbName matchee.
    if (existing[0].dbName !== cfg.dbName) {
      throw new Error(
        `Slug '${cfg.slug}' ya existe pero apunta a dbName='${existing[0].dbName}' (esperado '${cfg.dbName}'). Refusing to overwrite.`,
      );
    }
    tenantId = existing[0].id;
    await db
      .update(tenants)
      .set({
        status: 'active',
        name: cfg.name,
        contactEmail: cfg.contactEmail,
        planId: plan.id,
      })
      .where(eq(tenants.id, tenantId));
    console.log(
      `[seed-pilot] Tenant '${cfg.slug}' actualizado (id=${tenantId}).`,
    );
  } else {
    const inserted = await db
      .insert(tenants)
      .values({
        slug: cfg.slug,
        name: cfg.name,
        contactEmail: cfg.contactEmail,
        dbName: cfg.dbName,
        planId: plan.id,
        status: 'active',
      })
      .returning({ id: tenants.id });
    tenantId = inserted[0]!.id;
    created = true;
    console.log(`[seed-pilot] Tenant '${cfg.slug}' creado (id=${tenantId}).`);
  }

  await db
    .insert(tenantDomains)
    .values({
      tenantId,
      domain: cfg.host,
      isPrimary: true,
    })
    .onConflictDoUpdate({
      target: tenantDomains.domain,
      set: { tenantId, isPrimary: true },
    });
  console.log(`[seed-pilot] Domain '${cfg.host}' → tenant ${tenantId}.`);

  return { tenantId, created };
}

async function ensureTenantDb(
  cfg: PilotConfig,
): Promise<void> {
  const adminUrl = deriveAdminUrl(getControlUrl());

  const sql = postgres(adminUrl, { max: 1 });
  let exists = false;
  try {
    const rows = await sql<{ datname: string }[]>`
      SELECT datname FROM pg_database WHERE datname = ${cfg.dbName}
    `;
    exists = rows.length > 0;
  } finally {
    await sql.end();
  }

  if (!exists) {
    await provisionTenantDatabase(adminUrl, cfg.dbName);
    console.log(`[seed-pilot] DB '${cfg.dbName}' creada.`);
  } else {
    console.log(
      `[seed-pilot] DB '${cfg.dbName}' ya existe, salteando creación.`,
    );
  }

  const tenantUrl = getTenantUrl(cfg.dbName);
  await migrateTenantDatabase(tenantUrl);
  console.log(`[seed-pilot] Migraciones aplicadas a '${cfg.dbName}'.`);

  await seedTenantDatabase(tenantUrl, {
    adminUsername: cfg.admin.username,
    adminEmail: cfg.admin.email,
    adminPassword: cfg.admin.password,
    adminDisplayName: cfg.admin.displayName,
  });
  console.log(`[seed-pilot] Admin '${cfg.admin.username}' seedeado.`);
}

async function main(): Promise<void> {
  const cfg = parseArgs();
  console.log('[seed-pilot] Iniciando provisión...');
  console.log(`  Slug:    ${cfg.slug}`);
  console.log(`  Name:    ${cfg.name}`);
  console.log(`  Host:    ${cfg.host}`);
  console.log(`  Plan:    ${cfg.planCode}`);
  console.log(`  Admin:   ${cfg.admin.username} <${cfg.admin.email}>`);
  console.log('');

  const { tenantId, created } = await ensureControlRows(cfg);
  await ensureTenantDb(cfg);

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`✓ Tenant ${created ? 'CREADO' : 'ACTUALIZADO'}: ${cfg.slug}`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Tenant ID:   ${tenantId}`);
  console.log(`Host:        ${cfg.host}`);
  console.log(`Admin user:  ${cfg.admin.username}`);
  console.log(`Admin pass:  ${cfg.admin.password}`);
  console.log('');
  console.log('Próximos pasos (ver docs/runbooks/pilot-day-1.md):');
  console.log(`  1. Apuntá el web: NEXT_PUBLIC_TENANT_HOST=${cfg.host}`);
  console.log(`  2. Login: http://localhost:3001/login`);
  console.log(`  3. Setup: payment methods, bonus defs, primer socio.`);
  console.log('');
}

main().catch((err) => {
  console.error('[seed-pilot] FALLÓ:', err);
  process.exit(1);
});
