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

// Centralizamos env en apps/api/.env.local (ver setup-control.ts).
loadEnv({ path: path.resolve(process.cwd(), '../../apps/api/.env.local') });

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
  // 4. Platform user (super-admin de prueba)
  // -------------------------------------------------------------------------
  console.log('🌱 Insertando platform_user super-admin de prueba...');
  const insertedUsers = await db
    .insert(platformUsers)
    .values({
      email: 'superadmin@plataforma-casino.local',
      // Placeholder hash — NO es una password real. Se reemplaza al implementar auth.
      // Esto es un valor cualquiera con formato Argon2id-compatible que NO resuelve.
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$placeholder',
      displayName: 'Super Admin (dev)',
      twoFaSecret: null,
      status: 'active',
    })
    .onConflictDoNothing({ target: platformUsers.email })
    .returning();

  console.log(`  → insertados: ${insertedUsers.length}.`);

  console.log('✅ Seed de control DB completado.');
  console.log('');
  console.log('Resumen:');
  console.log('  - tenant_plans: basic + pro');
  console.log('  - tenants: demo-casino (onboarding)');
  console.log('  - tenant_domains: demo.localhost (no verified)');
  console.log('  - platform_users: superadmin@plataforma-casino.local (password placeholder)');
  console.log('');
  console.log('Verificalo con: pnpm --filter @casino/db db:studio:control');
}

seed()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('❌ Error en seed-control:', err);
    process.exit(1);
  });
