/**
 * Barrel del schema de DBs de tenant.
 *
 * En este sprint todavía no implementamos schemas de tenant — se hacen
 * en un sprint posterior siguiendo docs/04-modelo-datos.md §3.
 *
 * Este archivo existe como placeholder para que drizzle.tenant.config.ts
 * tenga un schema válido al que apuntar.
 *
 * Próximas tablas a implementar (orden tentativo):
 *   1. users, roles, permissions, role_permissions, user_roles, user_permission_overrides, user_hierarchy
 *   2. wallets, wallet_transactions (particionada), wallet_holds
 *   3. payment_methods, deposits, withdrawals
 *   4. game_providers, games, game_sessions, game_rounds
 *   5. audit_log
 *   6. branding_settings, tenant_settings
 *   7. (resto: bonuses, promotions, leagues, referrals, kyc, etc.)
 */

// Placeholder — sin tablas aún. drizzle-kit no genera nada para tenant en este sprint.
export {};
