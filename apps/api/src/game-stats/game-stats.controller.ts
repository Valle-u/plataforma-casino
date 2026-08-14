/**
 * GameStatsController — endpoints read-only de reporting de juego.
 *
 * Sigue patrón de WalletStatsController (Sprint 45):
 *   - @PanelOnly() bloquea players con JWT.
 *   - @PermissionsGuard valida game_stats.{view_any|view_own_network|export}.
 *   - Scope downstream via UserHierarchyService.getActiveDescendants.
 *
 * Endpoints:
 *   - GET /tenant/game-stats/rounds        list paginada filtrable
 *   - GET /tenant/game-stats/summary       totales GGR + RTP real
 *   - GET /tenant/game-stats/by-game       breakdown por juego + flag RTP
 *   - GET /tenant/game-stats/by-player     top players por volumen
 *   - GET /tenant/game-stats/export        CSV de rounds
 */

import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import {
  buildCsv,
  buildCsvFilename,
  CSV_EXPORT_MAX_ROWS,
  type CsvColumn,
} from '../common/csv';
import { EffectivePermissionsService } from '../permissions/effective-permissions.service';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { RequirePermissions } from '../permissions/require-permissions.decorator';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import { PanelOnly } from '../tenant-auth/panel-only.decorator';
import type {
  RequestWithTenantContext,
  TenantDb,
} from '../tenant-resolver/tenant-context';
import { UserHierarchyService } from '../user-hierarchy/user-hierarchy.service';
import {
  GameStatsService,
  type RoundRow,
  type RoundStatus,
} from './game-stats.service';

@Controller('tenant/game-stats')
@UseGuards(TenantJwtGuard, PermissionsGuard)
@PanelOnly()
export class GameStatsController {
  constructor(
    private readonly stats: GameStatsService,
    private readonly hierarchy: UserHierarchyService,
    private readonly effectivePermissions: EffectivePermissionsService,
  ) {}

  private async resolveScope(
    db: TenantDb,
    actorId: string,
  ): Promise<string[] | undefined> {
    const hasViewAll = await this.effectivePermissions.hasAllPermissions(
      db,
      actorId,
      ['game_stats.view_any'],
    );
    if (hasViewAll) return undefined;
    const downstream = await this.hierarchy.getActiveDescendants(db, actorId);
    return [actorId, ...downstream];
  }

  @Get('rounds')
  @RequirePermissions('game_stats.view_own_network')
  async listRounds(
    @CurrentTenantUser() actor: { id: string },
    @Req() req: RequestWithTenantContext,
    @Query('gameCode') gameCode?: string,
    @Query('userId') userId?: string,
    @Query('sessionId') sessionId?: string,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('minBet') minBet?: string,
    @Query('maxBet') maxBet?: string,
    @Query('outcome') outcome?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const db = this.requireDb(req);
    const restrictToUserIds = await this.resolveScope(db, actor.id);
    return this.stats.listRounds(db, {
      gameCode,
      userId,
      sessionId,
      status: status as RoundStatus | undefined,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      minBet: minBet !== undefined ? Number(minBet) : undefined,
      maxBet: maxBet !== undefined ? Number(maxBet) : undefined,
      outcome: outcome as 'win' | 'loss' | 'zero' | undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      restrictToUserIds,
    });
  }

  @Get('summary')
  @RequirePermissions('game_stats.view_own_network')
  async summary(
    @CurrentTenantUser() actor: { id: string },
    @Req() req: RequestWithTenantContext,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const db = this.requireDb(req);
    const restrictToUserIds = await this.resolveScope(db, actor.id);
    return this.stats.summary(db, {
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      restrictToUserIds,
    });
  }

  /**
   * GET /tenant/game-stats/reconciliation — por qué el netwin de esta página
   * puede no coincidir con Estadísticas de pago/Comisiones (2026-08). Ver
   * doc en `GameStatsService.getReconciliation`.
   */
  @Get('reconciliation')
  @RequirePermissions('game_stats.view_own_network')
  async reconciliation(
    @CurrentTenantUser() actor: { id: string },
    @Req() req: RequestWithTenantContext,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const db = this.requireDb(req);
    const restrictToUserIds = await this.resolveScope(db, actor.id);
    return this.stats.getReconciliation(db, {
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      restrictToUserIds,
    });
  }

  @Get('by-game')
  @RequirePermissions('game_stats.view_own_network')
  async byGame(
    @CurrentTenantUser() actor: { id: string },
    @Req() req: RequestWithTenantContext,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const db = this.requireDb(req);
    const restrictToUserIds = await this.resolveScope(db, actor.id);
    return this.stats.byGame(db, {
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      restrictToUserIds,
    });
  }

  @Get('by-player')
  @RequirePermissions('game_stats.view_own_network')
  async byPlayer(
    @CurrentTenantUser() actor: { id: string },
    @Req() req: RequestWithTenantContext,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('limit') limit?: string,
  ) {
    const db = this.requireDb(req);
    const restrictToUserIds = await this.resolveScope(db, actor.id);
    return this.stats.byPlayer(db, {
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      limit: limit ? Number(limit) : undefined,
      restrictToUserIds,
    });
  }

  @Get('export')
  @RequirePermissions('game_stats.export')
  async export(
    @CurrentTenantUser() actor: { id: string },
    @Req() req: RequestWithTenantContext,
    @Res() res: Response,
    @Query('gameCode') gameCode?: string,
    @Query('userId') userId?: string,
    @Query('sessionId') sessionId?: string,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('minBet') minBet?: string,
    @Query('maxBet') maxBet?: string,
    @Query('outcome') outcome?: string,
  ): Promise<void> {
    const db = this.requireDb(req);
    const restrictToUserIds = await this.resolveScope(db, actor.id);

    // Espejo EXACTO de los filtros de /rounds — antes el export descartaba
    // sessionId/status/minBet/maxBet, así que el CSV no coincidía con la tabla.
    const rows = await this.stats.listForExport(
      db,
      {
        gameCode,
        userId,
        sessionId,
        status: status as RoundStatus | undefined,
        dateFrom: dateFrom ? new Date(dateFrom) : undefined,
        dateTo: dateTo ? new Date(dateTo) : undefined,
        minBet: minBet !== undefined ? Number(minBet) : undefined,
        maxBet: maxBet !== undefined ? Number(maxBet) : undefined,
        outcome: outcome as 'win' | 'loss' | 'zero' | undefined,
        restrictToUserIds,
      },
      CSV_EXPORT_MAX_ROWS,
    );

    const columns: CsvColumn<RoundRow>[] = [
      { header: 'fecha', value: (r) => r.placedAt },
      { header: 'provider', value: (r) => r.providerCode },
      { header: 'juego', value: (r) => r.gameCode },
      { header: 'juego_nombre', value: (r) => r.gameName },
      { header: 'jugador_username', value: (r) => r.username },
      { header: 'jugador_nombre', value: (r) => r.displayName },
      { header: 'status', value: (r) => r.status },
      { header: 'outcome', value: (r) => r.outcome },
      { header: 'bet', value: (r) => r.betAmount },
      { header: 'win', value: (r) => r.winAmount },
      { header: 'net', value: (r) => r.netAmount },
      { header: 'balance_post_bet', value: (r) => r.balanceAfter ?? '' },
      { header: 'round_external_id', value: (r) => r.roundExternalId },
      { header: 'session_id', value: (r) => r.sessionId },
      {
        header: 'settled_at',
        value: (r) => r.settledAt ?? '',
      },
    ];
    const csv = buildCsv(columns, rows);
    const filename = buildCsvFilename('game-stats');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }

  private requireDb(req: RequestWithTenantContext): TenantDb {
    if (!req.tenantContext) {
      throw new Error('TenantContext no resuelto.');
    }
    return req.tenantContext.db;
  }
}
