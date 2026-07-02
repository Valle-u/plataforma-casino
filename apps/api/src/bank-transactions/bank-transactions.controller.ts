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
  Patch,
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
import { UserHierarchyService } from '../user-hierarchy/user-hierarchy.service';
import type {
  RequestWithTenantContext,
  TenantDb,
} from '../tenant-resolver/tenant-context';
import { BankTransactionsService } from './bank-transactions.service';
import {
  BankTransactionAlreadyMatchedError,
  BankTransactionAmountMismatchError,
  BankTransactionDuplicateRefError,
  BankTransactionMatchedImmutableError,
  BankTransactionNotFoundError,
  DepositAlreadyHasBankTxError,
} from './bank-transactions.errors';
import {
  MatchBankTransactionDto,
  UpdateBankTransactionDto,
  UploadBankTransactionDto,
} from './dto/upload-bank-tx.dto';

@Controller('tenant/bank-transactions')
@UseGuards(TenantJwtGuard, PermissionsGuard)
@PanelOnly()
export class BankTransactionsController {
  constructor(
    private readonly service: BankTransactionsService,
    private readonly audit: AuditLogService,
    private readonly hierarchy: UserHierarchyService,
  ) {}

  private requireDb(req: RequestWithTenantContext): TenantDb {
    if (!req.tenantContext) throw new Error('TenantContext no resuelto.');
    return req.tenantContext.db;
  }

  /**
   * Capa 3 · Fase 2: si el actor es socio independiente, devuelve su
   * `branchBankAccount` — ese es el único bankAccount que puede ver/tocar.
   * Sino devuelve null (admin/otros roles ven todo el extracto del tenant).
   */
  private async resolveIndepBankAccount(
    db: TenantDb,
    actorId: string,
  ): Promise<string | null> {
    return this.hierarchy.getBankAccountOfIndependent(db, actorId);
  }

  /**
   * Capa 3 · Fase 2: para endpoints por ID (findOne, match, unmatch,
   * update, delete). Si el actor es indep, valida que la bank_tx caiga
   * en su cuenta; sino tira NOT_FOUND (mismo trato que Fase 1).
   */
  private async assertActorCanTouch(
    db: TenantDb,
    actorId: string,
    bankTxId: string,
  ): Promise<void> {
    const indepAcct = await this.resolveIndepBankAccount(db, actorId);
    if (indepAcct === null) return; // admin / no-indep: sin restricción de cuenta.
    await this.service.assertBankTxOwnedByAccount(db, bankTxId, [indepAcct]);
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
    // Capa 3 · Fase 2: un socio indep solo puede subir a SU propia cuenta.
    // Sin este check, con bank_tx.upload otorgado, podría contaminar la
    // cola del banco del admin.
    const indepAcct = await this.resolveIndepBankAccount(db, actor.id);
    if (indepAcct !== null && dto.bankAccount !== indepAcct) {
      throw new BadRequestException({
        message: `Los socios independientes solo pueden subir transferencias a su propia cuenta (${indepAcct}).`,
        error: 'BANK_TX_WRONG_ACCOUNT',
      });
    }
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
    @CurrentTenantUser() actor: { id: string },
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
    // Aislamiento: excluir del listado las transferencias que caen en los
    // bancos propios de socios independientes (users.branchBankAccount).
    // Modelo económico: el independiente tiene su propio banco, ese extracto
    // no le corresponde al admin del tenant.
    const excludeBankAccounts = await this.hierarchy.getIndependentBankAccounts(db);
    // Capa 3 · Fase 2: si el actor es indep, restringimos su cola a su
    // propia cuenta (el excludeBankAccounts es para el admin — al indep
    // no le aplica porque solo ve la suya).
    const indepAcct = await this.resolveIndepBankAccount(db, actor.id);
    const onlyBankAccounts = indepAcct ? [indepAcct] : undefined;
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
      excludeBankAccounts: indepAcct ? undefined : excludeBankAccounts,
      onlyBankAccounts,
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
    @CurrentTenantUser() actor: { id: string },
  ) {
    const db = this.requireDb(req);
    const dir = (direction === 'outgoing' ? 'outgoing' : 'incoming');
    // Capa 3 · Fase 2: si el actor es indep, el selector de matching solo
    // muestra bank_txs de su propia cuenta.
    const indepAcct = await this.resolveIndepBankAccount(db, actor.id);
    const onlyBankAccounts = indepAcct ? [indepAcct] : undefined;
    if (includeAll === 'true') {
      return { data: await this.service.findAllUnmatched(db, dir, onlyBankAccounts) };
    }
    return {
      data: await this.service.findUnmatchedByAmountAndDirection(
        db,
        amount,
        dir,
        onlyBankAccounts,
      ),
    };
  }

  @Get(':id')
  @RequirePermissions('bank_tx.view')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
  ) {
    const db = this.requireDb(req);
    try {
      // Capa 3 · Fase 2: indep solo ve las bank_tx de su cuenta.
      await this.assertActorCanTouch(db, actor.id, id);
    } catch (err) {
      if (err instanceof BankTransactionNotFoundError) {
        throw new NotFoundException(`Bank tx ${id} no existe.`);
      }
      throw err;
    }
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
      // Capa 3 · Fase 2: indep solo puede matchear bank_tx de su cuenta.
      await this.assertActorCanTouch(db, actor.id, id);
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
      // Capa 3 · Fase 2: indep solo puede matchear bank_tx de su cuenta.
      await this.assertActorCanTouch(db, actor.id, id);
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
      // Capa 3 · Fase 2: indep solo puede unmatch bank_tx de su cuenta.
      await this.assertActorCanTouch(db, actor.id, id);
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

  /**
   * PATCH /tenant/bank-transactions/:id — editar una transferencia aún sin
   * matchear. Solo campos del DTO (patch parcial). 409 si ya está matcheada.
   */
  @Patch(':id')
  @RequirePermissions('bank_tx.edit')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBankTransactionDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = this.requireDb(req);
    try {
      // Capa 3 · Fase 2: indep solo puede editar bank_tx de su cuenta.
      await this.assertActorCanTouch(db, actor.id, id);
      const before = await this.service.findById(db, id);
      const row = await this.service.update(db, id, actor.id, dto);
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'bank_tx.edit',
        targetType: 'bank_transaction',
        targetId: id,
        before: before ?? undefined,
        after: row,
        metadata: { changedFields: Object.keys(dto), severity: 'medium' },
        ...extractRequestContext(req),
      });
      return row;
    } catch (err) {
      if (err instanceof BankTransactionNotFoundError) {
        throw new NotFoundException({ message: err.message });
      }
      if (err instanceof BankTransactionMatchedImmutableError) {
        throw new ConflictException({
          message: err.message,
          error: 'BANK_TX_ALREADY_MATCHED',
        });
      }
      if (err instanceof BankTransactionDuplicateRefError) {
        throw new ConflictException({
          message: err.message,
          error: 'BANK_TX_DUPLICATE_REF',
        });
      }
      throw err;
    }
  }

  /** DELETE /tenant/bank-transactions/:id — admin only. Solo sin matchear. */
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
      // Capa 3 · Fase 2: indep solo puede borrar bank_tx de su cuenta.
      await this.assertActorCanTouch(db, actor.id, id);
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
      if (err instanceof BankTransactionMatchedImmutableError) {
        throw new ConflictException({
          message: err.message,
          error: 'BANK_TX_ALREADY_MATCHED',
        });
      }
      throw err;
    }
  }
}
