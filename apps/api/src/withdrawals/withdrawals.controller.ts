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
  Logger as NestLogger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
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
import type { WithdrawalWithRelations } from './withdrawals.service';
import { AuditLogService } from '../audit/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EffectivePermissionsService } from '../permissions/effective-permissions.service';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { RequirePermissions } from '../permissions/require-permissions.decorator';
import { extractRequestContext } from '../request-context/request-context';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import type {
  RequestWithTenantContext,
  TenantDb,
} from '../tenant-resolver/tenant-context';
import { OutOfScopeError } from '../user-hierarchy/user-hierarchy.errors';
import { UserHierarchyService } from '../user-hierarchy/user-hierarchy.service';
import { InsufficientFunderBalanceError } from '../commissions/commissions.errors';
import { InsufficientBalanceError } from '../wallet/wallet.errors';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { ProcessWithdrawalDto } from './dto/process-withdrawal.dto';
import { RejectWithdrawalDto } from './dto/reject-withdrawal.dto';
import {
  InvalidPaymentMethodError,
  TooManyPendingWithdrawalsError,
  WithdrawalInvalidStateError,
  WithdrawalNotFoundError,
  WithdrawalRequiresBankTxError,
} from './withdrawals.errors';
import { WithdrawalsService } from './withdrawals.service';

@Controller('tenant/withdrawals')
@UseGuards(TenantJwtGuard, PermissionsGuard)
export class WithdrawalsController {
  private readonly logger = new NestLogger(WithdrawalsController.name);

  constructor(
    private readonly withdrawalsService: WithdrawalsService,
    private readonly audit: AuditLogService,
    private readonly hierarchy: UserHierarchyService,
    private readonly notifications: NotificationsService,
    private readonly effectivePermissions: EffectivePermissionsService,
  ) {}

  /**
   * Resuelve scope downstream del actor. Misma semántica que en deposits:
   *   - `withdrawals.view_all` → undefined (sin filter, admin).
   *   - Solo `withdrawals.view` → [actor.id, ...descendants].
   */
  private async resolveScope(
    db: TenantDb,
    actorId: string,
  ): Promise<string[] | undefined> {
    const hasViewAll = await this.effectivePermissions.hasAllPermissions(
      db,
      actorId,
      ['withdrawals.view_all'],
    );
    if (hasViewAll) return undefined;
    const downstream = await this.hierarchy.getActiveDescendants(db, actorId);
    return [actorId, ...downstream];
  }

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

  /**
   * GET /tenant/withdrawals — listado review con scope.
   * Actor con `withdrawals.view_all` ve todo; sino solo su downstream.
   */
  @Get()
  @RequirePermissions('withdrawals.view')
  async listForReview(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
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
    const userIds = await this.resolveScope(db, actor.id);
    return this.withdrawalsService.listForReview(db, {
      status: statuses,
      userId,
      userIds,
      assignedTo,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  /**
   * GET /tenant/withdrawals/export
   * Export CSV con los mismos filtros que `listForReview`. Cap en
   * `CSV_EXPORT_MAX_ROWS`. Records audit `withdrawals.export`.
   */
  @Get('export')
  @RequirePermissions('withdrawals.export')
  async exportCsv(
    @Req() req: RequestWithTenantContext,
    @Res() res: Response,
    @CurrentTenantUser() actor: { id: string; username: string },
    @Query('status') status?: string,
    @Query('userId') userId?: string,
    @Query('assignedTo') assignedTo?: string,
  ): Promise<void> {
    const db = req.tenantContext!.db;
    const statuses = status?.split(',') as Array<
      'pending' | 'approved' | 'processing' | 'paid' | 'rejected' | 'failed'
    >;
    const userIds = await this.resolveScope(db, actor.id);
    const { data, total } = await this.withdrawalsService.listForExport(
      db,
      { status: statuses, userId, userIds, assignedTo },
      CSV_EXPORT_MAX_ROWS,
    );

    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'withdrawals.export',
      targetType: 'withdrawal',
      targetId: null,
      metadata: {
        rowCount: data.length,
        totalMatched: total,
        truncated: total > data.length,
        scoped: userIds !== undefined,
        filters: {
          status: status ?? null,
          userId: userId ?? null,
          assignedTo: assignedTo ?? null,
        },
        severity: 'medium',
      },
      ...extractRequestContext(req),
    });

    const csv = buildCsv<WithdrawalWithRelations>(WITHDRAWAL_CSV_COLUMNS, data);
    const filename = buildCsvFilename('withdrawals');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Total-Rows', String(data.length));
    if (total > data.length) res.setHeader('X-Truncated', 'true');
    res.send(csv);
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
      await this.hierarchy.assertScope(db, actor.id, before.userId);
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
      await this.hierarchy.assertScope(db, actor.id, before.userId);
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

      // Notif al user: "tu retiro fue rechazado". Fail-soft.
      for (const channel of ['in_app', 'email'] as const) {
        try {
          await this.notifications.enqueue(db, {
            userId: after.userId,
            kind: 'withdrawal_rejected',
            channel,
            payload: {
              withdrawalId: id,
              amountChips: after.amountChips,
              reason: dto.reason,
            },
          });
        } catch (err) {
          this.logger.error(
            `Notif withdrawal_rejected (${channel}) falló user=${after.userId} withdrawal=${id}: ${(err as Error).message}`,
          );
        }
      }
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
      await this.hierarchy.assertScope(db, actor.id, before.userId);
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

      // Notif al user: "tu retiro fue procesado". Fail-soft.
      for (const channel of ['in_app', 'email'] as const) {
        try {
          await this.notifications.enqueue(db, {
            userId: after.userId,
            kind: 'withdrawal_paid',
            channel,
            payload: {
              withdrawalId: id,
              amountChips: after.amountChips,
              externalRef: dto.externalRef ?? '',
            },
          });
        } catch (err) {
          this.logger.error(
            `Notif withdrawal_paid (${channel}) falló user=${after.userId} withdrawal=${id}: ${(err as Error).message}`,
          );
        }
      }
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
      await this.hierarchy.assertScope(db, actor.id, before.userId);
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

      // Notif al user: "tu retiro falló". Fail-soft.
      for (const channel of ['in_app', 'email'] as const) {
        try {
          await this.notifications.enqueue(db, {
            userId: after.userId,
            kind: 'withdrawal_failed',
            channel,
            payload: {
              withdrawalId: id,
              amountChips: after.amountChips,
              reason: dto.reason,
            },
          });
        } catch (err) {
          this.logger.error(
            `Notif withdrawal_failed (${channel}) falló user=${after.userId} withdrawal=${id}: ${(err as Error).message}`,
          );
        }
      }
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
    if (err instanceof WithdrawalRequiresBankTxError) {
      // Sprint 51: markPaid requiere outgoing bank_tx asociada. El empleado
      // de confianza debe cargar la transferencia de salida y matchearla
      // antes de que el operador pueda marcar paid.
      return new BadRequestException({
        statusCode: 400,
        message: err.message,
        error: 'WITHDRAWAL_REQUIRES_BANK_TX',
        withdrawalId: err.withdrawalId,
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
    if (err instanceof InsufficientFunderBalanceError) {
      // Sprint 25: el operador que marca paid no tiene saldo para pagar
      // las commissions de la jerarquía upstream. Bloquea el markPaid
      // completo (Opción 3a). Mensaje específico para no confundir con
      // el saldo del propio retiro (que sale del wallet del CLIENTE).
      return new ConflictException({
        statusCode: 409,
        message: err.message,
        error: 'INSUFFICIENT_FUNDER_BALANCE',
        available: err.available,
        required: err.required,
      });
    }
    if (err instanceof OutOfScopeError) {
      return new ForbiddenException({
        statusCode: 403,
        message: err.message,
        error: 'OUT_OF_SCOPE',
      });
    }
    if (err instanceof ForbiddenException || err instanceof BadRequestException) {
      return err;
    }
    return err as Error;
  }
}

// ──────────────────────────────────────────────────────────────────────
// CSV column definitions
// ──────────────────────────────────────────────────────────────────────

const WITHDRAWAL_CSV_COLUMNS: CsvColumn<WithdrawalWithRelations>[] = [
  { header: 'created_at', value: (r) => r.createdAt },
  { header: 'id', value: (r) => r.id },
  { header: 'status', value: (r) => r.status },
  { header: 'user_id', value: (r) => r.userId },
  { header: 'username', value: (r) => r.userUsername },
  { header: 'display_name', value: (r) => r.userDisplayName },
  { header: 'method_id', value: (r) => r.methodId },
  { header: 'method_code', value: (r) => r.methodCode },
  { header: 'method_name', value: (r) => r.methodName },
  { header: 'amount_chips', value: (r) => r.amountChips },
  { header: 'amount_fiat', value: (r) => r.amountFiat },
  { header: 'currency_fiat', value: (r) => r.currencyFiat },
  { header: 'target_account', value: (r) => r.targetAccount },
  { header: 'hold_id', value: (r) => r.holdId },
  { header: 'wallet_tx_id', value: (r) => r.walletTxId },
  { header: 'assigned_to', value: (r) => r.assignedTo },
  { header: 'reviewed_by', value: (r) => r.reviewedBy },
  { header: 'reviewed_at', value: (r) => r.reviewedAt },
  { header: 'rejection_reason', value: (r) => r.rejectionReason },
  { header: 'paid_external_ref', value: (r) => r.paidExternalRef },
  { header: 'paid_at', value: (r) => r.paidAt },
  { header: 'failure_reason', value: (r) => r.failureReason },
  { header: 'updated_at', value: (r) => r.updatedAt },
];
