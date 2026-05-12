/**
 * ScopeGuard — valida que el `targetUserId` del request está dentro de
 * la red del actor (su descendencia activa) o que el actor es el target
 * mismo, o que el actor es admin_tenant (bypass).
 *
 * Política:
 *   1. Si NO hay `@ScopeTarget` decorator → skip (deja pasar).
 *   2. Si el actor mismo es el target → permitir (auto-operaciones).
 *   3. Si el actor tiene rol `admin_tenant` → permitir (bypass por rango).
 *   4. Si el target está en `getActiveDescendants(actor)` → permitir.
 *   5. Caso contrario → 403 OUT_OF_SCOPE.
 *
 * Diseño:
 *   - Se ejecuta DESPUÉS de TenantJwtGuard (necesita req.tenantUser).
 *   - El bypass de admin_tenant evita que el admin tenga que tener
 *     descendants explícitos para operar — su rol es jerárquico
 *     implícito.
 *   - El guard SOLO valida scope sobre USERS. No sobre entidades
 *     intermedias (deposit/withdrawal). Para eso, el handler debe
 *     extraer el user_id de la entidad ANTES o el endpoint debe usar
 *     un guard secundario.
 *
 * Performance: 1-2 queries por request protegido (roles del actor +
 * recursive descendants). Aceptable para MVP.
 */

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq, inArray } from 'drizzle-orm';
import { roles, userRoles } from '@casino/db';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import type { RequestWithTenantUser } from '../tenant-auth/guards/tenant-jwt.guard';
import { SCOPE_TARGET_KEY, type ScopeTargetMeta } from './scope-target.decorator';
import { UserHierarchyService } from './user-hierarchy.service';

@Injectable()
export class ScopeGuard implements CanActivate {
  private readonly logger = new Logger(ScopeGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly hierarchy: UserHierarchyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<ScopeTargetMeta | undefined>(
      SCOPE_TARGET_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!meta) return true; // sin decorator, sin chequeo.

    const req = context.switchToHttp().getRequest<RequestWithTenantUser>();
    const actor = req.tenantUser;
    if (!actor) {
      // No debería pasar (TenantJwtGuard corre primero), defensivo.
      throw new ForbiddenException('ScopeGuard requiere user autenticado.');
    }

    const targetUserId = this.extractTarget(req, meta);
    if (!targetUserId) {
      // No vino target en la request — dejamos pasar (el handler lo
      // validará por DTO o tirará el error que corresponde).
      return true;
    }

    // Bypass 1: actor === target.
    if (actor.id === targetUserId) return true;

    const db = (req as RequestWithTenantContext).tenantContext!.db;

    // Bypass 2: actor con rol admin_tenant.
    const adminRows = await db
      .select({ code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(userRoles.userId, actor.id), inArray(roles.code, ['admin_tenant'])))
      .limit(1);
    if (adminRows.length > 0) return true;

    // Chequeo real: ¿target está en mi red?
    const descendants = await this.hierarchy.getActiveDescendants(db, actor.id);
    if (descendants.includes(targetUserId)) return true;

    this.logger.warn(
      `OUT_OF_SCOPE: actor=${actor.id} target=${targetUserId} (no es admin, no es self, no está en su red)`,
    );
    throw new ForbiddenException({
      statusCode: 403,
      message: `Target ${targetUserId} no está dentro de tu red.`,
      error: 'OUT_OF_SCOPE',
    });
  }

  private extractTarget(
    req: RequestWithTenantUser,
    meta: ScopeTargetMeta,
  ): string | null {
    let value: unknown;
    if (meta.location === 'body') {
      value = (req.body as Record<string, unknown> | undefined)?.[meta.field];
    } else if (meta.location === 'param') {
      value = (req.params as Record<string, string> | undefined)?.[meta.field];
    } else if (meta.location === 'query') {
      value = (req.query as Record<string, string> | undefined)?.[meta.field];
    }
    if (typeof value === 'string' && value.length > 0) return value;
    return null;
  }
}
