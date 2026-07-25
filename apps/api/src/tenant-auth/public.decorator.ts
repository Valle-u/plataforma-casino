import { SetMetadata } from '@nestjs/common';

/**
 * @Public() — marks an endpoint as publicly accessible (no JWT required).
 *
 * Applied at method or class level. The TenantJwtGuard checks this metadata
 * at the very top of canActivate() and returns true immediately if set.
 *
 * Tenant context is still resolved by middleware before the guard runs,
 * so req.tenantContext.db is available for public queries.
 *
 * Usage:
 *   @Get('active')
 *   @Public()
 *   async listActive(@Req() req: ...) { ... }
 */
export const PUBLIC_METADATA = 'is-public';

export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(PUBLIC_METADATA, true);
