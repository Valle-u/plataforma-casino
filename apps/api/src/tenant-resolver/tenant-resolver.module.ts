/**
 * TenantResolverModule — provee el middleware + cache de conexiones.
 *
 * Es @Global porque el cache de conexiones se comparte entre todos los modules
 * que necesitan acceso al tenant context.
 */

import { Global, Module } from '@nestjs/common';
import { TenantConnectionCache } from './tenant-connection-cache';
import { TenantResolverMiddleware } from './tenant-resolver.middleware';

@Global()
@Module({
  providers: [TenantConnectionCache, TenantResolverMiddleware],
  exports: [TenantConnectionCache, TenantResolverMiddleware],
})
export class TenantResolverModule {}
