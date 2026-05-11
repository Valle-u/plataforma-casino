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
import { BurnDto, MintDto } from './dto/mint-burn.dto';
import {
  IdempotencyConflictError,
  InsufficientBalanceError,
  MintRoleRequiredError,
  WalletNotFoundError,
} from './wallet.errors';
import { WalletService } from './wallet.service';

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

@Controller('tenant/wallet')
@UseGuards(TenantJwtGuard, PermissionsGuard)
export class WalletController {
  constructor(
    private readonly walletService: WalletService,
    private readonly audit: AuditLogService,
  ) {}

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
