/**
 * Seed inicial de un tenant DB.
 *
 * Se invoca **inmediatamente después de migrar** una tenant DB nueva.
 * Inserta:
 *   1. Los 6 roles del sistema (admin_tenant, socio, distribuidor, cajero, empleado, usuario_final).
 *   2. Un subset MVP del catálogo de permisos (más se suma en sprints posteriores).
 *   3. Asigna TODOS los permisos al rol admin_tenant.
 *   4. Crea el user admin del tenant con password hasheada Argon2id.
 *   5. Asigna el rol admin_tenant al user admin.
 *
 * Idempotente vía onConflictDoNothing/Update donde corresponde.
 *
 * Ver `docs/03-jerarquia-roles.md` para reglas de roles y `docs/04 §3` para schema.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, sql as drizzleSql } from 'drizzle-orm';
import postgres from 'postgres';
import {
  permissions,
  roles,
  rolePermissions,
  userRoles,
  users,
  type NewPermission,
  type NewRole,
} from './../tenant';
import { hashPassword } from './../utils/password';

export interface TenantSeedOptions {
  adminUsername: string;
  adminEmail: string;
  adminPassword: string;
  adminDisplayName: string;
}

export interface TenantSeedResult {
  adminUserId: string;
  adminRoleId: string;
  rolesInserted: number;
  permissionsInserted: number;
}

const SYSTEM_ROLES: NewRole[] = [
  {
    code: 'admin_tenant',
    name: 'Admin del Tenant',
    description: 'Dueño del casino. Control total dentro de su tenant.',
    isSystem: true,
    requiresTwoFa: true,
  },
  {
    code: 'socio',
    name: 'Socio',
    description: 'Revenue share + red de cajeros y referidos.',
    isSystem: true,
    requiresTwoFa: true,
  },
  {
    code: 'distribuidor',
    name: 'Distribuidor',
    description: 'Gestiona cajeros bajo un Socio.',
    isSystem: true,
    requiresTwoFa: true,
  },
  {
    code: 'cajero',
    name: 'Cajero',
    description: 'Carga y retira fichas a jugadores.',
    isSystem: true,
    requiresTwoFa: true,
  },
  {
    code: 'empleado',
    name: 'Empleado',
    description: 'Permisos a la carta. Sin defaults fuertes.',
    isSystem: true,
    // requiresTwoFa decidido por el Admin Tenant según los permisos que le
    // dé. Default false — seguro porque sin permisos no puede hacer daño.
    requiresTwoFa: false,
  },
  {
    code: 'usuario_final',
    name: 'Usuario Final',
    description: 'Jugador. Sin acceso al panel.',
    isSystem: true,
    requiresTwoFa: false,
  },
];

/**
 * Subset MVP del catálogo de permisos. Más se sumarán a medida que se
 * implementen los módulos correspondientes (referrals, promos, etc.).
 *
 * Catálogo completo en `docs/03-jerarquia-roles.md §4`.
 */
const SYSTEM_PERMISSIONS: NewPermission[] = [
  // Wallet
  { code: 'wallet.load', category: 'wallet', description: 'Cargar fichas a un usuario', auditRequired: true, isDelegatable: true },
  { code: 'wallet.unload', category: 'wallet', description: 'Retirar fichas de un usuario', auditRequired: true, isDelegatable: true },
  { code: 'wallet.adjust', category: 'wallet', description: 'Ajustar saldo manualmente con motivo', auditRequired: true, isDelegatable: false },
  { code: 'wallet.mint', category: 'wallet', description: 'Crear fichas desde la nada (solo admin_tenant)', auditRequired: true, isDelegatable: false },
  { code: 'wallet.burn', category: 'wallet', description: 'Destruir fichas (solo admin_tenant)', auditRequired: true, isDelegatable: false },
  { code: 'wallet.view_any', category: 'wallet', description: 'Ver saldo de cualquier usuario', auditRequired: false, isDelegatable: true },

  // Users
  { code: 'users.create', category: 'users', description: 'Crear usuarios', auditRequired: true, isDelegatable: true },
  { code: 'users.edit', category: 'users', description: 'Editar usuarios', auditRequired: true, isDelegatable: true },
  { code: 'users.ban', category: 'users', description: 'Banear / suspender usuarios', auditRequired: true, isDelegatable: true },
  { code: 'users.view_any', category: 'users', description: 'Ver cualquier usuario del tenant', auditRequired: false, isDelegatable: true },
  { code: 'users.impersonate', category: 'users', description: 'Operar como otro usuario', auditRequired: true, isDelegatable: false },
  { code: 'users.change_hierarchy', category: 'users', description: 'Asignar/cambiar parent de un user en la jerarquía', auditRequired: true, isDelegatable: false },

  // Deposits
  { code: 'deposits.view', category: 'deposits', description: 'Ver solicitudes de depósito', auditRequired: false, isDelegatable: true },
  { code: 'deposits.approve', category: 'deposits', description: 'Aprobar y cargar fichas', auditRequired: true, isDelegatable: true },
  { code: 'deposits.reject', category: 'deposits', description: 'Rechazar con motivo', auditRequired: true, isDelegatable: true },

  // Withdrawals
  { code: 'withdrawals.view', category: 'withdrawals', description: 'Ver solicitudes de retiro', auditRequired: false, isDelegatable: true },
  { code: 'withdrawals.approve', category: 'withdrawals', description: 'Aprobar retiro', auditRequired: true, isDelegatable: true },
  { code: 'withdrawals.reject', category: 'withdrawals', description: 'Rechazar retiro', auditRequired: true, isDelegatable: true },
  { code: 'withdrawals.process', category: 'withdrawals', description: 'Marcar como pagado', auditRequired: true, isDelegatable: true },

  // Roles & permissions
  { code: 'roles.create', category: 'roles', description: 'Crear roles custom', auditRequired: true, isDelegatable: false },
  { code: 'roles.edit', category: 'roles', description: 'Editar roles', auditRequired: true, isDelegatable: false },
  { code: 'permissions.grant', category: 'permissions', description: 'Otorgar override de permiso', auditRequired: true, isDelegatable: false },
  { code: 'permissions.revoke', category: 'permissions', description: 'Revocar override de permiso', auditRequired: true, isDelegatable: false },

  // Reports
  { code: 'reports.netwin.view', category: 'reports', description: 'Ver reportes de NGR', auditRequired: false, isDelegatable: true },
  { code: 'reports.export', category: 'reports', description: 'Exportar reportes', auditRequired: true, isDelegatable: true },

  // Audit
  { code: 'audit.view', category: 'audit', description: 'Leer audit_log', auditRequired: false, isDelegatable: true },
  { code: 'audit.export', category: 'audit', description: 'Exportar audit_log', auditRequired: true, isDelegatable: false },

  // Tenant settings
  { code: 'tenant.settings.edit', category: 'tenant', description: 'Editar configuración del tenant', auditRequired: true, isDelegatable: false },
  { code: 'branding.edit', category: 'tenant', description: 'Editar branding del tenant', auditRequired: true, isDelegatable: false },

  // Bonos (sistema de bonos — Sprint Bonos-1, ver docs/15)
  { code: 'bonuses.view', category: 'bonuses', description: 'Ver bonos definiciones y instancias propias', auditRequired: false, isDelegatable: true },
  { code: 'bonuses.view_any', category: 'bonuses', description: 'Ver bonos de cualquier user', auditRequired: false, isDelegatable: true },
  { code: 'bonuses.create_definition', category: 'bonuses', description: 'Crear definición de bono', auditRequired: true, isDelegatable: false },
  { code: 'bonuses.edit_definition', category: 'bonuses', description: 'Editar definición de bono', auditRequired: true, isDelegatable: false },
  { code: 'bonuses.grant_manual', category: 'bonuses', description: 'Otorgar bono manualmente a un user (motivo obligatorio)', auditRequired: true, isDelegatable: true },
  { code: 'bonuses.cancel', category: 'bonuses', description: 'Cancelar un bono activo (revierte al funder)', auditRequired: true, isDelegatable: true },
  { code: 'bonuses.force_clear', category: 'bonuses', description: 'Forzar el clear de un bono (pasa remaining al wallet real del user)', auditRequired: true, isDelegatable: false },

  // Promociones / Sorteos (Sprint Sorteos, ver docs/15 §B)
  { code: 'promotions.view', category: 'promotions', description: 'Ver promociones activas y participaciones propias', auditRequired: false, isDelegatable: true },
  { code: 'promotions.view_any', category: 'promotions', description: 'Ver promociones y entregas de cualquier user', auditRequired: false, isDelegatable: true },
  { code: 'promotions.create_definition', category: 'promotions', description: 'Crear promoción/sorteo', auditRequired: true, isDelegatable: false },
  { code: 'promotions.edit_definition', category: 'promotions', description: 'Editar promoción/sorteo', auditRequired: true, isDelegatable: false },
  { code: 'promotions.cancel', category: 'promotions', description: 'Cancelar promoción/sorteo (reverte fondos no-entregados)', auditRequired: true, isDelegatable: false },

  // Liga / Rankings (Sprint Liga, ver docs/15 §C)
  { code: 'leagues.view', category: 'leagues', description: 'Ver leagues activas y standings (público para users del tenant)', auditRequired: false, isDelegatable: true },
  { code: 'leagues.view_any', category: 'leagues', description: 'Ver leagues con resultados completos (admin)', auditRequired: false, isDelegatable: true },
  { code: 'leagues.create_definition', category: 'leagues', description: 'Crear league', auditRequired: true, isDelegatable: false },
  { code: 'leagues.edit_definition', category: 'leagues', description: 'Editar league', auditRequired: true, isDelegatable: false },
  { code: 'leagues.run_actions', category: 'leagues', description: 'Forzar recompute o close manual de una league', auditRequired: true, isDelegatable: false },

  // Antifraude (Sprint Antifraude, ver docs/15 §D)
  { code: 'fraud.view', category: 'fraud', description: 'Ver señales antifraude y clusters sospechosos', auditRequired: false, isDelegatable: false },
  { code: 'fraud.review', category: 'fraud', description: 'Confirmar/descartar pares marcados (deduplicar manualmente)', auditRequired: true, isDelegatable: false },
  { code: 'fraud.run_scan', category: 'fraud', description: 'Disparar manualmente el scan de detección', auditRequired: true, isDelegatable: false },
];

export async function seedTenantDatabase(
  connectionUrl: string,
  opts: TenantSeedOptions,
): Promise<TenantSeedResult> {
  const sql = postgres(connectionUrl, { max: 1 });
  const db = drizzle(sql);

  try {
    // 1. Roles del sistema. Hacemos upsert con `onConflictDoUpdate` (no
    //    `DoNothing`) para que cambios en flags importantes — `requiresTwoFa`,
    //    `description` — propaguen a tenants ya existentes cuando se re-seedee.
    const rolesInserted = await db
      .insert(roles)
      .values(SYSTEM_ROLES)
      .onConflictDoUpdate({
        target: roles.code,
        set: {
          name: drizzleSql`excluded.name`,
          description: drizzleSql`excluded.description`,
          requiresTwoFa: drizzleSql`excluded.requires_two_fa`,
          updatedAt: new Date(),
        },
      })
      .returning();

    // 2. Permisos del sistema
    const permsInserted = await db
      .insert(permissions)
      .values(SYSTEM_PERMISSIONS)
      .onConflictDoNothing({ target: permissions.code })
      .returning();

    // 3. Conseguimos el id del rol admin_tenant (puede que ya existiera)
    const adminRoleRow = await db.select().from(roles).where(eq(roles.code, 'admin_tenant')).limit(1);
    const adminRole = adminRoleRow[0];
    if (!adminRole) {
      throw new Error('admin_tenant role no encontrado tras seed.');
    }

    // 4. Asignar TODOS los permisos al rol admin_tenant (para el MVP).
    //    En el futuro habrá overrides finos según jerarquía.
    const allPerms = await db.select({ code: permissions.code }).from(permissions);
    if (allPerms.length > 0) {
      await db
        .insert(rolePermissions)
        .values(allPerms.map((p) => ({ roleId: adminRole.id, permissionCode: p.code })))
        .onConflictDoNothing();
    }

    // 5. Crear/actualizar user admin
    const passwordHash = await hashPassword(opts.adminPassword);
    const upsertedUser = await db
      .insert(users)
      .values({
        username: opts.adminUsername,
        email: opts.adminEmail,
        displayName: opts.adminDisplayName,
        passwordHash,
        status: 'active',
      })
      .onConflictDoUpdate({
        target: users.username,
        set: {
          passwordHash,
          email: opts.adminEmail,
          displayName: opts.adminDisplayName,
          status: 'active',
          updatedAt: new Date(),
        },
      })
      .returning();

    const adminUser = upsertedUser[0];
    if (!adminUser) {
      throw new Error('No se pudo upsert el admin user.');
    }

    // 6. Asignar admin_tenant al user
    await db
      .insert(userRoles)
      .values({ userId: adminUser.id, roleId: adminRole.id })
      .onConflictDoNothing();

    return {
      adminUserId: adminUser.id,
      adminRoleId: adminRole.id,
      rolesInserted: rolesInserted.length,
      permissionsInserted: permsInserted.length,
    };
  } finally {
    await sql.end();
  }
}
