/**
 * TenantJwtGuard — protege endpoints que requieren un user del tenant autenticado.
 *
 * Requiere que el TenantResolverMiddleware haya cargado tenantContext.
 *
 * Validaciones (en orden):
 *   1. tenantContext está presente (si no, 404 — host no resuelto).
 *   2. Header Authorization: Bearer <jwt>.
 *   3. JWT firma + expiración OK.
 *   4. JWT.tenantId === tenantContext.tenant.id (CRÍTICO — previene cross-tenant).
 *   5. User existe en tenant DB y está activo.
 *   6. **Policy 2FA**: si el user tiene un rol con `requires_two_fa=true`
 *      pero NO tiene `two_fa_enabled=true`, fallar con 403
 *      TWO_FA_SETUP_REQUIRED — EXCEPTO si el handler lleva
 *      `@AllowWithoutTwoFa()` (endpoints de setup mismo).
 *
 * Nota arquitectura: la policy se integra ACÁ (no como guard separado
 * global) porque NestJS corre los guards globales ANTES que los guards
 * de controller/method. Hacer un guard global requeriría que TenantJwtGuard
 * también fuese global y "soft" (tolerante a falta de JWT) — pattern más
 * confuso que integrar el check post-auth en el mismo guard.
 */

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { RequestWithContext } from '../../request-context/request-context';
import type { RequestWithTenantContext } from '../../tenant-resolver/tenant-context';
import {
  TenantAuthService,
  type TenantJwtPayload,
} from '../tenant-auth.service';
import { ALLOW_WITHOUT_TWO_FA_METADATA } from '../allow-without-two-fa.decorator';
import { TwoFaPolicyService } from '../two-fa-policy.service';
import { PANEL_ONLY_METADATA } from '../panel-only.decorator';
import { PUBLIC_METADATA } from '../public.decorator';
import { userHasPanelAccess } from '../panel-access';
import { TenantUsersService } from '../../tenant-users/tenant-users.service';

/** Request augmentado con info del tenant user autenticado. */
export interface RequestWithTenantUser extends RequestWithTenantContext {
  tenantUser: {
    id: string;
    username: string;
    email: string | null;
    displayName: string;
    /**
     * Sprint 37: si la sesión actual es impersonate, apunta al admin
     * que originó. NULL en sesiones normales. El handler `/me` lo
     * expone para que el frontend muestre el banner persistente.
     */
    impersonatedBy?: string | null;
  };
}

@Injectable()
export class TenantJwtGuard implements CanActivate {
  private readonly logger = new Logger(TenantJwtGuard.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly authService: TenantAuthService,
    private readonly twoFaPolicy: TwoFaPolicyService,
    private readonly reflector: Reflector,
    private readonly tenantUsers: TenantUsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithTenantUser>();

    if (!request.tenantContext) {
      throw new NotFoundException(
        'No se encontró tenant para este Host. Verificá tenant_domains.',
      );
    }
    const { tenant, db } = request.tenantContext;

    // @Public() bypass: skip JWT validation entirely. Tenant context
    // is still resolved by middleware, so req.tenantContext.db is available.
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      PUBLIC_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic === true) {
      return true;
    }

    const authHeader = request.header('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token faltante o formato inválido');
    }

    const token = authHeader.substring('Bearer '.length).trim();
    if (!token) {
      throw new UnauthorizedException('Token vacío');
    }

    let payload: TenantJwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<TenantJwtPayload>(token);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown';
      this.logger.warn(`JWT verify failed: ${message}`);
      throw new UnauthorizedException('Token inválido o expirado');
    }

    const user = await this.authService.validateJwtPayload(db, tenant.id, payload);
    if (!user) {
      throw new UnauthorizedException('Usuario no autorizado');
    }

    // Sprint 37: si el JWT trae impersonatedBy, lo propagamos al
    // tenantUser para que /me lo exponga + audit lo trace.
    request.tenantUser = {
      ...user,
      impersonatedBy: payload.impersonatedBy ?? null,
    };

    // Propagar el session_id del JWT al requestContext para que audit lo
    // capture. Si el JWT es viejo (sin sid), queda undefined → audit lo
    // guarda NULL.
    if (payload.sid) {
      const ctx = (request as RequestWithContext).requestContext;
      if (ctx) ctx.sessionId = payload.sid;
    }
    // Propagar impersonatorId al requestContext para que cada audit
    // entry lo guarde automático.
    if (payload.impersonatedBy) {
      const ctx = (request as RequestWithContext).requestContext;
      if (ctx) ctx.impersonatorId = payload.impersonatedBy;
    }

    // 6.0. Sprint 43 (security): si el endpoint tiene @PanelOnly(),
    // exigir que el user tenga rol con panel access. Defense-in-depth
    // sobre el check del login (un JWT viejo emitido antes del fix, o
    // un cliente que llamó con audience='player' por error, no debe
    // poder pegar a endpoints admin).
    const requiresPanel = this.reflector.getAllAndOverride<boolean | undefined>(
      PANEL_ONLY_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (requiresPanel === true) {
      const roleRows = await this.tenantUsers.getRoles(db, user.id);
      const codes = roleRows.map((r) => r.code);
      if (!userHasPanelAccess(codes)) {
        this.logger.warn(
          `[panel-access] DENY tenant=${tenant.slug} user=${user.username} roles=[${codes.join(',')}] path=${request.originalUrl ?? request.url}`,
        );
        throw new ForbiddenException({
          statusCode: HttpStatus.FORBIDDEN,
          message: 'Esta operación requiere una cuenta con acceso al panel.',
          error: 'NOT_PANEL_USER',
        });
      }
    }

    // 6. Policy 2FA. Bypass si el handler tiene @AllowWithoutTwoFa().
    if (this.twoFaPolicy.isEnabled()) {
      const allow = this.reflector.getAllAndOverride<boolean | undefined>(
        ALLOW_WITHOUT_TWO_FA_METADATA,
        [context.getHandler(), context.getClass()],
      );
      if (allow !== true) {
        const policyResult = await this.twoFaPolicy.check(db, user.id);
        if (!policyResult.ok) {
          throw new ForbiddenException({
            statusCode: HttpStatus.FORBIDDEN,
            message:
              'Tu rol requiere 2FA habilitado. Configurá 2FA antes de continuar.',
            error: policyResult.reason ?? 'TWO_FA_SETUP_REQUIRED',
          });
        }
      }
    }

    return true;
  }
}
