/**
 * PermissionsGuard — valida que el user tenga los permisos exigidos por el endpoint.
 *
 * Pre-requisito: debe correr DESPUÉS de TenantJwtGuard, que carga
 *   - request.tenantContext (con db del tenant)
 *   - request.tenantUser (id del user autenticado)
 *
 * Uso:
 *   @UseGuards(TenantJwtGuard, PermissionsGuard)
 *   @RequirePermissions('users.view_any')
 *   @Get()
 *   listUsers() { ... }
 *
 * Si el user no tiene los permisos → 403 Forbidden con mensaje específico.
 * Si el endpoint no usa @RequirePermissions → pasa libre.
 */

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RequestWithTenantUser } from '../tenant-auth/guards/tenant-jwt.guard';
import { EffectivePermissionsService } from './effective-permissions.service';
import { REQUIRED_PERMISSIONS_KEY } from './require-permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly effectivePermissions: EffectivePermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1. Leer permisos requeridos del metadata.
    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      REQUIRED_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required || required.length === 0) {
      // Endpoint sin @RequirePermissions → no requiere permiso específico.
      return true;
    }

    // 2. Obtener tenantContext + tenantUser del request (puestos por TenantJwtGuard).
    const request = context.switchToHttp().getRequest<RequestWithTenantUser>();

    if (!request.tenantContext || !request.tenantUser) {
      // Esto no debería pasar si TenantJwtGuard corrió antes.
      this.logger.error(
        'PermissionsGuard: tenantContext o tenantUser ausentes. ¿Falta TenantJwtGuard antes?',
      );
      throw new ForbiddenException('Estado de autenticación inválido.');
    }

    // 3. Calcular permisos efectivos del user.
    const effective = await this.effectivePermissions.calculateForUser(
      request.tenantContext.db,
      request.tenantUser.id,
    );

    // 4. Verificar que tenga TODOS los requeridos.
    const missing = required.filter((perm) => !effective.has(perm));

    if (missing.length > 0) {
      this.logger.warn(
        `User ${request.tenantUser.username} (id=${request.tenantUser.id}) faltan permisos: ${missing.join(', ')}`,
      );
      throw new ForbiddenException(
        `Faltan permisos: ${missing.join(', ')}.`,
      );
    }

    return true;
  }
}
