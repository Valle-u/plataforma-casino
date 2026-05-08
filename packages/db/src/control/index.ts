/**
 * Barrel del schema de la DB de control.
 *
 * Lo que se exporta acá es lo que `drizzle-kit` lee para generar migraciones
 * (configurado en drizzle.control.config.ts → schema: './src/control/index.ts').
 *
 * También es lo que apps/api importa para hacer queries:
 *   import { tenants, tenantPlans } from '@casino/db/control';
 */

export * from './tenant-plans';
export * from './tenants';
export * from './tenant-domains';
export * from './platform-users';
