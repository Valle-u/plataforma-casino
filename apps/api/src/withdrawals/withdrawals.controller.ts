/**
 * WithdrawalsController — endpoints del flujo de retiro.
 *
 * Cualquier user logueado:
 *   - POST /tenant/withdrawals → solicitar retiro (hold inmediato).
 *   - GET  /tenant/withdrawals/mine → listar SUS retiros.
 *
 * Operadores con permisos:
 *   - GET  /tenant/withdrawals               (withdrawals.view)
 *   - GET  /tenant/withdrawals/:id           (withdrawals.view)
 *   - POST /tenant/withdrawals/:id/approve   (withdrawals.approve)
 *   - POST /tenant/withdrawals/:id/reject    (withdrawals.reject)
 *   - POST /tenant/withdrawals/:id/mark-paid (withdrawals.process)
 *   - POST /tenant/withdrawals/:id/mark-failed (withdrawals.process)
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
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import { InsufficientBalanceError } from '../wallet/wallet.errors';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { ProcessWithdrawalDto } from './dto/process-withdrawal.dto';
import { RejectWithdrawalDto } from './dto/reject-withdrawal.dto';
import {
  InvalidPaymentMethodError,
  TooManyPendingWithdrawalsError,
  WithdrawalInvalidStateError,
  WithdrawalNotFoundError,
} from './withdrawals.errors';
import { WithdrawalsService } from './withdrawals.service';

@Controller('tenant/withdrawals')
@UseGuards(TenantJwtGuard, PermissionsGuard)
export class WithdrawalsController {
  constructor(
    private readonly withdrawalsService: WithdrawalsService,
    private readonly audit: AuditLogService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateWithdrawalDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<{ withdrawal: unknown }> {
    const db = req.tenantContext!.db;
    let w;
    try {
      w = await this.withdrawalsService.create(db, {
        actorUserId: actor.id,
        methodId: dto.methodId,
        amountChips: dto.amountChips,
        amountFiat: dto.amountFiat,
        currencyFiat: dto.currencyFiat,
        targetAccount: dto.targetAccount,
      });
    } catch (err) {
      throw this.mapError(err);
    }

    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'withdrawals.create',
      targetType: 'withdrawal',
      targetId: w.id,
      after: {
        status: w.status,
        amountChips: w.amountChips,
        amountFiat: w.amountFiat,
        currencyFiat: w.currencyFiat,
      },
      metadata: { methodId: dto.methodId, holdId: w.holdId },
      ...extractRequestContext(req),
    });

    return { withdrawal: w };
  }

  @Get('mine')
  async listMine(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<{ data: unknown[] }> {
    const db = req.tenantContext!.db;
    const data = await this.withdrawalsService.listForUser(
      db,
      actor.id,
      limit ? Number(limit) : undefined,
      offset ? Number(offset) : undefined,
    );
    return { data };
  }

  @Get()
  @RequirePermissions('withdrawals.view')
  async listForReview(
    @Req() req: RequestWithTenantContext,
    @Query('status') status?: string,
    @Query('userId') userId?: string,
    @Query('assignedTo') assignedTo?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<{ data: unknown[]; total: number }> {
    const db = req.tenantContext!.db;
    const statuses = status?.split(',') as Array<
      'pending' | 'approved' | 'processing' | 'paid' | 'rejected' | 'failed'
    >;
    return this.withdrawalsService.listForReview(db, {
      status: statuses,
      userId,
      assignedTo,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Get(':id')
  @RequirePermissions('withdrawals.view')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
  ): Promise<{ withdrawal: unknown; walletTx: unknown | null }> {
    const db = req.tenantContext!.db;
    let withdrawal;
    try {
      withdrawal = await this.withdrawalsService.findById(db, id);
    } catch (err) {
      throw this.mapError(err);
    }
    const walletTx = withdrawal.walletTxId
      ? await this.withdrawalsService.getLinkedWalletTx(db, withdrawal.walletTxId)
      : null;
    return { withdrawal, walletTx };
  }

  @Post(':id/approve')
  @RequirePermissions('withdrawals.approve')
  @HttpCode(HttpStatus.OK)
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<{ withdrawal: unknown }> {
    const db = req.tenantContext!.db;
    let before, after;
    try {
      before = await this.withdrawalsService.findById(db, id);
      after = await this.withdrawalsService.approve(db, id, actor.id);
    } catch (err) {
      throw this.mapError(err);
    }
    if (before.status !== after.status) {
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'withdrawals.approve',
        targetType: 'withdrawal',
        targetId: id,
        before: { status: before.status },
        after: { status: after.status },
        ...extractRequestContext(req),
      });
    }
    return { withdrawal: after };
  }

  @Post(':id/reject')
  @RequirePermissions('withdrawals.reject')
  @HttpCode(HttpStatus.OK)
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectWithdrawalDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<{ withdrawal: unknown }> {
    const db = req.tenantContext!.db;
    let before, after;
    try {
      before = await this.withdrawalsService.findById(db, id);
      after = await this.withdrawalsService.reject(db, id, actor.id, dto.reason);
    } catch (err) {
      throw this.mapError(err);
    }
    if (before.status !== after.status) {
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'withdrawals.reject',
        targetType: 'withdrawal',
        targetId: id,
        before: { status: before.status },
        after: { status: after.status },
        reason: dto.reason,
        metadata: { holdReleased: true },
        ...extractRequestContext(req),
      });
    }
    return { withdrawal: after };
  }

  @Post(':id/mark-paid')
  @RequirePermissions('withdrawals.process')
  @HttpCode(HttpStatus.OK)
  async markPaid(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ProcessWithdrawalDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<{ withdrawal: unknown }> {
    const db = req.tenantContext!.db;
    let before, after;
    try {
      before = await this.withdrawalsService.findById(db, id);
      after = await this.withdrawalsService.markPaid(db, id, actor.id, dto.externalRef);
    } catch (err) {
      throw this.mapError(err);
    }
    if (before.status !== after.status) {
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'withdrawals.paid',
        targetType: 'withdrawal',
        targetId: id,
        before: { status: before.status },
        after: { status: after.status, walletTxId: after.walletTxId },
        metadata: { externalRef: dto.externalRef, severity: 'high' },
        ...extractRequestContext(req),
      });
    }
    return { withdrawal: after };
  }

  @Post(':id/mark-failed')
  @RequirePermissions('withdrawals.process')
  @HttpCode(HttpStatus.OK)
  async markFailed(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectWithdrawalDto, // reusa el shape (reason obligatorio).
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<{ withdrawal: unknown }> {
    const db = req.tenantContext!.db;
    let before, after;
    try {
      before = await this.withdrawalsService.findById(db, id);
      after = await this.withdrawalsService.markFailed(db, id, actor.id, dto.reason);
    } catch (err) {
      throw this.mapError(err);
    }
    if (before.status !== after.status) {
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'withdrawals.failed',
        targetType: 'withdrawal',
        targetId: id,
        before: { status: before.status },
        after: { status: after.status },
        reason: dto.reason,
        metadata: { holdReleased: true },
        ...extractRequestContext(req),
      });
    }
    return { withdrawal: after };
  }

  private mapError(err: unknown): Error {
    if (err instanceof WithdrawalNotFoundError) {
      return new NotFoundException({
        statusCode: 404,
        message: err.message,
        error: 'WITHDRAWAL_NOT_FOUND',
      });
    }
    if (err instanceof InvalidPaymentMethodError) {
      return new BadRequestException({
        statusCode: 400,
        message: err.message,
        error: 'INVALID_PAYMENT_METHOD',
      });
    }
    if (err instanceof TooManyPendingWithdrawalsError) {
      return new ConflictException({
        statusCode: 409,
        message: err.message,
        error: 'TOO_MANY_PENDING_WITHDRAWALS',
        current: err.current,
      });
    }
    if (err instanceof WithdrawalInvalidStateError) {
      return new ConflictException({
        statusCode: 409,
        message: err.message,
        error: 'WITHDRAWAL_INVALID_STATE',
        currentStatus: err.currentStatus,
      });
    }
    if (err instanceof InsufficientBalanceError) {
      return new ConflictException({
        statusCode: 409,
        message: err.message,
        error: 'INSUFFICIENT_BALANCE',
        available: err.available,
        required: err.required,
      });
    }
    if (err instanceof ForbiddenException || err instanceof BadRequestException) {
      return err;
    }
    return err as Error;
  }
}
