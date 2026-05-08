/**
 * AdminTokenGuard — guard simple para proteger endpoints administrativos
 * antes de tener auth real (que llega en Fase 1.5+).
 *
 * Funcionamiento:
 *   - Lee `X-Admin-Token` del header del request.
 *   - Compara contra `ADMIN_API_TOKEN` del .env.local.
 *   - Si match → permite. Si no → 401.
 *
 * NO es auth real. Es un cinturón mientras se implementa JWT + roles.
 * Ver `docs/12-seguridad-compliance.md §3` para el plan de auth final.
 */

import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

@Injectable()
export class AdminTokenGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.header('x-admin-token');

    const expected = this.config.get<string>('ADMIN_API_TOKEN');
    if (!expected) {
      // Si el server no tiene token configurado, asumimos que el endpoint está
      // bloqueado (fail-closed). Mejor 401 que dejar todo abierto por error.
      throw new UnauthorizedException('ADMIN_API_TOKEN no configurado en el server.');
    }

    if (!provided || provided !== expected) {
      throw new UnauthorizedException('Header X-Admin-Token inválido o faltante.');
    }

    return true;
  }
}
