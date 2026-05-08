/**
 * PlatformJwtGuard — protege endpoints que requieren super-admin autenticado.
 *
 * Valida el header `Authorization: Bearer <jwt>`:
 *   1. Lee el header.
 *   2. Verifica firma + expiración con JwtService.
 *   3. Re-consulta la DB para confirmar que el usuario existe y está activo
 *      (permite "banear" mid-session — el siguiente request rechaza).
 *   4. Adjunta el user al request (`req.platformUser`) para que los handlers
 *      puedan accederlo.
 *
 * Si algo falla → 401 Unauthorized con mensaje genérico.
 */

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import {
  PlatformAuthService,
  type PlatformJwtPayload,
} from '../platform-auth.service';

/** Tipado del request con el platformUser adjunto. */
export interface RequestWithPlatformUser extends Request {
  platformUser: {
    id: string;
    email: string;
    displayName: string;
  };
}

@Injectable()
export class PlatformJwtGuard implements CanActivate {
  private readonly logger = new Logger(PlatformJwtGuard.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly authService: PlatformAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithPlatformUser>();

    const authHeader = request.header('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token faltante o formato inválido');
    }

    const token = authHeader.substring('Bearer '.length).trim();
    if (!token) {
      throw new UnauthorizedException('Token vacío');
    }

    let payload: PlatformJwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<PlatformJwtPayload>(token);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown';
      this.logger.warn(`JWT verify failed: ${message}`);
      throw new UnauthorizedException('Token inválido o expirado');
    }

    const user = await this.authService.validateJwtPayload(payload);
    if (!user) {
      throw new UnauthorizedException('Usuario no autorizado');
    }

    request.platformUser = user;
    return true;
  }
}
