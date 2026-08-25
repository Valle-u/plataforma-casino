/**
 * Punto de entrada principal del package @casino/db.
 *
 * Re-exporta todo lo público para que apps/api pueda hacer:
 *   import { createControlDb, tenants, tenantPlans } from '@casino/db';
 *
 * Para imports más específicos están los sub-exports:
 *   import { tenants } from '@casino/db/control';
 *   import { createControlDb } from '@casino/db/client';
 *   import { generateUuidV7 } from '@casino/db/utils';
 */

export * from './client';
export * from './control';
export * from './tenant';
export * from './utils';
export * from './provisioning';
export * from './migrate-tenant';
export * from './migrate-all';
export * from './migrations-paths';
export * from './seeds/tenant-seed';
