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
import { HouseNotProvisionedError } from '../house/house.service';
import { InsufficientBalanceError } from '../wallet/wallet.errors';
import { BranchesService } from './branches.service';
import {
  BranchDegradeBlockedError,
  BranchFlipHasPendingRequestsError,
  BranchFlipRaceError,
  BranchFlipSamePeriodError,
  BranchInvalidPriceError,
  BranchNoBankPaymentMethodError,
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
        actorUserId: actor.id,
        isIndependent: dto.isIndependent,
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
      // No filtrar credenciales en la respuesta (passwordHash / twoFaSecret).
      const { passwordHash: _ph, twoFaSecret: _2fa, ...safe } = updated;
      return { user: safe };
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
      // Idempotency key obligatoria por DTO (fix 2026-08-25): NUNCA generar una
      // random por request — un doble-click sería doble venta / drenaje de stock.
      const idempotencyKey = dto.idempotencyKey;
      const result = await this.service.sellChips(db, {
        socioId,
        actorUserId: actor.id,
        amountChips: dto.amountChips,
        amountFiat: dto.amountFiat,
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
    if (err instanceof BranchNoBankPaymentMethodError) {
      return new BadRequestException({
        statusCode: 400,
        message: err.message,
        error: 'BRANCH_NO_BANK_PAYMENT_METHOD',
        hint: 'El socio tiene que cargar un método de pago tipo transferencia bancaria en "Mis métodos de pago" (su panel, /my-branch) antes de que actives la independencia.',
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
    if (err instanceof BranchFlipHasPendingRequestsError) {
      return new ConflictException({
        statusCode: 409,
        message: err.message,
        error: 'BRANCH_FLIP_PENDING_REQUESTS',
        pending: err.pending,
        hint: 'Aprobá o rechazá los depósitos/retiros pendientes de la sub-red antes de cambiar el modo. Es un bloqueo duro (no bypasseable con force).',
      });
    }
    if (err instanceof BranchFlipSamePeriodError) {
      return new ConflictException({
        statusCode: 409,
        message: err.message,
        error: 'BRANCH_FLIP_SAME_PERIOD',
        independizedAt: err.independizedAt.toISOString(),
        hint: 'El socio ya se independizó este período. Esperá al cierre del mes para volverlo dependiente sin perder su comisión del tramo dependiente.',
      });
    }
    if (err instanceof BranchFlipRaceError) {
      return new ConflictException({
        statusCode: 409,
        message: err.message,
        error: 'BRANCH_FLIP_RACE',
        hint: 'Otro cambio de modo se procesó en paralelo. Reintentá la operación.',
      });
    }
    // W1: la venta transfiere fichas DESDE la Casa (modelo tope mensual). Si la
    // Casa no tiene stock suficiente, `executeTransferPair` tira
    // InsufficientBalanceError — lo mapeamos a un 409 accionable en vez de
    // dejar que caiga en un 500.
    if (err instanceof InsufficientBalanceError) {
      return new ConflictException({
        statusCode: 409,
        message:
          'La Casa no tiene stock suficiente para vender esas fichas. Fondeá el presupuesto de la Casa e intentá de nuevo.',
        error: 'HOUSE_INSUFFICIENT_STOCK',
      });
    }
    if (err instanceof HouseNotProvisionedError) {
      return new ConflictException({
        statusCode: 409,
        message: err.message,
        error: 'HOUSE_NOT_PROVISIONED',
      });
    }
    return err as Error;
  }
}
