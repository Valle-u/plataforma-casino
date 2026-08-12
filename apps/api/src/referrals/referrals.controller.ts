/**
 * ReferralsController — endpoints de links de referido por operador.
 *
 * Endpoints protegidos (requieren JWT panel + permisos):
 *   GET /tenant/referrals/my-code            — código + link del operador
 *   GET /tenant/referrals/my-stats           — clicks + registros (90d)
 *   GET /tenant/referrals/my-metrics         — time-series clicks + signups
 *   GET /tenant/referrals/my-referred-users  — lista paginada de referidos
 *
 * Endpoints públicos (sin auth):
 *   GET /tenant/referrals/resolve/:code      — lookup de código para landing
 *   POST /tenant/referrals/track-click/:code — registrar click
 *
 * Leyes aplicables: R3 (marketing), P1 (scope), P4 (multi-tenant).
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { RequirePermissions } from '../permissions/require-permissions.decorator';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import { PanelOnly } from '../tenant-auth/panel-only.decorator';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import { CreateReferralCodeDto } from './dto/create-referral-code.dto';
import { UpdateReferralCodeDto } from './dto/update-referral-code.dto';
import {
  ReferralsService,
  type MyReferralCodesResult,
  type ReferralCodeInfo,
  type ReferralCodeListItem,
  type ReferralMetricsResult,
  type ReferralMyStats,
  type ReferralResolveResult,
  type ReferredUsersResult,
} from './referrals.service';

@Controller('tenant/referrals')
export class ReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  // ── Protected endpoints (panel) ────────────────────────────────────

  @Get('my-code')
  @UseGuards(TenantJwtGuard, PermissionsGuard)
  @PanelOnly()
  @RequirePermissions('referrals.view_own')
  async getMyCode(
    @CurrentTenantUser() actor: { id: string },
    @Req() req: RequestWithTenantContext,
  ): Promise<ReferralCodeInfo> {
    const db = req.tenantContext!.db;
    return this.referrals.getOrCreateCode(db, actor.id);
  }

  @Get('my-stats')
  @UseGuards(TenantJwtGuard, PermissionsGuard)
  @PanelOnly()
  @RequirePermissions('referrals.view_own')
  async getMyStats(
    @CurrentTenantUser() actor: { id: string },
    @Req() req: RequestWithTenantContext,
  ): Promise<ReferralMyStats> {
    const db = req.tenantContext!.db;
    return this.referrals.getMyStats(db, actor.id);
  }

  @Get('my-metrics')
  @UseGuards(TenantJwtGuard, PermissionsGuard)
  @PanelOnly()
  @RequirePermissions('referrals.view_own')
  async getMyMetrics(
    @CurrentTenantUser() actor: { id: string },
    @Query('days') daysQuery: string | undefined,
    @Query('code') code: string | undefined,
    @Req() req: RequestWithTenantContext,
  ): Promise<ReferralMetricsResult> {
    const db = req.tenantContext!.db;
    const days = Math.min(Math.max(parseInt(daysQuery ?? '30', 10) || 30, 1), 365);
    const codeFilter = code?.trim() || undefined;
    return this.referrals.getMyMetrics(db, actor.id, days, codeFilter);
  }

  @Get('my-referred-users')
  @UseGuards(TenantJwtGuard, PermissionsGuard)
  @PanelOnly()
  @RequirePermissions('referrals.view_own')
  async getReferredUsers(
    @CurrentTenantUser() actor: { id: string },
    @Query('page') pageQuery: string | undefined,
    @Query('limit') limitQuery: string | undefined,
    @Query('code') code: string | undefined,
    @Req() req: RequestWithTenantContext,
  ): Promise<ReferredUsersResult> {
    const db = req.tenantContext!.db;
    const page = Math.max(parseInt(pageQuery ?? '1', 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(limitQuery ?? '20', 10) || 20, 1), 100);
    const codeFilter = code?.trim() || undefined;
    return this.referrals.getReferredUsers(db, actor.id, page, limit, codeFilter);
  }

  // ── Campañas (CRUD, panel) ─────────────────────────────────────────

  @Get('my-codes')
  @UseGuards(TenantJwtGuard, PermissionsGuard)
  @PanelOnly()
  @RequirePermissions('referrals.view_own')
  async getMyCodes(
    @CurrentTenantUser() actor: { id: string },
    @Req() req: RequestWithTenantContext,
  ): Promise<MyReferralCodesResult> {
    const db = req.tenantContext!.db;
    return this.referrals.listMyCodes(db, actor.id);
  }

  @Post('codes')
  @UseGuards(TenantJwtGuard, PermissionsGuard)
  @PanelOnly()
  @RequirePermissions('referrals.view_own')
  async createCode(
    @CurrentTenantUser() actor: { id: string },
    @Body() dto: CreateReferralCodeDto,
    @Req() req: RequestWithTenantContext,
  ): Promise<ReferralCodeListItem> {
    const db = req.tenantContext!.db;
    return this.referrals.createCampaignCode(db, actor.id, dto.label);
  }

  @Patch('codes/:id')
  @UseGuards(TenantJwtGuard, PermissionsGuard)
  @PanelOnly()
  @RequirePermissions('referrals.view_own')
  async updateCode(
    @CurrentTenantUser() actor: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdateReferralCodeDto,
    @Req() req: RequestWithTenantContext,
  ): Promise<ReferralCodeListItem> {
    const db = req.tenantContext!.db;
    return this.referrals.updateCampaignCode(db, actor.id, id, {
      label: dto.label,
      isActive: dto.isActive,
    });
  }

  // ── Public endpoints (sin auth) ────────────────────────────────────

  @Get('resolve/:code')
  async resolveCode(
    @Param('code') code: string,
    @Req() req: RequestWithTenantContext,
  ): Promise<ReferralResolveResult> {
    const db = req.tenantContext!.db;
    return this.referrals.resolveCode(db, code);
  }

  @Post('track-click/:code')
  @HttpCode(HttpStatus.NO_CONTENT)
  async trackClick(
    @Param('code') code: string,
    @Req() req: RequestWithTenantContext,
  ): Promise<void> {
    const db = req.tenantContext!.db;
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      req.ip ??
      null;
    const userAgent = req.headers['user-agent'] ?? null;
    const referer = req.headers['referer'] ?? null;

    await this.referrals.trackClick(db, code, ip, userAgent, referer);
  }
}
