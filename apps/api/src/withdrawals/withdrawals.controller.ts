/**
 * WithdrawalsController â€” endpoints del flujo de retiro.
 *
 * Cualquier user logueado:
 *   - POST /tenant/withdrawals â†’ solicitar retiro (hold inmediato).
 *   - GET  /tenant/withdrawals/mine â†’ listar SUS retiros.
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
  Headers,
  HttpCode,
  HttpException,
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
import { users } from '@casino/db';
import type { Response } from 'express';
import {
  buildCsv,
  buildCsvFilename,
  CSV_EXPORT_MAX_ROWS,
  type CsvColumn,
} from '../common/csv';
import type { WithdrawalWithRelations } from './withdrawals.service';
import { AuditLogService } from '../audit/audit-log.service';
import {
  BankTransactionAlreadyMatchedError,
  BankTransactionAmountMismatchError,
  BankTransactionDuplicateRefError,
  BankTransactionOutgoingReceiptRequiredError,
  BankTransactionUploadRateLimitedError,
} from '../bank-transactions/bank-transactions.errors';
import { NotificationsService } from '../notifications/notifications.service';
import { EffectivePermissionsService } from '../permissions/effective-permissions.service';
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
import { OutOfScopeError } from '../user-hierarchy/user-hierarchy.errors';
import { UserHierarchyService } from '../user-hierarchy/user-hierarchy.service';
import { InsufficientBalanceError } from '../wallet/wallet.errors';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { PayInFullWithdrawalDto } from './dto/pay-in-full-withdrawal.dto';
import { RejectWithdrawalDto } from './dto/reject-withdrawal.dto';
import {
  InvalidPaymentMethodError,
  TooManyPendingWithdrawalsError,
  WithdrawalInvalidStateError,
  WithdrawalNotFoundError,
  WithdrawalRequiresBankTxError,
  WithdrawalHasMatchedBankTxError,
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
   * Resuelve scope downstream del actor. Misma semÃ¡ntica que en deposits:
   *   - `withdrawals.view_all` â†’ ve TODO el tenant PERO se poda el subÃ¡rbol de
   *     socios independientes (aislamiento del modelo econÃ³mico).
   *   - Solo `withdrawals.view` â†’ [actor.id, ...descendants], tambiÃ©n filtrado
   *     por independientes.
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
    const excluded = await this.hierarchy.getIndependentSubtreeIds(db);

    if (hasViewAll) {
      if (excluded.size === 0) return undefined;
      const all = await db.select({ id: users.id }).from(users);
      const allowed = all.map((u) => u.id).filter((id) => !excluded.has(id));
      if (!allowed.includes(actorId)) allowed.push(actorId);
      return allowed;
    }
    const downstream = await this.hierarchy.getActiveDescendants(db, actorId);
    const base = [actorId, ...downstream].filter(
      (id) => id === actorId || !excluded.has(id),
    );
    // Ruteo descentralizado: el actor tambiÃ©n ve las solicitudes de sus HIJOS
    // DIRECTOS que estÃ©n en una sub-red independiente (Ã©l es su padre directo).
    // No ve nietos independientes ni otras sub-redes â€” solo su nivel inmediato.
    const directChildren = await this.hierarchy.getDirectChildrenIds(db, actorId);
    const indepDirectChildren = directChildren.filter((id) => excluded.has(id));
    return Array.from(new Set([...base, ...indepDirectChildren]));
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
   * GET /tenant/withdrawals â€” listado review con scope.
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
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<{ withdrawal: unknown; walletTx: unknown }> {
    const db = req.tenantContext!.db;
    let withdrawal;
    try {
      withdrawal = await this.withdrawalsService.findById(db, id);
    } catch (err) {
      throw this.mapError(err);
    }

    // Scope: el actor solo ve el detalle si el dueÃ±o estÃ¡ en su alcance (mismo
    // criterio que el listado, incluido el ruteo al padre directo en la red
    // descentralizada). Antes el chequeo era laxo: dejaba que CUALQUIER actor
    // de la red independiente viera el retiro de otra sub-red indep. Ahora se
    // resuelve por scope real â†’ solo el padre directo (o su red centralizada).
    // 404 no revela existencia.
    const scopeUserIds = await this.resolveScope(db, actor.id);
    if (
      scopeUserIds &&
      actor.id !== withdrawal.userId &&
      !scopeUserIds.includes(withdrawal.userId)
    ) {
      throw new NotFoundException({ error: 'WITHDRAWAL_NOT_FOUND' });
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
    let scopeBypass;
    try {
      before = await this.withdrawalsService.findById(db, id);
      scopeBypass = await this.hierarchy.assertCanReviewRequest(
        db,
        actor.id,
        before.userId,
        'withdrawals.approve_admin_network',
      );
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
        ...(scopeBypass ? { metadata: { scopeBypass } } : {}),
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
    let scopeBypass;
    try {
      before = await this.withdrawalsService.findById(db, id);
      scopeBypass = await this.hierarchy.assertCanReviewRequest(
        db,
        actor.id,
        before.userId,
        'withdrawals.reject_admin_network',
      );
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
        metadata: {
          holdReleased: true,
          ...(scopeBypass ? { scopeBypass } : {}),
        },
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
            `Notif withdrawal_rejected (${channel}) fallÃ³ user=${after.userId} withdrawal=${id}: ${(err as Error).message}`,
          );
        }
      }
    }
    return { withdrawal: after };
  }

  /**
   * Sprint 52 (decisiÃ³n dueÃ±o): mark-paid es ONE-CLICK, sin payload. No se
   * recibe referencia manual â€” `paidExternalRef` se auto-genera en el
   * backend y se usa para tracking/reportes.
   */
  @Post(':id/mark-paid')
  @RequirePermissions('withdrawals.process')
  @HttpCode(HttpStatus.OK)
  async markPaid(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<{ withdrawal: unknown }> {
    const db = req.tenantContext!.db;
    let before, after;
    let scopeBypass;
    try {
      before = await this.withdrawalsService.findById(db, id);
      scopeBypass = await this.hierarchy.assertCanReviewRequest(
        db,
        actor.id,
        before.userId,
        'withdrawals.process_admin_network',
      );
      after = await this.withdrawalsService.markPaid(db, id, actor.id);
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
        metadata: {
          paidExternalRef: after.paidExternalRef,
          severity: 'high',
          ...(scopeBypass ? { scopeBypass } : {}),
        },
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
              externalRef: after.paidExternalRef ?? '',
            },
          });
        } catch (err) {
          this.logger.error(
            `Notif withdrawal_paid (${channel}) fallÃ³ user=${after.userId} withdrawal=${id}: ${(err as Error).message}`,
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
    let scopeBypass;
    try {
      before = await this.withdrawalsService.findById(db, id);
      scopeBypass = await this.hierarchy.assertCanReviewRequest(
        db,
        actor.id,
        before.userId,
        'withdrawals.process_admin_network',
      );
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
        metadata: {
          holdReleased: true,
          ...(scopeBypass ? { scopeBypass } : {}),
        },
        ...extractRequestContext(req),
      });

      // Notif al user: "tu retiro fallÃ³". Fail-soft.
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
            `Notif withdrawal_failed (${channel}) fallÃ³ user=${after.userId} withdrawal=${id}: ${(err as Error).message}`,
          );
        }
      }
    }
    return { withdrawal: after };
  }

  /**
   * Fase 2 (mobile): POST /tenant/withdrawals/:id/pay-in-full.
   *
   * Endpoint compuesto para el operador financiero: en UNA operaciÃ³n se
   * declara la transferencia saliente YA ejecutada, se matchea con el retiro
   * y se marca pagado (debita fichas + libera hold). AtÃ³mico server-side.
   *
   * Permisos: exige `withdrawals.process` (marcar pagado) + `bank_tx.upload`
   * (cargar la transferencia) + `bank_tx.match` (matchearla). Un cajero con
   * solo `withdrawals.process` NO puede usar este endpoint â€” preserva la
   * separaciÃ³n de funciones del Sprint 51. El scope usa el comodÃ­n
   * `withdrawals.process_admin_network` igual que mark-paid.
   *
   * Idempotencia: header `Idempotency-Key` obligatorio. Un retry post-commit
   * reutilizando la misma key no duplica nada (el retiro ya quedÃ³ paid).
   */
  @Post(':id/pay-in-full')
  @RequirePermissions('withdrawals.process', 'bank_tx.upload', 'bank_tx.match')
  @PanelOnly()
  @HttpCode(HttpStatus.OK)
  async payInFull(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PayInFullWithdrawalDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<{ withdrawal: unknown; bankTransaction: unknown; walletTx: unknown }> {
    this.requireIdempotencyKey(idempotencyKey);
    const db = req.tenantContext!.db;

    // Capa 3 Â· Fase 2: un socio independiente solo puede pagar declarando la
    // transferencia desde SU propia cuenta (mismo criterio que el upload).
    const indepAcct = await this.hierarchy.getBankAccountOfIndependent(db, actor.id);
    if (indepAcct !== null && dto.bankAccount !== indepAcct) {
      throw new BadRequestException({
        message: `Los socios independientes solo pueden declarar transferencias a su propia cuenta (${indepAcct}).`,
        error: 'BANK_TX_WRONG_ACCOUNT',
      });
    }

    let before, after;
    let scopeBypass;
    try {
      before = await this.withdrawalsService.findById(db, id);
      scopeBypass = await this.hierarchy.assertCanReviewRequest(
        db,
        actor.id,
        before.userId,
        'withdrawals.process_admin_network',
      );
      after = await this.withdrawalsService.payInFull(db, {
        withdrawalId: id,
        actorUserId: actor.id,
        dto,
      });
    } catch (err) {
      throw this.mapError(err);
    }

    if (before.status !== after.withdrawal.status) {
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'withdrawals.pay_in_full',
        targetType: 'withdrawal',
        targetId: id,
        before: { status: before.status },
        after: {
          status: after.withdrawal.status,
          walletTxId: after.withdrawal.walletTxId,
        },
        metadata: {
          bankTransactionId: after.bankTransaction?.id ?? null,
          amountTransferred: dto.amount,
          currencyFiat: dto.currency ?? before.currencyFiat,
          bankAccount: dto.bankAccount,
          paidExternalRef: after.withdrawal.paidExternalRef,
          receiptStorageKey: dto.receiptStorageKey,
          override: dto.override === true,
          overrideReason: dto.overrideReason ?? null,
          idempotencyKey,
          severity: 'high',
          ...(scopeBypass ? { scopeBypass } : {}),
        },
        ...extractRequestContext(req),
      });

      // Notif al user: "tu retiro fue procesado". Fail-soft.
      for (const channel of ['in_app', 'email'] as const) {
        try {
          await this.notifications.enqueue(db, {
            userId: after.withdrawal.userId,
            kind: 'withdrawal_paid',
            channel,
            payload: {
              withdrawalId: id,
              amountChips: after.withdrawal.amountChips,
              externalRef: after.withdrawal.paidExternalRef ?? '',
            },
          });
        } catch (err) {
          this.logger.error(
            `Notif withdrawal_paid (${channel}) fallÃ³ user=${after.withdrawal.userId} withdrawal=${id}: ${(err as Error).message}`,
          );
        }
      }
    }

    return {
      withdrawal: after.withdrawal,
      bankTransaction: after.bankTransaction,
      walletTx: after.walletTx,
    };
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
    if (err instanceof WithdrawalHasMatchedBankTxError) {
      // AuditorÃ­a economÃ­a (2026-07): no se puede fallar-y-liberar un retiro
      // cuya outgoing bank_tx ya fue matcheada (plata ya saliÃ³). Hay que
      // desmatchear primero. 409 accionable.
      return new ConflictException({
        statusCode: 409,
        message: err.message,
        error: 'WITHDRAWAL_HAS_MATCHED_BANK_TX',
        withdrawalId: err.withdrawalId,
        bankTransactionId: err.bankTransactionId,
      });
    }
    if (err instanceof BankTransactionDuplicateRefError) {
      return new ConflictException({
        statusCode: 409,
        message: err.message,
        error: 'BANK_TX_DUPLICATE_REF',
      });
    }
    if (err instanceof BankTransactionOutgoingReceiptRequiredError) {
      return new BadRequestException({
        statusCode: 400,
        message: err.message,
        error: 'BANK_TX_OUTGOING_RECEIPT_REQUIRED',
      });
    }
    if (err instanceof BankTransactionAmountMismatchError) {
      return new BadRequestException({
        statusCode: 400,
        message: err.message,
        error: 'BANK_TX_AMOUNT_MISMATCH',
      });
    }
    if (err instanceof BankTransactionUploadRateLimitedError) {
      // Mismo shape que el upload del Sprint 50: 429 con motivo y umbral.
      return new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: err.message,
          error: 'BANK_TX_UPLOAD_RATE_LIMITED',
          reason: err.reason,
          current: err.current,
          limit: err.limit,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (err instanceof BankTransactionAlreadyMatchedError) {
      return new ConflictException({
        statusCode: 409,
        message: err.message,
        error: 'BANK_TX_ALREADY_MATCHED',
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

  private requireIdempotencyKey(key: string | undefined): void {
    if (!key || key.trim() === '') {
      throw new BadRequestException(
        'Header Idempotency-Key requerido. MandÃ¡ un UUID o ULID estable.',
      );
    }
    if (key.length > 200) {
      throw new BadRequestException('Idempotency-Key demasiado largo (max 200 chars).');
    }
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// CSV column definitions
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
