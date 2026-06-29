/**
 * LedgerController — panel de integridad del ledger (Blindaje, Parte A).
 *
 * Endpoints (todos panel-only, admin_tenant):
 *   - POST /tenant/ledger/reconcile                 (ledger.reconcile)
 *   - GET  /tenant/ledger/reconciliations           (ledger.view)
 *   - GET  /tenant/ledger/reconciliations/latest    (ledger.view)
 *   - GET  /tenant/ledger/supply                     (ledger.view)
 *
 * El chequeo es read-only sobre la economía: correrlo on-demand no muta
 * fichas, solo inserta una fila de corrida + (si descuadra) un audit.
 */

import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { PanelOnly } from '../tenant-auth/panel-only.decorator';
import type {
  RequestWithTenantContext,
  TenantDb,
} from '../tenant-resolver/tenant-context';
import { LedgerReconciliationService } from './ledger-reconciliation.service';

@Controller('tenant/ledger')
@UseGuards(TenantJwtGuard, PermissionsGuard)
@PanelOnly()
export class LedgerController {
  constructor(
    private readonly service: LedgerReconciliationService,
    private readonly audit: AuditLogService,
  ) {}

  private requireDb(req: RequestWithTenantContext): TenantDb {
    if (!req.tenantContext) throw new Error('TenantContext no resuelto.');
    return req.tenantContext.db;
  }

  /**
   * POST /tenant/ledger/reconcile — corre el chequeo on-demand (botón del
   * panel). Devuelve la corrida persistida.
   */
  @Post('reconcile')
  @RequirePermissions('ledger.reconcile')
  @HttpCode(HttpStatus.OK)
  async reconcile(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = this.requireDb(req);
    const run = await this.service.runReconciliation(db, {
      trigger: 'manual',
      triggeredByUserId: actor.id,
    });
    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'ledger.reconcile_run',
      targetType: 'ledger_reconciliation_run',
      targetId: run.id,
      metadata: {
        status: run.status,
        walletsChecked: run.walletsChecked,
        walletsMismatched: run.walletsMismatched,
        holdsMismatched: run.holdsMismatched,
      },
      ...extractRequestContext(req),
    });
    return run;
  }

  /** GET /tenant/ledger/reconciliations?limit=&offset= — historial. */
  @Get('reconciliations')
  @RequirePermissions('ledger.view')
  async list(
    @Req() req: RequestWithTenantContext,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const db = this.requireDb(req);
    return this.service.listRuns(db, {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  /** GET /tenant/ledger/reconciliations/latest — última corrida (panel). */
  @Get('reconciliations/latest')
  @RequirePermissions('ledger.view')
  async latest(@Req() req: RequestWithTenantContext) {
    const db = this.requireDb(req);
    const run = await this.service.getLatestRun(db);
    return { run };
  }

  /** GET /tenant/ledger/supply — snapshot de supply en vivo (sin persistir). */
  @Get('supply')
  @RequirePermissions('ledger.view')
  async supply(@Req() req: RequestWithTenantContext) {
    const db = this.requireDb(req);
    return this.service.computeSupply(db);
  }
}
