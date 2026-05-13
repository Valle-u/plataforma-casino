/**
 * DepositsController — endpoints del flujo de carga autoservicio.
 *
 * Usuarios (jugadores y cualquier user logueado) pueden:
 *   - POST /tenant/deposits → solicitar depósito (status pending).
 *   - GET  /tenant/deposits/mine → listar SUS propios depósitos.
 *
 * Operadores con permisos (cajero, distribuidor, admin) pueden:
 *   - GET   /tenant/deposits → listar para review (con filtros).
 *   - GET   /tenant/deposits/:id → ver detalle.
 *   - POST  /tenant/deposits/:id/approve → aprueba + acredita wallet.
 *   - POST  /tenant/deposits/:id/reject → rechaza con motivo.
 *
 * Auditoría: cada acción (create/approve/reject) deja entry en audit_log.
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
import { OutOfScopeError } from '../user-hierarchy/user-hierarchy.errors';
import { UserHierarchyService } from '../user-hierarchy/user-hierarchy.service';
import {
  DepositAlreadyResolvedError,
  DepositNotFoundError,
  InvalidPaymentMethodError,
  TooManyPendingDepositsError,
} from './deposits.errors';
import { DepositsService } from './deposits.service';
import { CreateDepositDto } from './dto/create-deposit.dto';
import { RejectDepositDto } from './dto/reject-deposit.dto';

@Controller('tenant/deposits')
@UseGuards(TenantJwtGuard, PermissionsGuard)
export class DepositsController {
  constructor(
    private readonly depositsService: DepositsService,
    private readonly audit: AuditLogService,
    private readonly hierarchy: UserHierarchyService,
  ) {}

  /** POST /tenant/deposits — el actor (cualquier user logueado) solicita depósito. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateDepositDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<{
    deposit: {
      id: string;
      status: string;
      amountChips: string;
      amountFiat: string;
      currencyFiat: string;
      createdAt: Date;
    };
  }> {
    const db = req.tenantContext!.db;
    let deposit;
    try {
      deposit = await this.depositsService.create(db, {
        actorUserId: actor.id,
        methodId: dto.methodId,
        amountFiat: dto.amountFiat,
        currencyFiat: dto.currencyFiat,
        amountChips: dto.amountChips,
        receiptUrl: dto.receiptUrl,
        externalRef: dto.externalRef,
      });
    } catch (err) {
      throw this.mapError(err);
    }

    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'deposits.create',
      targetType: 'deposit',
      targetId: deposit.id,
      after: {
        status: deposit.status,
        amountChips: deposit.amountChips,
        amountFiat: deposit.amountFiat,
        currencyFiat: deposit.currencyFiat,
      },
      metadata: { methodId: dto.methodId },
      ...extractRequestContext(req),
    });

    return {
      deposit: {
        id: deposit.id,
        status: deposit.status,
        amountChips: deposit.amountChips,
        amountFiat: deposit.amountFiat,
        currencyFiat: deposit.currencyFiat,
        createdAt: deposit.createdAt,
      },
    };
  }

  /** GET /tenant/deposits/mine — depósitos del actor. */
  @Get('mine')
  async listMine(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<{ data: unknown[] }> {
    const db = req.tenantContext!.db;
    const data = await this.depositsService.listForUser(
      db,
      actor.id,
      limit ? Number(limit) : undefined,
      offset ? Number(offset) : undefined,
    );
    return { data };
  }

  /** GET /tenant/deposits — listado para review. Requiere `deposits.view`. */
  @Get()
  @RequirePermissions('deposits.view')
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
      'pending' | 'under_review' | 'approved' | 'rejected' | 'expired' | 'cancelled'
    >;
    return this.depositsService.listForReview(db, {
      status: statuses,
      userId,
      assignedTo,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  /** GET /tenant/deposits/:id — detalle. Requiere `deposits.view`. */
  @Get(':id')
  @RequirePermissions('deposits.view')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
  ): Promise<{ deposit: unknown; walletTx: unknown | null }> {
    const db = req.tenantContext!.db;
    let deposit;
    try {
      deposit = await this.depositsService.findById(db, id);
    } catch (err) {
      throw this.mapError(err);
    }
    const walletTx = deposit.walletTxId
      ? await this.depositsService.getLinkedWalletTx(db, deposit.walletTxId)
      : null;
    return { deposit, walletTx };
  }

  /** POST /tenant/deposits/:id/approve — aprueba + acredita wallet. */
  @Post(':id/approve')
  @RequirePermissions('deposits.approve')
  @HttpCode(HttpStatus.OK)
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<{ deposit: unknown; walletTxId: string | null }> {
    const db = req.tenantContext!.db;
    let before;
    try {
      before = await this.depositsService.findById(db, id);
    } catch (err) {
      throw this.mapError(err);
    }

    // Scope: el actor debe poder operar sobre el user dueño del depósito.
    // El @ScopeTarget declarativo no aplica acá porque el targetUserId
    // está en el entity, no en el body/param del request.
    try {
      await this.hierarchy.assertScope(db, actor.id, before.userId);
    } catch (err) {
      throw this.mapError(err);
    }

    let after;
    try {
      after = await this.depositsService.approve(db, id, actor.id);
    } catch (err) {
      throw this.mapError(err);
    }

    // Auditamos solo si el status realmente cambió (idempotencia silenciosa).
    if (before.status !== after.status) {
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'deposits.approve',
        targetType: 'deposit',
        targetId: id,
        before: { status: before.status },
        after: { status: after.status, walletTxId: after.walletTxId },
        metadata: { amountChips: after.amountChips, userId: after.userId },
        ...extractRequestContext(req),
      });
    }

    return { deposit: after, walletTxId: after.walletTxId };
  }

  /** POST /tenant/deposits/:id/reject — rechaza con motivo. */
  @Post(':id/reject')
  @RequirePermissions('deposits.reject')
  @HttpCode(HttpStatus.OK)
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectDepositDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<{ deposit: unknown }> {
    const db = req.tenantContext!.db;
    let before;
    try {
      before = await this.depositsService.findById(db, id);
    } catch (err) {
      throw this.mapError(err);
    }
    try {
      await this.hierarchy.assertScope(db, actor.id, before.userId);
    } catch (err) {
      throw this.mapError(err);
    }
    let after;
    try {
      after = await this.depositsService.reject(db, id, actor.id, dto.reason);
    } catch (err) {
      throw this.mapError(err);
    }

    if (before.status !== after.status) {
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'deposits.reject',
        targetType: 'deposit',
        targetId: id,
        before: { status: before.status },
        after: { status: after.status },
        reason: dto.reason,
        metadata: { userId: after.userId },
        ...extractRequestContext(req),
      });
    }

    return { deposit: after };
  }

  private mapError(err: unknown): Error {
    if (err instanceof DepositNotFoundError) {
      return new NotFoundException({
        statusCode: 404,
        message: err.message,
        error: 'DEPOSIT_NOT_FOUND',
      });
    }
    if (err instanceof InvalidPaymentMethodError) {
      return new BadRequestException({
        statusCode: 400,
        message: err.message,
        error: 'INVALID_PAYMENT_METHOD',
      });
    }
    if (err instanceof TooManyPendingDepositsError) {
      return new ConflictException({
        statusCode: 409,
        message: err.message,
        error: 'TOO_MANY_PENDING_DEPOSITS',
        current: err.current,
      });
    }
    if (err instanceof DepositAlreadyResolvedError) {
      return new ConflictException({
        statusCode: 409,
        message: err.message,
        error: 'DEPOSIT_ALREADY_RESOLVED',
        status: err.status,
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
