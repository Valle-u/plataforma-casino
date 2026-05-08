/**
 * TenantsController — endpoints HTTP de tenants.
 *
 * Protegido por AdminTokenGuard (header X-Admin-Token requerido) hasta que
 * implementemos auth real con JWT + permisos `platform.*`.
 */

import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminTokenGuard } from '../auth/admin-token.guard';
import { TenantsService, type TenantSummary } from './tenants.service';

@Controller('tenants')
@UseGuards(AdminTokenGuard)
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  /**
   * GET /tenants
   * Lista todos los tenants activos del sistema.
   * Requiere header: X-Admin-Token: <ADMIN_API_TOKEN del .env.local>
   */
  @Get()
  async findAll(): Promise<{ data: TenantSummary[]; count: number }> {
    const data = await this.tenantsService.findAll();
    return { data, count: data.length };
  }
}
