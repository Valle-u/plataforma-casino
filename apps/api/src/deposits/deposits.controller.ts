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
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import { BonusesAutoGrantService } from '../bonuses/bonuses-auto-grant.service';
import { NotificationsService } from '../notifications/notifications.service';
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
  private readonly logger = new Logger(DepositsController.name);

  constructor(
    private readonly depositsService: DepositsService,
    private readonly audit: AuditLogService,
    private readonly hierarchy: UserHierarchyService,
    private readonly bonusesAutoGrant: BonusesAutoGrantService,
    private readonly notifications: NotificationsService,
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

      // Notif al user: "tu depósito fue aprobado". Fail-soft: si la
      // notif falla, el deposit ya está aprobado y la wallet acreditada;
      // no rollback. in_app + email para que el user lo vea en panel
      // y en su mail.
      for (const channel of ['in_app', 'email'] as const) {
        try {
          await this.notifications.enqueue(db, {
            userId: after.userId,
            kind: 'deposit_approved',
            channel,
            payload: {
              depositId: id,
              amountChips: after.amountChips,
            },
          });
        } catch (err) {
          this.logger.error(
            `Notif deposit_approved (${channel}) falló para user=${after.userId} deposit=${id}: ${(err as Error).message}`,
          );
        }
      }

      // Auto-grant de bono (welcome / reload) tras el approve.
      // Fail-soft: si falla, log warning + audit "auto_grant_failed" pero
      // NO revertimos el depósito. El cajero puede otorgar el bono manual
      // después si fuera necesario (operación ya está aprobada).
      try {
        const result = await this.bonusesAutoGrant.autoGrantForApprovedDeposit(db, {
          depositId: id,
          userId: after.userId,
          depositAmount: after.amountChips,
          actorUserId: actor.id,
        });
        if (result.bonus) {
          await this.audit.record(db, {
            actorUserId: actor.id,
            actorUsername: actor.username,
            actionCode: 'bonus.auto_grant',
            targetType: 'user_bonus',
            targetId: result.bonus.id,
            after: {
              userId: result.bonus.userId,
              definitionId: result.bonus.definitionId,
              amount: result.bonus.grantedAmount,
              kind: result.kind,
            },
            metadata: {
              severity: 'medium',
              triggeredBy: 'deposits.approve',
              depositId: id,
            },
            ...extractRequestContext(req),
          });
        } else if (result.skipReason === 'fraud_blocked') {
          // Bloqueo por antifraude (cluster confirmed score >= 90).
          // Severity:high — el admin DEBE ver esto. Si el bloqueo fue
          // un false positive el user reporta y se revisa el link.
          await this.audit.record(db, {
            actorUserId: actor.id,
            actorUsername: actor.username,
            actionCode: 'bonus.auto_grant.fraud_blocked',
            targetType: 'deposit',
            targetId: id,
            metadata: {
              severity: 'high',
              userId: after.userId,
              depositAmount: after.amountChips,
              reason: 'cluster_confirmed_score_gte_90',
            },
            ...extractRequestContext(req),
          });
        } else if (result.skipReason) {
          // Skip "benigno" — sin definition configurada, deposit
          // bajo el mínimo, etc. Solo debug log.
          this.logger.debug(
            `Auto-grant skip on deposit ${id}: reason=${result.skipReason} kind=${result.kind ?? 'n/a'}`,
          );
        }
      } catch (err) {
        // Error real (funder sin saldo, definition rota, etc.). NO
        // revertir el deposit. Audit + log.
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Auto-grant FALLÓ sobre deposit ${id}: ${msg}. El depósito sigue aprobado.`,
        );
        await this.audit.record(db, {
          actorUserId: actor.id,
          actorUsername: actor.username,
          actionCode: 'bonus.auto_grant_failed',
          targetType: 'deposit',
          targetId: id,
          metadata: {
            severity: 'high',
            error: msg,
            userId: after.userId,
            depositAmount: after.amountChips,
          },
          ...extractRequestContext(req),
        });
      }
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
