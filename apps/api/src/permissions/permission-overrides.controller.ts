/**
 * PermissionOverridesController — endpoints para grant/revoke individuales.
 *
 * Requieren:
 *   - JWT del tenant (admin del tenant o quien tenga `permissions.grant` / `permissions.revoke`).
 *   - Permission atómico correspondiente.
 *
 * El admin del tenant tiene ambos permisos (en seed); cualquier otro user
 * los necesita explícitamente delegados.
 *
 * Cascada al revocar (`docs/03 §7.3`): cuando se borra/revoca un override
 * (X, P), se cascadea a todos los overrides cuya `granted_by_chain`
 * contiene a X y son del mismo permission_code. La chain se construye en
 * `grant()` concatenando la chain del actor (si su permiso vino por
 * override) con su propio id.
 */

import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { permissions as permissionsTable, userPermissionOverrides } from '@casino/db';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import { PanelOnly } from '../tenant-auth/panel-only.decorator';
import type { RequestWithTenantContext, TenantDb } from '../tenant-resolver/tenant-context';
import { AuditLogService } from '../audit/audit-log.service';
import { extractRequestContext } from '../request-context/request-context';
import { GrantPermissionDto, RevokePermissionDto } from './dto/grant-permission.dto';
import { EffectivePermissionsService } from './effective-permissions.service';
import { PermissionsGuard } from './permissions.guard';
import { RequirePermissions } from './require-permissions.decorator';

@Controller('tenant/permission-overrides')
@UseGuards(TenantJwtGuard, PermissionsGuard)
@PanelOnly()
export class PermissionOverridesController {
  constructor(
    private readonly effectivePermissions: EffectivePermissionsService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * GET /tenant/permission-overrides/catalog
   *
   * Devuelve TODO el catálogo de permissions del tenant (mismo set que el
   * seed inserta, plus cualquier cosa que el operador agregue manual).
   *
   * Lo usa el frontend para popular el dropdown del Grant override modal
   * (necesita saber qué permission_codes son válidos + cuáles son
   * delegables vs no, para mostrar warning antes de intentar grantear
   * un no-delegable).
   *
   * Ordenado por category, code para que la UI los agrupe naturalmente.
   *
   * Permission: `users.view_any` (mismo gate que ver detalle de un user —
   * si podés ver users, podés saber qué permisos existen). NO requiere
   * `permissions.grant` porque es solo lectura del catálogo.
   */
  @Get('catalog')
  @RequirePermissions('users.view_any')
  async catalog(@Req() req: RequestWithTenantContext): Promise<{
    data: Array<{
      code: string;
      category: string | null;
      description: string | null;
      isDelegatable: boolean;
      auditRequired: boolean;
    }>;
    count: number;
  }> {
    const db = req.tenantContext!.db;
    const rows = await db
      .select({
        code: permissionsTable.code,
        category: permissionsTable.category,
        description: permissionsTable.description,
        isDelegatable: permissionsTable.isDelegatable,
        auditRequired: permissionsTable.auditRequired,
      })
      .from(permissionsTable)
      .orderBy(asc(permissionsTable.category), asc(permissionsTable.code));
    return { data: rows, count: rows.length };
  }

  /**
   * GET /tenant/permission-overrides/user/:userId
   * Lista los overrides (grant/revoke) que tiene un user.
   * Útil para que el panel de admin muestre el estado actual de overrides
   * antes de proponer un nuevo grant/revoke/clear.
   * Requiere `users.view_any`.
   */
  @Get('user/:userId')
  @RequirePermissions('users.view_any')
  async listForUser(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() req: RequestWithTenantContext,
  ): Promise<{
    userId: string;
    overrides: Array<{
      permissionCode: string;
      effect: 'grant' | 'revoke';
      reason: string | null;
      grantedBy: string | null;
      grantedAt: Date;
    }>;
    count: number;
  }> {
    const db = req.tenantContext!.db;
    const rows = await db
      .select({
        permissionCode: userPermissionOverrides.permissionCode,
        effect: userPermissionOverrides.effect,
        reason: userPermissionOverrides.reason,
        grantedBy: userPermissionOverrides.grantedBy,
        grantedAt: userPermissionOverrides.grantedAt,
      })
      .from(userPermissionOverrides)
      .where(eq(userPermissionOverrides.userId, userId))
      .orderBy(asc(userPermissionOverrides.permissionCode));

    return { userId, overrides: rows, count: rows.length };
  }

  /**
   * GET /tenant/permission-overrides/cascade-preview?userId=X&permissionCode=Y
   * Devuelve cuántos (y cuáles) overrides downstream serían barridos si
   * se revoca/clear el override (userId, permissionCode).
   * Es preview: no muta nada. (`docs/03 §7.3` exige preview antes de confirmar).
   * Requiere `permissions.revoke`.
   */
  @Get('cascade-preview')
  @RequirePermissions('permissions.revoke')
  async cascadePreview(
    @Query('userId', ParseUUIDPipe) userId: string,
    @Query('permissionCode') permissionCode: string,
    @Req() req: RequestWithTenantContext,
  ): Promise<{
    userId: string;
    permissionCode: string;
    affected: Array<{
      userId: string;
      effect: 'grant' | 'revoke';
      grantedBy: string | null;
      grantedAt: Date;
    }>;
    count: number;
  }> {
    if (!permissionCode || permissionCode.trim() === '') {
      throw new BadRequestException('permissionCode requerido.');
    }
    const db = req.tenantContext!.db;
    const affected = await this.findCascadeTargets(db, userId, permissionCode);
    return { userId, permissionCode, affected, count: affected.length };
  }

  /**
   * POST /tenant/permission-overrides/grant
   * Otorga un permiso individual a un user (override 'grant').
   * Requiere `permissions.grant`.
   *
   * Construye `granted_by_chain` así: si el actor mismo tiene un override
   * 'grant' sobre este permission, su chain = [...chainDelActor, actor.id].
   * Si no, chain = [actor.id]. Esto permite que la cascada al revocar
   * encuentre downstream completo.
   */
  @Post('grant')
  @RequirePermissions('permissions.grant')
  @HttpCode(HttpStatus.CREATED)
  async grant(
    @Body() dto: GrantPermissionDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<{ ok: true; effect: 'grant'; chain: string[] }> {
    const db = req.tenantContext!.db;

    // Validación 1: el permission_code existe en el catálogo + check is_delegatable.
    // (`docs/03 §7.2`). Si no existe → 400. Si no-delegable → 403.
    const permRows = await db
      .select({ code: permissionsTable.code, isDelegatable: permissionsTable.isDelegatable })
      .from(permissionsTable)
      .where(eq(permissionsTable.code, dto.permissionCode))
      .limit(1);
    const perm = permRows[0];
    if (!perm) {
      throw new BadRequestException(`Permiso "${dto.permissionCode}" no existe en el catálogo.`);
    }
    if (!perm.isDelegatable) {
      throw new ForbiddenException(
        `El permiso "${dto.permissionCode}" no es delegable (is_delegatable=false).`,
      );
    }

    // Validación 2: regla de techo (`docs/03 §7.1`). El actor debe tener el
    // permiso que delega — sino estaría regalando algo que no tiene.
    const actorHas = await this.effectivePermissions.hasAllPermissions(db, actor.id, [
      dto.permissionCode,
    ]);
    if (!actorHas) {
      throw new ForbiddenException(
        `No podés otorgar "${dto.permissionCode}" porque vos mismo no lo tenés.`,
      );
    }

    const chain = await this.buildChain(db, actor.id, dto.permissionCode);

    // Snapshot del estado previo para audit (null si no había override).
    const prev = await db
      .select()
      .from(userPermissionOverrides)
      .where(
        and(
          eq(userPermissionOverrides.userId, dto.userId),
          eq(userPermissionOverrides.permissionCode, dto.permissionCode),
        ),
      )
      .limit(1);

    await db
      .insert(userPermissionOverrides)
      .values({
        userId: dto.userId,
        permissionCode: dto.permissionCode,
        effect: 'grant',
        grantedBy: actor.id,
        grantedByChain: chain,
        reason: dto.reason ?? null,
      })
      .onConflictDoUpdate({
        target: [userPermissionOverrides.userId, userPermissionOverrides.permissionCode],
        set: {
          effect: 'grant',
          grantedBy: actor.id,
          grantedByChain: chain,
          reason: dto.reason ?? null,
          grantedAt: new Date(),
        },
      });

    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'permissions.grant',
      targetType: 'user',
      targetId: dto.userId,
      before: prev[0] ?? null,
      after: { effect: 'grant', permissionCode: dto.permissionCode, chain },
      reason: dto.reason ?? null,
      metadata: { chain },
      ...extractRequestContext(req),
    });

    return { ok: true, effect: 'grant', chain };
  }

  /**
   * POST /tenant/permission-overrides/revoke
   * Revoca explícitamente un permiso (override 'revoke').
   * Útil para "el cajero X no puede hacer wallet.unload" aunque su rol lo permita.
   * Requiere `permissions.revoke`. Reason obligatorio.
   *
   * Cascada: si el override anterior era 'grant' (o si ya no existe), todos
   * los overrides downstream del target para ese permission se borran.
   */
  @Post('revoke')
  @RequirePermissions('permissions.revoke')
  @HttpCode(HttpStatus.CREATED)
  async revoke(
    @Body() dto: RevokePermissionDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<{ ok: true; effect: 'revoke'; cascadedCount: number; severity: 'normal' | 'high' }> {
    const db = req.tenantContext!.db;

    // Verificar si el permiso es no-delegable. Si lo es, lo loggeamos
    // con severity 'high' porque suele ser un permiso sensible
    // (wallet.adjust, users.impersonate, permissions.grant, etc).
    // Permitimos el revoke (un admin debe poder revocar cualquier cosa)
    // pero marcamos el audit para que el super-admin lo vea.
    const permRows = await db
      .select({ isDelegatable: permissionsTable.isDelegatable })
      .from(permissionsTable)
      .where(eq(permissionsTable.code, dto.permissionCode))
      .limit(1);
    if (!permRows[0]) {
      throw new BadRequestException(`Permiso "${dto.permissionCode}" no existe en el catálogo.`);
    }
    const isSensitive = !permRows[0].isDelegatable;

    const prev = await db
      .select()
      .from(userPermissionOverrides)
      .where(
        and(
          eq(userPermissionOverrides.userId, dto.userId),
          eq(userPermissionOverrides.permissionCode, dto.permissionCode),
        ),
      )
      .limit(1);

    const cascadedUserIds = await this.cascadeDelete(db, dto.userId, dto.permissionCode);

    await db
      .insert(userPermissionOverrides)
      .values({
        userId: dto.userId,
        permissionCode: dto.permissionCode,
        effect: 'revoke',
        grantedBy: actor.id,
        grantedByChain: [actor.id],
        reason: dto.reason,
      })
      .onConflictDoUpdate({
        target: [userPermissionOverrides.userId, userPermissionOverrides.permissionCode],
        set: {
          effect: 'revoke',
          grantedBy: actor.id,
          grantedByChain: [actor.id],
          reason: dto.reason,
          grantedAt: new Date(),
        },
      });

    const reqCtx = extractRequestContext(req);
    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'permissions.revoke',
      targetType: 'user',
      targetId: dto.userId,
      before: prev[0] ?? null,
      after: { effect: 'revoke', permissionCode: dto.permissionCode },
      reason: dto.reason,
      metadata: {
        cascadedCount: cascadedUserIds.length,
        permissionCode: dto.permissionCode,
        severity: isSensitive ? 'high' : 'normal',
        sensitive: isSensitive,
      },
      ...reqCtx,
    });

    if (cascadedUserIds.length > 0) {
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'permissions.cascade_revoke',
        targetType: 'permission',
        targetId: dto.permissionCode,
        reason: `Cascadeado por revoke a ${dto.userId}`,
        metadata: {
          rootUserId: dto.userId,
          permissionCode: dto.permissionCode,
          affectedUserIds: cascadedUserIds,
        },
        ...reqCtx,
      });
    }

    return {
      ok: true,
      effect: 'revoke',
      cascadedCount: cascadedUserIds.length,
      severity: isSensitive ? 'high' : 'normal',
    };
  }

  /**
   * POST /tenant/permission-overrides/clear
   * Quita un override (deja al user con solo lo que sus roles le dan).
   * Requiere `permissions.revoke`.
   *
   * Cascada: borra también todos los overrides downstream del target para
   * ese permission_code (chain @> [target]).
   */
  @Post('clear')
  @RequirePermissions('permissions.revoke')
  @HttpCode(HttpStatus.OK)
  async clear(
    @Body() dto: { userId: string; permissionCode: string },
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<{ ok: true; cascadedCount: number }> {
    const db = req.tenantContext!.db;

    const prev = await db
      .select()
      .from(userPermissionOverrides)
      .where(
        and(
          eq(userPermissionOverrides.userId, dto.userId),
          eq(userPermissionOverrides.permissionCode, dto.permissionCode),
        ),
      )
      .limit(1);

    const cascadedUserIds = await this.cascadeDelete(db, dto.userId, dto.permissionCode);
    await db
      .delete(userPermissionOverrides)
      .where(
        and(
          eq(userPermissionOverrides.userId, dto.userId),
          eq(userPermissionOverrides.permissionCode, dto.permissionCode),
        ),
      );

    const reqCtx = extractRequestContext(req);
    // Solo logueamos si había algo que limpiar (idempotencia silenciosa).
    if (prev.length > 0 || cascadedUserIds.length > 0) {
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'permissions.clear',
        targetType: 'user',
        targetId: dto.userId,
        before: prev[0] ?? null,
        after: null,
        metadata: {
          permissionCode: dto.permissionCode,
          cascadedCount: cascadedUserIds.length,
        },
        ...reqCtx,
      });
    }

    if (cascadedUserIds.length > 0) {
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'permissions.cascade_revoke',
        targetType: 'permission',
        targetId: dto.permissionCode,
        reason: `Cascadeado por clear a ${dto.userId}`,
        metadata: {
          rootUserId: dto.userId,
          permissionCode: dto.permissionCode,
          affectedUserIds: cascadedUserIds,
        },
        ...reqCtx,
      });
    }

    return { ok: true, cascadedCount: cascadedUserIds.length };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers internos
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Construye la `granted_by_chain` para un nuevo override.
   * Si el actor recibió este permission por un override 'grant', su chain
   * propia se prepone. Sino, chain = [actor.id].
   */
  private async buildChain(
    db: TenantDb,
    actorId: string,
    permissionCode: string,
  ): Promise<string[]> {
    const rows = await db
      .select({
        chain: userPermissionOverrides.grantedByChain,
        effect: userPermissionOverrides.effect,
      })
      .from(userPermissionOverrides)
      .where(
        and(
          eq(userPermissionOverrides.userId, actorId),
          eq(userPermissionOverrides.permissionCode, permissionCode),
        ),
      )
      .limit(1);

    const actorOverride = rows[0];
    if (actorOverride && actorOverride.effect === 'grant') {
      // Evitar duplicar al actor si ya está al final de su propia chain.
      const base = actorOverride.chain.filter((id) => id !== actorId);
      return [...base, actorId];
    }
    return [actorId];
  }

  /**
   * Encuentra todos los overrides downstream de (targetUserId, permissionCode).
   * "Downstream" = chain @> ARRAY[targetUserId]. Excluye el override del propio
   * target (mismo userId) — esos los maneja la operación principal.
   */
  private async findCascadeTargets(
    db: TenantDb,
    targetUserId: string,
    permissionCode: string,
  ): Promise<
    Array<{
      userId: string;
      effect: 'grant' | 'revoke';
      grantedBy: string | null;
      grantedAt: Date;
    }>
  > {
    const rows = await db
      .select({
        userId: userPermissionOverrides.userId,
        effect: userPermissionOverrides.effect,
        grantedBy: userPermissionOverrides.grantedBy,
        grantedAt: userPermissionOverrides.grantedAt,
      })
      .from(userPermissionOverrides)
      .where(
        and(
          eq(userPermissionOverrides.permissionCode, permissionCode),
          sql`${userPermissionOverrides.grantedByChain} @> ARRAY[${targetUserId}]::uuid[]`,
          sql`${userPermissionOverrides.userId} <> ${targetUserId}`,
        ),
      )
      .orderBy(asc(userPermissionOverrides.grantedAt));
    return rows;
  }

  /**
   * Borra (cascada) todos los overrides downstream para ese permission.
   * Devuelve la lista de userIds afectados (para que el caller la registre
   * en audit como `permissions.cascade_revoke`). NO toca el override del
   * propio target.
   */
  private async cascadeDelete(
    db: TenantDb,
    targetUserId: string,
    permissionCode: string,
  ): Promise<string[]> {
    const deleted = await db
      .delete(userPermissionOverrides)
      .where(
        and(
          eq(userPermissionOverrides.permissionCode, permissionCode),
          sql`${userPermissionOverrides.grantedByChain} @> ARRAY[${targetUserId}]::uuid[]`,
          sql`${userPermissionOverrides.userId} <> ${targetUserId}`,
        ),
      )
      .returning({ userId: userPermissionOverrides.userId });
    return deleted.map((d) => d.userId);
  }
}
