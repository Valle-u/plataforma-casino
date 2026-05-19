/**
 * GamesController — CRUD admin + listing player-facing.
 *
 * Endpoints:
 *
 *   Player-facing (sin permission, solo TenantJwtGuard):
 *     - GET /tenant/games/active?category=&featuredOnly=  → lobby.
 *     - GET /tenant/games/code/:code                       → detalle por code.
 *
 *   Admin:
 *     - GET    /tenant/games                  (games.edit)
 *     - GET    /tenant/games/:id              (games.edit)
 *     - POST   /tenant/games                  (games.edit)
 *     - PATCH  /tenant/games/:id              (games.edit)
 *     - POST   /tenant/games/:id/archive      (games.edit)
 *
 * Mutations auditadas con severity:medium (catálogo, no plata directa).
 *
 * NOTE: `/active` y `/code/:code` van ANTES de `/:id` para evitar
 * que `code` se intente parsear como UUID.
 */

import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { RequirePermissions } from '../permissions/require-permissions.decorator';
import { extractRequestContext } from '../request-context/request-context';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import type { Game } from '@casino/db';
import { CreateGameDto, UpdateGameDto } from './dto/game.dto';
import { GameCodeConflictError, GameNotFoundError } from './games.errors';
import { GamesService } from './games.service';

@Controller('tenant/games')
@UseGuards(TenantJwtGuard, PermissionsGuard)
export class GamesController {
  constructor(
    private readonly service: GamesService,
    private readonly audit: AuditLogService,
  ) {}

  // ──────────────────────────────────────────────────────────────────────
  // Player-facing
  // ──────────────────────────────────────────────────────────────────────

  /** Lobby: lista activos (filtros opcionales category + featuredOnly). */
  @Get('active')
  async listActive(
    @Req() req: RequestWithTenantContext,
    @Query('category') category?: string,
    @Query('featuredOnly') featuredOnly?: string,
  ) {
    const db = req.tenantContext!.db;
    const data = await this.service.listActiveForPlayer(db, {
      category: category as Game['category'] | undefined,
      featuredOnly: featuredOnly === 'true',
    });
    return { data };
  }

  /** Detalle por code (para el iframe del juego). */
  @Get('code/:code')
  async getByCode(
    @Param('code') code: string,
    @Req() req: RequestWithTenantContext,
  ) {
    const db = req.tenantContext!.db;
    try {
      const game = await this.service.findByCode(db, code);
      // Player NO ve juegos archivados — devolver 404 si no activo.
      if (!game.isActive) {
        throw new NotFoundException({
          message: `Game '${code}' no disponible.`,
          error: 'GAME_NOT_FOUND',
        });
      }
      return game;
    } catch (err) {
      if (err instanceof GameNotFoundError) {
        throw new NotFoundException({
          message: err.message,
          error: 'GAME_NOT_FOUND',
        });
      }
      throw err;
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Admin
  // ──────────────────────────────────────────────────────────────────────

  @Get()
  @RequirePermissions('games.edit')
  async list(
    @Req() req: RequestWithTenantContext,
    @Query('category') category?: string,
    @Query('activeOnly') activeOnly?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const db = req.tenantContext!.db;
    return this.service.list(db, {
      category: category as Game['category'] | undefined,
      activeOnly: activeOnly === 'true',
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Get(':id')
  @RequirePermissions('games.edit')
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
  ) {
    const db = req.tenantContext!.db;
    try {
      return await this.service.findById(db, id);
    } catch (err) {
      if (err instanceof GameNotFoundError) {
        throw new NotFoundException({
          message: err.message,
          error: 'GAME_NOT_FOUND',
        });
      }
      throw err;
    }
  }

  @Post()
  @RequirePermissions('games.edit')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateGameDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    let created;
    try {
      created = await this.service.create(db, dto);
    } catch (err) {
      if (err instanceof GameCodeConflictError) {
        throw new ConflictException({
          message: err.message,
          error: 'GAME_CODE_CONFLICT',
        });
      }
      throw err;
    }
    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'games.create',
      targetType: 'game',
      targetId: created.id,
      after: {
        code: created.code,
        name: created.name,
        category: created.category,
        isActive: created.isActive,
      },
      metadata: { severity: 'medium' },
      ...extractRequestContext(req),
    });
    return created;
  }

  @Patch(':id')
  @RequirePermissions('games.edit')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGameDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    let before;
    try {
      before = await this.service.findById(db, id);
    } catch (err) {
      if (err instanceof GameNotFoundError) {
        throw new NotFoundException({
          message: err.message,
          error: 'GAME_NOT_FOUND',
        });
      }
      throw err;
    }
    const updated = await this.service.update(db, id, dto);
    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'games.edit',
      targetType: 'game',
      targetId: id,
      before: { name: before.name, isActive: before.isActive, featured: before.featured },
      after: { name: updated.name, isActive: updated.isActive, featured: updated.featured },
      metadata: { severity: 'medium' },
      ...extractRequestContext(req),
    });
    return updated;
  }

  @Post(':id/archive')
  @RequirePermissions('games.edit')
  @HttpCode(HttpStatus.OK)
  async archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    let before;
    try {
      before = await this.service.findById(db, id);
    } catch (err) {
      if (err instanceof GameNotFoundError) {
        throw new NotFoundException({
          message: err.message,
          error: 'GAME_NOT_FOUND',
        });
      }
      throw err;
    }
    const updated = await this.service.archive(db, id);
    if (before.isActive) {
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'games.archive',
        targetType: 'game',
        targetId: id,
        before: { isActive: true },
        after: { isActive: false },
        metadata: { severity: 'medium' },
        ...extractRequestContext(req),
      });
    }
    return updated;
  }
}
