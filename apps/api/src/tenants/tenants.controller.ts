/**
 * TenantsController — endpoints HTTP de tenants.
 *
 * Protegido por AdminTokenGuard (header X-Admin-Token requerido) hasta que
 * implementemos auth real con JWT + permisos `platform.*`.
 */

import { Controller, Get, UseGuards } from '@nestjs/common';
import { PlatformJwtGuard } from '../platform-auth/guards/platform-jwt.guard';
import { CurrentPlatformUser } from '../platform-auth/decorators/current-platform-user.decorator';
import { TenantsService, type TenantSummary } from './tenants.service';

@Controller('tenants')
@UseGuards(PlatformJwtGuard)
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  /**
   * GET /tenants
   * Lista todos los tenants activos del sistema.
   * Requiere: header `Authorization: Bearer <jwt>` con un token de platform user activo.
   */
  @Get()
  async findAll(
    @CurrentPlatformUser() user: { id: string; email: string },
  ): Promise<{ data: TenantSummary[]; count: number; requestedBy: string }> {
    const data = await this.tenantsService.findAll();
    return {
      data,
      count: data.length,
      requestedBy: user.email,
    };
  }
}
