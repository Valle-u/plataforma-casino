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

import { randomBytes } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, sql as drizzleSql } from 'drizzle-orm';
import postgres from 'postgres';
import {
  games,
  HOUSE_USERNAME,
  permissions,
  roles,
  rolePermissions,
  userRoles,
  users,
  wallets,
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
    requiresTwoFa: false,
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
  { code: 'wallet.correct', category: 'wallet', description: 'Cargar fichas por correccion/bonificacion/reintegro contra el cupo mensual del empleado (docs/19). Delegable a empleado de confianza.', auditRequired: true, isDelegatable: true },
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
  { code: 'bank_tx.upload', category: 'bank_tx', description: 'Cargar transferencias bancarias entrantes (empleado de confianza). Delegable a la planilla "Empleado de Banco".', auditRequired: true, isDelegatable: true },
  { code: 'bank_tx.view', category: 'bank_tx', description: 'Ver transferencias bancarias para matchear con deposits', auditRequired: false, isDelegatable: true },
  { code: 'bank_tx.match', category: 'bank_tx', description: 'Matchear una transferencia con un deposit (cajero al aprobar)', auditRequired: true, isDelegatable: true },
  { code: 'bank_tx.edit', category: 'bank_tx', description: 'Editar una transferencia bancaria aún sin matchear. Delegable a la planilla "Empleado de Banco".', auditRequired: true, isDelegatable: true },
  { code: 'bank_tx.delete', category: 'bank_tx', description: 'Borrar una bank_transaction (solo admin, audit severity:high)', auditRequired: true, isDelegatable: false },

  // Commissions settle (Sprint 50 — liquidación periódica de pendings).
  { code: 'commissions.settle', category: 'commissions', description: 'Liquidar (mintear + acreditar) commissions accrued pendientes', auditRequired: true, isDelegatable: false },

  // Ledger (Blindaje del núcleo económico, Parte A — validador de invariante).
  // Solo admin_tenant: chequea que las fichas cuadren y muestra el supply.
  { code: 'ledger.view', category: 'ledger', description: 'Ver el chequeo de integridad del ledger (reconciliación de fichas) y el supply', auditRequired: false, isDelegatable: false },
  { code: 'ledger.reconcile', category: 'ledger', description: 'Correr el chequeo de integridad del ledger on-demand', auditRequired: false, isDelegatable: false },

  // House / Tesorería (Blindaje del núcleo económico, Parte B). Solo admin_tenant.
  { code: 'house.view', category: 'house', description: 'Ver el estado de la Casa / tesorería (balance, capital, exposición)', auditRequired: false, isDelegatable: false },
  { code: 'house.inject_capital', category: 'house', description: 'Fondear la Casa: aporte de capital atado a bank_tx (estricto) o presupuesto (docs/16 §12). SOLO admin — no delegable (crea fichas de la nada).', auditRequired: true, isDelegatable: false },

  // Users
  { code: 'users.create', category: 'users', description: 'Crear usuarios', auditRequired: true, isDelegatable: true },
  { code: 'users.edit', category: 'users', description: 'Editar usuarios', auditRequired: true, isDelegatable: true },
  // Sprint 51.4: reset de password de un user inferior en la jerarquía.
  // No delegable — solo admin_tenant y socios directos pueden tenerlo.
  // ScopeGuard valida que el target esté en el downstream del actor.
  // Audit severity:high obligatoria.
  { code: 'users.reset_password', category: 'users', description: 'Resetear la password de un usuario downstream (admin / socio sobre su red)', auditRequired: true, isDelegatable: false },
  { code: 'users.ban', category: 'users', description: 'Banear / suspender usuarios', auditRequired: true, isDelegatable: true },
  { code: 'users.view_any', category: 'users', description: 'Listar usuarios de tu red downstream (gate del listado, scoped)', auditRequired: false, isDelegatable: true },
  { code: 'users.view_all', category: 'users', description: 'Ver TODOS los usuarios del tenant, incluyendo la sub-red de socios independientes (bypassa scope). Solo admin por default; no delegable — para que un empleado vea la red del admin sin invadir la sub-red del independiente, otorgar `users.view_admin_network`.', auditRequired: false, isDelegatable: false },
  { code: 'users.view_admin_network', category: 'users', description: 'Ver la red del admin: Casa + socios dependientes + descendants. NO expone la sub-red de socios independientes (aislamiento del modelo). Delegable a empleados de confianza del admin.', auditRequired: false, isDelegatable: true },
  { code: 'users.impersonate', category: 'users', description: 'Operar como otro usuario', auditRequired: true, isDelegatable: false },
  { code: 'users.intervene_independent', category: 'users', description: 'Intervenir (impersonate) en una sub-red INDEPENDIENTE — el ÚNICO cruce permitido al aislamiento E8/P3. Solo admin, NO delegable, con motivo obligatorio + audit severity critical.', auditRequired: true, isDelegatable: false },
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
  { code: 'audit.export', category: 'audit', description: 'Exportar audit_log a CSV. Delegable a la planilla "Empleado de Trazabilidad".', auditRequired: true, isDelegatable: true },

  // Payment methods (CRUD del catálogo del tenant)
  { code: 'payment_methods.edit', category: 'tenant', description: 'Crear/editar/desactivar métodos de pago del tenant', auditRequired: true, isDelegatable: false },

  // Commissions (revenue share a la jerarquía upstream)
  { code: 'commissions.configure', category: 'commissions', description: 'Configurar reglas de comisión (% por rol/evento)', auditRequired: true, isDelegatable: false },
  { code: 'commissions.configure_network', category: 'commissions', description: 'Fijar la comisión (%) de los hijos directos de mi red (cascada, docs §11)', auditRequired: true, isDelegatable: true },
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
  { code: 'bonuses.create_definition', category: 'bonuses', description: 'Crear definición de bono. Delegable a la planilla "Empleado de Bonos y Promociones".', auditRequired: true, isDelegatable: true },
  { code: 'bonuses.edit_definition', category: 'bonuses', description: 'Editar definición de bono. Delegable a la planilla "Empleado de Bonos y Promociones".', auditRequired: true, isDelegatable: true },
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
  { code: 'fraud.view', category: 'fraud', description: 'Ver señales antifraude y clusters sospechosos. Delegable a la planilla "Empleado de Antifraude".', auditRequired: false, isDelegatable: true },
  { code: 'fraud.review', category: 'fraud', description: 'Confirmar/descartar pares marcados (deduplicar manualmente). Delegable a la planilla "Empleado de Antifraude".', auditRequired: true, isDelegatable: true },
  { code: 'fraud.run_scan', category: 'fraud', description: 'Disparar manualmente el scan de detección. Delegable a la planilla "Empleado de Antifraude".', auditRequired: true, isDelegatable: true },

  // Games catálogo (Sprint 34 — admin gestiona qué juegos están disponibles)
  { code: 'games.edit', category: 'games', description: 'CRUD del catálogo de juegos del tenant', auditRequired: true, isDelegatable: false },

  // Sucursales independientes (Sprint 51 — socios con banco propio y precio
  // configurado de fichas. El admin del tenant les "vende" fichas reseteando
  // el saldo desde su mint. Sensible: no delegable, audit severity:high.)
  { code: 'branch.toggle_independence', category: 'branch', description: 'Activar/desactivar el modo sucursal independiente para un socio (admin only)', auditRequired: true, isDelegatable: false },
  { code: 'branch.sell_chips', category: 'branch', description: 'Vender fichas al wallet de un socio independiente al precio configurado', auditRequired: true, isDelegatable: false },
  // Sprint 51.1 — listado + reporting de sucursales (read-only, delegable
  // a operadores que necesiten ver el panel sin poder mutar).
  { code: 'branch.view', category: 'branch', description: 'Ver el listado de sucursales independientes + reportes de ventas', auditRequired: false, isDelegatable: true },

  // ──────────────────────────────────────────────────────────────────────
  // Comodín externo — permisos `*_admin_network` (Sprint 51.5)
  //
  // Un actor con estos permisos puede operar sobre TODA la red del admin
  // (Casa + socios dependientes + descendants) SIN estar en la jerarquía
  // (no necesita ser descendente del target). El ScopeGuard lee el
  // decorador @AdminNetworkBypass en el handler; si el actor tiene el
  // permiso Y target ∈ (todos los users − sub-red independiente) → pass.
  //
  // NUNCA alcanzan a la sub-red del socio independiente (aislamiento del
  // modelo). Todos delegables. Se otorgan por override; NO se grantean a
  // ningún rol por default (el admin_tenant ya bypassea scope y no los
  // necesita).
  //
  // Precedente: users.view_admin_network (0044).
  // ──────────────────────────────────────────────────────────────────────
  { code: 'wallet.load_admin_network',          category: 'wallet',      description: 'Cargar fichas a cualquier user de la red del admin (Casa + dependientes + descendants). NO alcanza a la sub-red del socio independiente. Otorgar por override al empleado comodín.',   auditRequired: true,  isDelegatable: true },
  { code: 'wallet.unload_admin_network',        category: 'wallet',      description: 'Retirar fichas desde cualquier user de la red del admin hacia la wallet del actor. Reason obligatorio.',                                                                             auditRequired: true,  isDelegatable: true },
  { code: 'wallet.view_admin_network',          category: 'wallet',      description: 'Ver wallet y transacciones de cualquier user de la red del admin (excluye sub-red del socio independiente). Alternativa a wallet.view_any para el comodín.',                        auditRequired: false, isDelegatable: true },
  { code: 'deposits.approve_admin_network',     category: 'deposits',    description: 'Aprobar depósitos pendientes de cualquier user de la red del admin (excluye sub-red del independiente).',                                                                            auditRequired: true,  isDelegatable: true },
  { code: 'deposits.reject_admin_network',      category: 'deposits',    description: 'Rechazar depósitos pendientes de cualquier user de la red del admin.',                                                                                                                auditRequired: true,  isDelegatable: true },
  { code: 'deposits.view_admin_network',        category: 'deposits',    description: 'Ver depósitos (listado + detalle + export) de la red del admin. Reemplaza a deposits.view_all para el comodín.',                                                                     auditRequired: false, isDelegatable: true },
  { code: 'withdrawals.approve_admin_network',  category: 'withdrawals', description: 'Aprobar retiros pendientes de cualquier user de la red del admin.',                                                                                                                   auditRequired: true,  isDelegatable: true },
  { code: 'withdrawals.reject_admin_network',   category: 'withdrawals', description: 'Rechazar retiros pendientes de cualquier user de la red del admin.',                                                                                                                  auditRequired: true,  isDelegatable: true },
  { code: 'withdrawals.process_admin_network',  category: 'withdrawals', description: 'Marcar retiros como procesados/pagados en la red del admin.',                                                                                                                         auditRequired: true,  isDelegatable: true },
  { code: 'withdrawals.view_admin_network',     category: 'withdrawals', description: 'Ver retiros de la red del admin. Reemplaza a withdrawals.view_all para el comodín.',                                                                                                 auditRequired: false, isDelegatable: true },
  { code: 'bonuses.grant_manual_admin_network', category: 'bonuses',     description: 'Otorgar bonos manuales a cualquier user de la red del admin.',                                                                                                                        auditRequired: true,  isDelegatable: true },
  { code: 'bonuses.cancel_admin_network',       category: 'bonuses',     description: 'Cancelar bonos activos de cualquier user de la red del admin (revierte fichas al funder).',                                                                                           auditRequired: true,  isDelegatable: true },

  // Referrals (Fase 1+2 — links de referido + auto-registro)
  { code: 'referrals.view_own',  category: 'referrals', description: 'Ver métricas y código de referido propio',                    auditRequired: false, isDelegatable: false },
  { code: 'referrals.view_any',  category: 'referrals', description: 'Ver métricas de referidos de cualquier operador (admin)',      auditRequired: false, isDelegatable: false },
  { code: 'referrals.create',    category: 'referrals', description: 'Registrarse vía link de referido (auto-registro público)',     auditRequired: false, isDelegatable: false },
];

// ──────────────────────────────────────────────────────────────────────
// Demo games catalog (Sprint 34) — seed inicial demo
// ──────────────────────────────────────────────────────────────────────

const DEMO_GAMES: Array<Omit<NewGame, 'id' | 'createdAt' | 'updatedAt'>> = [
  // ── Slots ───────────────────────────────────────────────────────────
  {
    code: 'mock_lucky_seven',
    name: 'Lucky Seven',
    providerCode: 'palace',
    category: 'slots',
    shortDescription: 'Slot clásico 3 reels con simbolos clásicos.',
    config: { rtp: 0.96, minBet: '1', maxBet: '500', volatility: 'medium' },
    featured: true,
    sortOrder: 10,
  },
  {
    code: 'mock_book_of_demo',
    name: 'Book of Demo',
    providerCode: 'palace',
    category: 'slots',
    shortDescription: '5 reels, 10 líneas, free spins re-trigger.',
    config: { rtp: 0.96, minBet: '1', maxBet: '500', volatility: 'high' },
    featured: true,
    sortOrder: 20,
  },
  {
    code: 'mock_fruit_fiesta',
    name: 'Fruit Fiesta',
    providerCode: 'palace',
    category: 'slots',
    shortDescription: 'Slot frutal de baja volatilidad — premios chicos seguidos.',
    config: { rtp: 0.97, minBet: '1', maxBet: '200', volatility: 'low' },
    sortOrder: 30,
  },
  {
    code: 'mock_egyptian_treasure',
    name: 'Egyptian Treasure',
    providerCode: 'palace',
    category: 'slots',
    shortDescription: 'Pirámides + Cleopatra + scatters dorados.',
    config: { rtp: 0.95, minBet: '1', maxBet: '1000', volatility: 'medium' },
    sortOrder: 40,
  },
  {
    code: 'mock_neon_nights',
    name: 'Neon Nights',
    providerCode: 'palace',
    category: 'slots',
    shortDescription: 'Estética cyberpunk + multiplicadores en cascada.',
    config: { rtp: 0.96, minBet: '1', maxBet: '500', volatility: 'high' },
    sortOrder: 50,
  },
  {
    code: 'mock_western_gold',
    name: 'Western Gold',
    providerCode: 'palace',
    category: 'slots',
    shortDescription: 'Cowboys + wilds expandidos.',
    config: { rtp: 0.96, minBet: '1', maxBet: '300', volatility: 'medium' },
    sortOrder: 60,
  },

  // ── Crash ───────────────────────────────────────────────────────────
  {
    code: 'mock_crash_classic',
    name: 'Crash Classic',
    providerCode: 'palace',
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
    providerCode: 'palace',
    category: 'table',
    shortDescription: 'Blackjack clásico contra el dealer (próximamente).',
    config: { decks: 6, blackjackPayout: '3:2', minBet: '5', maxBet: '500' },
    sortOrder: 10,
  },
  {
    code: 'mock_roulette',
    name: 'Ruleta Europea',
    providerCode: 'palace',
    category: 'table',
    shortDescription: 'Ruleta europea de un solo cero (próximamente).',
    config: { type: 'european', minBet: '1', maxBet: '1000' },
    sortOrder: 20,
  },

  // ── Live (placeholders) ────────────────────────────────────────────
  {
    code: 'mock_live_baccarat',
    name: 'Live Baccarat',
    providerCode: 'palace',
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

    // Defaults sensatos por rol — mapa definido con el user en la sesión
    // "roles paso a paso" (2026-07). El ScopeGuard garantiza que solo pueden
    // operar sobre su descendencia downstream, así que no hace falta restringir
    // a nivel de permission code.
    //
    // Espejo de migración 0047 para tenants nuevos. Mantener en sync.
    const DEFAULT_ROLE_PERMISSIONS: Array<{
      roleCode: string;
      permissionCodes: string[];
    }> = [
      {
        // Socio (mini-casino delegado). Alcance = red downstream.
        // Ver el mapa completo en docs/03-jerarquia-roles.md.
        roleCode: 'socio',
        // Modelo limpio (LEYES R3/R4): el rol NO trae permisos de MOVER plata
        // (wallet.load/unload, deposits.approve/reject, withdrawals.approve/
        // reject/process). El socio DEPENDIENTE es comercial puro. Los recibe
        // solo si es INDEPENDIENTE (auto-grant en branches.service). Los
        // `.view`/`.export` sí: ver la red es comercial (R2).
        permissionCodes: [
          'users.view_any', 'users.create', 'users.edit', 'users.ban',
          'users.reset_password', 'users.export', 'users.change_hierarchy',
          'wallet.view_any', 'wallet.export',
          'deposits.view', 'deposits.export',
          'withdrawals.view', 'withdrawals.export',
          'bonuses.view', 'bonuses.view_any', 'bonuses.grant_manual',
          'bonuses.cancel', 'bonuses.export',
          'wallet_stats.view_own_network', 'wallet_stats.export',
          'game_stats.view_own_network', 'game_stats.export',
          'audit.view', 'notifications.view_any',
          'commissions.view', 'commissions.configure_network',
          'permissions.grant', 'permissions.revoke',
          'referrals.view_own',
        ],
      },
      {
        // Distribuidor (supervisor de cajeros). Subset del socio.
        roleCode: 'distribuidor',
        // Modelo limpio (R3/R4): sin permisos de mover plata en el rol (solo
        // el independiente los recibe por auto-grant). Ver la red = comercial.
        permissionCodes: [
          'users.view_any', 'users.create', 'users.edit', 'users.ban',
          'users.reset_password', 'users.export', 'users.change_hierarchy',
          'wallet.view_any', 'wallet.export',
          'deposits.view', 'deposits.export',
          'withdrawals.view', 'withdrawals.export',
          'bonuses.view', 'bonuses.view_any', 'bonuses.grant_manual',
          'bonuses.cancel', 'bonuses.export',
          'wallet_stats.view_own_network', 'game_stats.view_own_network',
          'audit.view', 'notifications.view_any',
          'commissions.view',
          'referrals.view_own',
        ],
      },
      {
        // Cajero (piso operativo puro).
        roleCode: 'cajero',
        // Modelo limpio (R3/R4): sin permisos de mover plata en el rol (solo
        // el cajero INDEPENDIENTE los recibe por auto-grant). Gestiona a sus
        // jugadores (crear/editar/banear/reset — todo scopeado a su sub-red por
        // el ScopeGuard) + ve su actividad. Editar/banear es GESTIÓN comercial,
        // no mover plata: aplica a cajeros dependientes e independientes por igual.
        permissionCodes: [
          'users.view_any', 'users.create', 'users.edit', 'users.ban',
          'users.reset_password',
          'wallet.view_any',
          'deposits.view',
          'withdrawals.view',
          'bonuses.view', 'bonuses.grant_manual', 'bonuses.cancel',
          'referrals.view_own',
        ],
      },
      // Empleado y usuario_final: sin defaults (a la carta / self-scoped).
    ];
    for (const { roleCode, permissionCodes } of DEFAULT_ROLE_PERMISSIONS) {
      const roleRow = await db
        .select()
        .from(roles)
        .where(eq(roles.code, roleCode))
        .limit(1);
      const role = roleRow[0];
      if (!role) continue;
      await db
        .insert(rolePermissions)
        .values(
          permissionCodes.map((code) => ({
            roleId: role.id,
            permissionCode: code,
          })),
        )
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

    // 6.5. Crear la cuenta de SISTEMA "Casa" / tesorería (Parte B). Es la única
    //      fuente de fichas y la contraparte de todo. NO humana: is_system,
    //      sin roles, password aleatoria no usable. Idempotente por username.
    //      Su wallet arranca en 0; el capital inicial se aporta en B-build-3.
    //      Ver docs/16-tesoreria.md.
    const housePasswordHash = await hashPassword(randomBytes(32).toString('hex'));
    const houseUpserted = await db
      .insert(users)
      .values({
        username: HOUSE_USERNAME,
        displayName: 'Casa / Tesorería',
        passwordHash: housePasswordHash,
        status: 'active',
        isSystem: true,
      })
      .onConflictDoUpdate({
        target: users.username,
        set: {
          isSystem: true,
          displayName: 'Casa / Tesorería',
          updatedAt: new Date(),
        },
      })
      .returning();
    const houseUser = houseUpserted[0];
    if (houseUser) {
      await db
        .insert(wallets)
        .values({ userId: houseUser.id, balance: '0', lockedBalance: '0' })
        .onConflictDoNothing({ target: wallets.userId });
    }

    // 7. Seed del catálogo de juegos mock (Sprint 34). Idempotente:
    //    onConflictDoNothing por code — si el admin ya tunó algún juego
    //    (e.g. lo archivó o cambió config), NO lo pisa.
    await db
      .insert(games)
      .values(DEMO_GAMES)
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
