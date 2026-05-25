/**
 * Decorador @CurrentPlatformUser() — extrae el platformUser del request.
 *
 * Uso en controllers protegidos por PlatformJwtGuard:
 *
 *   @UseGuards(PlatformJwtGuard)
 *   @Get('me')
 *   getMe(@CurrentPlatformUser() user) {
 *     return user;
 *   }
 *
 * Es azúcar sintáctico para evitar acceder al request crudo.
 */

import type { ExecutionContext } from '@nestjs/common';
import { createParamDecorator } from '@nestjs/common';
import type { RequestWithPlatformUser } from '../guards/platform-jwt.guard';

export const CurrentPlatformUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<RequestWithPlatformUser>();
    return request.platformUser;
  },
);
