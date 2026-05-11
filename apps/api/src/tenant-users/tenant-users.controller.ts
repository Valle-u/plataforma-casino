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
  UseGuards,
} from '@nestjs/common';
import { users, type User } from '@casino/db';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { RequirePermissions } from '../permissions/require-permissions.decorator';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import { CreateTenantUserDto } from './dto/create-tenant-user.dto';
import { UpdateTenantUserDto } from './dto/update-tenant-user.dto';
import { TenantUsersService } from './tenant-users.service';

@Controller('tenant/users')
@UseGuards(TenantJwtGuard, PermissionsGuard)
export class TenantUsersController {
  constructor(private readonly tenantUsersService: TenantUsersService) {}

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

    // Sacamos campos sensibles antes de devolver.
    const { passwordHash: _, twoFaSecret: __, ...safe } = created;
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
    const updated = await this.tenantUsersService.update(req.tenantContext.db, userId, {
      status: dto.status,
      displayName: dto.displayName,
      email: dto.email,
      phone: dto.phone,
    });

    const { passwordHash: _, twoFaSecret: __, ...safe } = updated;
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
  @HttpCode(HttpStatus.OK)
  async addRole(
    @Param('id', ParseUUIDPipe) userId: string,
    @Param('roleCode') roleCode: string,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<{ added: boolean; userId: string; roleCode: string; by: string }> {
    if (!req.tenantContext) throw new Error('TenantContext faltante.');
    const { added } = await this.tenantUsersService.addRole(
      req.tenantContext.db,
      userId,
      roleCode,
      actor.id,
    );
    return { added, userId, roleCode, by: actor.username };
  }

  /**
   * DELETE /tenant/users/:id/roles/:roleCode
   * Quita un rol del user. Idempotente.
   * Requiere `users.edit`.
   */
  @Delete(':id/roles/:roleCode')
  @RequirePermissions('users.edit')
  @HttpCode(HttpStatus.OK)
  async removeRole(
    @Param('id', ParseUUIDPipe) userId: string,
    @Param('roleCode') roleCode: string,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<{ removed: boolean; userId: string; roleCode: string; by: string }> {
    if (!req.tenantContext) throw new Error('TenantContext faltante.');
    const { removed } = await this.tenantUsersService.removeRole(
      req.tenantContext.db,
      userId,
      roleCode,
    );
    return { removed, userId, roleCode, by: actor.username };
  }
}
