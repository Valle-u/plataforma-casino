/**
 * BranchesController — Sprint 51.
 *
 * Endpoints admin-only (no delegables):
 *   - POST /tenant/users/:id/branch/toggle-independence  (branch.toggle_independence)
 *   - POST /tenant/users/:id/branch/sell-chips           (branch.sell_chips)
 */

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { generateUuidV7 } from '@casino/db';
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
import { BranchesService } from './branches.service';
import {
  BranchDegradeBlockedError,
  BranchInvalidPriceError,
  BranchNotASocioError,
  BranchNotIndependentError,
  BranchPriceNotConfiguredError,
  BranchSocioNotFoundError,
} from './branches.errors';
import { SellChipsDto } from './dto/sell-chips.dto';
import { ToggleIndependenceDto } from './dto/toggle-independence.dto';

@Controller('tenant/users/:id/branch')
@UseGuards(TenantJwtGuard, PermissionsGuard)
@PanelOnly()
export class BranchesController {
  constructor(
    private readonly service: BranchesService,
    private readonly audit: AuditLogService,
  ) {}

  private requireDb(req: RequestWithTenantContext): TenantDb {
    if (!req.tenantContext) throw new Error('TenantContext no resuelto.');
    return req.tenantContext.db;
  }

  @Post('toggle-independence')
  @RequirePermissions('branch.toggle_independence')
  @HttpCode(HttpStatus.OK)
  async toggleIndependence(
    @Param('id', ParseUUIDPipe) socioId: string,
    @Body() dto: ToggleIndependenceDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = this.requireDb(req);
    try {
      const before = { isIndependent: undefined as boolean | undefined };
      const updated = await this.service.toggleIndependence(db, {
        socioId,
        isIndependent: dto.isIndependent,
        branchBankAccount: dto.branchBankAccount ?? null,
        branchChipsPricePerUnit: dto.branchChipsPricePerUnit ?? null,
        force: dto.force ?? false,
      });
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'branch.toggle_independence',
        targetType: 'user',
        targetId: socioId,
        before,
        after: {
          isIndependent: updated.isIndependentBranch,
          branchBankAccount: updated.branchBankAccount,
          branchChipsPricePerUnit: updated.branchChipsPricePerUnit,
        },
        metadata: {
          severity: dto.force === true && !dto.isIndependent ? 'critical' : 'high',
          forced: dto.force === true && !dto.isIndependent,
        },
        ...extractRequestContext(req),
      });
      return { user: updated };
    } catch (err) {
      throw this.mapError(err);
    }
  }

  @Post('sell-chips')
  @RequirePermissions('branch.sell_chips')
  @HttpCode(HttpStatus.OK)
  async sellChips(
    @Param('id', ParseUUIDPipe) socioId: string,
    @Body() dto: SellChipsDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = this.requireDb(req);
    try {
      const idempotencyKey = dto.idempotencyKey ?? generateUuidV7();
      const result = await this.service.sellChips(db, {
        socioId,
        actorUserId: actor.id,
        amountChips: dto.amountChips,
        idempotencyKey,
        notes: dto.notes ?? null,
      });
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'branch.sell_chips',
        targetType: 'user',
        targetId: socioId,
        after: {
          amountChips: result.amountChips,
          pricePerUnit: result.pricePerUnit,
          amountFiat: result.amountFiat,
          walletTxId: result.walletTxId,
          newBalance: result.newBalance,
        },
        metadata: {
          severity: 'high',
          notes: dto.notes ?? null,
          idempotencyKey,
        },
        ...extractRequestContext(req),
      });
      return result;
    } catch (err) {
      throw this.mapError(err);
    }
  }

  private mapError(err: unknown): Error {
    if (err instanceof BranchSocioNotFoundError) {
      return new NotFoundException({
        statusCode: 404,
        message: err.message,
        error: 'BRANCH_SOCIO_NOT_FOUND',
      });
    }
    if (err instanceof BranchNotASocioError) {
      return new BadRequestException({
        statusCode: 400,
        message: err.message,
        error: 'BRANCH_NOT_A_SOCIO',
      });
    }
    if (err instanceof BranchNotIndependentError) {
      return new ConflictException({
        statusCode: 409,
        message: err.message,
        error: 'BRANCH_NOT_INDEPENDENT',
      });
    }
    if (err instanceof BranchPriceNotConfiguredError) {
      return new BadRequestException({
        statusCode: 400,
        message: err.message,
        error: 'BRANCH_PRICE_NOT_CONFIGURED',
      });
    }
    if (err instanceof BranchInvalidPriceError) {
      return new BadRequestException({
        statusCode: 400,
        message: err.message,
        error: 'BRANCH_INVALID_PRICE',
      });
    }
    if (err instanceof BranchDegradeBlockedError) {
      return new ConflictException({
        statusCode: 409,
        message: err.message,
        error: 'BRANCH_DEGRADE_BLOCKED',
        pending: err.pending,
        hint: 'Limpiá los items pendientes o volvé a llamar con `force: true` (auditado severity critical).',
      });
    }
    return err as Error;
  }
}
