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
import { createControlDb } from '../client';
import { tenantPlans, tenants, tenantDomains, platformUsers } from '../control';
import { hashPassword } from '../utils/password';

// Centralizamos env en apps/api/.env.local (ver setup-control.ts).
loadEnv({ path: path.resolve(process.cwd(), '../../apps/api/.env.local') });

// Credenciales del super-admin de development.
// IMPORTANTE: solo para entorno local/dev. En staging/prod se crea otro usuario
// con password fuerte y se borra/desactiva éste.
const DEV_SUPERADMIN_EMAIL = 'superadmin@plataforma-casino.local';
const DEV_SUPERADMIN_PASSWORD = 'dev-superadmin-2026';

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
  const insertedTenants = await db
    .insert(tenants)
    .values({
      slug: 'demo-casino',
      name: 'Casino Demo',
      dbName: 'tenant_demo_casino',
      dbHost: 'localhost',
      status: 'onboarding',
      planId: basicPlan.id,
      contactEmail: 'admin@demo-casino.local',
    })
    .onConflictDoNothing({ target: tenants.slug })
    .returning();

  console.log(`  → insertados: ${insertedTenants.length}.`);

  const [demoTenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, 'demo-casino'))
    .limit(1);

  if (!demoTenant) {
    throw new Error('Tenant "demo-casino" no encontrado después de seed.');
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
  console.log('  CREDENCIALES DEV SUPER-ADMIN');
  console.log('───────────────────────────────────────────────────');
  console.log(`  Email:    ${DEV_SUPERADMIN_EMAIL}`);
  console.log(`  Password: ${DEV_SUPERADMIN_PASSWORD}`);
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
