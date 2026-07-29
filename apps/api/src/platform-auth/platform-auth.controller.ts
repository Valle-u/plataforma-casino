/**
 * PlatformAuthController — endpoints de auth para super-admins.
 *
 * MVP:
 *   POST /platform/auth/login    — recibe email + password, devuelve access + refresh.
 *   POST /platform/auth/refresh  — recibe refresh token, lo rota, devuelve nuevos.
 *   POST /platform/auth/logout   — recibe refresh token, lo revoca.
 *
 * Próximas sesiones:
 *   POST /platform/auth/2fa/...  — flujos TOTP.
 *   POST /platform/auth/logout-all — revoca todas las sesiones del user.
 */

import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { LogoutDto } from './dto/logout.dto';
import {
  PlatformAuthService,
  type AuthResult,
  type SessionContext,
} from './platform-auth.service';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import { RateLimiterService } from '../rate-limit/rate-limiter.service';

@Controller('platform/auth')
export class PlatformAuthController {
  constructor(
    private readonly authService: PlatformAuthService,
    private readonly limiter: RateLimiterService,
  ) {}

  /**
   * POST /platform/auth/login
   *
   * Body: { email, password }
   * 200 OK:
   *   { accessToken, refreshToken, user: { id, email, displayName } }
   * 401: credenciales inválidas / cuenta no disponible.
   * 400: DTO mal armado.
   */
  @Post('login')
  @UseGuards(RateLimitGuard)
  @RateLimit([
    {
      rule: 'platform.login',
      limit: 5,
      windowSec: 15 * 60,
      scope: 'ip+body.email',
    },
    {
      rule: 'platform.login.ip',
      limit: 50,
      windowSec: 15 * 60,
      scope: 'ip',
    },
  ])
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Req() req: Request & { rateLimitKey?: string }): Promise<AuthResult> {
    const result = await this.authService.login(dto.email, dto.password, this.extractContext(req));
    if (req.rateLimitKey) {
      await this.limiter.reset(req.rateLimitKey);
    }
    return result;
  }

  /**
   * POST /platform/auth/refresh
   *
   * Body: { refreshToken }
   * 200 OK: { accessToken, refreshToken, user } — refresh token NUEVO (rotación).
   * 401: token inválido, expirado, o ya revocado.
   *
   * El refresh token recibido queda inutilizable después de esta llamada.
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto, @Req() req: Request): Promise<AuthResult> {
    return this.authService.refresh(dto.refreshToken, this.extractContext(req));
  }

  /**
   * POST /platform/auth/logout
   *
   * Body: { refreshToken }
   * 204 No Content (idempotente — si el token no existe, también devuelve 204).
   *
   * Solo invalida la sesión asociada a este refresh token. Otras sesiones del
   * mismo usuario (otros dispositivos) siguen activas.
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: LogoutDto): Promise<void> {
    await this.authService.logout(dto.refreshToken);
  }

  /**
   * Extrae info de contexto del request para auditoría/antifraude.
   */
  private extractContext(req: Request): SessionContext {
    return {
      userAgent: req.header('user-agent') ?? undefined,
      ip: req.ip ?? undefined,
    };
  }
}
