/**
 * WalletController — endpoints de wallet expuestos al frontend.
 *
 * Esta primera iteración cubre:
 *   - GET /tenant/wallet/me            → mi propia wallet (cualquier user logueado).
 *   - GET /tenant/wallet/user/:userId  → wallet de otro user (requiere wallet.view_any).
 *   - POST /tenant/wallet/burn         → destruir fichas (admin_tenant only).
 *
 * El mint DIRECTO del admin (crear fichas de la nada) se ELIMINÓ: las fichas
 * solo se crean vía aporte de capital a la Casa, atado a respaldo real (ver
 * Tesorería / B-build-6).
 *
 * Idempotencia:
 *   - `burn` exige header `Idempotency-Key`. Si falta, 400.
 *
 * Auditoría:
 *   - Toda mutación produce entry en audit_log (`actionCode='wallet.burn'`),
 *     antes/después del balance, idempotencyKey en metadata.
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
import { roles, userRoles, walletTransactions, users, HOUSE_USERNAME } from '@casino/db';
import { and, eq, gte, sql } from 'drizzle-orm';
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
import type {
  RequestWithTenantContext,
  TenantDb,
} from '../tenant-resolver/tenant-context';
import { AdminNetworkBypass } from '../user-hierarchy/admin-network-bypass.decorator';
import { ScopeTarget } from '../user-hierarchy/scope-target.decorator';
import { ScopeGuard } from '../user-hierarchy/scope.guard';
import { LoadDto, UnloadDto } from './dto/load-unload.dto';
import { BurnDto } from './dto/mint-burn.dto';
import {
  IdempotencyConflictError,
  IndependentBranchTargetError,
  InsufficientBalanceError,
  MintRoleRequiredError,
  SelfTransferError,
  TargetUserNotFoundError,
  WalletNotFoundError,
} from './wallet.errors';
import {
  WalletService,
  type TransferPairResult,
  type WalletTxType,
  type WalletTxExportRow,
} from './wallet.service';
import { UserHierarchyService } from '../user-hierarchy/user-hierarchy.service';

interface WalletView {
  id: string;
  userId: string;
  balance: string;
  bonusBalance: string;
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
    private readonly hierarchy: UserHierarchyService,
  ) {}

  /**
   * Aislamiento (2026-08-14): quién puede ver/exportar la wallet de OTRO user.
   *
   * `wallet.view_any` habilita ver saldos de otros, pero SIN scope permitía
   * bajar el historial de CUALQUIER user del tenant — incluidas sub-redes de
   * socios independientes (viola R6/E8) y usuarios de otras redes.
   *
   * Modelo (mismo que deposits.resolveScope): el actor alcanza su subárbol de
   * descendientes activos + él mismo, podando las sub-redes independientes
   * (excepto sus HIJOS DIRECTOS independientes, que él enruta). Para el admin,
   * su subárbol = toda la red principal, así que mantiene su acceso; para un
   * cajero/socio, solo su red. NO redefine ninguna permission — solo enforce
   * el aislamiento que ya rige en deposits/withdrawals.
   */
  private async resolveWalletScope(
    db: TenantDb,
    actorId: string,
  ): Promise<string[]> {
    const excluded = await this.hierarchy.getIndependentSubtreeIds(db);
    const downstream = await this.hierarchy.getActiveDescendants(db, actorId);
    const base = [actorId, ...downstream].filter(
      (id) => id === actorId || !excluded.has(id),
    );
    const directChildren = await this.hierarchy.getDirectChildrenIds(db, actorId);
    const indepDirectChildren = directChildren.filter((id) => excluded.has(id));
    return Array.from(new Set([...base, ...indepDirectChildren]));
  }

  /** 404 si el actor no puede ver la wallet de `targetUserId` (fuera de su red). */
  private async assertCanAccessUserWallet(
    db: TenantDb,
    actorId: string,
    targetUserId: string,
  ): Promise<void> {
    if (actorId === targetUserId) return;
    const scope = await this.resolveWalletScope(db, actorId);
    if (!scope.includes(targetUserId)) {
      // 404 (no 403) para no revelar la existencia de users de otra red.
      throw new NotFoundException(`Usuario ${targetUserId} no encontrado.`);
    }
  }

  /**
   * Helper: si el actor tiene 2FA enabled, exige código válido en el
   * body. Si no tiene 2FA, no hace nada. Tira 400 TWO_FA_REQUIRED si
   * falta el código, 401 TWO_FA_CODE_INVALID si es incorrecto.
   *
   * Para operaciones sensibles (mint/burn por ahora; futuro: wallet.adjust,
   * permissions.grant, etc.).
   */
  private async requireTwoFaIfEnabled(
    db: TenantDb,
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
   *
   * `excludeTypes` (optativo, comma-separated): excluye esos `type` de la
   * lista y del `total`. /play/wallet lo usa para ocultar apuestas/ganancias
   * de juego (bet, win, jackpot_win, rollback) y mostrar solo cargas,
   * retiros y bonos. El resto de consumidores (admin wallet, win-toast)
   * no lo mandan y siguen viendo todo.
   */
  @Get('me/transactions')
  async getMyTransactions(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('excludeTypes') excludeTypes?: string,
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
    // Query param libre → cast al tipo del enum. Valores inválidos no
    // matchean ninguna fila (NOT IN), así que no hay riesgo de inyección.
    const excluded: WalletTxType[] = excludeTypes
      ? (excludeTypes
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean) as WalletTxType[])
      : [];
    const { data, total } = await this.walletService.listTransactionsForUser(
      db,
      actor.id,
      limit ? Number(limit) : 50,
      offset ? Number(offset) : 0,
      excluded,
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
   * GET /tenant/wallet/me/stats?windowDays=7 — Sprint 51.10.
   *
   * Agrega los movimientos del actor en una ventana de N días (1-90):
   *   - Sum por type (cuánto mintó, burneó, cargó, descargó, etc.).
   *   - Net change = sum(creditos) - sum(débitos).
   *   - Count total de transactions en la ventana.
   *
   * Para el header del panel `/wallet` — el operador ve de un vistazo
   * cuánto movió esta semana sin tener que paginar el historial.
   *
   * Sin permiso especial — cada user ve solo sus propios stats.
   */
  @Get('me/stats')
  async getMyStats(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
    @Query('windowDays') windowDaysRaw?: string,
  ): Promise<{
    windowDays: number;
    totalTransactions: number;
    netChange: string;
    byType: Array<{ type: string; sum: string; count: number }>;
  }> {
    const db = req.tenantContext!.db;
    const windowDays = Math.max(
      1,
      Math.min(90, Number.parseInt(windowDaysRaw ?? '7', 10) || 7),
    );
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    // Resolver wallet del actor (lo crea si no existe).
    const wallet = await this.walletService.getOrCreateWalletForUser(
      db,
      actor.id,
    );

    const conditions = and(
      eq(walletTransactions.walletId, wallet.id),
      gte(walletTransactions.createdAt, since),
    );

    // Buckets: credit (mint/load/transfer_in/etc.) vs debit (burn/unload/
    // transfer_out/etc.). El SQL lo decide por type para evitar
    // double-counting. El service ya tiene la lista en `CREDIT_TYPES`
    // pero la replicamos acá para mantener el endpoint independiente.
    const CREDIT_TYPES = [
      'mint',
      'load',
      'transfer_in',
      'deposit_credit',
      'bonus_funding_revert',
      'bonus_clear',
      'cashback_credit',
      'promo_reward',
      'win',
    ];

    const [byTypeRows, totalRow, netRow] = await Promise.all([
      db
        .select({
          type: walletTransactions.type,
          sum: sql<string>`coalesce(sum(${walletTransactions.amount}), 0)::text`,
          count: sql<number>`count(*)::int`,
        })
        .from(walletTransactions)
        .where(conditions)
        .groupBy(walletTransactions.type)
        .orderBy(sql`sum(${walletTransactions.amount}) DESC`),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(walletTransactions)
        .where(conditions),
      db
        .select({
          // Cast enum a text para comparar contra los strings — si
          // comparamos directo, Postgres tira 22P02 (`enum_in` con
          // valores que no son del enum walletTransactions.type).
          // ARRAY[...] literal con strings explícitos para evitar
          // problemas de parametrización de arrays.
          net: sql<string>`coalesce(sum(case
            when ${walletTransactions.type}::text in (${sql.join(
              CREDIT_TYPES.map((t) => sql`${t}`),
              sql`, `,
            )})
              then ${walletTransactions.amount}
            else -${walletTransactions.amount}
          end), 0)::text`,
        })
        .from(walletTransactions)
        .where(conditions),
    ]);

    return {
      windowDays,
      totalTransactions: totalRow[0]?.n ?? 0,
      netChange: netRow[0]?.net ?? '0',
      byType: byTypeRows.map((r) => ({
        type: r.type,
        sum: r.sum,
        count: r.count,
      })),
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
    // Aislamiento: solo se exporta la wallet de users dentro de la red del actor.
    await this.assertCanAccessUserWallet(db, actor.id, userId);
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
    // Aislamiento: solo se ve la wallet de users dentro de la red del actor.
    await this.assertCanAccessUserWallet(db, actor.id, userId);
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
  @AdminNetworkBypass('wallet.load_admin_network')
  @HttpCode(HttpStatus.CREATED)
  async load(
    @Body() dto: LoadDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<TransferResponse> {
    this.requireIdempotencyKey(idempotencyKey);
    const db = req.tenantContext!.db;

    // docs/19 + LEYES R7: los empleados cargan fichas SOLO por corrección
    // contra su cupo mensual. El rol 'empleado' queda bloqueado de wallet.load
    // aunque tenga el permiso por override (el cupo es el control — un load
    // desde su wallet propia no consume cupo y abriría un bypass). El admin
    // (tesorería) y los socios dependientes (reventa, R3) siguen cargando con
    // wallet.load sin cambios.
    const employeeRole = await db
      .select({ code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(userRoles.userId, actor.id), eq(roles.code, 'empleado')))
      .limit(1);
    if (employeeRole[0]) {
      throw new ForbiddenException({
        statusCode: HttpStatus.FORBIDDEN,
        message:
          'Los empleados cargan fichas solo por corrección contra su cupo mensual (docs/19). El canal wallet.load no aplica para el rol empleado.',
        error: 'EMPLOYEE_LOAD_BLOCKED',
      });
    }

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
   * El actor RETIRA fichas DESDE el wallet del target.
   *
   * - **Red dependiente**: las fichas vuelven a la Casa (__casa__).
   * - **Red independiente**: las fichas vuelven al operador directo (padre del target).
   *
   * Reason obligatorio (regla §4).
   *
   * Requiere `wallet.unload` + `Idempotency-Key`.
   */
  @Post('unload')
  @RequirePermissions('wallet.unload')
  @ScopeTarget('targetUserId', 'body')
  @AdminNetworkBypass('wallet.unload_admin_network')
  @HttpCode(HttpStatus.CREATED)
  async unload(
    @Body() dto: UnloadDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<TransferResponse> {
    this.requireIdempotencyKey(idempotencyKey);
    const db = req.tenantContext!.db;

    // Resolver DESTINO: padre directo (si está en red independiente) o Casa.
    const nearestIndepAncestor = await this.hierarchy.getNearestIndependentBranchAncestor(
      db,
      dto.targetUserId,
    );

    let targetUserId: string;
    if (nearestIndepAncestor) {
      // Red independiente → fichas vuelven al padre directo (quien cargó).
      const parent = await this.hierarchy.getActiveParent(db, dto.targetUserId);
      if (!parent?.parentUserId) {
        throw new Error('No se encontró el padre directo del usuario en red independiente.');
      }
      targetUserId = parent.parentUserId;
    } else {
      // Red dependiente → fichas vuelven a la Casa.
      const houseRow = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, HOUSE_USERNAME))
        .limit(1);
      if (!houseRow[0]) {
        throw new Error('Casa no encontrada');
      }
      targetUserId = houseRow[0].id;
    }

    let result: TransferPairResult;
    try {
      result = await this.walletService.executeTransferPair(db, {
        actorUserId: actor.id,
        sourceUserId: dto.targetUserId, // el target PIERDE.
        targetUserId, // Casa o padre directo RECIBE.
        amount: dto.amount,
        sourceType: 'unload',
        targetType: nearestIndepAncestor ? 'transfer_in' : 'adjustment',
        source: nearestIndepAncestor ? 'unload_independent' : 'unload_dependent',
        idempotencyKey: idempotencyKey!,
        reason: dto.reason,
        notes: dto.notes ?? null,
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
        destinationType: nearestIndepAncestor ? 'independent_direct_parent' : 'casa',
        destinationUserId: targetUserId,
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
      const hasHold = err.locked !== null && Number(err.locked) > 0;
      return new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        message: err.message,
        error: 'INSUFFICIENT_BALANCE',
        available: err.available,
        required: err.required,
        locked: err.locked ?? '0.00',
        // Cuando el rechazo es porque parte del balance está comprometido en
        // un hold (retiro pendiente), el front lo informa explícitamente.
        reason: hasHold ? 'HOLD_LOCKED' : 'BALANCE',
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
    if (err instanceof IndependentBranchTargetError) {
      return new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        message: err.message,
        error: 'INDEPENDENT_BRANCH_TARGET',
      });
    }
    return err as Error;
  }

  private toView(w: {
    id: string;
    userId: string;
    balance: string;
    bonusBalance?: string;
    lockedBalance: string;
    currency: string;
    version: number;
    updatedAt: Date;
  }): WalletView {
    return {
      id: w.id,
      userId: w.userId,
      balance: w.balance,
      bonusBalance: w.bonusBalance ?? '0',
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

const WALLET_TX_CSV_COLUMNS: CsvColumn<WalletTxExportRow>[] = [
  { header: 'created_at', value: (r) => r.createdAt },
  { header: 'id', value: (r) => r.id },
  { header: 'owner_username', value: (r) => r.ownerUsername },
  { header: 'wallet_id', value: (r) => r.walletId },
  { header: 'type', value: (r) => r.type },
  { header: 'amount', value: (r) => r.amount },
  { header: 'balance_after', value: (r) => r.balanceAfter },
  { header: 'related_tx_id', value: (r) => r.relatedTxId },
  { header: 'counterparty_username', value: (r) => r.counterpartyUsername },
  { header: 'counterparty_user_id', value: (r) => r.counterpartyUserId },
  { header: 'source', value: (r) => r.source },
  { header: 'reference_id', value: (r) => r.referenceId },
  { header: 'idempotency_key', value: (r) => r.idempotencyKey },
  { header: 'created_by_username', value: (r) => r.createdByUsername },
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
