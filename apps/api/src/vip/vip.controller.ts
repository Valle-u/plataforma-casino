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
  async getMine() {
    // DESHABILITADO temporalmente (2026-07-24): devuelve tier default
    // sin recomputar ni aplicar perks. Ver nota en AGENTS.md.
    return {
      tierCode: null,
      tierLabel: null,
      volume30d: '0',
      progressPct: 0,
      perks: { depositBonusPct: 0, cashbackPct: 0, freeWithdrawalsPerDay: 0 },
    };
  }
}
