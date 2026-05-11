/**
 * @CurrentTenantUser() — extrae el tenantUser autenticado del request.
 * Usar en handlers protegidos por TenantJwtGuard.
 */

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { RequestWithTenantUser } from '../guards/tenant-jwt.guard';

export const CurrentTenantUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<RequestWithTenantUser>();
    return request.tenantUser;
  },
);
