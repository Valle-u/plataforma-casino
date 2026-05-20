/**
 * WalletStatsController — endpoints read-only de reporting financiero.
 *
 * Endpoints:
 *   - GET /tenant/wallet-stats/movements        list filtrable + paginada
 *   - GET /tenant/wallet-stats/summary          totales in/out/net por bucket
 *   - GET /tenant/wallet-stats/by-role          breakdown por rol del owner
 *   - GET /tenant/wallet-stats/export           CSV con mismos filtros
 *
 * Permisos (Sprint 45):
 *   - `wallet_stats.view_any`        ve todo el tenant
 *   - `wallet_stats.view_own_network` ve solo su red downstream (jerarquía)
 *   - `wallet_stats.export`          CSV (suma a uno de los anteriores)
 *
 * Defense in depth:
 *   - @PanelOnly() bloquea players con JWT (no aplicable, no es info de player).
 *   - @PermissionsGuard valida los permisos atómicos por endpoint.
 *   - Scope downstream se calcula en el controller y se pasa al service
 *     como `restrictToUserIds` — el service NO sabe de jerarquía.
 */

import {
  Controller,
  Get,
  Query,
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
  WalletStatsService,
  type MovementRow,
  type WalletTxType,
} from './wallet-stats.service';

@Controller('tenant/wallet-stats')
@UseGuards(TenantJwtGuard, PermissionsGuard)
@PanelOnly()
export class WalletStatsController {
  constructor(
    private readonly stats: WalletStatsService,
    private readonly hierarchy: UserHierarchyService,
    private readonly effectivePermissions: EffectivePermissionsService,
  ) {}

  /**
   * Resuelve restricción de scope para el actor:
   *   - view_any  → undefined (sin filtro = ve todo).
   *   - view_own_network → [actorId, ...descendants]. Si vacío, [actorId]
   *     (al menos ve sus propias tx).
   *
   * `@RequirePermissions('wallet_stats.view_own_network')` ya garantizó
   * que el actor tiene AL MENOS el permiso básico. Si tiene view_any,
   * lo bypaseamos.
   */
  private async resolveScope(
    db: TenantDb,
    actorId: string,
  ): Promise<string[] | undefined> {
    const hasViewAll = await this.effectivePermissions.hasAllPermissions(
      db,
      actorId,
      ['wallet_stats.view_any'],
    );
    if (hasViewAll) return undefined;
    const downstream = await this.hierarchy.getActiveDescendants(db, actorId);
    return [actorId, ...downstream];
  }

  /**
   * GET /tenant/wallet-stats/movements
   *
   * Query params (todos opcionales):
   *   - type             single o repetible (?type=load&type=mint)
   *   - ownerRole        single o repetible (?ownerRole=usuario_final)
   *   - dateFrom         ISO datetime
   *   - dateTo           ISO datetime
   *   - userId           UUID — filtra por owner del wallet
   *   - actorId          UUID — filtra por created_by
   *   - minAmount        number
   *   - maxAmount        number
   *   - limit            default 50, max 200
   *   - offset           default 0
   */
  @Get('movements')
  @RequirePermissions('wallet_stats.view_own_network')
  async listMovements(
    @CurrentTenantUser() actor: { id: string },
    @Req() req: RequestWithTenantContext,
    @Query('type') type?: string | string[],
    @Query('ownerRole') ownerRole?: string | string[],
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('userId') userId?: string,
    @Query('actorId') actorId?: string,
    @Query('minAmount') minAmount?: string,
    @Query('maxAmount') maxAmount?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const db = this.requireDb(req);
    const restrictToUserIds = await this.resolveScope(db, actor.id);

    return this.stats.listMovements(db, {
      types: this.parseTypes(type),
      ownerRoles: this.parseRoles(ownerRole),
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      userId,
      actorId,
      minAmount: minAmount !== undefined ? Number(minAmount) : undefined,
      maxAmount: maxAmount !== undefined ? Number(maxAmount) : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      restrictToUserIds,
    });
  }

  /**
   * GET /tenant/wallet-stats/summary
   *
   * Query params:
   *   - dateFrom, dateTo — si no se pasan, default = últimos 30 días.
   */
  @Get('summary')
  @RequirePermissions('wallet_stats.view_own_network')
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

  /** GET /tenant/wallet-stats/by-role — breakdown por rol del owner. */
  @Get('by-role')
  @RequirePermissions('wallet_stats.view_own_network')
  async byRole(
    @CurrentTenantUser() actor: { id: string },
    @Req() req: RequestWithTenantContext,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const db = this.requireDb(req);
    const restrictToUserIds = await this.resolveScope(db, actor.id);
    return this.stats.byRole(db, {
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      restrictToUserIds,
    });
  }

  /**
   * GET /tenant/wallet-stats/export
   * CSV con los mismos filtros que /movements pero hasta CSV_EXPORT_MAX_ROWS.
   */
  @Get('export')
  @RequirePermissions('wallet_stats.export')
  async export(
    @CurrentTenantUser() actor: { id: string },
    @Req() req: RequestWithTenantContext,
    @Res() res: Response,
    @Query('type') type?: string | string[],
    @Query('ownerRole') ownerRole?: string | string[],
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('userId') userId?: string,
    @Query('actorId') actorId?: string,
  ): Promise<void> {
    const db = this.requireDb(req);
    const restrictToUserIds = await this.resolveScope(db, actor.id);

    const rows = await this.stats.listForExport(
      db,
      {
        types: this.parseTypes(type),
        ownerRoles: this.parseRoles(ownerRole),
        dateFrom: dateFrom ? new Date(dateFrom) : undefined,
        dateTo: dateTo ? new Date(dateTo) : undefined,
        userId,
        actorId,
        restrictToUserIds,
      },
      CSV_EXPORT_MAX_ROWS,
    );

    const columns: CsvColumn<MovementRow>[] = [
      { header: 'fecha', value: (r) => r.createdAt.toISOString() },
      { header: 'tipo', value: (r) => r.type },
      { header: 'direccion', value: (r) => r.direction },
      { header: 'monto', value: (r) => r.amount },
      { header: 'balance_despues', value: (r) => r.balanceAfter },
      { header: 'owner_username', value: (r) => r.ownerUsername },
      { header: 'owner_nombre', value: (r) => r.ownerDisplayName },
      { header: 'owner_rol', value: (r) => r.ownerRole ?? '' },
      { header: 'actor_username', value: (r) => r.actorUsername ?? 'sistema' },
      { header: 'actor_rol', value: (r) => r.actorRole ?? '' },
      { header: 'fuente', value: (r) => r.source ?? '' },
      { header: 'motivo', value: (r) => r.reason ?? '' },
      { header: 'notas', value: (r) => r.notes ?? '' },
      { header: 'idempotency_key', value: (r) => r.idempotencyKey ?? '' },
    ];
    const csv = buildCsv(columns, rows);
    const filename = buildCsvFilename('wallet-stats');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private requireDb(req: RequestWithTenantContext): TenantDb {
    if (!req.tenantContext) {
      throw new Error('TenantContext no resuelto.');
    }
    return req.tenantContext.db;
  }

  private parseTypes(input: string | string[] | undefined): WalletTxType[] | undefined {
    if (!input) return undefined;
    const arr = Array.isArray(input) ? input : [input];
    return arr as WalletTxType[];
  }

  private parseRoles(input: string | string[] | undefined): string[] | undefined {
    if (!input) return undefined;
    return Array.isArray(input) ? input : [input];
  }
}
