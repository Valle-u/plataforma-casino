/**
 * LeaguesController.
 *
 * Endpoints:
 *   GET    /tenant/leagues                       — lista (permission view)
 *   GET    /tenant/leagues/:id                   — detalle
 *   POST   /tenant/leagues                       — crear (permission create)
 *   PATCH  /tenant/leagues/:id                   — editar (permission edit)
 *   GET    /tenant/leagues/:id/standings         — top N + posición del user
 *   GET    /tenant/leagues/:id/results           — resultados finales (closed)
 *   POST   /tenant/leagues/:id/recompute         — admin force recompute
 *   POST   /tenant/leagues/:id/close             — admin force close+settle
 *   POST   /tenant/leagues/jobs/close-due        — corre el cron manualmente
 *                                                  para todas las vencidas
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
import { asc, eq } from 'drizzle-orm';
import { leagueResults, type League, type LeagueResult } from '@casino/db';
import { AuditLogService } from '../audit/audit-log.service';
import {
  buildCsv,
  buildCsvFilename,
  CSV_EXPORT_MAX_ROWS,
  type CsvColumn,
} from '../common/csv';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { RequirePermissions } from '../permissions/require-permissions.decorator';
import { extractRequestContext } from '../request-context/request-context';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import { CreateLeagueDto, UpdateLeagueDto } from './dto/league.dto';
import { LeaguesCloseCron } from './leagues-close.cron';
import {
  LeagueActorRoleError,
  LeaguePrizesShapeError,
  LeagueCodeConflictError,
  LeagueMetricNotSupportedError,
  LeagueNotClosableError,
  LeagueNotFoundError,
  LeagueScheduleInvalidError,
} from './leagues.errors';
import { LeaguesService } from './leagues.service';

@Controller('tenant/leagues')
@UseGuards(TenantJwtGuard, PermissionsGuard)
// NOTA: NO @PanelOnly() a nivel clase porque endpoints player como
// GET /:id/standings y /:id/results son consumidos por la UI del
// jugador (ver su posición en el ranking). Los endpoints admin
// (recompute, close, create) están protegidos por @RequirePermissions
// — un player con 0 permisos no puede ejecutar nada admin.
export class LeaguesController {
  constructor(
    private readonly service: LeaguesService,
    private readonly closeCron: LeaguesCloseCron,
    private readonly audit: AuditLogService,
  ) {}

  // ──────────────────────────────────────────────────────────────────────
  // CRUD
  // ──────────────────────────────────────────────────────────────────────

  /**
   * GET /tenant/leagues — abierto a cualquier user logueado del tenant.
   * Doc 15 §C5: "Solo logueados pueden ver" + "Premios visibles
   * públicamente (transparencia)". No exigimos permission, solo JWT.
   */
  @Get()
  async list(
    @Req() req: RequestWithTenantContext,
    @Query('status') status?: string,
    @Query('metric') metric?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const db = req.tenantContext!.db;
    return this.service.list(db, {
      status,
      metric,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  /**
   * GET /tenant/leagues/export
   * Export CSV de leagues con los mismos filtros que `list` (status, metric).
   * Cap `CSV_EXPORT_MAX_ROWS`. Records audit `league.export`.
   */
  @Get('export')
  @RequirePermissions('leagues.export')
  async exportCsv(
    @Req() req: RequestWithTenantContext,
    @Res() res: Response,
    @CurrentTenantUser() actor: { id: string; username: string },
    @Query('status') status?: string,
    @Query('metric') metric?: string,
  ): Promise<void> {
    const db = req.tenantContext!.db;
    const { data, total } = await this.service.list(db, {
      status,
      metric,
      limit: CSV_EXPORT_MAX_ROWS,
      offset: 0,
    });

    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'league.export',
      targetType: 'league',
      targetId: null,
      metadata: {
        rowCount: data.length,
        totalMatched: total,
        truncated: total > data.length,
        filters: { status: status ?? null, metric: metric ?? null },
        severity: 'medium',
      },
      ...extractRequestContext(req),
    });

    const csv = buildCsv<League>(LEAGUE_CSV_COLUMNS, data);
    const filename = buildCsvFilename('leagues');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Total-Rows', String(data.length));
    if (total > data.length) res.setHeader('X-Truncated', 'true');
    res.send(csv);
  }

  @Get(':id')
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
  ) {
    const db = req.tenantContext!.db;
    try {
      return await this.service.findById(db, id);
    } catch (err) {
      if (err instanceof LeagueNotFoundError) {
        throw new NotFoundException({ message: err.message, error: 'LEAGUE_NOT_FOUND' });
      }
      throw err;
    }
  }

  @Post()
  @RequirePermissions('leagues.create_definition')
  async create(
    @Body() dto: CreateLeagueDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    let created;
    try {
      created = await this.service.create(db, actor.id, dto);
    } catch (err) {
      throw this.mapError(err);
    }
    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'league.create',
      targetType: 'league',
      targetId: created.id,
      after: {
        code: created.code,
        period: created.period,
        metric: created.metric,
        status: created.status,
      },
      metadata: { severity: 'medium' },
      ...extractRequestContext(req),
    });
    return created;
  }

  @Patch(':id')
  @RequirePermissions('leagues.edit_definition')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeagueDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    let before;
    try {
      before = await this.service.findById(db, id);
    } catch (err) {
      throw this.mapError(err);
    }
    let updated;
    try {
      updated = await this.service.update(db, id, dto, actor.id);
    } catch (err) {
      throw this.mapError(err);
    }
    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'league.edit',
      targetType: 'league',
      targetId: id,
      before: { status: before.status, name: before.name },
      after: { status: updated.status, name: updated.name },
      metadata: { severity: 'medium' },
      ...extractRequestContext(req),
    });
    return updated;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Standings (user-facing) + Results
  // ──────────────────────────────────────────────────────────────────────

  /**
   * GET /tenant/leagues/:id/standings?topN=10
   * Top N + (si el user actual no está en top N) ventana posición-1 ..
   * posición+1 alrededor del user.
   */
  @Get(':id/standings')
  @HttpCode(HttpStatus.OK)
  async standings(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
    @Query('topN') topN?: string,
  ) {
    const db = req.tenantContext!.db;
    const view = await this.service.getStandingsView(
      db,
      id,
      actor.id,
      topN ? Math.min(100, Math.max(1, Number(topN))) : 10,
    );
    return view;
  }

  @Get(':id/results')
  async results(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
  ): Promise<{ data: LeagueResult[] }> {
    const db = req.tenantContext!.db;
    const data = await db
      .select()
      .from(leagueResults)
      .where(eq(leagueResults.leagueId, id))
      .orderBy(asc(leagueResults.finalPosition));
    return { data };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Admin actions
  // ──────────────────────────────────────────────────────────────────────

  /**
   * GET /tenant/leagues/:id/settle-preview — Sprint 51.8.1.
   *
   * Devuelve el ranking actual + qué premio cobraría cada posición SI
   * cerrara ahora. Read-only — no muta nada. Permite sanity-check antes
   * del close definitivo.
   *
   * Requiere `leagues.run_actions` (mismo permiso que close/recompute) —
   * no es info pública.
   */
  @Get(':id/settle-preview')
  @RequirePermissions('leagues.run_actions')
  @HttpCode(HttpStatus.OK)
  async settlePreview(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
  ) {
    const db = req.tenantContext!.db;
    try {
      return await this.service.settlePreview(db, id);
    } catch (err) {
      throw this.mapError(err);
    }
  }

  @Post(':id/recompute')
  @RequirePermissions('leagues.run_actions')
  @HttpCode(HttpStatus.OK)
  async recompute(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    let standings;
    try {
      standings = await this.service.recompute(db, id);
    } catch (err) {
      throw this.mapError(err);
    }
    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'league.recompute',
      targetType: 'league',
      targetId: id,
      metadata: { severity: 'low', participants: standings.length },
      ...extractRequestContext(req),
    });
    return { participants: standings.length };
  }

  @Post(':id/close')
  @RequirePermissions('leagues.run_actions')
  @HttpCode(HttpStatus.OK)
  async close(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    let result;
    try {
      result = await this.service.closeAndSettle(db, id);
    } catch (err) {
      throw this.mapError(err);
    }
    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'league.close.manual',
      targetType: 'league',
      targetId: id,
      metadata: { severity: 'high', ...result },
      ...extractRequestContext(req),
    });
    return result;
  }

  /**
   * Dispara el cron sobre el tenant actual — corre `closeAndSettle` para
   * TODAS las leagues con status='active' AND endsAt < NOW().
   */
  @Post('jobs/close-due')
  @RequirePermissions('leagues.run_actions')
  @HttpCode(HttpStatus.OK)
  async closeDue(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    const results = await this.closeCron.runForTenant(db);
    if (results.length > 0) {
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'league.close_due_job.manual',
        targetType: 'league_batch',
        targetId: null,
        metadata: { severity: 'medium', count: results.length },
        ...extractRequestContext(req),
      });
    }
    return { count: results.length, results };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────

  private mapError(err: unknown): Error {
    if (err instanceof LeagueNotFoundError) {
      return new NotFoundException({ message: err.message, error: 'LEAGUE_NOT_FOUND' });
    }
    if (err instanceof LeagueCodeConflictError) {
      return new ConflictException({ message: err.message, error: 'LEAGUE_CODE_CONFLICT' });
    }
    if (err instanceof LeagueScheduleInvalidError) {
      return new ConflictException({ message: err.message, error: 'LEAGUE_SCHEDULE_INVALID' });
    }
    if (err instanceof LeagueNotClosableError) {
      return new ConflictException({ message: err.message, error: 'LEAGUE_NOT_CLOSABLE' });
    }
    if (err instanceof LeagueMetricNotSupportedError) {
      return new ConflictException({ message: err.message, error: 'LEAGUE_METRIC_NOT_SUPPORTED' });
    }
    if (err instanceof LeagueActorRoleError) {
      return new ForbiddenException({ message: err.message, error: 'LEAGUE_ACTOR_ROLE' });
    }
    if (err instanceof LeaguePrizesShapeError) {
      return new BadRequestException({
        message: err.message,
        error: 'LEAGUE_PRIZES_INVALID',
      });
    }
    return err as Error;
  }
}

// ──────────────────────────────────────────────────────────────────────
// CSV column definitions
// ──────────────────────────────────────────────────────────────────────

const LEAGUE_CSV_COLUMNS: CsvColumn<League>[] = [
  { header: 'created_at', value: (r) => r.createdAt },
  { header: 'id', value: (r) => r.id },
  { header: 'code', value: (r) => r.code },
  { header: 'name', value: (r) => r.name },
  { header: 'period', value: (r) => r.period },
  { header: 'metric', value: (r) => r.metric },
  { header: 'status', value: (r) => r.status },
  { header: 'starts_at', value: (r) => r.startsAt },
  { header: 'ends_at', value: (r) => r.endsAt },
  { header: 'metric_config', value: (r) => r.metricConfig },
  { header: 'prizes', value: (r) => r.prizes },
  { header: 'visibility', value: (r) => r.visibility },
  { header: 'funded_by_user_id', value: (r) => r.fundedByUserId },
  { header: 'created_by_user_id', value: (r) => r.createdByUserId },
  { header: 'updated_at', value: (r) => r.updatedAt },
];
