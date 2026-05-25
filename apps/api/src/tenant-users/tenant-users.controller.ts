/**
 * TenantUsersController — endpoints de gestión de users dentro de un tenant.
 *
 * Demuestra el sistema de permisos: cada endpoint declara qué permiso atómico
 * exige. El PermissionsGuard valida contra el set efectivo del user logueado.
 */

import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseIntPipe,
  Patch,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { and, asc, eq, or, sql } from 'drizzle-orm';
import {
  buildCsv,
  buildCsvFilename,
  CSV_EXPORT_MAX_ROWS,
  type CsvColumn,
} from '../common/csv';
import { NotFoundException } from '@nestjs/common';
import {
  roles,
  userHierarchy,
  userRoles,
  users,
  wallets,
  type User,
} from '@casino/db';
import { gte, inArray, isNull } from 'drizzle-orm';
import { AuditLogService } from '../audit/audit-log.service';
import { extractRequestContext } from '../request-context/request-context';
import { ScopeTarget } from '../user-hierarchy/scope-target.decorator';
import { ScopeGuard } from '../user-hierarchy/scope.guard';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import { PanelOnly } from '../tenant-auth/panel-only.decorator';
import { EffectivePermissionsService } from '../permissions/effective-permissions.service';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { RequirePermissions } from '../permissions/require-permissions.decorator';
import type {
  RequestWithTenantContext,
  TenantDb,
} from '../tenant-resolver/tenant-context';
import { NotificationsService } from '../notifications/notifications.service';
import { PermissionOverridesService } from '../permissions/permission-overrides.service';
import { TwoFaCodeInvalidError, TwoFaError } from '../tenant-auth/two-fa.errors';
import { TwoFaService } from '../tenant-auth/two-fa.service';
import { UserHierarchyService } from '../user-hierarchy/user-hierarchy.service';
import { CreateTenantUserDto } from './dto/create-tenant-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateTenantUserDto } from './dto/update-tenant-user.dto';
import { TenantUsersService } from './tenant-users.service';

/** Quita campos sensibles antes de mandarlos a audit. */
function safeSnapshot(u: User): Omit<User, 'passwordHash' | 'twoFaSecret'> {
  const { passwordHash: _ph, twoFaSecret: _tfa, ...rest } = u;
  return rest;
}

@Controller('tenant/users')
@UseGuards(TenantJwtGuard, PermissionsGuard, ScopeGuard)
// Sprint 43 (security): controller admin-only. Defense-in-depth contra
// players con JWT viejo intentando enumerar usuarios.
@PanelOnly()
export class TenantUsersController {
  private readonly logger = new Logger(TenantUsersController.name);

  constructor(
    private readonly tenantUsersService: TenantUsersService,
    private readonly effectivePermissions: EffectivePermissionsService,
    private readonly audit: AuditLogService,
    private readonly twoFa: TwoFaService,
    private readonly notifications: NotificationsService,
    private readonly permissionOverrides: PermissionOverridesService,
    private readonly hierarchy: UserHierarchyService,
  ) {}

  /**
   * GET /tenant/users
   *
   * Lista users del tenant con filtros server-side:
   *   - ?search=<q>     → ILIKE sobre username + displayName + email (OR).
   *                       Sanitiza % y _ del input para que el user no rompa
   *                       el LIKE (no inyección — solo UX consistente).
   *   - ?status=active  → exacto sobre `users.status` enum.
   *   - ?limit=50       → default 50, max 200. UI puede subir según necesidad.
   *   - ?offset=0       → offset paginación.
   *
   * Response:
   *   - `data`: rows de la página actual.
   *   - `count`: rows en `data` (compat con el shape original).
   *   - `total`: total que matchea los filtros (cross-page). Necesario para
   *     pagers y para "X de Y" en la UI.
   *   - `requestedBy`: username del actor (compat).
   *
   * Permission: `users.view_any`. Ordenado por `username` ASC para consistencia
   * de paginación (el UUID v7 de id también es time-prefixed pero username es
   * más predecible para el operador).
   */
  @Get()
  @RequirePermissions('users.view_any')
  async list(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser()
    requester: { id: string; username: string },
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('role') roleCode?: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit?: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset?: number,
  ): Promise<{
    data: Array<{
      id: string;
      username: string;
      email: string | null;
      displayName: string;
      status: string;
      createdAt: Date;
      // Sprint 51.10: campos enriquecidos para mostrar en la tabla
      // sin segundo round-trip por row.
      lastLoginAt: Date | null;
      roleCodes: string[];
      parentUserId: string | null;
      parentUsername: string | null;
      walletBalance: string | null;
    }>;
    count: number;
    total: number;
    requestedBy: string;
  }> {
    if (!req.tenantContext) {
      throw new Error('TenantContext faltante.');
    }
    const db = req.tenantContext.db;

    const safeLimit = Math.min(Math.max(limit ?? 50, 1), 200);
    const safeOffset = Math.max(offset ?? 0, 0);

    const conditions = [];
    if (status) {
      conditions.push(
        eq(users.status, status as 'active' | 'banned' | 'suspended' | 'pending'),
      );
    }
    if (search && search.trim() !== '') {
      // Escapamos %_ del input para que el operador no termine matcheando todo
      // cuando alguien tipea "%" en el buscador. El backslash lo escapa el
      // dialecto Postgres con ESCAPE '\'. Drizzle pasa el string como parámetro.
      const escaped = search.trim().replace(/\\/g, '\\\\').replace(/[%_]/g, '\\$&');
      const pattern = `%${escaped}%`;
      conditions.push(
        or(
          sql`${users.username} ILIKE ${pattern} ESCAPE '\\'`,
          sql`${users.displayName} ILIKE ${pattern} ESCAPE '\\'`,
          sql`COALESCE(${users.email}, '') ILIKE ${pattern} ESCAPE '\\'`,
        )!,
      );
    }
    // Sprint 51.10: filtro por rol. Como un user puede tener N roles, lo
    // resolvemos con subquery `IN (SELECT user_id FROM user_roles JOIN
    // roles WHERE role.code = ?)`. Si pasan un código inexistente, el set
    // queda vacío y devuelve 0 rows — comportamiento deseado.
    if (roleCode && roleCode.trim() !== '') {
      const trimmedCode = roleCode.trim();
      conditions.push(
        sql`${users.id} IN (
          SELECT ${userRoles.userId} FROM ${userRoles}
          INNER JOIN ${roles} ON ${roles.id} = ${userRoles.roleId}
          WHERE ${roles.code} = ${trimmedCode}
        )`,
      );
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Sprint 51.10: la página vivía como tabla "fría" (solo id, name,
    // status, createdAt). Ahora enriquecemos con wallet balance, parent
    // y lastLoginAt. Drizzle no infiere bien self-joins con
    // aliasedTable, así que traemos parentUserId crudo desde
    // user_hierarchy y resolvemos el username en una 2da query batched.
    const [rows, totalRow] = await Promise.all([
      db
        .select({
          id: users.id,
          username: users.username,
          email: users.email,
          displayName: users.displayName,
          status: users.status,
          createdAt: users.createdAt,
          lastLoginAt: users.lastLoginAt,
          parentUserId: userHierarchy.parentUserId,
          walletBalance: wallets.balance,
        })
        .from(users)
        .leftJoin(
          userHierarchy,
          and(
            eq(userHierarchy.userId, users.id),
            isNull(userHierarchy.until),
          ),
        )
        .leftJoin(wallets, eq(wallets.userId, users.id))
        .where(whereClause)
        .orderBy(asc(users.username))
        .limit(safeLimit)
        .offset(safeOffset),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(users)
        .where(whereClause),
    ]);

    const userIds = rows.map((r) => r.id);

    // Roles por user — query agregada con array_agg (Postgres). Un user
    // puede tener N roles (típicamente 1, pero hasta 3-4 en admins).
    const rolesMap = new Map<string, string[]>();
    if (userIds.length > 0) {
      const roleRows = await db
        .select({
          userId: userRoles.userId,
          roleCodes: sql<string[]>`array_agg(${roles.code})`,
        })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(inArray(userRoles.userId, userIds))
        .groupBy(userRoles.userId);
      for (const r of roleRows) {
        rolesMap.set(r.userId, r.roleCodes ?? []);
      }
    }

    // Resolver usernames de parents en una sola query batched.
    const parentIds = [
      ...new Set(rows.map((r) => r.parentUserId).filter((p): p is string => !!p)),
    ];
    const parentUsernameMap = new Map<string, string>();
    if (parentIds.length > 0) {
      const parentRows = await db
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(inArray(users.id, parentIds));
      for (const p of parentRows) parentUsernameMap.set(p.id, p.username);
    }

    const data = rows.map((r) => ({
      ...r,
      roleCodes: rolesMap.get(r.id) ?? [],
      parentUsername: r.parentUserId
        ? (parentUsernameMap.get(r.parentUserId) ?? null)
        : null,
    }));

    return {
      data,
      count: data.length,
      total: totalRow[0]?.n ?? 0,
      requestedBy: requester.username,
    };
  }

  /**
   * GET /tenant/users/stats — Sprint 51.10.
   *
   * KPIs agregados para el header del panel `/users`:
   *   - Total de users por rol.
   *   - Activos en últimas 24h / 7d (basado en `lastLoginAt`).
   *   - Creados esta semana.
   *
   * Mismo permiso que list (`users.view_any`). Una query agregada por
   * cada métrica — todas baratas (count + group by).
   */
  @Get('stats')
  @RequirePermissions('users.view_any')
  async stats(@Req() req: RequestWithTenantContext): Promise<{
    total: number;
    byStatus: Record<string, number>;
    byRole: Array<{ code: string; name: string; count: number }>;
    activeLast24h: number;
    activeLast7d: number;
    createdLast7d: number;
  }> {
    if (!req.tenantContext) throw new Error('TenantContext faltante.');
    const db = req.tenantContext.db;
    const now = new Date();
    const past24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const past7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [totalRow, statusRows, roleRows, active24Row, active7Row, created7Row] =
      await Promise.all([
        db.select({ n: sql<number>`count(*)::int` }).from(users),
        db
          .select({
            status: users.status,
            n: sql<number>`count(*)::int`,
          })
          .from(users)
          .groupBy(users.status),
        db
          .select({
            code: roles.code,
            name: roles.name,
            count: sql<number>`count(${userRoles.userId})::int`,
          })
          .from(roles)
          .leftJoin(userRoles, eq(userRoles.roleId, roles.id))
          .groupBy(roles.code, roles.name)
          .orderBy(asc(roles.code)),
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(users)
          .where(gte(users.lastLoginAt, past24h)),
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(users)
          .where(gte(users.lastLoginAt, past7d)),
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(users)
          .where(gte(users.createdAt, past7d)),
      ]);

    const byStatus: Record<string, number> = {};
    for (const s of statusRows) byStatus[s.status] = s.n;

    return {
      total: totalRow[0]?.n ?? 0,
      byStatus,
      byRole: roleRows.map((r) => ({
        code: r.code,
        name: r.name,
        count: r.count,
      })),
      activeLast24h: active24Row[0]?.n ?? 0,
      activeLast7d: active7Row[0]?.n ?? 0,
      createdLast7d: created7Row[0]?.n ?? 0,
    };
  }

  /**
   * GET /tenant/users/export
   * Export CSV de todos los users del tenant. Cap en `CSV_EXPORT_MAX_ROWS`.
   * Records audit `users.export` con metadata { rowCount, severity:medium }.
   *
   * No incluye `passwordHash`, `twoFaSecret` ni recovery codes — sensibles
   * y nunca deben salir del servidor.
   */
  @Get('export')
  @RequirePermissions('users.export')
  async exportCsv(
    @Req() req: RequestWithTenantContext,
    @Res() res: Response,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<void> {
    const db = req.tenantContext!.db;
    const rows = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        displayName: users.displayName,
        phone: users.phone,
        status: users.status,
        twoFaEnabled: users.twoFaEnabled,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .limit(CSV_EXPORT_MAX_ROWS);

    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'users.export',
      targetType: 'user',
      targetId: null,
      metadata: {
        rowCount: rows.length,
        severity: 'medium',
        truncated: rows.length === CSV_EXPORT_MAX_ROWS,
      },
      ...extractRequestContext(req),
    });

    const csv = buildCsv<TenantUserExportRow>(USER_CSV_COLUMNS, rows);
    const filename = buildCsvFilename('users');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Total-Rows', String(rows.length));
    res.send(csv);
  }

  /**
   * GET /tenant/users/:id
   * Devuelve detalle completo del user: datos + roles + permisos efectivos.
   * Útil para panel de admin (vista detalle).
   * Requiere `users.view_any`.
   */
  @Get(':id')
  @RequirePermissions('users.view_any')
  async findOne(
    @Param('id', ParseUUIDPipe) userId: string,
    @Req() req: RequestWithTenantContext,
  ): Promise<{
    user: Omit<User, 'passwordHash' | 'twoFaSecret'>;
    roles: Array<{ code: string; name: string; isSystem: boolean }>;
    effectivePermissions: string[];
  }> {
    if (!req.tenantContext) throw new Error('TenantContext faltante.');
    const db = req.tenantContext.db;

    const user = await this.tenantUsersService.findById(db, userId);
    if (!user) throw new NotFoundException(`User ${userId} no existe.`);

    const [userRolesList, effective] = await Promise.all([
      this.tenantUsersService.getRoles(db, userId),
      this.effectivePermissions.calculateForUser(db, userId),
    ]);

    const { passwordHash: _, twoFaSecret: __, ...safe } = user;
    return {
      user: safe,
      roles: userRolesList,
      effectivePermissions: [...effective].sort(),
    };
  }

  /**
   * POST /tenant/users
   * Crea un user nuevo y le asigna un rol.
   * Requiere `users.create`.
   *
   * Body: { username, password, displayName, email?, phone?, roleCode, permissionOverrides? }
   * 201: { user, createdBy, permissionOverrides? }
   * 400: rol no existe / DTO inválido / actor no tiene un override pedido
   * 403: actor no puede delegar (empleado-only) / override no delegable
   * 409: username o email duplicado
   *
   * Sprint 51.5: si `permissionOverrides[]` viene, los otorga en bloque
   * dentro de la misma transacción. Si cualquiera falla, rollback total.
   * Si `roleCode='empleado'`, el actor se asigna como parent del empleado
   * en `user_hierarchy` (un empleado opera bajo su creador).
   */
  @Post()
  @RequirePermissions('users.create')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateTenantUserDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<{
    user: Omit<User, 'passwordHash' | 'twoFaSecret'>;
    createdBy: string;
    permissionOverrides?: string[];
    parentAssigned?: boolean;
  }> {
    if (!req.tenantContext) {
      throw new Error('TenantContext faltante.');
    }
    const db = req.tenantContext.db;

    // Sprint 51.5: si hay overrides O el rol es empleado, envolvemos en
    // transaction para atomicidad. Caso simple (sin overrides, no
    // empleado): TX de una sola operación (drizzle no penaliza).
    const grantedCodes: string[] = [];
    let parentAssigned = false;

    const created = await db.transaction(async (tx) => {
      const txDb = tx as unknown as typeof db;
      const newUser = await this.tenantUsersService.create(txDb, {
        username: dto.username,
        password: dto.password,
        displayName: dto.displayName,
        email: dto.email,
        phone: dto.phone,
        roleCode: dto.roleCode,
        createdBy: actor.id,
      });

      // Auto-parent para empleado: el actor es su "manager natural".
      // No para otros roles (admin podría querer crear un socio root).
      if (dto.roleCode === 'empleado') {
        await this.hierarchy.setParent(txDb, {
          userId: newUser.id,
          parentUserId: actor.id,
          relationType: 'empleado',
          actorUserId: actor.id,
        });
        parentAssigned = true;
      }

      // Asignar overrides en bloque. Si alguno falla, la TX rollbackea.
      if (dto.permissionOverrides && dto.permissionOverrides.length > 0) {
        // De-duplicar el array (defensa contra el frontend).
        const unique = [...new Set(dto.permissionOverrides)];
        for (const code of unique) {
          await this.permissionOverrides.grant(txDb, {
            actorUserId: actor.id,
            targetUserId: newUser.id,
            permissionCode: code,
            reason: `Auto-grant al crear ${dto.roleCode} desde panel.`,
          });
          grantedCodes.push(code);
        }
      }

      return newUser;
    });

    const safe = safeSnapshot(created);

    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'users.create',
      targetType: 'user',
      targetId: created.id,
      after: safe,
      metadata: {
        roleCode: dto.roleCode,
        parentAssigned,
        permissionOverrides: grantedCodes.length > 0 ? grantedCodes : undefined,
      },
      ...extractRequestContext(req),
    });

    return {
      user: safe,
      createdBy: actor.username,
      permissionOverrides: grantedCodes.length > 0 ? grantedCodes : undefined,
      parentAssigned: parentAssigned || undefined,
    };
  }

  /**
   * PATCH /tenant/users/:id
   * Actualiza campos del user (status, displayName, email, phone).
   * Requiere `users.edit` (excepto cambios de status a banned/suspended que
   * en una iteración futura se podrían exigir users.ban).
   *
   * Body: cualquier subset de { status, displayName, email, phone }.
   * 200: user actualizado (sin password_hash).
   * 404: user no existe.
   * 409: email duplicado.
   */
  @Patch(':id')
  @RequirePermissions('users.edit')
  @ScopeTarget('id', 'param')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateTenantUserDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<{ user: Omit<User, 'passwordHash' | 'twoFaSecret'>; updatedBy: string }> {
    if (!req.tenantContext) {
      throw new Error('TenantContext faltante.');
    }
    const db = req.tenantContext.db;
    const before = await this.tenantUsersService.findById(db, userId);

    const updated = await this.tenantUsersService.update(db, userId, {
      status: dto.status,
      displayName: dto.displayName,
      email: dto.email,
      phone: dto.phone,
    });

    const safe = safeSnapshot(updated);

    // Solo logueamos si hubo cambios efectivos (no-op = sin entry).
    // Excluimos `updatedAt` del compare porque siempre cambia aunque
    // el resto sea idéntico.
    const stripTs = (u: Omit<User, 'passwordHash' | 'twoFaSecret'>): unknown => {
      const { updatedAt: _ts, ...rest } = u;
      return rest;
    };
    if (before && JSON.stringify(stripTs(safeSnapshot(before))) !== JSON.stringify(stripTs(safe))) {
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'users.update',
        targetType: 'user',
        targetId: userId,
        before: safeSnapshot(before),
        after: safe,
        metadata: { changedFields: Object.keys(dto) },
        ...extractRequestContext(req),
      });
    }

    return {
      user: safe,
      updatedBy: actor.username,
    };
  }

  /**
   * POST /tenant/users/:id/roles/:roleCode
   * Asigna un rol al user. Idempotente.
   * Requiere `users.edit`.
   */
  @Post(':id/roles/:roleCode')
  @RequirePermissions('users.edit')
  @ScopeTarget('id', 'param')
  @HttpCode(HttpStatus.OK)
  async addRole(
    @Param('id', ParseUUIDPipe) userId: string,
    @Param('roleCode') roleCode: string,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<{ added: boolean; userId: string; roleCode: string; by: string }> {
    if (!req.tenantContext) throw new Error('TenantContext faltante.');
    const db = req.tenantContext.db;
    const { added } = await this.tenantUsersService.addRole(db, userId, roleCode, actor.id);

    // Solo logueamos cuando hubo cambio real (idempotencia silenciosa).
    if (added) {
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'users.role_add',
        targetType: 'user',
        targetId: userId,
        metadata: { roleCode },
        ...extractRequestContext(req),
      });
    }

    return { added, userId, roleCode, by: actor.username };
  }

  /**
   * DELETE /tenant/users/:id/roles/:roleCode
   * Quita un rol del user. Idempotente.
   * Requiere `users.edit`.
   */
  @Delete(':id/roles/:roleCode')
  @RequirePermissions('users.edit')
  @ScopeTarget('id', 'param')
  @HttpCode(HttpStatus.OK)
  async removeRole(
    @Param('id', ParseUUIDPipe) userId: string,
    @Param('roleCode') roleCode: string,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<{ removed: boolean; userId: string; roleCode: string; by: string }> {
    if (!req.tenantContext) throw new Error('TenantContext faltante.');
    const db = req.tenantContext.db;
    const { removed } = await this.tenantUsersService.removeRole(db, userId, roleCode);

    if (removed) {
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'users.role_remove',
        targetType: 'user',
        targetId: userId,
        metadata: { roleCode },
        ...extractRequestContext(req),
      });
    }

    return { removed, userId, roleCode, by: actor.username };
  }

  /**
   * POST /tenant/users/:id/reset-password (Sprint 51.4)
   *
   * Resetea la password de un user inferior en la jerarquía. El
   * `ScopeGuard` valida que el target esté en el downstream del actor
   * (admin_tenant bypasea — puede resetear a cualquiera). Si el rol
   * del actor tiene `requiresTwoFa=true` y el actor lo tiene habilitado,
   * exige `twoFaCode` en el body.
   *
   * Body: { newPassword: string (≥8 chars, ≤72), twoFaCode?: string, reason?: string }
   * 200: { user, by, sessionsInvalidated: false } — el target debe
   *      cambiar password manualmente en próximo login (feature futura).
   * 400: password muy corta / 2FA inválido / 2FA requerido y no enviado.
   * 403: target fuera del downstream del actor.
   * 404: target no existe.
   *
   * Notificación enviada al target: kind `password_reset_by_admin`
   * (in_app + email, fail-soft). Audit `users.reset_password` severity:high.
   */
  @Post(':id/reset-password')
  @RequirePermissions('users.reset_password')
  @ScopeTarget('id', 'param')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Param('id', ParseUUIDPipe) userId: string,
    @Body() dto: ResetPasswordDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<{
    user: Omit<User, 'passwordHash' | 'twoFaSecret'>;
    by: string;
    sessionsInvalidated: false;
  }> {
    if (!req.tenantContext) throw new Error('TenantContext faltante.');
    const db = req.tenantContext.db;

    // Defensa en profundidad: no permitir reseteo de uno mismo desde
    // este endpoint. Self-change debería ir por otro flow (sprint
    // futuro: `POST /tenant/auth/me/password` con currentPassword).
    if (userId === actor.id) {
      throw new BadRequestException({
        message: 'Para cambiar tu propia password usá el flujo self-change.',
        error: 'CANNOT_RESET_OWN_PASSWORD',
      });
    }

    // Si el actor tiene 2FA habilitada, exigimos el código.
    await this.requireTwoFaIfEnabled(db, actor.id, dto.twoFaCode);

    // Resetear (valida largo, hashea, persiste).
    const updated = await this.tenantUsersService.resetPassword(
      db,
      userId,
      dto.newPassword,
    );
    const safe = safeSnapshot(updated);

    // Audit severity:high. NO logueamos before/after de password (claro)
    // pero sí registramos el actor, target y reason.
    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'users.reset_password',
      targetType: 'user',
      targetId: userId,
      reason: dto.reason,
      metadata: {
        severity: 'high',
        targetUsername: updated.username,
      },
      ...extractRequestContext(req),
    });

    // Notificar al target. Fail-soft — si falla, el reseteo ya está hecho.
    const actorRoles = await this.tenantUsersService
      .getRoles(db, actor.id)
      .catch(() => []);
    const actorRolePrimary =
      actorRoles.find((r) => r.code === 'admin_tenant')?.code ??
      actorRoles[0]?.code ??
      'upstream';
    for (const channel of ['in_app', 'email'] as const) {
      try {
        await this.notifications.enqueue(db, {
          userId: updated.id,
          kind: 'password_reset_by_admin',
          channel,
          payload: {
            actorUsername: actor.username,
            actorRole: actorRolePrimary,
            reason: dto.reason ?? '',
          },
        });
      } catch (err) {
        this.logger.error(
          `Notif password_reset_by_admin (${channel}) falló user=${updated.id}: ${(err as Error).message}`,
        );
      }
    }

    return { user: safe, by: actor.username, sessionsInvalidated: false };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Helpers privados
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Sprint 51.4: si el actor tiene 2FA habilitada, exige el código y
   * lo valida. Si no tiene 2FA, deja pasar. Mismo patrón que
   * `bonuses.force_clear`.
   */
  private async requireTwoFaIfEnabled(
    db: TenantDb,
    actorUserId: string,
    code: string | undefined,
  ): Promise<void> {
    const enabled = await this.twoFa.isEnabled(db, actorUserId);
    if (!enabled) return;
    if (!code) {
      throw new BadRequestException({
        message: 'Esta operación requiere código 2FA.',
        error: 'TWO_FA_REQUIRED',
      });
    }
    try {
      await this.twoFa.verify(db, actorUserId, code);
    } catch (err) {
      if (err instanceof TwoFaCodeInvalidError) {
        throw new BadRequestException({
          message: err.message,
          error: 'TWO_FA_CODE_INVALID',
        });
      }
      if (err instanceof TwoFaError) {
        throw new BadRequestException({
          message: err.message,
          error: 'TWO_FA_ERROR',
        });
      }
      throw err;
    }
  }
}

// ──────────────────────────────────────────────────────────────────────
// CSV column definitions
// ──────────────────────────────────────────────────────────────────────

interface TenantUserExportRow {
  id: string;
  username: string;
  email: string | null;
  displayName: string;
  phone: string | null;
  status: string;
  twoFaEnabled: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const USER_CSV_COLUMNS: CsvColumn<TenantUserExportRow>[] = [
  { header: 'created_at', value: (r) => r.createdAt },
  { header: 'id', value: (r) => r.id },
  { header: 'username', value: (r) => r.username },
  { header: 'display_name', value: (r) => r.displayName },
  { header: 'email', value: (r) => r.email },
  { header: 'phone', value: (r) => r.phone },
  { header: 'status', value: (r) => r.status },
  { header: 'two_fa_enabled', value: (r) => r.twoFaEnabled },
  { header: 'last_login_at', value: (r) => r.lastLoginAt },
  { header: 'updated_at', value: (r) => r.updatedAt },
];
