/**
 * BankTransactionsController — Sprint 50.
 *
 * Endpoints:
 *   - POST   /tenant/bank-transactions                          (bank_tx.upload)
 *   - GET    /tenant/bank-transactions                          (bank_tx.view)
 *   - GET    /tenant/bank-transactions/:id                      (bank_tx.view)
 *   - GET    /tenant/bank-transactions/unmatched-for-amount/:amount   (bank_tx.match)
 *   - POST   /tenant/bank-transactions/:id/match/:depositId     (bank_tx.match)
 *   - POST   /tenant/bank-transactions/:id/unmatch              (bank_tx.match)
 *   - DELETE /tenant/bank-transactions/:id                      (bank_tx.delete)
 */

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
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
import { PanelOnly } from '../tenant-auth/panel-only.decorator';
import type {
  RequestWithTenantContext,
  TenantDb,
} from '../tenant-resolver/tenant-context';
import { BankTransactionsService } from './bank-transactions.service';
import {
  BankTransactionAlreadyMatchedError,
  BankTransactionAmountMismatchError,
  BankTransactionDuplicateRefError,
  BankTransactionNotFoundError,
  DepositAlreadyHasBankTxError,
} from './bank-transactions.errors';
import {
  MatchBankTransactionDto,
  UploadBankTransactionDto,
} from './dto/upload-bank-tx.dto';

@Controller('tenant/bank-transactions')
@UseGuards(TenantJwtGuard, PermissionsGuard)
@PanelOnly()
export class BankTransactionsController {
  constructor(
    private readonly service: BankTransactionsService,
    private readonly audit: AuditLogService,
  ) {}

  private requireDb(req: RequestWithTenantContext): TenantDb {
    if (!req.tenantContext) throw new Error('TenantContext no resuelto.');
    return req.tenantContext.db;
  }

  /** POST /tenant/bank-transactions — empleado sube transferencia. */
  @Post()
  @RequirePermissions('bank_tx.upload')
  @HttpCode(HttpStatus.CREATED)
  async upload(
    @Body() dto: UploadBankTransactionDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = this.requireDb(req);
    try {
      const row = await this.service.upload(db, actor.id, dto);
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'bank_tx.upload',
        targetType: 'bank_transaction',
        targetId: row.id,
        metadata: {
          amount: row.amount,
          bankAccount: row.bankAccount,
          senderName: row.senderName,
        },
        ...extractRequestContext(req),
      });
      return row;
    } catch (err) {
      if (err instanceof BankTransactionDuplicateRefError) {
        throw new ConflictException({
          message: err.message,
          error: 'BANK_TX_DUPLICATE_REF',
        });
      }
      throw err;
    }
  }

  /** GET /tenant/bank-transactions?status=&direction=&amount=&... */
  @Get()
  @RequirePermissions('bank_tx.view')
  async list(
    @Req() req: RequestWithTenantContext,
    @Query('status') status?: string,
    @Query('direction') direction?: string,
    @Query('bankAccount') bankAccount?: string,
    @Query('amount') amount?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('uploadedBy') uploadedBy?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const db = this.requireDb(req);
    return this.service.list(db, {
      status: status as 'unmatched' | 'matched' | 'disputed' | undefined,
      direction: direction as 'incoming' | 'outgoing' | undefined,
      bankAccount,
      amount,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      uploadedBy,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  /**
   * GET /tenant/bank-transactions/unmatched-for-amount/:amount
   * Lista bank_txs sin matchear con monto exacto. Default: solo las del
   * monto pedido. Si pasa `?includeAll=true`, devuelve TODAS las
   * unmatched (para override).
   */
  @Get('unmatched-for-amount/:amount')
  @RequirePermissions('bank_tx.match')
  async unmatchedForAmount(
    @Param('amount') amount: string,
    @Query('includeAll') includeAll: string | undefined,
    @Query('direction') direction: string | undefined,
    @Req() req: RequestWithTenantContext,
  ) {
    const db = this.requireDb(req);
    const dir = (direction === 'outgoing' ? 'outgoing' : 'incoming');
    if (includeAll === 'true') {
      return { data: await this.service.findAllUnmatched(db, dir) };
    }
    return {
      data: await this.service.findUnmatchedByAmountAndDirection(db, amount, dir),
    };
  }

  @Get(':id')
  @RequirePermissions('bank_tx.view')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
  ) {
    const db = this.requireDb(req);
    const row = await this.service.findById(db, id);
    if (!row) throw new NotFoundException(`Bank tx ${id} no existe.`);
    return row;
  }

  /** POST /tenant/bank-transactions/:id/match/:depositId */
  @Post(':id/match/:depositId')
  @RequirePermissions('bank_tx.match')
  @HttpCode(HttpStatus.OK)
  async match(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('depositId', ParseUUIDPipe) depositId: string,
    @Body() dto: MatchBankTransactionDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = this.requireDb(req);
    try {
      const row = await this.service.match(db, id, depositId, actor.id, dto);
      const isOverride = dto.override === true;
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'bank_tx.match',
        targetType: 'bank_transaction',
        targetId: id,
        metadata: {
          depositId,
          override: isOverride,
          overrideReason: dto.overrideReason ?? null,
          severity: isOverride ? 'high' : 'normal',
        },
        ...extractRequestContext(req),
      });
      return row;
    } catch (err) {
      if (err instanceof BankTransactionNotFoundError) {
        throw new NotFoundException({ message: err.message });
      }
      if (err instanceof BankTransactionAlreadyMatchedError) {
        throw new ConflictException({
          message: err.message,
          error: 'BANK_TX_ALREADY_MATCHED',
        });
      }
      if (err instanceof DepositAlreadyHasBankTxError) {
        throw new ConflictException({
          message: err.message,
          error: 'DEPOSIT_ALREADY_HAS_BANK_TX',
        });
      }
      if (err instanceof BankTransactionAmountMismatchError) {
        throw new BadRequestException({
          message: err.message,
          error: 'BANK_TX_AMOUNT_MISMATCH',
        });
      }
      throw err;
    }
  }

  /**
   * Sprint 51: matchea bank_tx OUTGOING con withdrawal.
   * POST /tenant/bank-transactions/:id/match-withdrawal/:withdrawalId
   */
  @Post(':id/match-withdrawal/:withdrawalId')
  @RequirePermissions('bank_tx.match')
  @HttpCode(HttpStatus.OK)
  async matchWithdrawalEndpoint(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('withdrawalId', ParseUUIDPipe) withdrawalId: string,
    @Body() dto: MatchBankTransactionDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = this.requireDb(req);
    try {
      const row = await this.service.matchWithdrawal(
        db,
        id,
        withdrawalId,
        actor.id,
        dto,
      );
      const isOverride = dto.override === true;
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'bank_tx.match_withdrawal',
        targetType: 'bank_transaction',
        targetId: id,
        metadata: {
          withdrawalId,
          override: isOverride,
          overrideReason: dto.overrideReason ?? null,
          severity: isOverride ? 'high' : 'normal',
        },
        ...extractRequestContext(req),
      });
      return row;
    } catch (err) {
      if (err instanceof BankTransactionNotFoundError) {
        throw new NotFoundException({ message: err.message });
      }
      if (err instanceof BankTransactionAlreadyMatchedError) {
        throw new ConflictException({
          message: err.message,
          error: 'BANK_TX_ALREADY_MATCHED',
        });
      }
      if (err instanceof BankTransactionAmountMismatchError) {
        throw new BadRequestException({
          message: err.message,
          error: 'BANK_TX_AMOUNT_MISMATCH',
        });
      }
      throw err;
    }
  }

  /** POST /tenant/bank-transactions/:id/unmatch */
  @Post(':id/unmatch')
  @RequirePermissions('bank_tx.match')
  @HttpCode(HttpStatus.OK)
  async unmatch(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = this.requireDb(req);
    try {
      const row = await this.service.unmatch(db, id, actor.id);
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'bank_tx.unmatch',
        targetType: 'bank_transaction',
        targetId: id,
        metadata: { severity: 'high' },
        ...extractRequestContext(req),
      });
      return row;
    } catch (err) {
      if (err instanceof BankTransactionNotFoundError) {
        throw new NotFoundException({ message: err.message });
      }
      throw err;
    }
  }

  /** DELETE /tenant/bank-transactions/:id — admin only. */
  @Delete(':id')
  @RequirePermissions('bank_tx.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = this.requireDb(req);
    try {
      await this.service.deleteBankTx(db, id, actor.id);
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'bank_tx.delete',
        targetType: 'bank_transaction',
        targetId: id,
        metadata: { severity: 'high' },
        ...extractRequestContext(req),
      });
    } catch (err) {
      if (err instanceof BankTransactionNotFoundError) {
        throw new NotFoundException({ message: err.message });
      }
      throw err;
    }
  }
}
