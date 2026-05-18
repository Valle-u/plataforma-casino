/**
 * PromotionsController — CRUD admin + endpoints user-facing.
 *
 * Endpoints:
 *   GET    /tenant/promotions                       → lista (públic-ish, vía permission view)
 *   GET    /tenant/promotions/:id                   → detalle
 *   POST   /tenant/promotions                       → crear (permission)
 *   PATCH  /tenant/promotions/:id                   → editar (permission)
 *   POST   /tenant/promotions/:id/spin              → user gira (daily_wheel)
 *   GET    /tenant/promotions/:id/my-rewards        → mi historial en esa promo
 *
 * No hay DELETE — el admin pasa la promo a status='cancelled' vía PATCH.
 */

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { Promotion } from '@casino/db';
import { AuditLogService } from '../audit/audit-log.service';
import {
  buildCsv,
  buildCsvFilename,
  CSV_EXPORT_MAX_ROWS,
  type CsvColumn,
} from '../common/csv';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { RequirePermissions } from '../permissions/require-permissions.decorator';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { extractRequestContext } from '../request-context/request-context';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import { DailyWheelService } from './daily-wheel.service';
import { LoginStreakService } from './login-streak.service';
import {
  CreatePromotionDto,
  UpdatePromotionDto,
} from './dto/promotion.dto';
import {
  FunderInsufficientBalanceError,
  PromotionAlreadyClaimedError,
  PromotionCodeConflictError,
  PromotionNotActiveError,
  PromotionNotFoundError,
  PromotionScheduleClosedError,
  PromotionTypeMismatchError,
  WheelConfigInvalidError,
} from './promotions.errors';
import { PromotionsService } from './promotions.service';

@Controller('tenant/promotions')
@UseGuards(TenantJwtGuard, PermissionsGuard)
export class PromotionsController {
  private readonly logger = new Logger(PromotionsController.name);

  constructor(
    private readonly service: PromotionsService,
    private readonly wheelService: DailyWheelService,
    private readonly streakService: LoginStreakService,
    private readonly audit: AuditLogService,
  ) {}

  // ──────────────────────────────────────────────────────────────────────
  // CRUD admin
  // ──────────────────────────────────────────────────────────────────────

  @Get()
  @RequirePermissions('promotions.view')
  async list(
    @Req() req: RequestWithTenantContext,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const db = req.tenantContext!.db;
    return this.service.list(db, {
      type,
      status,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  /**
   * GET /tenant/promotions/export
   * Export CSV de promotions con los mismos filtros que `list` (type, status).
   * Cap `CSV_EXPORT_MAX_ROWS`. Records audit `promotion.export`.
   */
  @Get('export')
  @RequirePermissions('promotions.export')
  async exportCsv(
    @Req() req: RequestWithTenantContext,
    @Res() res: Response,
    @CurrentTenantUser() actor: { id: string; username: string },
    @Query('type') type?: string,
    @Query('status') status?: string,
  ): Promise<void> {
    const db = req.tenantContext!.db;
    const { data, total } = await this.service.list(db, {
      type,
      status,
      limit: CSV_EXPORT_MAX_ROWS,
      offset: 0,
    });

    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'promotion.export',
      targetType: 'promotion',
      targetId: null,
      metadata: {
        rowCount: data.length,
        totalMatched: total,
        truncated: total > data.length,
        filters: { type: type ?? null, status: status ?? null },
        severity: 'medium',
      },
      ...extractRequestContext(req),
    });

    const csv = buildCsv<Promotion>(PROMOTION_CSV_COLUMNS, data);
    const filename = buildCsvFilename('promotions');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Total-Rows', String(data.length));
    if (total > data.length) res.setHeader('X-Truncated', 'true');
    res.send(csv);
  }

  /**
   * GET /tenant/promotions/active?type=daily_wheel
   *
   * Player-facing: lista promociones `status='active'` y dentro de la
   * ventana de schedule. SIN permission especial — solo JWT.
   *
   * Sirve para que el frontend del player descubra qué promos puede
   * mostrarle al usuario (wheel, streak, etc.) sin tener que conocer
   * el `id` de antemano. El listing admin sigue siendo `/` con
   * `promotions.view`.
   */
  @Get('active')
  async listActive(
    @Req() req: RequestWithTenantContext,
    @Query('type') type?: string,
  ) {
    const db = req.tenantContext!.db;
    const data = await this.service.listActiveForPlayer(db, { type });
    return { data };
  }

  @Get(':id')
  @RequirePermissions('promotions.view')
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
  ) {
    const db = req.tenantContext!.db;
    try {
      return await this.service.findById(db, id);
    } catch (err) {
      if (err instanceof PromotionNotFoundError) {
        throw new NotFoundException({ message: err.message, error: 'PROMOTION_NOT_FOUND' });
      }
      throw err;
    }
  }

  @Post()
  @RequirePermissions('promotions.create_definition')
  async create(
    @Body() dto: CreatePromotionDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    let created;
    try {
      created = await this.service.create(db, actor.id, dto);
    } catch (err) {
      if (err instanceof PromotionCodeConflictError) {
        throw new ConflictException({
          message: err.message,
          error: 'PROMOTION_CODE_CONFLICT',
        });
      }
      throw err;
    }
    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'promotion.create',
      targetType: 'promotion',
      targetId: created.id,
      after: { code: created.code, type: created.type, status: created.status },
      metadata: { severity: 'medium' },
      ...extractRequestContext(req),
    });
    return created;
  }

  @Patch(':id')
  @RequirePermissions('promotions.edit_definition')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePromotionDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    let before;
    try {
      before = await this.service.findById(db, id);
    } catch (err) {
      if (err instanceof PromotionNotFoundError) {
        throw new NotFoundException({ message: err.message, error: 'PROMOTION_NOT_FOUND' });
      }
      throw err;
    }
    const updated = await this.service.update(db, id, dto);
    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'promotion.edit',
      targetType: 'promotion',
      targetId: id,
      before: { status: before.status, name: before.name },
      after: { status: updated.status, name: updated.name },
      metadata: { severity: 'medium' },
      ...extractRequestContext(req),
    });
    return updated;
  }

  // ──────────────────────────────────────────────────────────────────────
  // User-facing: daily wheel spin
  // ──────────────────────────────────────────────────────────────────────

  /**
   * POST /tenant/promotions/:id/spin
   *
   * El user gira la ruleta diaria. Idempotente por día (UTC): un mismo
   * day-anchor → mismo reward (raceada → 200 con reward existente).
   *
   * Rate limit: 30/min por user para evitar abuso de retries — la
   * idempotency natural ya lo blinda pero queremos cortar floodings.
   */
  @Post(':id/spin')
  @RateLimit({
    rule: 'promotions.spin',
    limit: 30,
    windowSec: 60,
    scope: 'user',
  })
  @HttpCode(HttpStatus.OK)
  async spin(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
  ) {
    const db = req.tenantContext!.db;
    try {
      const result = await this.wheelService.spin(db, {
        promotionId: id,
        userId: actor.id,
      });
      // Audit del spin para forensics.
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: null,
        actionCode: 'promotion.spin',
        targetType: 'promotion',
        targetId: id,
        after: {
          rewardId: result.reward.id,
          prize: result.reward.prize,
          segmentId: result.segment.id,
        },
        metadata: { severity: 'low', rng: result.rng },
        ...extractRequestContext(req),
      });
      return {
        rewardId: result.reward.id,
        segmentId: result.segment.id,
        segmentLabel: result.segment.label,
        prize: result.reward.prize,
        grantedAt: result.reward.grantedAt,
      };
    } catch (err) {
      throw this.mapError(err);
    }
  }

  @Get(':id/my-rewards')
  @HttpCode(HttpStatus.OK)
  async myRewards(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const db = req.tenantContext!.db;
    const data = await this.wheelService.listMyRewards(
      db,
      id,
      actor.id,
      limit ? Number(limit) : 50,
      offset ? Number(offset) : 0,
    );
    return { data };
  }

  // ──────────────────────────────────────────────────────────────────────
  // User-facing: login_streak
  // ──────────────────────────────────────────────────────────────────────

  /**
   * POST /tenant/promotions/:id/claim-streak
   *
   * Reclama el premio del día. Idempotente por (user, dayUTC) — si ya
   * reclamó hoy, retorna el reward existente. Si rompió el streak (gap >
   * forgivenessDays), se resetea a día 1.
   *
   * Rate limit defensivo igual que el spin del wheel.
   */
  @Post(':id/claim-streak')
  @RateLimit({
    rule: 'promotions.claim_streak',
    limit: 30,
    windowSec: 60,
    scope: 'user',
  })
  @HttpCode(HttpStatus.OK)
  async claimStreak(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
  ) {
    const db = req.tenantContext!.db;
    try {
      const result = await this.streakService.claim(db, {
        promotionId: id,
        userId: actor.id,
      });
      if (result.created) {
        await this.audit.record(db, {
          actorUserId: actor.id,
          actorUsername: null,
          actionCode: 'promotion.streak.claim',
          targetType: 'promotion',
          targetId: id,
          after: {
            rewardId: result.reward.id,
            streak: result.streak,
            prize: result.prize,
          },
          metadata: { severity: 'low' },
          ...extractRequestContext(req),
        });
      }
      return {
        rewardId: result.reward.id,
        streak: result.streak,
        prize: result.prize,
        created: result.created,
        grantedAt: result.reward.grantedAt,
      };
    } catch (err) {
      throw this.mapError(err);
    }
  }

  /**
   * GET /tenant/promotions/:id/my-streak
   *
   * Estado del streak del user para la promotion (lectura). Útil para
   * que el frontend muestre "día N de M".
   */
  @Get(':id/my-streak')
  @HttpCode(HttpStatus.OK)
  async myStreak(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
  ) {
    const db = req.tenantContext!.db;
    const progress = await this.streakService.getMyProgress(db, id, actor.id);
    return { progress };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────

  private mapError(err: unknown): Error {
    if (err instanceof PromotionNotFoundError) {
      return new NotFoundException({
        message: err.message,
        error: 'PROMOTION_NOT_FOUND',
      });
    }
    if (err instanceof PromotionTypeMismatchError) {
      return new BadRequestException({
        message: err.message,
        error: 'PROMOTION_TYPE_MISMATCH',
      });
    }
    if (err instanceof PromotionNotActiveError) {
      return new ConflictException({
        message: err.message,
        error: 'PROMOTION_NOT_ACTIVE',
      });
    }
    if (err instanceof PromotionScheduleClosedError) {
      return new ConflictException({
        message: err.message,
        error: 'PROMOTION_SCHEDULE_CLOSED',
      });
    }
    if (err instanceof PromotionAlreadyClaimedError) {
      return new ConflictException({
        message: err.message,
        error: 'PROMOTION_ALREADY_CLAIMED',
      });
    }
    if (err instanceof WheelConfigInvalidError) {
      this.logger.error(`Wheel config inválida: ${err.message}`);
      return new ConflictException({
        message: 'Promotion mal configurada — contactá al admin.',
        error: 'WHEEL_CONFIG_INVALID',
      });
    }
    if (err instanceof FunderInsufficientBalanceError) {
      return new ConflictException({
        message: err.message,
        error: 'FUNDER_INSUFFICIENT_BALANCE',
      });
    }
    return err as Error;
  }
}

// ──────────────────────────────────────────────────────────────────────
// CSV column definitions
// ──────────────────────────────────────────────────────────────────────

const PROMOTION_CSV_COLUMNS: CsvColumn<Promotion>[] = [
  { header: 'created_at', value: (r) => r.createdAt },
  { header: 'id', value: (r) => r.id },
  { header: 'code', value: (r) => r.code },
  { header: 'name', value: (r) => r.name },
  { header: 'type', value: (r) => r.type },
  { header: 'status', value: (r) => r.status },
  { header: 'starts_at', value: (r) => r.startsAt },
  { header: 'ends_at', value: (r) => r.endsAt },
  { header: 'draw_at', value: (r) => r.drawAt },
  { header: 'config', value: (r) => r.config },
  { header: 'prizes', value: (r) => r.prizes },
  { header: 'target_segment', value: (r) => r.targetSegment },
  { header: 'visibility', value: (r) => r.visibility },
  { header: 'scope', value: (r) => r.scope },
  { header: 'funded_by_user_id', value: (r) => r.fundedByUserId },
  { header: 'created_by_user_id', value: (r) => r.createdByUserId },
  { header: 'updated_at', value: (r) => r.updatedAt },
];
