/**
 * TenantsController — endpoints de gestión de tenants para super-admins.
 *
 * Todos los endpoints requieren Authorization: Bearer <jwt> de un super-admin
 * activo (vía PlatformJwtGuard).
 *
 * Endpoints:
 *   GET  /tenants            — lista todos los tenants no eliminados.
 *   POST /tenants            — crea un tenant nuevo (incluye provisión de DB).
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { PlatformJwtGuard } from '../platform-auth/guards/platform-jwt.guard';
import { CurrentPlatformUser } from '../platform-auth/decorators/current-platform-user.decorator';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { TenantsService, type TenantSummary } from './tenants.service';
import type { Tenant } from '@casino/db';

@Controller('tenants')
@UseGuards(PlatformJwtGuard)
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  /**
   * GET /tenants
   * Lista todos los tenants activos (incluye onboarding y suspendidos, excluye soft-deleted).
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

  /**
   * POST /tenants
   * Crea un tenant nuevo. Provisiona su DB Postgres y lo deja en status='active'.
   *
   * Body:
   *   { slug, name, planCode, contactEmail, primaryDomain }
   *
   * 201 Created:
   *   { tenant: { id, slug, name, status, ... } }
   * 400: DTO mal armado o plan no existe.
   * 409: slug o dominio ya en uso.
   * 401: sin auth.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateTenantDto,
    @CurrentPlatformUser() user: { id: string; email: string },
  ): Promise<{ tenant: Tenant; createdBy: string }> {
    const tenant = await this.tenantsService.create(dto, user.email);
    return {
      tenant,
      createdBy: user.email,
    };
  }
}
