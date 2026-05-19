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
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { RequirePermissions } from '../permissions/require-permissions.decorator';
import type { Request } from 'express';
import { extractRequestContext } from '../request-context/request-context';
import { AuditLogService } from '../audit/audit-log.service';
import { LoginStreakService } from '../promotions/login-streak.service';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import { RateLimiterService } from '../rate-limit/rate-limiter.service';
import { AllowWithoutTwoFa } from './allow-without-two-fa.decorator';
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
    private readonly limiter: RateLimiterService,
    private readonly loginStreak: LoginStreakService,
  ) {}

  /**
   * Login con rate-limit por (ip+username):
   *   - 10 intentos por 15 min. Si un atacante intenta brute-force a un
   *     username desde una IP, queda bloqueado tras 10. Si rota usernames
   *     evita el lock por user pero queda detectable a nivel ip.
   *   - El campo se normaliza (lowercase+trim) para que `Foo ` y `foo`
   *     compartan contador.
   */
  @Post('login')
  @UseGuards(RateLimitGuard)
  @RateLimit({
    rule: 'auth.login',
    limit: 10,
    windowSec: 15 * 60,
    scope: 'ip+body.username',
  })
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: TenantLoginDto,
    @Req() req: RequestWithTenantContext & { rateLimitKey?: string },
  ): Promise<TenantAuthResult> {
    const ctx = this.requireTenantContext(req);
    const result = await this.authService.login(
      ctx.db,
      ctx.tenant.id,
      dto.username,
      dto.password,
      this.extractContext(req),
      dto.twoFaCode,
      dto.recoveryCode,
    );
    // Reset-on-success: si el usuario logró autenticarse (incluyendo 2FA),
    // borramos el contador de intentos. Un legítimo que tipeó mal 3 veces
    // y entró en la 4ta NO queda bloqueado por las próximas N. El attacker
    // por definición no llega acá (no completa el flow).
    if (req.rateLimitKey) {
      this.limiter.reset(req.rateLimitKey);
    }

    // Hook fail-soft: dispara claim de cualquier login_streak activa
    // con `config.autoClaimOnLogin = true`. No esperamos el resultado
    // — el login retorna inmediatamente; el streak se procesa en
    // background.  Si falla, log warning, login sigue OK.
    void this.loginStreak
      .autoClaimOnLogin(ctx.db, result.user.id)
      .catch((err: unknown) => {
        // Best-effort. No tiramos.
        // eslint-disable-next-line no-console
        console.warn(
          `[autoClaimOnLogin] tenant=${ctx.tenant.slug} user=${result.user.id} error=${(err as Error).message}`,
        );
      });

    return result;
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
  @AllowWithoutTwoFa()
  me(
    @CurrentTenantUser()
    user: {
      id: string;
      username: string;
      email: string | null;
      displayName: string;
      impersonatedBy?: string | null;
    },
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
   * POST /tenant/auth/impersonate/:userId
   *
   * Sprint 37: admin emite un par de tokens "como" otro user. Validaciones
   * en el service (target existe + active, actor != target). Permission
   * `users.impersonate` chequeado via guard. Audit severity:high.
   *
   * El frontend debe guardar el token original en sessionStorage ANTES de
   * llamar este endpoint, para poder restaurarlo con "Volver a mi cuenta".
   * Si el frontend olvida guardar, el admin tiene que re-loguearse.
   */
  @Post('impersonate/:userId')
  @UseGuards(TenantJwtGuard, PermissionsGuard)
  @RequirePermissions('users.impersonate')
  @HttpCode(HttpStatus.OK)
  async impersonate(
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @CurrentTenantUser() actor: { id: string; username: string },
    @Req() req: RequestWithTenantContext,
  ): Promise<TenantAuthResult> {
    if (!req.tenantContext) {
      throw new NotFoundException('Tenant no resuelto.');
    }
    const ctx = extractRequestContext(req);
    const result = await this.authService.impersonate(
      req.tenantContext.db,
      req.tenantContext.tenant.id,
      actor.id,
      targetUserId,
      { userAgent: ctx.userAgent ?? undefined, ip: ctx.ip ?? undefined },
    );
    await this.audit.record(req.tenantContext.db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'users.impersonate.start',
      targetType: 'user',
      targetId: targetUserId,
      metadata: { severity: 'high', targetUsername: result.user.username },
      ...ctx,
    });
    return result;
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
  @AllowWithoutTwoFa()
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
   *
   * Devuelve 10 recovery codes — el frontend DEBE mostrarlos al user en
   * este punto (UNA sola vez). Si el user los pierde y pierde su app TOTP,
   * solo soporte puede recuperarlo.
   */
  @Post('2fa/confirm')
  // Orden importa: TenantJwtGuard primero para que `req.tenantUser` esté
  // populado cuando RateLimitGuard arma la clave con scope 'user'.
  @UseGuards(TenantJwtGuard, RateLimitGuard)
  @AllowWithoutTwoFa()
  @RateLimit({
    rule: 'auth.2fa.confirm',
    limit: 10,
    windowSec: 15 * 60,
    scope: 'user',
  })
  @HttpCode(HttpStatus.OK)
  async confirmTwoFa(
    @Body() dto: TwoFaCodeDto,
    @CurrentTenantUser() actor: { id: string; username: string },
    @Req() req: RequestWithTenantContext & { rateLimitKey?: string },
  ): Promise<{ ok: true; recoveryCodes: string[] }> {
    const ctx = this.requireTenantContext(req);
    let result: { recoveryCodes: string[] };
    try {
      result = await this.twoFa.confirmSetup(ctx.db, actor.id, dto.code);
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
    // Reset-on-success: el user legítimo no debe quedar bloqueado por
    // intentos de typo previos.
    if (req.rateLimitKey) this.limiter.reset(req.rateLimitKey);
    await this.audit.record(ctx.db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'auth.2fa.enabled',
      targetType: 'user',
      targetId: actor.id,
      metadata: { severity: 'high', recoveryCodesIssued: result.recoveryCodes.length },
      ...extractRequestContext(req),
    });
    return { ok: true, recoveryCodes: result.recoveryCodes };
  }

  /**
   * POST /tenant/auth/2fa/recovery-codes/regenerate
   * Genera un batch nuevo de recovery codes, invalidando los anteriores.
   * Requiere TOTP fresco (defensa anti-sesión robada).
   */
  @Post('2fa/recovery-codes/regenerate')
  @UseGuards(TenantJwtGuard, RateLimitGuard)
  @RateLimit({
    rule: 'auth.2fa.recovery_regen',
    limit: 5,
    windowSec: 60 * 60,
    scope: 'user',
  })
  @HttpCode(HttpStatus.OK)
  async regenerateRecoveryCodes(
    @Body() dto: TwoFaCodeDto,
    @CurrentTenantUser() actor: { id: string; username: string },
    @Req() req: RequestWithTenantContext & { rateLimitKey?: string },
  ): Promise<{ ok: true; recoveryCodes: string[] }> {
    const ctx = this.requireTenantContext(req);
    let result: { recoveryCodes: string[] };
    try {
      result = await this.twoFa.regenerateRecoveryCodes(ctx.db, actor.id, dto.code);
    } catch (err) {
      if (err instanceof TwoFaCodeInvalidError) {
        throw new BadRequestException({ message: err.message, error: 'TWO_FA_CODE_INVALID' });
      }
      if (err instanceof TwoFaNotInitializedError) {
        throw new BadRequestException({ message: err.message, error: 'TWO_FA_NOT_INITIALIZED' });
      }
      throw err;
    }
    if (req.rateLimitKey) this.limiter.reset(req.rateLimitKey);
    await this.audit.record(ctx.db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'auth.2fa.recovery_codes.regenerated',
      targetType: 'user',
      targetId: actor.id,
      metadata: { severity: 'high', count: result.recoveryCodes.length },
      ...extractRequestContext(req),
    });
    return { ok: true, recoveryCodes: result.recoveryCodes };
  }

  /**
   * GET /tenant/auth/2fa/recovery-codes/count
   * Cantidad de recovery codes vigentes (no usados). El frontend lo
   * muestra para que el user sepa cuántos backups le quedan.
   */
  @Get('2fa/recovery-codes/count')
  @UseGuards(TenantJwtGuard)
  @AllowWithoutTwoFa()
  @HttpCode(HttpStatus.OK)
  async countRecoveryCodes(
    @CurrentTenantUser() actor: { id: string },
    @Req() req: RequestWithTenantContext,
  ): Promise<{ active: number }> {
    const ctx = this.requireTenantContext(req);
    const active = await this.twoFa.countActiveRecoveryCodes(ctx.db, actor.id);
    return { active };
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
