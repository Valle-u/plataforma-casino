/**
 * ScopeGuard — valida que el `targetUserId` del request está dentro de
 * la red del actor (su descendencia activa) o que el actor es el target
 * mismo, o que el actor es admin_tenant (bypass jerárquico), o que el
 * actor tiene un permiso `*_admin_network` que le permite operar sobre
 * toda la red del admin (comodín externo).
 *
 * Política (orden de evaluación):
 *   1. Si NO hay `@ScopeTarget` decorator → skip (deja pasar).
 *   2. Si el actor mismo es el target → permitir (auto-operaciones).
 *   3. Si el actor tiene rol `admin_tenant` → permitir (bypass por rango).
 *   4. Si el target está en `getActiveDescendants(actor)` → permitir.
 *   5. NUEVO: si el handler tiene `@AdminNetworkBypass(perm)` y el actor
 *      tiene `perm` y el target está en `getAdminNetworkIds(db)` →
 *      permitir + registrar en `req.scopeBypass` para audit.
 *   6. Caso contrario → 403 OUT_OF_SCOPE.
 *
 * Diseño:
 *   - Se ejecuta DESPUÉS de TenantJwtGuard (necesita req.tenantUser).
 *   - Los bypass (admin_tenant, admin_network) NUNCA alcanzan a la
 *     sub-red del socio independiente — getAdminNetworkIds la excluye.
 *   - El guard SOLO valida scope sobre USERS. No sobre entidades
 *     intermedias (deposit/withdrawal). Para eso, el handler debe
 *     extraer el user_id de la entidad ANTES o el endpoint debe usar
 *     un guard secundario.
 *
 * Performance: 1-3 queries por request protegido (roles del actor +
 * recursive descendants; opcionalmente permisos efectivos y admin
 * network). Aceptable para MVP; memoizar por request en próxima iter.
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
import { EffectivePermissionsService } from '../permissions/effective-permissions.service';
import {
  ADMIN_NETWORK_BYPASS_KEY,
  type AdminNetworkBypassMeta,
  type ScopeBypassInfo,
} from './admin-network-bypass.decorator';
import { SCOPE_TARGET_KEY, type ScopeTargetMeta } from './scope-target.decorator';
import { UserHierarchyService } from './user-hierarchy.service';

@Injectable()
export class ScopeGuard implements CanActivate {
  private readonly logger = new Logger(ScopeGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly hierarchy: UserHierarchyService,
    private readonly effectivePermissions: EffectivePermissionsService,
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

    // Bypass 3 (comodín externo): si el handler declaró @AdminNetworkBypass y
    // el actor tiene ese permiso Y **el actor está dentro de la red del admin**
    // Y el target está también en la red del admin (excluye sub-red indep)
    // → dejamos pasar.
    //
    // El chequeo del actor es CRÍTICO: sin él, un socio independiente al que
    // se le otorgue el comodín *_admin_network puede cruzar hacia la red del
    // admin y ejecutar acciones que nunca debía tocar (drenar Casa vía
    // correcciones, subir cupos, etc.). El comodín está diseñado para
    // usuarios del admin_network que operan sobre el admin_network — nunca
    // para escalar desde una sub-red indep hacia el admin.
    const bypassMeta = this.reflector.getAllAndOverride<
      AdminNetworkBypassMeta | undefined
    >(ADMIN_NETWORK_BYPASS_KEY, [context.getHandler(), context.getClass()]);
    if (bypassMeta) {
      const hasPerm = await this.effectivePermissions.hasAllPermissions(
        db,
        actor.id,
        [bypassMeta.permissionCode],
      );
      if (hasPerm) {
        const adminNetworkIds = await this.hierarchy.getAdminNetworkIds(db);
        const actorInAdminNetwork = adminNetworkIds.has(actor.id);
        const targetInAdminNetwork = adminNetworkIds.has(targetUserId);
        if (actorInAdminNetwork && targetInAdminNetwork) {
          this.logger.log(
            `SCOPE_BYPASS_ADMIN_NETWORK: actor=${actor.id} target=${targetUserId} perm=${bypassMeta.permissionCode}`,
          );
          // Marcar en request para que AuditInterceptor lo persista.
          (req as RequestWithTenantUser & { scopeBypass?: ScopeBypassInfo }).scopeBypass = {
            kind: 'admin_network',
            perm: bypassMeta.permissionCode,
          };
          return true;
        }
        if (!actorInAdminNetwork && targetInAdminNetwork) {
          // Log severity alta: alguien fuera del admin_network intentó usar
          // el comodín para tocar el admin_network. Puerta de exploit
          // conocida (D1 pre-fix). No dejar pasar.
          this.logger.warn(
            `SCOPE_BYPASS_REJECTED_ACTOR_OUTSIDE_ADMIN_NETWORK: actor=${actor.id} target=${targetUserId} perm=${bypassMeta.permissionCode}`,
          );
        }
      }
    }

    this.logger.warn(
      `OUT_OF_SCOPE: actor=${actor.id} target=${targetUserId} (no es admin, no es self, no está en su red, no aplica admin_network bypass)`,
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
