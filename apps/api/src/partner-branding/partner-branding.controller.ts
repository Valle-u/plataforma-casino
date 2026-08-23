/**
 * PartnerBrandingController — el socio independiente edita SU diseño.
 *
 *   GET /tenant/partner-branding/me → mi diseño (config o null).
 *   PUT /tenant/partner-branding/me → guarda mi diseño.
 *
 * Requiere sesión de panel (TenantJwtGuard + @PanelOnly). El chequeo de "es
 * socio independiente" lo hace el service (403 si no lo es).
 */

import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { IsObject } from 'class-validator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import { PanelOnly } from '../tenant-auth/panel-only.decorator';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import { PartnerBrandingService } from './partner-branding.service';

class SavePartnerBrandingDto {
  /** El diseño completo (misma forma que design.config del tenant). */
  @IsObject()
  config!: Record<string, unknown>;
}

@Controller('tenant/partner-branding')
@UseGuards(TenantJwtGuard)
@PanelOnly()
export class PartnerBrandingController {
  constructor(private readonly service: PartnerBrandingService) {}

  @Get('me')
  async getMine(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
  ): Promise<{ config: Record<string, unknown> | null }> {
    return { config: await this.service.getMine(req.tenantContext!.db, actor.id) };
  }

  @Put('me')
  async saveMine(
    @Body() dto: SavePartnerBrandingDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
  ): Promise<{ ok: true }> {
    await this.service.saveMine(req.tenantContext!.db, actor.id, dto.config);
    return { ok: true };
  }
}
