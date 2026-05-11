/**
 * TenantAuthController — endpoints de auth para usuarios DENTRO de un tenant.
 *
 * Todos requieren TenantContext (resuelto por TenantResolverMiddleware del Host).
 *
 * Endpoints:
 *   POST /tenant/auth/login    — username + password → access + refresh
 *   POST /tenant/auth/refresh  — rota refresh
 *   POST /tenant/auth/logout   — revoca sesión
 *   GET  /tenant/auth/me       — info del user actual (requiere JWT)
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { TenantLoginDto } from './dto/tenant-login.dto';
import { TenantRefreshDto } from './dto/tenant-refresh.dto';
import { TenantLogoutDto } from './dto/tenant-logout.dto';
import {
  TenantAuthService,
  type SessionContext,
  type TenantAuthResult,
} from './tenant-auth.service';
import { TenantJwtGuard } from './guards/tenant-jwt.guard';
import { CurrentTenantUser } from './decorators/current-tenant-user.decorator';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';

@Controller('tenant/auth')
export class TenantAuthController {
  constructor(private readonly authService: TenantAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: TenantLoginDto,
    @Req() req: RequestWithTenantContext,
  ): Promise<TenantAuthResult> {
    const ctx = this.requireTenantContext(req);
    return this.authService.login(
      ctx.db,
      ctx.tenant.id,
      dto.username,
      dto.password,
      this.extractContext(req),
    );
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body() dto: TenantRefreshDto,
    @Req() req: RequestWithTenantContext,
  ): Promise<TenantAuthResult> {
    const ctx = this.requireTenantContext(req);
    return this.authService.refresh(
      ctx.db,
      ctx.tenant.id,
      dto.refreshToken,
      this.extractContext(req),
    );
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Body() dto: TenantLogoutDto,
    @Req() req: RequestWithTenantContext,
  ): Promise<void> {
    const ctx = this.requireTenantContext(req);
    await this.authService.logout(ctx.db, dto.refreshToken);
  }

  /**
   * GET /tenant/auth/me
   * Devuelve datos del user autenticado.
   * Requiere TenantJwtGuard (que a su vez requiere TenantContext).
   */
  @Get('me')
  @UseGuards(TenantJwtGuard)
  me(
    @CurrentTenantUser()
    user: { id: string; username: string; email: string | null; displayName: string },
    @Req() req: RequestWithTenantContext,
  ): Record<string, unknown> {
    return {
      user,
      tenant: req.tenantContext
        ? {
            id: req.tenantContext.tenant.id,
            slug: req.tenantContext.tenant.slug,
            name: req.tenantContext.tenant.name,
          }
        : null,
    };
  }

  private requireTenantContext(
    req: RequestWithTenantContext,
  ): NonNullable<RequestWithTenantContext['tenantContext']> {
    if (!req.tenantContext) {
      throw new NotFoundException(
        'No se encontró tenant para este Host. Verificá tenant_domains.',
      );
    }
    return req.tenantContext;
  }

  private extractContext(req: Request): SessionContext {
    return {
      userAgent: req.header('user-agent') ?? undefined,
      ip: req.ip ?? undefined,
    };
  }
}
