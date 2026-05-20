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
  games,
  permissions,
  roles,
  rolePermissions,
  userRoles,
  users,
  type NewGame,
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

  // Wallet — exports
  { code: 'wallet.export', category: 'wallet', description: 'Exportar transactions de wallet a CSV', auditRequired: true, isDelegatable: true },

  // Wallet stats (Sprint 45 — reporting consolidado de movimientos)
  { code: 'wallet_stats.view_any', category: 'wallet_stats', description: 'Ver estadísticas de pago de TODO el tenant (bypassa scope)', auditRequired: false, isDelegatable: false },
  { code: 'wallet_stats.view_own_network', category: 'wallet_stats', description: 'Ver estadísticas de pago de mi red downstream', auditRequired: false, isDelegatable: true },
  { code: 'wallet_stats.export', category: 'wallet_stats', description: 'Exportar estadísticas de pago a CSV', auditRequired: true, isDelegatable: true },

  // Game stats (Sprint 46 — reporting de jugadas, GGR, RTP real)
  { code: 'game_stats.view_any', category: 'game_stats', description: 'Ver estadísticas de juego de TODO el tenant (bypassa scope)', auditRequired: false, isDelegatable: false },
  { code: 'game_stats.view_own_network', category: 'game_stats', description: 'Ver estadísticas de juego de mi red downstream', auditRequired: false, isDelegatable: true },
  { code: 'game_stats.export', category: 'game_stats', description: 'Exportar estadísticas de juego a CSV', auditRequired: true, isDelegatable: true },

  // Bank transactions (Sprint 50 — separación de funciones: empleado sube
  // las transferencias entrantes, cajero matchea y aprueba sin acceso al banco).
  { code: 'bank_tx.upload', category: 'bank_tx', description: 'Cargar transferencias bancarias entrantes (empleado de confianza)', auditRequired: true, isDelegatable: false },
  { code: 'bank_tx.view', category: 'bank_tx', description: 'Ver transferencias bancarias para matchear con deposits', auditRequired: false, isDelegatable: true },
  { code: 'bank_tx.match', category: 'bank_tx', description: 'Matchear una transferencia con un deposit (cajero al aprobar)', auditRequired: true, isDelegatable: true },
  { code: 'bank_tx.delete', category: 'bank_tx', description: 'Borrar una bank_transaction (solo admin, audit severity:high)', auditRequired: true, isDelegatable: false },

  // Commissions settle (Sprint 50 — liquidación periódica de pendings).
  { code: 'commissions.settle', category: 'commissions', description: 'Liquidar (mintear + acreditar) commissions accrued pendientes', auditRequired: true, isDelegatable: false },

  // Users
  { code: 'users.create', category: 'users', description: 'Crear usuarios', auditRequired: true, isDelegatable: true },
  { code: 'users.edit', category: 'users', description: 'Editar usuarios', auditRequired: true, isDelegatable: true },
  { code: 'users.ban', category: 'users', description: 'Banear / suspender usuarios', auditRequired: true, isDelegatable: true },
  { code: 'users.view_any', category: 'users', description: 'Ver cualquier usuario del tenant', auditRequired: false, isDelegatable: true },
  { code: 'users.impersonate', category: 'users', description: 'Operar como otro usuario', auditRequired: true, isDelegatable: false },
  { code: 'users.change_hierarchy', category: 'users', description: 'Asignar/cambiar parent de un user en la jerarquía', auditRequired: true, isDelegatable: false },
  { code: 'users.export', category: 'users', description: 'Exportar lista de usuarios a CSV', auditRequired: true, isDelegatable: true },

  // Deposits
  { code: 'deposits.view', category: 'deposits', description: 'Ver depósitos de mi red downstream (yo + descendants)', auditRequired: false, isDelegatable: true },
  { code: 'deposits.view_all', category: 'deposits', description: 'Ver TODOS los depósitos del tenant (bypassa scope)', auditRequired: false, isDelegatable: false },
  { code: 'deposits.approve', category: 'deposits', description: 'Aprobar y cargar fichas', auditRequired: true, isDelegatable: true },
  { code: 'deposits.reject', category: 'deposits', description: 'Rechazar con motivo', auditRequired: true, isDelegatable: true },
  { code: 'deposits.export', category: 'deposits', description: 'Exportar depósitos a CSV', auditRequired: true, isDelegatable: true },

  // Withdrawals
  { code: 'withdrawals.view', category: 'withdrawals', description: 'Ver retiros de mi red downstream (yo + descendants)', auditRequired: false, isDelegatable: true },
  { code: 'withdrawals.view_all', category: 'withdrawals', description: 'Ver TODOS los retiros del tenant (bypassa scope)', auditRequired: false, isDelegatable: false },
  { code: 'withdrawals.approve', category: 'withdrawals', description: 'Aprobar retiro', auditRequired: true, isDelegatable: true },
  { code: 'withdrawals.reject', category: 'withdrawals', description: 'Rechazar retiro', auditRequired: true, isDelegatable: true },
  { code: 'withdrawals.process', category: 'withdrawals', description: 'Marcar como pagado', auditRequired: true, isDelegatable: true },
  { code: 'withdrawals.export', category: 'withdrawals', description: 'Exportar retiros a CSV', auditRequired: true, isDelegatable: true },

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

  // Payment methods (CRUD del catálogo del tenant)
  { code: 'payment_methods.edit', category: 'tenant', description: 'Crear/editar/desactivar métodos de pago del tenant', auditRequired: true, isDelegatable: false },

  // Commissions (revenue share a la jerarquía upstream)
  { code: 'commissions.configure', category: 'commissions', description: 'Configurar reglas de comisión (% por rol/evento)', auditRequired: true, isDelegatable: false },
  { code: 'commissions.view', category: 'commissions', description: 'Ver pagos de commission de mi red downstream', auditRequired: false, isDelegatable: true },
  { code: 'commissions.view_all', category: 'commissions', description: 'Ver TODOS los pagos del tenant (bypassa scope)', auditRequired: false, isDelegatable: false },

  // Responsible gaming (docs/12 §6.5)
  // `self_set` queda reservado en el catálogo — los endpoints /play/limits y
  // /play/exclusion no lo chequean (cualquier user autenticado puede operar
  // sobre SUS propios límites). Si emerge feature "disable self-service por
  // tenant", el guard se sumaría acá.
  { code: 'responsible_gaming.self_set', category: 'responsible_gaming', description: 'Self-service: configurar mis propios límites + auto-exclusión (reservado)', auditRequired: true, isDelegatable: false },
  { code: 'responsible_gaming.admin_set', category: 'responsible_gaming', description: 'Forzar límites o exclusión sobre otro user (severidad alta)', auditRequired: true, isDelegatable: false },
  { code: 'responsible_gaming.review', category: 'responsible_gaming', description: 'Ver límites y exclusiones de otros users', auditRequired: false, isDelegatable: true },

  // Tenant settings
  { code: 'tenant.settings.edit', category: 'tenant', description: 'Editar configuración del tenant', auditRequired: true, isDelegatable: false },
  { code: 'branding.edit', category: 'tenant', description: 'Editar branding del tenant', auditRequired: true, isDelegatable: false },
  { code: 'tenant.notifications.templates.edit', category: 'tenant', description: 'Editar plantillas de notificaciones (subject/body) del tenant', auditRequired: true, isDelegatable: false },

  // Notifications (queue admin)
  { code: 'notifications.view_any', category: 'notifications', description: 'Ver notifications de cualquier user (panel admin)', auditRequired: false, isDelegatable: true },
  { code: 'notifications.export', category: 'notifications', description: 'Exportar notifications a CSV', auditRequired: true, isDelegatable: true },
  { code: 'notifications.retry', category: 'notifications', description: 'Reintentar manualmente notifications failed', auditRequired: true, isDelegatable: true },

  // Bonos (sistema de bonos — Sprint Bonos-1, ver docs/15)
  { code: 'bonuses.view', category: 'bonuses', description: 'Ver bonos definiciones y instancias propias', auditRequired: false, isDelegatable: true },
  { code: 'bonuses.view_any', category: 'bonuses', description: 'Ver bonos de mi red downstream (yo + descendants)', auditRequired: false, isDelegatable: true },
  { code: 'bonuses.view_all', category: 'bonuses', description: 'Ver TODOS los bonos del tenant (bypassa scope)', auditRequired: false, isDelegatable: false },
  { code: 'bonuses.create_definition', category: 'bonuses', description: 'Crear definición de bono', auditRequired: true, isDelegatable: false },
  { code: 'bonuses.edit_definition', category: 'bonuses', description: 'Editar definición de bono', auditRequired: true, isDelegatable: false },
  { code: 'bonuses.grant_manual', category: 'bonuses', description: 'Otorgar bono manualmente a un user (motivo obligatorio)', auditRequired: true, isDelegatable: true },
  { code: 'bonuses.cancel', category: 'bonuses', description: 'Cancelar un bono activo (revierte al funder)', auditRequired: true, isDelegatable: true },
  { code: 'bonuses.force_clear', category: 'bonuses', description: 'Forzar el clear de un bono (pasa remaining al wallet real del user)', auditRequired: true, isDelegatable: false },
  { code: 'bonuses.export', category: 'bonuses', description: 'Exportar bonos a CSV', auditRequired: true, isDelegatable: true },
  { code: 'bonuses.export_definitions', category: 'bonuses', description: 'Exportar plantillas de bono a CSV', auditRequired: true, isDelegatable: true },

  // Promociones / Sorteos (Sprint Sorteos, ver docs/15 §B)
  { code: 'promotions.view', category: 'promotions', description: 'Ver promociones activas y participaciones propias', auditRequired: false, isDelegatable: true },
  { code: 'promotions.view_any', category: 'promotions', description: 'Ver promociones y entregas de cualquier user', auditRequired: false, isDelegatable: true },
  { code: 'promotions.create_definition', category: 'promotions', description: 'Crear promoción/sorteo', auditRequired: true, isDelegatable: false },
  { code: 'promotions.edit_definition', category: 'promotions', description: 'Editar promoción/sorteo', auditRequired: true, isDelegatable: false },
  { code: 'promotions.cancel', category: 'promotions', description: 'Cancelar promoción/sorteo (reverte fondos no-entregados)', auditRequired: true, isDelegatable: false },
  { code: 'promotions.export', category: 'promotions', description: 'Exportar promociones a CSV', auditRequired: true, isDelegatable: true },

  // Liga / Rankings (Sprint Liga, ver docs/15 §C)
  { code: 'leagues.view', category: 'leagues', description: 'Ver leagues activas y standings (público para users del tenant)', auditRequired: false, isDelegatable: true },
  { code: 'leagues.view_any', category: 'leagues', description: 'Ver leagues con resultados completos (admin)', auditRequired: false, isDelegatable: true },
  { code: 'leagues.create_definition', category: 'leagues', description: 'Crear league', auditRequired: true, isDelegatable: false },
  { code: 'leagues.edit_definition', category: 'leagues', description: 'Editar league', auditRequired: true, isDelegatable: false },
  { code: 'leagues.run_actions', category: 'leagues', description: 'Forzar recompute o close manual de una league', auditRequired: true, isDelegatable: false },
  { code: 'leagues.export', category: 'leagues', description: 'Exportar ligas a CSV', auditRequired: true, isDelegatable: true },

  // Antifraude (Sprint Antifraude, ver docs/15 §D)
  { code: 'fraud.view', category: 'fraud', description: 'Ver señales antifraude y clusters sospechosos', auditRequired: false, isDelegatable: false },
  { code: 'fraud.review', category: 'fraud', description: 'Confirmar/descartar pares marcados (deduplicar manualmente)', auditRequired: true, isDelegatable: false },
  { code: 'fraud.run_scan', category: 'fraud', description: 'Disparar manualmente el scan de detección', auditRequired: true, isDelegatable: false },

  // Games catálogo (Sprint 34 — admin gestiona qué juegos están disponibles)
  { code: 'games.edit', category: 'games', description: 'CRUD del catálogo de juegos del tenant', auditRequired: true, isDelegatable: false },
];

// ──────────────────────────────────────────────────────────────────────
// Mock games catalog (Sprint 34) — seed inicial demo
// ──────────────────────────────────────────────────────────────────────

const MOCK_GAMES: Array<Omit<NewGame, 'id' | 'createdAt' | 'updatedAt'>> = [
  // ── Slots ───────────────────────────────────────────────────────────
  {
    code: 'mock_lucky_seven',
    name: 'Lucky Seven',
    providerCode: 'mock',
    category: 'slots',
    shortDescription: 'Slot clásico 3 reels con simbolos clásicos.',
    config: { rtp: 0.96, minBet: '1', maxBet: '500', volatility: 'medium' },
    featured: true,
    sortOrder: 10,
  },
  {
    code: 'mock_book_of_demo',
    name: 'Book of Demo',
    providerCode: 'mock',
    category: 'slots',
    shortDescription: '5 reels, 10 líneas, free spins re-trigger.',
    config: { rtp: 0.96, minBet: '1', maxBet: '500', volatility: 'high' },
    featured: true,
    sortOrder: 20,
  },
  {
    code: 'mock_fruit_fiesta',
    name: 'Fruit Fiesta',
    providerCode: 'mock',
    category: 'slots',
    shortDescription: 'Slot frutal de baja volatilidad — premios chicos seguidos.',
    config: { rtp: 0.97, minBet: '1', maxBet: '200', volatility: 'low' },
    sortOrder: 30,
  },
  {
    code: 'mock_egyptian_treasure',
    name: 'Egyptian Treasure',
    providerCode: 'mock',
    category: 'slots',
    shortDescription: 'Pirámides + Cleopatra + scatters dorados.',
    config: { rtp: 0.95, minBet: '1', maxBet: '1000', volatility: 'medium' },
    sortOrder: 40,
  },
  {
    code: 'mock_neon_nights',
    name: 'Neon Nights',
    providerCode: 'mock',
    category: 'slots',
    shortDescription: 'Estética cyberpunk + multiplicadores en cascada.',
    config: { rtp: 0.96, minBet: '1', maxBet: '500', volatility: 'high' },
    sortOrder: 50,
  },
  {
    code: 'mock_western_gold',
    name: 'Western Gold',
    providerCode: 'mock',
    category: 'slots',
    shortDescription: 'Cowboys + wilds expandidos.',
    config: { rtp: 0.96, minBet: '1', maxBet: '300', volatility: 'medium' },
    sortOrder: 60,
  },

  // ── Crash ───────────────────────────────────────────────────────────
  {
    code: 'mock_crash_classic',
    name: 'Crash Classic',
    providerCode: 'mock',
    category: 'crash',
    shortDescription:
      'Apostá y retirá antes del crash. Multiplier desde 1.00x.',
    config: { houseEdge: 0.01, maxMultiplier: 100, minBet: '1', maxBet: '5000' },
    featured: true,
    sortOrder: 10,
  },

  // ── Table ───────────────────────────────────────────────────────────
  {
    code: 'mock_blackjack',
    name: 'Blackjack',
    providerCode: 'mock',
    category: 'table',
    shortDescription: 'Blackjack clásico contra el dealer (próximamente).',
    config: { decks: 6, blackjackPayout: '3:2', minBet: '5', maxBet: '500' },
    sortOrder: 10,
  },
  {
    code: 'mock_roulette',
    name: 'Ruleta Europea',
    providerCode: 'mock',
    category: 'table',
    shortDescription: 'Ruleta europea de un solo cero (próximamente).',
    config: { type: 'european', minBet: '1', maxBet: '1000' },
    sortOrder: 20,
  },

  // ── Live (placeholders) ────────────────────────────────────────────
  {
    code: 'mock_live_baccarat',
    name: 'Live Baccarat',
    providerCode: 'mock',
    category: 'live',
    shortDescription: 'Baccarat en vivo con dealer (próximamente).',
    config: { minBet: '10', maxBet: '10000' },
    sortOrder: 10,
  },
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

    // 7. Seed del catálogo de juegos mock (Sprint 34). Idempotente:
    //    onConflictDoNothing por code — si el admin ya tunó algún juego
    //    (e.g. lo archivó o cambió config), NO lo pisa.
    await db
      .insert(games)
      .values(MOCK_GAMES)
      .onConflictDoNothing({ target: games.code });

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
