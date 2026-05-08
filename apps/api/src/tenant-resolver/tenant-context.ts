/**
 * Tipos compartidos del TenantContext.
 *
 * Cuando el TenantResolverMiddleware identifica el tenant del request, adjunta
 * un objeto `tenantContext` al `Request` de Express. Cualquier handler downstream
 * puede leerlo desde ahí.
 */

import type { Request } from 'express';
import type { Tenant } from '@casino/db';
import type { drizzle } from 'drizzle-orm/postgres-js';

/** Cliente Drizzle apuntando a la DB del tenant. */
export type TenantDb = ReturnType<typeof drizzle>;

export interface TenantContext {
  tenant: Tenant;
  db: TenantDb;
}

/**
 * Request augmentado con `tenantContext`. Si el middleware no pudo resolver
 * un tenant para el host del request, queda undefined.
 */
export interface RequestWithTenantContext extends Request {
  tenantContext?: TenantContext;
}
