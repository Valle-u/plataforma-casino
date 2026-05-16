/**
 * WalletController — endpoints de wallet expuestos al frontend.
 *
 * Esta primera iteración cubre:
 *   - GET /tenant/wallet/me            → mi propia wallet (cualquier user logueado).
 *   - GET /tenant/wallet/user/:userId  → wallet de otro user (requiere wallet.view_any).
 *   - POST /tenant/wallet/mint         → crear fichas (admin_tenant only).
 *   - POST /tenant/wallet/burn         → destruir fichas (admin_tenant only).
 *
 * Idempotencia:
 *   - `mint`/`burn` exigen header `Idempotency-Key`. Si falta, 400.
 *   - El service usa esa key para garantizar que dos requests con misma
 *     key resulten en la misma tx (UNIQUE en wallet_transactions).
 *
 * Auditoría:
 *   - Toda mutación produce entry en audit_log con `actionCode='wallet.mint'`
 *     o `'wallet.burn'`, antes/después del balance, idempotencyKey en metadata.
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
  HttpStatus,
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
import type { WalletTransaction } from '@casino/db';
import { AuditLogService } from '../audit/audit-log.service';
import {
  TwoFaCodeInvalidError,
  TwoFaError,
} from '../tenant-auth/two-fa.errors';
import { TwoFaService } from '../tenant-auth/two-fa.service';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { RequirePermissions } from '../permissions/require-permissions.decorator';
import { extractRequestContext } from '../request-context/request-context';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import { ScopeTarget } from '../user-hierarchy/scope-target.decorator';
import { ScopeGuard } from '../user-hierarchy/scope.guard';
import { LoadDto, UnloadDto } from './dto/load-unload.dto';
import { BurnDto, MintDto } from './dto/mint-burn.dto';
import {
  IdempotencyConflictError,
  InsufficientBalanceError,
  MintRoleRequiredError,
  SelfTransferError,
  TargetUserNotFoundError,
  WalletNotFoundError,
} from './wallet.errors';
import { WalletService, type TransferPairResult } from './wallet.service';

interface WalletView {
  id: string;
  userId: string;
  balance: string;
  lockedBalance: string;
  currency: string;
  version: number;
  updatedAt: Date;
}

interface MintBurnResponse {
  ok: true;
  transaction: {
    id: string;
    type: string;
    amount: string;
    balanceAfter: string;
    createdAt: Date;
    idempotencyKey: string | null;
  };
  wallet: WalletView;
}

interface TransferResponse {
  ok: true;
  sourceTransaction: {
    id: string;
    type: string;
    amount: string;
    balanceAfter: string;
    createdAt: Date;
  };
  targetTransaction: {
    id: string;
    type: string;
    amount: string;
    balanceAfter: string;
    createdAt: Date;
    relatedTxId: string | null;
  };
  sourceWallet: WalletView;
  targetWallet: WalletView;
}

@Controller('tenant/wallet')
@UseGuards(TenantJwtGuard, PermissionsGuard, ScopeGuard)
export class WalletController {
  constructor(
    private readonly walletService: WalletService,
    private readonly audit: AuditLogService,
    private readonly twoFa: TwoFaService,
  ) {}

  /**
   * Helper: si el actor tiene 2FA enabled, exige código válido en el
   * body. Si no tiene 2FA, no hace nada. Tira 400 TWO_FA_REQUIRED si
   * falta el código, 401 TWO_FA_CODE_INVALID si es incorrecto.
   *
   * Para operaciones sensibles (mint/burn por ahora; futuro: wallet.adjust,
   * permissions.grant, etc.).
   */
  private async requireTwoFaIfEnabled(
    db: import('../tenant-resolver/tenant-context').TenantDb,
    actorUserId: string,
    code: string | undefined,
  ): Promise<void> {
    const enabled = await this.twoFa.isEnabled(db, actorUserId);
    if (!enabled) return;
    if (!code) {
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Esta operación requiere código 2FA.',
        error: 'TWO_FA_REQUIRED',
      });
    }
    try {
      await this.twoFa.verify(db, actorUserId, code);
    } catch (err) {
      if (err instanceof TwoFaCodeInvalidError) {
        throw new BadRequestException({
          statusCode: HttpStatus.BAD_REQUEST,
          message: err.message,
          error: 'TWO_FA_CODE_INVALID',
        });
      }
      if (err instanceof TwoFaError) {
        throw new BadRequestException({ message: err.message, error: 'TWO_FA_ERROR' });
      }
      throw err;
    }
  }

  /**
   * GET /tenant/wallet/me
   * Lee la wallet del user logueado. Si no existe, la crea con balance 0.
   * No requiere permiso especial (cada user ve la suya).
   */
  @Get('me')
  async getMine(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<WalletView> {
    const db = req.tenantContext!.db;
    const wallet = await this.walletService.getOrCreateWalletForUser(db, actor.id);
    return this.toView(wallet);
  }

  /**
   * GET /tenant/wallet/me/transactions
   * Historia de transacciones del wallet del user logueado. Paginado.
   * Útil para que el panel del player muestre el historial.
   */
  @Get('me/transactions')
  async getMyTransactions(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<{
    data: Array<{
      id: string;
      type: string;
      amount: string;
      balanceAfter: string;
      reason: string | null;
      createdAt: Date;
    }>;
    total: number;
  }> {
    const db = req.tenantContext!.db;
    const { data, total } = await this.walletService.listTransactionsForUser(
      db,
      actor.id,
      limit ? Number(limit) : 50,
      offset ? Number(offset) : 0,
    );
    return {
      data: data.map((tx) => ({
        id: tx.id,
        type: tx.type,
        amount: tx.amount,
        balanceAfter: tx.balanceAfter,
        reason: tx.reason,
        createdAt: tx.createdAt,
      })),
      total,
    };
  }

  /**
   * GET /tenant/wallet/me/transactions/export
   * Export CSV de las wallet transactions del actor. Cap en
   * `CSV_EXPORT_MAX_ROWS`. Records audit `wallet.export.me`.
   */
  @Get('me/transactions/export')
  @RequirePermissions('wallet.export')
  async exportMyTransactions(
    @Req() req: RequestWithTenantContext,
    @Res() res: Response,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<void> {
    const db = req.tenantContext!.db;
    const { data, total } = await this.walletService.listTransactionsForExport(
      db,
      actor.id,
      CSV_EXPORT_MAX_ROWS,
    );
    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'wallet.export.me',
      targetType: 'wallet_transaction',
      targetId: null,
      metadata: {
        rowCount: data.length,
        totalMatched: total,
        truncated: total > data.length,
        scope: 'self',
        severity: 'medium',
      },
      ...extractRequestContext(req),
    });
    sendCsvResponse(res, 'wallet_me', WALLET_TX_CSV_COLUMNS, data, total);
  }

  /**
   * GET /tenant/wallet/user/:userId/transactions/export
   * Export CSV de las wallet transactions de otro user. Requiere
   * `wallet.export` (mismo permiso que el de uno mismo — el `wallet.view_any`
   * implícito del rol que tiene este permiso es lo que habilita el
   * acceso). Records audit `wallet.export.user`.
   */
  @Get('user/:userId/transactions/export')
  @RequirePermissions('wallet.export', 'wallet.view_any')
  async exportUserTransactions(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() req: RequestWithTenantContext,
    @Res() res: Response,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<void> {
    const db = req.tenantContext!.db;
    const { data, total } = await this.walletService.listTransactionsForExport(
      db,
      userId,
      CSV_EXPORT_MAX_ROWS,
    );
    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'wallet.export.user',
      targetType: 'wallet_transaction',
      targetId: userId,
      metadata: {
        rowCount: data.length,
        totalMatched: total,
        truncated: total > data.length,
        scope: 'user',
        targetUserId: userId,
        severity: 'medium',
      },
      ...extractRequestContext(req),
    });
    sendCsvResponse(res, `wallet_user_${userId.slice(0, 8)}`, WALLET_TX_CSV_COLUMNS, data, total);
  }

  /**
   * GET /tenant/wallet/user/:userId
   * Lee la wallet de otro user. Requiere `wallet.view_any`.
   */
  @Get('user/:userId')
  @RequirePermissions('wallet.view_any')
  async getByUser(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() req: RequestWithTenantContext,
  ): Promise<WalletView> {
    const db = req.tenantContext!.db;
    try {
      const wallet = await this.walletService.getByUserId(db, userId);
      return this.toView(wallet);
    } catch (err) {
      if (err instanceof WalletNotFoundError) {
        // El user puede existir pero no tener wallet aún. Le creamos una
        // wallet vacía y la devolvemos. Esto evita un 404 confuso en el
        // panel admin cuando se visualiza un user nuevo.
        const wallet = await this.walletService.getOrCreateWalletForUser(db, userId);
        return this.toView(wallet);
      }
      throw err;
    }
  }

  /**
   * GET /tenant/wallet/user/:userId/transactions
   * Historia de transacciones de la wallet de otro user. Requiere
   * `wallet.view_any` (mismo permiso que ver el balance del otro).
   * Análogo a `/me/transactions` pero apuntando a un userId arbitrario.
   *
   * Útil para que el cajero/admin revise el histórico de un jugador
   * desde el panel de wallet de ese user.
   */
  @Get('user/:userId/transactions')
  @RequirePermissions('wallet.view_any')
  async getUserTransactions(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() req: RequestWithTenantContext,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<{
    data: Array<{
      id: string;
      type: string;
      amount: string;
      balanceAfter: string;
      reason: string | null;
      createdAt: Date;
    }>;
    total: number;
  }> {
    const db = req.tenantContext!.db;
    const { data, total } = await this.walletService.listTransactionsForUser(
      db,
      userId,
      limit ? Number(limit) : 50,
      offset ? Number(offset) : 0,
    );
    return {
      data: data.map((tx) => ({
        id: tx.id,
        type: tx.type,
        amount: tx.amount,
        balanceAfter: tx.balanceAfter,
        reason: tx.reason,
        createdAt: tx.createdAt,
      })),
      total,
    };
  }

  /**
   * POST /tenant/wallet/mint
   * Crea fichas desde la nada en la wallet del admin actor.
   * Requiere `wallet.mint` (que solo admin_tenant tiene en seed).
   * Header `Idempotency-Key` obligatorio.
   */
  @Post('mint')
  @RequirePermissions('wallet.mint')
  @HttpCode(HttpStatus.CREATED)
  async mint(
    @Body() dto: MintDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<MintBurnResponse> {
    this.requireIdempotencyKey(idempotencyKey);
    const db = req.tenantContext!.db;

    // 2FA: si el admin tiene 2FA activado, exigir código en el body.
    // mint/burn son las operaciones más sensibles del sistema (crean/destruyen
    // valor), así que aunque el actor ya pasó por TenantJwtGuard, pedimos un
    // segundo factor para defender contra access tokens robados.
    await this.requireTwoFaIfEnabled(db, actor.id, dto.twoFaCode);

    let tx;
    try {
      tx = await this.walletService.mint(db, {
        actorUserId: actor.id,
        amount: dto.amount,
        reason: dto.reason,
        idempotencyKey: idempotencyKey!,
        referenceId: dto.referenceId,
        notes: dto.notes,
      });
    } catch (err) {
      throw this.mapWalletError(err);
    }

    const wallet = await this.walletService.getByUserId(db, actor.id);

    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'wallet.mint',
      targetType: 'wallet',
      targetId: wallet.id,
      after: { balance: wallet.balance, version: wallet.version },
      reason: dto.reason,
      metadata: {
        amount: dto.amount,
        idempotencyKey,
        severity: 'high',
        referenceId: dto.referenceId ?? null,
      },
      ...extractRequestContext(req),
    });

    return this.toMintBurnResponse(tx, wallet);
  }

  /**
   * POST /tenant/wallet/burn
   * Destruye fichas del wallet del admin actor.
   * Requiere `wallet.burn`. Header Idempotency-Key obligatorio.
   */
  @Post('burn')
  @RequirePermissions('wallet.burn')
  @HttpCode(HttpStatus.CREATED)
  async burn(
    @Body() dto: BurnDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<MintBurnResponse> {
    this.requireIdempotencyKey(idempotencyKey);
    const db = req.tenantContext!.db;

    // 2FA: mismo motivo que en mint().
    await this.requireTwoFaIfEnabled(db, actor.id, dto.twoFaCode);

    let tx;
    try {
      tx = await this.walletService.burn(db, {
        actorUserId: actor.id,
        amount: dto.amount,
        reason: dto.reason,
        idempotencyKey: idempotencyKey!,
        referenceId: dto.referenceId,
        notes: dto.notes,
      });
    } catch (err) {
      throw this.mapWalletError(err);
    }

    const wallet = await this.walletService.getByUserId(db, actor.id);

    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'wallet.burn',
      targetType: 'wallet',
      targetId: wallet.id,
      after: { balance: wallet.balance, version: wallet.version },
      reason: dto.reason,
      metadata: {
        amount: dto.amount,
        idempotencyKey,
        severity: 'high',
        referenceId: dto.referenceId ?? null,
      },
      ...extractRequestContext(req),
    });

    return this.toMintBurnResponse(tx, wallet);
  }

  /**
   * POST /tenant/wallet/load
   * El actor TRANSFIERE fichas DESDE SU wallet HACIA el wallet de un user
   * target (jugador, cajero subordinado, etc.). Genera 1 par atómico de
   * transacciones: `transfer_out` en el actor + `load` en el target.
   *
   * Requiere `wallet.load` + `Idempotency-Key` header.
   * 409 INSUFFICIENT_BALANCE si el actor no tiene saldo.
   * 409 SELF_TRANSFER si target = actor.
   * 404 TARGET_NOT_FOUND si el target no existe.
   */
  @Post('load')
  @RequirePermissions('wallet.load')
  @ScopeTarget('targetUserId', 'body')
  @HttpCode(HttpStatus.CREATED)
  async load(
    @Body() dto: LoadDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<TransferResponse> {
    this.requireIdempotencyKey(idempotencyKey);
    const db = req.tenantContext!.db;

    let result: TransferPairResult;
    try {
      result = await this.walletService.load(db, {
        actorUserId: actor.id,
        targetUserId: dto.targetUserId,
        amount: dto.amount,
        idempotencyKey: idempotencyKey!,
        reason: dto.reason,
        notes: dto.notes,
      });
    } catch (err) {
      throw this.mapWalletError(err);
    }

    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'wallet.load',
      targetType: 'user',
      targetId: dto.targetUserId,
      after: {
        sourceBalance: result.sourceWallet.balance,
        targetBalance: result.targetWallet.balance,
      },
      reason: dto.reason ?? null,
      metadata: {
        amount: dto.amount,
        idempotencyKey,
        sourceTxId: result.sourceTx.id,
        targetTxId: result.targetTx.id,
      },
      ...extractRequestContext(req),
    });

    return this.toTransferResponse(result);
  }

  /**
   * POST /tenant/wallet/unload
   * El actor RETIRA fichas DESDE el wallet del target HACIA SU wallet.
   * Reason obligatorio (regla §4).
   *
   * Requiere `wallet.unload` + `Idempotency-Key`.
   */
  @Post('unload')
  @RequirePermissions('wallet.unload')
  @ScopeTarget('targetUserId', 'body')
  @HttpCode(HttpStatus.CREATED)
  async unload(
    @Body() dto: UnloadDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<TransferResponse> {
    this.requireIdempotencyKey(idempotencyKey);
    const db = req.tenantContext!.db;

    let result: TransferPairResult;
    try {
      result = await this.walletService.unload(db, {
        actorUserId: actor.id,
        targetUserId: dto.targetUserId,
        amount: dto.amount,
        reason: dto.reason,
        idempotencyKey: idempotencyKey!,
        notes: dto.notes,
      });
    } catch (err) {
      throw this.mapWalletError(err);
    }

    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'wallet.unload',
      targetType: 'user',
      targetId: dto.targetUserId,
      after: {
        sourceBalance: result.sourceWallet.balance,
        targetBalance: result.targetWallet.balance,
      },
      reason: dto.reason,
      metadata: {
        amount: dto.amount,
        idempotencyKey,
        sourceTxId: result.sourceTx.id,
        targetTxId: result.targetTx.id,
      },
      ...extractRequestContext(req),
    });

    return this.toTransferResponse(result);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────

  private requireIdempotencyKey(key: string | undefined): void {
    if (!key || key.trim() === '') {
      throw new BadRequestException(
        'Header Idempotency-Key requerido. Mandá un UUID o ULID estable.',
      );
    }
    if (key.length > 200) {
      throw new BadRequestException('Idempotency-Key demasiado largo (max 200 chars).');
    }
  }

  private mapWalletError(err: unknown): Error {
    if (err instanceof InsufficientBalanceError) {
      return new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        message: err.message,
        error: 'INSUFFICIENT_BALANCE',
        available: err.available,
        required: err.required,
      });
    }
    if (err instanceof IdempotencyConflictError) {
      return new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        message: err.message,
        error: 'IDEMPOTENCY_CONFLICT',
        idempotencyKey: err.key,
      });
    }
    if (err instanceof MintRoleRequiredError) {
      return new ForbiddenException({
        statusCode: HttpStatus.FORBIDDEN,
        message: err.message,
        error: 'ROLE_REQUIRED',
      });
    }
    if (err instanceof SelfTransferError) {
      return new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        message: err.message,
        error: 'SELF_TRANSFER',
      });
    }
    if (err instanceof TargetUserNotFoundError) {
      return new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        message: err.message,
        error: 'TARGET_NOT_FOUND',
      });
    }
    return err as Error;
  }

  private toView(w: {
    id: string;
    userId: string;
    balance: string;
    lockedBalance: string;
    currency: string;
    version: number;
    updatedAt: Date;
  }): WalletView {
    return {
      id: w.id,
      userId: w.userId,
      balance: w.balance,
      lockedBalance: w.lockedBalance,
      currency: w.currency,
      version: w.version,
      updatedAt: w.updatedAt,
    };
  }

  private toTransferResponse(result: TransferPairResult): TransferResponse {
    return {
      ok: true,
      sourceTransaction: {
        id: result.sourceTx.id,
        type: result.sourceTx.type,
        amount: result.sourceTx.amount,
        balanceAfter: result.sourceTx.balanceAfter,
        createdAt: result.sourceTx.createdAt,
      },
      targetTransaction: {
        id: result.targetTx.id,
        type: result.targetTx.type,
        amount: result.targetTx.amount,
        balanceAfter: result.targetTx.balanceAfter,
        createdAt: result.targetTx.createdAt,
        relatedTxId: result.targetTx.relatedTxId,
      },
      sourceWallet: this.toView(result.sourceWallet),
      targetWallet: this.toView(result.targetWallet),
    };
  }

  private toMintBurnResponse(
    tx: {
      id: string;
      type: string;
      amount: string;
      balanceAfter: string;
      createdAt: Date;
      idempotencyKey: string | null;
    },
    wallet: {
      id: string;
      userId: string;
      balance: string;
      lockedBalance: string;
      currency: string;
      version: number;
      updatedAt: Date;
    },
  ): MintBurnResponse {
    return {
      ok: true,
      transaction: {
        id: tx.id,
        type: tx.type,
        amount: tx.amount,
        balanceAfter: tx.balanceAfter,
        createdAt: tx.createdAt,
        idempotencyKey: tx.idempotencyKey,
      },
      wallet: this.toView(wallet),
    };
  }
}

// ──────────────────────────────────────────────────────────────────────
// CSV column definitions + helper
// ──────────────────────────────────────────────────────────────────────

const WALLET_TX_CSV_COLUMNS: CsvColumn<WalletTransaction>[] = [
  { header: 'created_at', value: (r) => r.createdAt },
  { header: 'id', value: (r) => r.id },
  { header: 'wallet_id', value: (r) => r.walletId },
  { header: 'type', value: (r) => r.type },
  { header: 'amount', value: (r) => r.amount },
  { header: 'balance_after', value: (r) => r.balanceAfter },
  { header: 'related_tx_id', value: (r) => r.relatedTxId },
  { header: 'counterparty_user_id', value: (r) => r.counterpartyUserId },
  { header: 'source', value: (r) => r.source },
  { header: 'reference_id', value: (r) => r.referenceId },
  { header: 'idempotency_key', value: (r) => r.idempotencyKey },
  { header: 'created_by', value: (r) => r.createdBy },
  { header: 'reason', value: (r) => r.reason },
  { header: 'notes', value: (r) => r.notes },
];

function sendCsvResponse<T>(
  res: Response,
  entityName: string,
  columns: CsvColumn<T>[],
  data: T[],
  total: number,
): void {
  const csv = buildCsv<T>(columns, data);
  const filename = buildCsvFilename(entityName);
  const truncated = total > data.length;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('X-Total-Rows', String(data.length));
  if (truncated) res.setHeader('X-Truncated', 'true');
  res.send(csv);
}
