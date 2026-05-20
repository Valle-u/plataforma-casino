/**
 * BranchesQueryController — Sprint 51.1.
 *
 * Endpoints read-only del listado + reporting + self-view de sucursales
 * independientes. Separado del `BranchesController` (que vive bajo
 * `/tenant/users/:id/branch/...` y maneja mutaciones admin-only) porque
 * estos son tenant-wide.
 *
 * Endpoints:
 *   - GET /tenant/branches              (branch.view)
 *   - GET /tenant/branches/sales-summary?from=&to=  (branch.view)
 *   - GET /tenant/branches/mine         (cualquier user autenticado)
 */

import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { RequirePermissions } from '../permissions/require-permissions.decorator';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import { PanelOnly } from '../tenant-auth/panel-only.decorator';
import type {
  RequestWithTenantContext,
  TenantDb,
} from '../tenant-resolver/tenant-context';
import {
  BranchesService,
  type BranchListRow,
  type BranchSalesSummaryRow,
  type MyBranchInfo,
} from './branches.service';

@Controller('tenant/branches')
@UseGuards(TenantJwtGuard, PermissionsGuard)
@PanelOnly()
export class BranchesQueryController {
  constructor(private readonly service: BranchesService) {}

  private requireDb(req: RequestWithTenantContext): TenantDb {
    if (!req.tenantContext) throw new Error('TenantContext no resuelto.');
    return req.tenantContext.db;
  }

  /** GET /tenant/branches — listado de sucursales independientes. */
  @Get()
  @RequirePermissions('branch.view')
  async list(
    @Req() req: RequestWithTenantContext,
  ): Promise<{ data: BranchListRow[] }> {
    const db = this.requireDb(req);
    return { data: await this.service.listIndependent(db) };
  }

  /**
   * GET /tenant/branches/sales-summary?from=ISO&to=ISO
   * Default sin filtro = all-time.
   */
  @Get('sales-summary')
  @RequirePermissions('branch.view')
  async salesSummary(
    @Req() req: RequestWithTenantContext,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<{
    data: BranchSalesSummaryRow[];
    totals: {
      salesCount: number;
      totalChipsSold: string;
      totalFiatSold: string;
    };
  }> {
    const db = this.requireDb(req);
    return this.service.salesSummary(db, {
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
  }

  /**
   * GET /tenant/branches/mine — self-view. Cualquier user autenticado
   * puede consultar su propia info de sucursal. Si no es socio o no es
   * independent, devuelve `isIndependent: false` con totales en cero.
   */
  @Get('mine')
  async mine(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
    @Query('limit') limit?: string,
  ): Promise<MyBranchInfo> {
    const db = this.requireDb(req);
    return this.service.myBranchInfo(
      db,
      actor.id,
      limit ? Number(limit) : undefined,
    );
  }
}
