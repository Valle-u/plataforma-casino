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
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  Logger,
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
import {
  BetLimitPerRoundExceededError,
  LossLimitExceededError,
  UserExcludedError,
} from '../responsible-gaming/responsible-gaming.errors';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import { InsufficientBalanceError } from '../wallet/wallet.errors';
import type { Game } from '@casino/db';
import { CreateGameDto, UpdateGameDto } from './dto/game.dto';
import { PlaceBetDto } from './dto/session.dto';
import { GameRoundsService } from './game-rounds.service';
import {
  GameSessionNotActiveError,
  GameSessionNotFoundError,
  GameSessionUserMismatchError,
} from './game-sessions.errors';
import { GameSessionsService } from './game-sessions.service';
import {
  GameBetOutOfRangeError,
  GameRoundNotFoundError,
  GameWinExceedsCeilingError,
} from './game-rounds.errors';
import { BettingCapExceededError } from '../house/betting-caps.errors';
import {
  GameCodeConflictError,
  GameInvalidConfigError,
  GameNotActiveError,
  GameNotFoundError,
} from './games.errors';
import { GamesService } from './games.service';

@Controller('tenant/games')
@UseGuards(TenantJwtGuard, PermissionsGuard)
export class GamesController {
  private readonly logger = new Logger(GamesController.name);
  constructor(
    private readonly service: GamesService,
    private readonly audit: AuditLogService,
    private readonly sessions: GameSessionsService,
    private readonly rounds: GameRoundsService,
  ) {}

  // ──────────────────────────────────────────────────────────────────────
  // Player-facing
  // ──────────────────────────────────────────────────────────────────────

  /** Lobby: lista activos con paginación y búsqueda (filtros opcionales). */
  @Get('active')
  async listActive(
    @Req() req: RequestWithTenantContext,
    @Query('category') category?: string,
    @Query('featuredOnly') featuredOnly?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const db = req.tenantContext!.db;
    return this.service.listActiveForPlayer(db, {
      category: category as Game['category'] | undefined,
      featuredOnly: featuredOnly === 'true',
      search: search || undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  /**
   * GET /tenant/games/recent-wins?limit=10 — Sprint 52.1.
   *
   * Feed público de ganadores recientes. Cualquier user logueado lo
   * consume. Usernames anonimizados ("leo***"). Sin permisos especiales.
   *
   * Frontend lo polls cada ~15-25s desde LiveWinsTicker.
   */
  @Get('recent-wins')
  async listRecentWins(
    @Req() req: RequestWithTenantContext,
    @Query('limit') limitRaw?: string,
  ) {
    const db = req.tenantContext!.db;
    const limit = limitRaw ? Math.max(1, Math.min(50, Number(limitRaw) || 10)) : 10;
    const data = await this.service.listRecentPublicWins(db, limit);
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
  // Player game loop (Sprint 35)
  // ──────────────────────────────────────────────────────────────────────

  /**
   * POST /tenant/games/code/:code/launch
   *
   * Player: abre una nueva game_session sobre el game `code` y devuelve
   * launchUrl + sessionId. Si el game no existe / no activo → 404 / 409.
   * Si user tiene auto-exclusion activa → 403.
   */
  @Post('code/:code/launch')
  @HttpCode(HttpStatus.CREATED)
  async launchGame(
    @Param('code') code: string,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    let game;
    try {
      game = await this.service.findByCode(db, code);
    } catch (err) {
      if (err instanceof GameNotFoundError) {
        throw new NotFoundException({
          message: err.message,
          error: 'GAME_NOT_FOUND',
        });
      }
      throw err;
    }
    const ctx = extractRequestContext(req);
    try {
      const { session, launchUrl } = await this.sessions.createSession(db, {
        game,
        userId: actor.id,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      });
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'games.launch',
        targetType: 'game_session',
        targetId: session.id,
        after: {
          gameCode: game.code,
          gameId: game.id,
          openedBalance: session.openedBalance,
        },
        metadata: { severity: 'low' },
        ...ctx,
      });
      return {
        sessionId: session.id,
        launchUrl,
        openedBalance: session.openedBalance,
      };
    } catch (err) {
      const mapped = this.mapGameError(err);
      // Loggear errores inesperados antes de reenviar
      if (err instanceof Error && !(err.constructor.name.startsWith('Game'))) {
        this.logger.error(`launchGame error: ${err.message}`, err.stack);
        throw new InternalServerErrorException({
          message: 'Launch game failed',
          error: err.message,
        });
      }
      throw mapped;
    }
  }

  /**
   * GET /tenant/game-sessions
   *
   * Player: lista las sesiones activas del usuario logueado.
   * Admin: puede ver sesiones de cualquier usuario vía query param ?userId=.
   */
  @Get('sessions')
  async listSessions(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
    @Query('userId') userId?: string,
  ) {
    const db = req.tenantContext!.db;
    const targetUserId = userId || actor.id;
    const sessions = await this.sessions.listActiveForUser(db, targetUserId);
    return { data: sessions, total: sessions.length };
  }

  /**
   * POST /tenant/games/sessions/:id/bet
   *
   * Player coloca un bet en una session activa. Mock síncrono: el
   * settle (RNG) corre en el mismo request y devuelve el resultado.
   *
   * Errores: bet fuera de rango (400), session no activa (409), user
   * excluido (403), bet excede caps de responsible gaming (409),
   * insufficient balance (409).
   */
  @Post('sessions/:id/bet')
  @HttpCode(HttpStatus.OK)
  async placeBet(
    @Param('id', ParseUUIDPipe) sessionId: string,
    @Body() dto: PlaceBetDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
  ) {
    const db = req.tenantContext!.db;
    let session;
    try {
      session = await this.sessions.findByIdForActor(db, sessionId, actor.id);
    } catch (err) {
      throw this.mapGameError(err);
    }
    try {
      const round = await this.rounds.placeBetAndSettle(db, {
        session,
        actorUserId: actor.id,
        betAmount: dto.amount,
        clientRoundId: dto.clientRoundId,
      });
      return round;
    } catch (err) {
      throw this.mapGameError(err);
    }
  }

  /**
   * POST /tenant/games/sessions/:id/close
   *
   * Player cierra la session (idempotente). Snapshot del closing_balance.
   */
  @Post('sessions/:id/close')
  @HttpCode(HttpStatus.OK)
  async closeSession(
    @Param('id', ParseUUIDPipe) sessionId: string,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
  ) {
    const db = req.tenantContext!.db;
    try {
      return await this.sessions.closeSession(db, sessionId, actor.id);
    } catch (err) {
      throw this.mapGameError(err);
    }
  }

  /**
   * GET /tenant/games/sessions/active
   *
   * Player: sus sessions activas (hasta 20). Para UI "tus partidas en curso".
   */
  @Get('sessions/active')
  async listActiveSessions(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
  ) {
    const db = req.tenantContext!.db;
    const data = await this.sessions.listActiveForUser(db, actor.id);
    return { data };
  }

  /**
   * GET /tenant/games/sessions/:id/rounds
   *
   * Player: history de rounds de una session (ownership validado).
   */
  @Get('sessions/:id/rounds')
  async listSessionRounds(
    @Param('id', ParseUUIDPipe) sessionId: string,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
    @Query('limit') limit?: string,
  ) {
    const db = req.tenantContext!.db;
    try {
      // Ownership check via findByIdForActor (no necesitamos el session row).
      await this.sessions.findByIdForActor(db, sessionId, actor.id);
    } catch (err) {
      throw this.mapGameError(err);
    }
    const lim = limit ? Math.min(Number(limit), 200) : 50;
    const data = await this.rounds.listForSession(db, sessionId, lim);
    return { data };
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
      if (err instanceof GameInvalidConfigError) {
        throw new BadRequestException({
          message: err.message,
          error: 'GAME_INVALID_CONFIG',
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
    let updated;
    try {
      updated = await this.service.update(db, id, dto);
    } catch (err) {
      if (err instanceof GameInvalidConfigError) {
        throw new BadRequestException({
          message: err.message,
          error: 'GAME_INVALID_CONFIG',
        });
      }
      throw err;
    }
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

  // ──────────────────────────────────────────────────────────────────────
  // Error mapping del player game loop
  // ──────────────────────────────────────────────────────────────────────

  private mapGameError(err: unknown): Error {
    if (err instanceof GameNotActiveError) {
      return new ConflictException({
        message: err.message,
        error: 'GAME_NOT_ACTIVE',
      });
    }
    if (err instanceof GameSessionNotFoundError) {
      return new NotFoundException({
        message: err.message,
        error: 'GAME_SESSION_NOT_FOUND',
      });
    }
    if (err instanceof GameSessionNotActiveError) {
      return new ConflictException({
        message: err.message,
        error: 'GAME_SESSION_NOT_ACTIVE',
      });
    }
    if (err instanceof GameSessionUserMismatchError) {
      return new ForbiddenException({
        message: err.message,
        error: 'GAME_SESSION_USER_MISMATCH',
      });
    }
    if (err instanceof GameBetOutOfRangeError) {
      return new BadRequestException({
        message: err.message,
        error: 'GAME_BET_OUT_OF_RANGE',
        minBet: err.minBet,
        maxBet: err.maxBet,
      });
    }
    if (err instanceof GameRoundNotFoundError) {
      return new NotFoundException({
        message: err.message,
        error: 'GAME_ROUND_NOT_FOUND',
      });
    }
    if (err instanceof GameWinExceedsCeilingError) {
      return new ConflictException({
        message: err.message,
        error: 'GAME_WIN_EXCEEDS_CEILING',
        winAmount: err.winAmount,
        ceiling: err.ceiling,
      });
    }
    if (err instanceof UserExcludedError) {
      return new ForbiddenException({
        message: err.message,
        error: 'USER_EXCLUDED',
        exclusionType: err.type,
        endsAt: err.endsAt,
      });
    }
    if (err instanceof BetLimitPerRoundExceededError) {
      return new ConflictException({
        message: err.message,
        error: 'BET_LIMIT_EXCEEDED',
        cap: err.cap,
        attempted: err.attempted,
      });
    }
    if (err instanceof BettingCapExceededError) {
      return new ConflictException({
        message: err.message,
        error: 'BETTING_CAP_EXCEEDED',
        level: err.level,
        cap: err.cap,
        current: err.current,
      });
    }
    if (err instanceof LossLimitExceededError) {
      return new ConflictException({
        message: err.message,
        error: 'LOSS_LIMIT_EXCEEDED',
        window: err.window,
        cap: err.cap,
        currentLoss: err.currentLoss,
        attempted: err.attempted,
      });
    }
    if (err instanceof InsufficientBalanceError) {
      return new ConflictException({
        message: err.message,
        error: 'INSUFFICIENT_BALANCE',
        available: err.available,
        required: err.required,
      });
    }
    return err as Error;
  }
}
