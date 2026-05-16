/**
 * TenantUsersController — endpoints de gestión de users dentro de un tenant.
 *
 * Demuestra el sistema de permisos: cada endpoint declara qué permiso atómico
 * exige. El PermissionsGuard valida contra el set efectivo del user logueado.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  buildCsv,
  buildCsvFilename,
  CSV_EXPORT_MAX_ROWS,
  type CsvColumn,
} from '../common/csv';
import { NotFoundException } from '@nestjs/common';
import { users, type User } from '@casino/db';
import { AuditLogService } from '../audit/audit-log.service';
import { extractRequestContext } from '../request-context/request-context';
import { ScopeTarget } from '../user-hierarchy/scope-target.decorator';
import { ScopeGuard } from '../user-hierarchy/scope.guard';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import { EffectivePermissionsService } from '../permissions/effective-permissions.service';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { RequirePermissions } from '../permissions/require-permissions.decorator';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import { CreateTenantUserDto } from './dto/create-tenant-user.dto';
import { UpdateTenantUserDto } from './dto/update-tenant-user.dto';
import { TenantUsersService } from './tenant-users.service';

/** Quita campos sensibles antes de mandarlos a audit. */
function safeSnapshot(u: User): Omit<User, 'passwordHash' | 'twoFaSecret'> {
  const { passwordHash: _ph, twoFaSecret: _tfa, ...rest } = u;
  return rest;
}

@Controller('tenant/users')
@UseGuards(TenantJwtGuard, PermissionsGuard, ScopeGuard)
export class TenantUsersController {
  constructor(
    private readonly tenantUsersService: TenantUsersService,
    private readonly effectivePermissions: EffectivePermissionsService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * GET /tenant/users
   * Lista todos los users del tenant.
   * Requiere `users.view_any`.
   */
  @Get()
  @RequirePermissions('users.view_any')
  async list(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser()
    requester: { id: string; username: string },
  ): Promise<{
    data: Array<{
      id: string;
      username: string;
      email: string | null;
      displayName: string;
      status: string;
      createdAt: Date;
    }>;
    count: number;
    requestedBy: string;
  }> {
    if (!req.tenantContext) {
      throw new Error('TenantContext faltante.');
    }
    const db = req.tenantContext.db;
    const rows = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        displayName: users.displayName,
        status: users.status,
        createdAt: users.createdAt,
      })
      .from(users);

    return {
      data: rows,
      count: rows.length,
      requestedBy: requester.username,
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
   * Body: { username, password, displayName, email?, phone?, roleCode }
   * 201: { user, createdBy }
   * 400: rol no existe / DTO inválido
   * 409: username o email duplicado
   */
  @Post()
  @RequirePermissions('users.create')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateTenantUserDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<{ user: Omit<User, 'passwordHash' | 'twoFaSecret'>; createdBy: string }> {
    if (!req.tenantContext) {
      throw new Error('TenantContext faltante.');
    }
    const db = req.tenantContext.db;
    const created = await this.tenantUsersService.create(db, {
      username: dto.username,
      password: dto.password,
      displayName: dto.displayName,
      email: dto.email,
      phone: dto.phone,
      roleCode: dto.roleCode,
      createdBy: actor.id,
    });

    const safe = safeSnapshot(created);

    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'users.create',
      targetType: 'user',
      targetId: created.id,
      after: safe,
      metadata: { roleCode: dto.roleCode },
      ...extractRequestContext(req),
    });

    return {
      user: safe,
      createdBy: actor.username,
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
