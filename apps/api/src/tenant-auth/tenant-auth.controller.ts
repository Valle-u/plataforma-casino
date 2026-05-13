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
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { extractRequestContext } from '../request-context/request-context';
import { AuditLogService } from '../audit/audit-log.service';
import { TenantLoginDto } from './dto/tenant-login.dto';
import { TenantRefreshDto } from './dto/tenant-refresh.dto';
import { TenantLogoutDto } from './dto/tenant-logout.dto';
import { TwoFaCodeDto } from './dto/two-fa.dto';
import {
  TenantAuthService,
  type SessionContext,
  type TenantAuthResult,
} from './tenant-auth.service';
import { TenantJwtGuard } from './guards/tenant-jwt.guard';
import { CurrentTenantUser } from './decorators/current-tenant-user.decorator';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import {
  TwoFaAlreadyEnabledError,
  TwoFaCodeInvalidError,
  TwoFaNotInitializedError,
} from './two-fa.errors';
import { TwoFaService } from './two-fa.service';

@Controller('tenant/auth')
export class TenantAuthController {
  constructor(
    private readonly authService: TenantAuthService,
    private readonly twoFa: TwoFaService,
    private readonly audit: AuditLogService,
  ) {}

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
      dto.twoFaCode,
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

  /**
   * POST /tenant/auth/2fa/init
   * Inicia setup de 2FA TOTP para el user logueado. Genera un secret
   * nuevo y devuelve el otpauth:// URL para que el frontend genere QR.
   * Tras escanear, el user debe llamar /2fa/confirm con un código.
   *
   * 409 si el user ya tiene 2FA activo (debe disable primero).
   */
  @Post('2fa/init')
  @UseGuards(TenantJwtGuard)
  @HttpCode(HttpStatus.OK)
  async initTwoFa(
    @CurrentTenantUser() actor: { id: string; username: string },
    @Req() req: RequestWithTenantContext,
  ): Promise<{ secret: string; otpauthUrl: string }> {
    const ctx = this.requireTenantContext(req);
    try {
      const result = await this.twoFa.initSetup(ctx.db, actor.id, ctx.tenant.slug);
      await this.audit.record(ctx.db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'auth.2fa.init',
        targetType: 'user',
        targetId: actor.id,
        metadata: { severity: 'high' },
        ...extractRequestContext(req),
      });
      return result;
    } catch (err) {
      if (err instanceof TwoFaAlreadyEnabledError) {
        throw new ConflictException({ message: err.message, error: 'TWO_FA_ALREADY_ENABLED' });
      }
      throw err;
    }
  }

  /**
   * POST /tenant/auth/2fa/confirm
   * Confirma el setup con un código de 6 dígitos. Solo después de esto
   * el sistema EXIGE 2FA al user.
   */
  @Post('2fa/confirm')
  @UseGuards(TenantJwtGuard)
  @HttpCode(HttpStatus.OK)
  async confirmTwoFa(
    @Body() dto: TwoFaCodeDto,
    @CurrentTenantUser() actor: { id: string; username: string },
    @Req() req: RequestWithTenantContext,
  ): Promise<{ ok: true }> {
    const ctx = this.requireTenantContext(req);
    try {
      await this.twoFa.confirmSetup(ctx.db, actor.id, dto.code);
    } catch (err) {
      if (err instanceof TwoFaCodeInvalidError) {
        throw new BadRequestException({ message: err.message, error: 'TWO_FA_CODE_INVALID' });
      }
      if (err instanceof TwoFaNotInitializedError) {
        throw new BadRequestException({ message: err.message, error: 'TWO_FA_NOT_INITIALIZED' });
      }
      if (err instanceof TwoFaAlreadyEnabledError) {
        throw new ConflictException({ message: err.message, error: 'TWO_FA_ALREADY_ENABLED' });
      }
      throw err;
    }
    await this.audit.record(ctx.db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'auth.2fa.enabled',
      targetType: 'user',
      targetId: actor.id,
      metadata: { severity: 'high' },
      ...extractRequestContext(req),
    });
    return { ok: true };
  }

  /**
   * DELETE /tenant/auth/2fa
   * Desactiva 2FA. Body con código actual para evitar que un atacante
   * con sesión robada lo apague.
   */
  @Delete('2fa')
  @UseGuards(TenantJwtGuard)
  @HttpCode(HttpStatus.OK)
  async disableTwoFa(
    @Body() dto: TwoFaCodeDto,
    @CurrentTenantUser() actor: { id: string; username: string },
    @Req() req: RequestWithTenantContext,
  ): Promise<{ ok: true }> {
    const ctx = this.requireTenantContext(req);
    try {
      await this.twoFa.disable(ctx.db, actor.id, dto.code);
    } catch (err) {
      if (err instanceof TwoFaCodeInvalidError) {
        throw new UnauthorizedException({ message: err.message, error: 'TWO_FA_CODE_INVALID' });
      }
      if (err instanceof TwoFaNotInitializedError) {
        throw new BadRequestException({ message: err.message, error: 'TWO_FA_NOT_INITIALIZED' });
      }
      throw err;
    }
    await this.audit.record(ctx.db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'auth.2fa.disabled',
      targetType: 'user',
      targetId: actor.id,
      metadata: { severity: 'high' },
      ...extractRequestContext(req),
    });
    return { ok: true };
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
