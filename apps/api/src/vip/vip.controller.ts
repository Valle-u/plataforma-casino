/**
 * VipController — Sprint 52.3.
 *
 * Endpoints player-facing del VIP system.
 *
 *   GET /tenant/vip/tiers   catálogo público de tiers (display).
 *   GET /tenant/vip/me      mi tier actual + progress + perks.
 *
 * Sin permission especial — cualquier user logueado consume su propio.
 */

import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import { VipService } from './vip.service';

@Controller('tenant/vip')
@UseGuards(TenantJwtGuard)
export class VipController {
  constructor(private readonly service: VipService) {}

  @Get('tiers')
  async listTiers(@Req() req: RequestWithTenantContext) {
    const db = req.tenantContext!.db;
    const data = await this.service.listTiers(db);
    return { data };
  }

  @Get('me')
  async getMine(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
  ) {
    const db = req.tenantContext!.db;
    return this.service.getMyStatus(db, actor.id);
  }
}
