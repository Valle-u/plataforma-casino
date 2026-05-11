/**
 * Script: insertar datos de ejemplo en la DB de control para development.
 *
 * Uso: pnpm --filter @casino/db db:seed:control
 *
 * Crea:
 *   - 2 tenant_plans: 'basic' y 'pro'
 *   - 1 tenant: 'demo-casino' (status onboarding)
 *   - 1 tenant_domain: 'demo.localhost' (no verificado)
 *   - 1 platform_user: super-admin de prueba (sin password real, solo placeholder)
 *
 * Idempotente: si los datos ya existen, no falla. Usa ON CONFLICT DO NOTHING.
 */

import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { createControlDb } from '../client';
import { tenantPlans, tenants, tenantDomains, platformUsers } from '../control';
import { roles, userRoles, users as tenantUsersTable } from '../tenant';
import { hashPassword } from '../utils/password';
import { deriveAdminUrl, provisionTenantDatabase } from '../provisioning';
import { migrateTenantDatabase } from '../migrate-tenant';
import { seedTenantDatabase } from '../seeds/tenant-seed';

// Centralizamos env en apps/api/.env.local (ver setup-control.ts).
loadEnv({ path: path.resolve(process.cwd(), '../../apps/api/.env.local') });

// Credenciales del super-admin de development (vive en DB de control).
// IMPORTANTE: solo para entorno local/dev. En staging/prod se crea otro usuario
// con password fuerte y se borra/desactiva éste.
const DEV_SUPERADMIN_EMAIL = 'superadmin@plataforma-casino.local';
const DEV_SUPERADMIN_PASSWORD = 'dev-superadmin-2026';

// Credenciales del admin del tenant demo (vive dentro de tenant_demo_casino).
// Permite testear el flujo de auth a nivel tenant.
const DEMO_TENANT_ADMIN_USERNAME = 'admin';
const DEMO_TENANT_ADMIN_EMAIL = 'admin@demo-casino.local';
const DEMO_TENANT_ADMIN_PASSWORD = 'demo-admin-2026';

// Cajero de prueba — usado para validar el sistema de permisos.
// Tiene rol 'cajero' que en MVP no tiene permisos asignados → no puede
// invocar endpoints protegidos por @RequirePermissions.
const DEMO_TENANT_CASHIER_USERNAME = 'cajero1';
const DEMO_TENANT_CASHIER_PASSWORD = 'cajero-2026';

async function seed(): Promise<void> {
  const url = process.env.DATABASE_URL_CONTROL;
  if (!url) {
    throw new Error('DATABASE_URL_CONTROL no está definido.');
  }

  console.log('🌱 Conectando a control DB...');
  const db = createControlDb(url);

  // -------------------------------------------------------------------------
  // 1. Tenant plans
  // -------------------------------------------------------------------------
  console.log('🌱 Insertando tenant_plans...');
  const insertedPlans = await db
    .insert(tenantPlans)
    .values([
      {
        code: 'basic',
        name: 'Plan Básico',
        commissionPct: '0.1500',
        monthlyFee: '0',
        features: { kyc_provider: false, salesbot: false, max_socios: 10 },
      },
      {
        code: 'pro',
        name: 'Plan Pro',
        commissionPct: '0.1000',
        monthlyFee: '500',
        features: { kyc_provider: true, salesbot: true, max_socios: 100 },
      },
    ])
    .onConflictDoNothing({ target: tenantPlans.code })
    .returning();

  console.log(`  → insertados: ${insertedPlans.length} (si dice 0, ya existían).`);

  // Necesitamos el id del plan basic para asociar el tenant demo.
  const [basicPlan] = await db
    .select()
    .from(tenantPlans)
    .where(eq(tenantPlans.code, 'basic'))
    .limit(1);

  if (!basicPlan) {
    throw new Error('Plan "basic" no encontrado después de seed.');
  }

  // -------------------------------------------------------------------------
  // 2. Tenant demo
  // -------------------------------------------------------------------------
  console.log('🌱 Insertando tenant demo-casino...');
  await db
    .insert(tenants)
    .values({
      slug: 'demo-casino',
      name: 'Casino Demo',
      dbName: 'tenant_demo_casino',
      dbHost: 'localhost',
      status: 'active', // active porque el seed también provisiona su DB abajo
      planId: basicPlan.id,
      contactEmail: 'admin@demo-casino.local',
    })
    .onConflictDoUpdate({
      target: tenants.slug,
      set: {
        // Si ya existía con onboarding/suspended, lo dejamos active para tests.
        status: 'active',
        updatedAt: new Date(),
      },
    });

  const [demoTenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, 'demo-casino'))
    .limit(1);

  if (!demoTenant) {
    throw new Error('Tenant "demo-casino" no encontrado después de seed.');
  }

  console.log(`  → demo-casino listo (status=active, dbName=${demoTenant.dbName}).`);

  // -------------------------------------------------------------------------
  // 2.b Provisión de la DB del tenant demo
  // -------------------------------------------------------------------------
  console.log(`🌱 Provisionando DB Postgres "${demoTenant.dbName}"...`);
  const adminUrl = deriveAdminUrl(url);
  const provResult = await provisionTenantDatabase(adminUrl, demoTenant.dbName);
  console.log(
    `  → ${provResult.created ? 'creada' : 'ya existía'} (alreadyExisted=${provResult.alreadyExisted}).`,
  );

  // -------------------------------------------------------------------------
  // 2.c Migrar schema de tenant
  // -------------------------------------------------------------------------
  const tenantUrl = url.replace(/\/[^/?]+(\?.*)?$/, `/${demoTenant.dbName}$1`);
  console.log('🌱 Aplicando migraciones a tenant DB...');
  await migrateTenantDatabase(tenantUrl);
  console.log('  → migraciones aplicadas (idempotente).');

  // -------------------------------------------------------------------------
  // 2.d Seed de tenant: roles + permisos + admin user
  // -------------------------------------------------------------------------
  console.log('🌱 Seedeando tenant DB con roles, permisos y admin user...');
  const tenantSeedResult = await seedTenantDatabase(tenantUrl, {
    adminUsername: DEMO_TENANT_ADMIN_USERNAME,
    adminEmail: DEMO_TENANT_ADMIN_EMAIL,
    adminPassword: DEMO_TENANT_ADMIN_PASSWORD,
    adminDisplayName: 'Admin Demo (dev)',
  });
  console.log(
    `  → roles: ${tenantSeedResult.rolesInserted}, permisos: ${tenantSeedResult.permissionsInserted}, admin user listo.`,
  );

  // -------------------------------------------------------------------------
  // 2.e Cajero de prueba (para validar el sistema de permisos)
  // -------------------------------------------------------------------------
  console.log('🌱 Creando cajero de prueba...');
  const tenantSql = postgres(tenantUrl, { max: 1 });
  const tenantDb = drizzle(tenantSql);
  try {
    const cashierHash = await hashPassword(DEMO_TENANT_CASHIER_PASSWORD);

    // Conseguir el rol 'cajero' (creado por seedTenantDatabase).
    const cajeroRoleRow = await tenantDb
      .select()
      .from(roles)
      .where(eq(roles.code, 'cajero'))
      .limit(1);
    const cajeroRole = cajeroRoleRow[0];
    if (!cajeroRole) {
      throw new Error('Rol cajero no encontrado tras seed.');
    }

    // Upsert del cajero.
    const cashierUpsert = await tenantDb
      .insert(tenantUsersTable)
      .values({
        username: DEMO_TENANT_CASHIER_USERNAME,
        email: null,
        displayName: 'Cajero 1 (dev)',
        passwordHash: cashierHash,
        status: 'active',
      })
      .onConflictDoUpdate({
        target: tenantUsersTable.username,
        set: { passwordHash: cashierHash, status: 'active', updatedAt: new Date() },
      })
      .returning();
    const cashier = cashierUpsert[0];
    if (!cashier) {
      throw new Error('No se pudo upsert el cajero.');
    }

    await tenantDb
      .insert(userRoles)
      .values({ userId: cashier.id, roleId: cajeroRole.id })
      .onConflictDoNothing();

    console.log(`  → ${DEMO_TENANT_CASHIER_USERNAME} con rol 'cajero' (sin permisos asignados).`);
  } finally {
    await tenantSql.end();
  }

  // -------------------------------------------------------------------------
  // 3. Tenant domain
  // -------------------------------------------------------------------------
  console.log('🌱 Insertando tenant_domain demo.localhost...');
  const insertedDomains = await db
    .insert(tenantDomains)
    .values({
      tenantId: demoTenant.id,
      domain: 'demo.localhost',
      isPrimary: true,
      verifiedAt: null, // pendiente de verificación
    })
    .onConflictDoNothing({ target: tenantDomains.domain })
    .returning();

  console.log(`  → insertados: ${insertedDomains.length}.`);

  // -------------------------------------------------------------------------
  // 4. Platform user (super-admin de prueba) con password hasheada REAL
  // -------------------------------------------------------------------------
  console.log('🌱 Insertando platform_user super-admin (con hash Argon2id real)...');
  console.log('   ⏳ Hasheando password (toma ~100ms)...');
  const passwordHash = await hashPassword(DEV_SUPERADMIN_PASSWORD);

  // onConflictDoUpdate: si ya existe (por seed previo con placeholder),
  // sobreescribimos el password hash. Idempotente y permite "rehasheo" si
  // cambia DEV_SUPERADMIN_PASSWORD.
  await db
    .insert(platformUsers)
    .values({
      email: DEV_SUPERADMIN_EMAIL,
      passwordHash,
      displayName: 'Super Admin (dev)',
      twoFaSecret: null,
      status: 'active',
    })
    .onConflictDoUpdate({
      target: platformUsers.email,
      set: {
        passwordHash,
        displayName: 'Super Admin (dev)',
        status: 'active',
        updatedAt: new Date(),
      },
    });

  console.log(`  → ${DEV_SUPERADMIN_EMAIL} listo con hash real.`);

  console.log('');
  console.log('✅ Seed de control DB completado.');
  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('  CREDENCIALES DEV — SUPER-ADMIN (DB de control)');
  console.log('───────────────────────────────────────────────────');
  console.log(`  Email:    ${DEV_SUPERADMIN_EMAIL}`);
  console.log(`  Password: ${DEV_SUPERADMIN_PASSWORD}`);
  console.log('───────────────────────────────────────────────────');
  console.log('  CREDENCIALES DEV — ADMIN TENANT (demo-casino)');
  console.log('───────────────────────────────────────────────────');
  console.log(`  Username: ${DEMO_TENANT_ADMIN_USERNAME}`);
  console.log(`  Email:    ${DEMO_TENANT_ADMIN_EMAIL}`);
  console.log(`  Password: ${DEMO_TENANT_ADMIN_PASSWORD}`);
  console.log(`  Host:     demo.localhost`);
  console.log('───────────────────────────────────────────────────');
  console.log('  CREDENCIALES DEV — CAJERO (demo-casino, sin permisos)');
  console.log('───────────────────────────────────────────────────');
  console.log(`  Username: ${DEMO_TENANT_CASHIER_USERNAME}`);
  console.log(`  Password: ${DEMO_TENANT_CASHIER_PASSWORD}`);
  console.log(`  Host:     demo.localhost`);
  console.log('═══════════════════════════════════════════════════');
  console.log('  ⚠️  Solo para development. NO usar en producción.');
  console.log('');
  console.log('Resumen:');
  console.log('  - tenant_plans: basic + pro');
  console.log('  - tenants: demo-casino (onboarding)');
  console.log('  - tenant_domains: demo.localhost (no verified)');
  console.log('  - platform_users: superadmin@plataforma-casino.local (password real Argon2id)');
  console.log('');
  console.log('Verificalo con: pnpm --filter @casino/db db:studio:control');
}

seed()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('❌ Error en seed-control:', err);
    process.exit(1);
  });
