/**
 * Barrel del schema de DBs de tenant.
 *
 * Lo que se exporta acá lo lee `drizzle-kit` para generar migraciones
 * (configurado en `drizzle.tenant.config.ts → schema: './src/tenant/index.ts'`).
 *
 * También es lo que `apps/api` importa para queries sobre el tenant DB:
 *   import { users, userSessions } from '@casino/db/tenant';
 *
 * Tablas implementadas en este sprint (auth básica del admin del tenant):
 *   - users
 *   - user_sessions
 *   - roles
 *   - permissions
 *   - role_permissions
 *   - user_roles
 *
 * Próximo sprint (post auth tenant):
 *   - user_permission_overrides (con granted_by_chain para cascada)
 *   - user_hierarchy
 *   - wallets, wallet_transactions, wallet_holds
 *   - payment_methods, deposits, withdrawals
 *   - audit_log
 *   - tenant_settings, branding_settings
 *   - resto del catálogo de docs/04-modelo-datos.md §3
 */

export * from './users';
export * from './user-sessions';
export * from './roles';
export * from './permissions';
export * from './role-permissions';
export * from './user-roles';
export * from './user-permission-overrides';
export * from './audit-log';
export * from './wallets';
export * from './wallet-transactions';
export * from './wallet-holds';
export * from './idempotency-keys';
export * from './payment-methods';
export * from './deposits';
export * from './withdrawals';
export * from './user-hierarchy';
export * from './user-recovery-codes';
export * from './bonus-definitions';
export * from './user-bonuses';
export * from './promotions';
export * from './promotion-rewards';
export * from './promotion-participants';
export * from './leagues';
export * from './league-standings';
export * from './league-results';
export * from './fraud-signals';
export * from './fraud-account-links';
export * from './tenant-settings';
export * from './tenant-settings-history';
export * from './notifications';
export * from './notification-templates';
export * from './commission-rules';
export * from './commission-payouts';
export * from './responsible-gaming-settings';
export * from './self-exclusions';
export * from './games';
export * from './game-sessions';
export * from './game-rounds';
export * from './bank-transactions';
export * from './achievement-definitions';
export * from './user-achievements';
