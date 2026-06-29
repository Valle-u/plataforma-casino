/**
 * HouseController — panel de la Casa / tesorería (Blindaje, Parte B).
 *
 * B-build-1: solo ver el estado de la Casa. Los endpoints de aporte de capital
 * (B-build-3) y demás llegan en fases siguientes.
 *
 *   - GET /tenant/house    (house.view)
 */

import {
  Controller,
  Get,
  NotFoundException,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { RequirePermissions } from '../permissions/require-permissions.decorator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import { PanelOnly } from '../tenant-auth/panel-only.decorator';
import type {
  RequestWithTenantContext,
  TenantDb,
} from '../tenant-resolver/tenant-context';
import { HouseNotProvisionedError, HouseService } from './house.service';

@Controller('tenant/house')
@UseGuards(TenantJwtGuard, PermissionsGuard)
@PanelOnly()
export class HouseController {
  constructor(private readonly service: HouseService) {}

  private requireDb(req: RequestWithTenantContext): TenantDb {
    if (!req.tenantContext) throw new Error('TenantContext no resuelto.');
    return req.tenantContext.db;
  }

  /** GET /tenant/house — estado de la Casa / tesorería. */
  @Get()
  @RequirePermissions('house.view')
  async state(@Req() req: RequestWithTenantContext) {
    const db = this.requireDb(req);
    try {
      return await this.service.getHouseState(db);
    } catch (err) {
      if (err instanceof HouseNotProvisionedError) {
        throw new NotFoundException({
          message: err.message,
          error: 'HOUSE_NOT_PROVISIONED',
        });
      }
      throw err;
    }
  }
}
