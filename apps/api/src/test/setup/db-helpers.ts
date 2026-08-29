/**
 * Helpers de DB para los tests E2E.
 *
 * Responsabilidades:
 *   - DROP + CREATE del tenant test database antes de la suite.
 *   - Aplicar migraciones de tenant.
 *   - Seedear roles + permisos + admin + cajero1 + cajero2.
 *   - Asegurar la fila del tenant en `platform_control.tenants` y su
 *     domain en `tenant_domains` para que el TenantResolver lo encuentre.
 *
 * Diseño:
 *   - Asumimos que `platform_control` ya existe y está migrado/seedeado
 *     (responsabilidad del dev: `pnpm db:setup:control && pnpm db:seed:control`).
 *   - Asumimos que `tenant_plans` tiene el código 'basic' (lo crea el
 *     seed control).
 *   - Cada `globalSetup` arranca limpio: drop + recreate del tenant test.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import {
  createControlDb,
  deriveAdminUrl,
  hashPassword,
  migrateTenantDatabase,
  provisionTenantDatabase,
  seedTenantDatabase,
  tenantDomains,
  tenantPlans,
  tenants,
  userRoles,
  users,
  roles,
} from '@casino/db';
import { TEST_TENANT } from './test-tenant';

/** Saca la URL del tenant test reemplazando el placeholder del template. */
export function getTestTenantUrl(): string {
  const template = process.env.DATABASE_URL_TENANT_TEMPLATE;
  if (!template) {
    throw new Error(
      'DATABASE_URL_TENANT_TEMPLATE no configurada. Ver apps/api/.env.local',
    );
  }
  return template.replace('<tenant_db>', TEST_TENANT.dbName);
}

/** URL del control DB. */
export function getControlUrl(): string {
  const url = process.env.DATABASE_URL_CONTROL;
  if (!url) {
    throw new Error(
      'DATABASE_URL_CONTROL no configurada. Ver apps/api/.env.local',
    );
  }
  return url;
}

/** DROP DATABASE del tenant test. Idempotente. */
export async function dropTestTenantDatabase(): Promise<void> {
  const adminUrl = deriveAdminUrl(getControlUrl());
  const sql = postgres(adminUrl, { max: 1 });
  try {
    // Force disconnect cualquier conexión vieja antes de drop.
    await sql.unsafe(
      `SELECT pg_terminate_backend(pg_stat_activity.pid)
       FROM pg_stat_activity
       WHERE pg_stat_activity.datname = '${TEST_TENANT.dbName}'
         AND pid <> pg_backend_pid()`,
    );
    await sql.unsafe(`DROP DATABASE IF EXISTS ${TEST_TENANT.dbName}`);
  } finally {
    await sql.end();
  }
}

/** Asegura la fila del tenant en control DB + su domain. */
async function upsertTenantInControlDb(): Promise<void> {
  const db = createControlDb(getControlUrl());

  // Buscar plan 'basic'.
  const planRows = await db
    .select()
    .from(tenantPlans)
    .where(eq(tenantPlans.code, TEST_TENANT.planCode))
    .limit(1);
  const plan = planRows[0];
  if (!plan) {
    throw new Error(
      `Plan '${TEST_TENANT.planCode}' no existe en control DB. Corré: pnpm db:seed:control`,
    );
  }

  // Upsert tenant.
  const existing = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, TEST_TENANT.slug))
    .limit(1);

  let tenantId: string;
  if (existing[0]) {
    tenantId = existing[0].id;
    await db
      .update(tenants)
      .set({
        status: 'active',
        dbName: TEST_TENANT.dbName,
        name: TEST_TENANT.name,
        contactEmail: TEST_TENANT.contactEmail,
        planId: plan.id,
      })
      .where(eq(tenants.id, tenantId));
  } else {
    const inserted = await db
      .insert(tenants)
      .values({
        slug: TEST_TENANT.slug,
        name: TEST_TENANT.name,
        contactEmail: TEST_TENANT.contactEmail,
        dbName: TEST_TENANT.dbName,
        planId: plan.id,
        status: 'active',
      })
      .returning({ id: tenants.id });
    tenantId = inserted[0]!.id;
  }

  // Upsert domain.
  await db
    .insert(tenantDomains)
    .values({
      tenantId,
      domain: TEST_TENANT.host,
      isPrimary: true,
    })
    .onConflictDoUpdate({
      target: tenantDomains.domain,
      set: { tenantId, isPrimary: true },
    });
}

/**
 * Reset completo del tenant de test: drop + create + migrate + seed +
 * cajero1/cajero2 + control DB rows.
 *
 * Idempotente — se puede llamar tantas veces como quieras.
 */
export async function resetTestTenantDatabase(): Promise<void> {
  // 1. Dropear (cierra conexiones primero).
  await dropTestTenantDatabase();

  // 2. Crear DB Postgres.
  const adminUrl = deriveAdminUrl(getControlUrl());
  await provisionTenantDatabase(adminUrl, TEST_TENANT.dbName);

  // 3. Aplicar migraciones de tenant.
  const tenantUrl = getTestTenantUrl();
  await migrateTenantDatabase(tenantUrl);

  // 4. Seedear roles + permisos + admin.
  await seedTenantDatabase(tenantUrl, {
    adminUsername: TEST_TENANT.admin.username,
    adminEmail: TEST_TENANT.admin.email,
    adminPassword: TEST_TENANT.admin.password,
    adminDisplayName: TEST_TENANT.admin.displayName,
  });

  // 5. Sumar cajero1 y cajero2 (con rol 'cajero').
  await seedExtraTestUsers(tenantUrl);

  // 6. Fila en control DB + domain.
  await upsertTenantInControlDb();
}

/**
 * Reset ligero entre suites: limpia tablas mutables y deja a admin/cajero1/
 * cajero2 con balances en 0 y sin overrides. De `users` no borra filas (los
 * ids se referencian por todos lados) pero SI restaura el estado de auth
 * mutable — lockout, 2FA y status — que de otro modo se filtra entre suites.
 *
 * Mucho más rápido que drop+create (~50ms vs ~2s) y suficiente para evitar
 * contaminación cross-suite. Llamado desde el `beforeAll` de cada suite
 * via `resetMutableState()`.
 */
/**
 * Reset entre suites: trunca tablas mutables y wipea wallets.
 *
 * También deletea wallets de la tabla (no solo update a 0) para garantizar
 * que cualquier suite siguiente parte de "no hay wallet" y la app crea
 * frescas via `getOrCreateWalletForUser`. Esto evita que estado de version
 * arrastrado afecte tests de optimistic locking.
 *
 * Usa una connection nueva (no cacheada) — postgres-js cierra al `end()`.
 */
export async function resetMutableState(): Promise<void> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    // Truncate completo de tablas mutables + wallets. CASCADE limpia FKs
    // de wallet_transactions y wallet_holds.
    await sql.unsafe(`
      TRUNCATE TABLE
        audit_log,
        wallet_transactions,
        wallet_holds,
        wallets,
        idempotency_keys,
        user_permission_overrides,
        user_sessions,
        user_bonuses,
        bonus_definitions,
        promotion_rewards,
        promotion_participants,
        promotions,
        league_results,
        league_standings,
        leagues,
        fraud_signals,
        fraud_account_links,
        tenant_settings,
        tenant_settings_history,
        notifications,
        notification_templates,
        push_subscriptions
      RESTART IDENTITY CASCADE
    `);

    // Estado de AUTH de los users seedeados.
    //
    // `users` no se trunca (los ids se referencian por todos lados), pero
    // varias de sus columnas SI son mutables y se filtran entre suites:
    //
    //   - `locked_until` / `failed_login_attempts`: el lockout de cuenta.
    //     Una suite que prueba credenciales malas deja al admin bloqueado y
    //     TODAS las suites siguientes se caen con 401 al loguearse.
    //   - `two_fa_enabled` / `two_fa_secret`: una suite que habilita 2FA y
    //     no limpia obliga a las siguientes a pasar un codigo que no tienen.
    //   - `status`: suspended/banned deja al user sin poder loguear.
    //
    // Los cuatro producen el MISMO sintoma (401 en el login del bootstrap) y
    // ninguno es culpa de la suite que lo sufre. Antes esto se parchaba a mano
    // en las suites de 2FA; centralizarlo lo cubre para todas.
    await sql.unsafe(`
      UPDATE users
         SET locked_until = NULL,
             failed_login_attempts = 0,
             two_fa_enabled = false,
             two_fa_secret = NULL,
             status = 'active'
       WHERE username IN ('jest_admin', 'jest_cajero1', 'jest_cajero2')
    `);
  } finally {
    await sql.end();
  }
}

/** Crea cajero1 y cajero2 en la DB del tenant de test, con rol 'cajero'. */
async function seedExtraTestUsers(tenantUrl: string): Promise<void> {
  const sql = postgres(tenantUrl, { max: 1 });
  const db = drizzle(sql);
  try {
    const cajeroRole = await db
      .select()
      .from(roles)
      .where(eq(roles.code, 'cajero'))
      .limit(1);
    if (!cajeroRole[0]) {
      throw new Error("Rol 'cajero' no existe — el seed no corrió?");
    }
    const roleId = cajeroRole[0].id;

    for (const c of [TEST_TENANT.cajero1, TEST_TENANT.cajero2]) {
      const passwordHash = await hashPassword(c.password);
      const inserted = await db
        .insert(users)
        .values({
          username: c.username,
          passwordHash,
          displayName: c.displayName,
          status: 'active',
        })
        .returning({ id: users.id });
      const userId = inserted[0]!.id;
      await db.insert(userRoles).values({
        userId,
        roleId,
      });
    }
  } finally {
    await sql.end();
  }
}
