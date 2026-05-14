/**
 * UserBonusesController — instancias de bono.
 *
 * Endpoints:
 *   GET    /tenant/bonuses/me                       → mis bonos (cualquier user logueado)
 *   GET    /tenant/bonuses/user/:userId             → bonos de un user (permiso bonuses.view_any)
 *   GET    /tenant/bonuses/:id                      → uno (permiso bonuses.view_any si no es propio)
 *   POST   /tenant/bonuses/grant                    → grant manual (permiso bonuses.grant_manual)
 *   POST   /tenant/bonuses/:id/cancel               → cancelar (permiso bonuses.cancel)
 *   POST   /tenant/bonuses/:id/force-clear          → forzar clear (permiso bonuses.force_clear + 2FA)
 *   GET    /tenant/bonuses/stats/active             → KPIs (permiso bonuses.view_any)
 *
 * Grant manual exige header `Idempotency-Key` para evitar duplicados.
 *
 * Scope: el grant_manual y cancel se valida con el ScopeGuard sobre
 * `userId` del request — un cajero solo puede otorgar a users dentro de
 * su red operativa.
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
  UseGuards,
} from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import { FraudDetectionService } from '../fraud/fraud-detection.service';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { RequirePermissions } from '../permissions/require-permissions.decorator';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { extractRequestContext } from '../request-context/request-context';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import { TwoFaCodeInvalidError, TwoFaError } from '../tenant-auth/two-fa.errors';
import { TwoFaService } from '../tenant-auth/two-fa.service';
import type { RequestWithTenantContext, TenantDb } from '../tenant-resolver/tenant-context';
import { OutOfScopeError } from '../user-hierarchy/user-hierarchy.errors';
import { ScopeTarget } from '../user-hierarchy/scope-target.decorator';
import { ScopeGuard } from '../user-hierarchy/scope.guard';
import { UserHierarchyService } from '../user-hierarchy/user-hierarchy.service';
import {
  BonusDefinitionNotActiveError,
  BonusDefinitionNotFoundError,
  BonusTargetNotFoundError,
  FunderInsufficientBalanceError,
  GrantIdempotencyConflictError,
  UserBonusInvalidStatusError,
  UserBonusNotFoundError,
} from './bonuses.errors';
import {
  CancelBonusDto,
  ForceClearBonusDto,
  GrantBonusDto,
} from './dto/grant-bonus.dto';
import { BonusesCashbackService } from './bonuses-cashback.service';
import { BonusesExpirationService } from './bonuses-expiration.service';
import { UserBonusesService } from './user-bonuses.service';

@Controller('tenant/bonuses')
@UseGuards(TenantJwtGuard, PermissionsGuard, ScopeGuard)
export class UserBonusesController {
  constructor(
    private readonly service: UserBonusesService,
    private readonly hierarchy: UserHierarchyService,
    private readonly twoFa: TwoFaService,
    private readonly audit: AuditLogService,
    private readonly expirationService: BonusesExpirationService,
    private readonly cashbackService: BonusesCashbackService,
    private readonly fraudService: FraudDetectionService,
  ) {}

  @Get('me')
  async listMine(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
    @Query('statuses') statuses?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const db = req.tenantContext!.db;
    const statusList = statuses ? statuses.split(',').map((s) => s.trim()) : undefined;
    return this.service.listForUser(db, actor.id, {
      statuses: statusList,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Get('user/:userId')
  @RequirePermissions('bonuses.view_any')
  async listForUser(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() req: RequestWithTenantContext,
    @Query('statuses') statuses?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const db = req.tenantContext!.db;
    const statusList = statuses ? statuses.split(',').map((s) => s.trim()) : undefined;
    return this.service.listForUser(db, userId, {
      statuses: statusList,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Get('stats/active')
  @RequirePermissions('bonuses.view_any')
  async stats(@Req() req: RequestWithTenantContext) {
    const db = req.tenantContext!.db;
    return this.service.countActive(db);
  }

  /**
   * POST /tenant/bonuses/jobs/expire
   *
   * Dispara el job de expiración SOLO para el tenant actual del request.
   * Útil para:
   *   - Reconciliación manual: admin notó bonos vencidos no procesados
   *     (cron caído, etc.) y los quiere limpiar AHORA.
   *   - Testing del flow.
   *
   * Requiere `bonuses.force_clear` (es la operación más sensible — cierra
   * bonos masivamente). No exige 2FA porque no entrega chips al user
   * (revierte al funder). Cron-equivalente, no destructivo end-user.
   */
  @Post('jobs/expire')
  @RequirePermissions('bonuses.force_clear')
  @HttpCode(HttpStatus.OK)
  async expireDue(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    const result = await this.expirationService.expireDueForTenant(db);

    if (result.totalProcessed > 0) {
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'bonus.expire_job.manual',
        targetType: 'bonus_batch',
        targetId: null,
        metadata: {
          severity: 'medium',
          ...result,
        },
        ...extractRequestContext(req),
      });
    }

    return result;
  }

  /**
   * POST /tenant/bonuses/jobs/cashback?asOf=ISO8601
   *
   * Dispara el job de cashback para el tenant actual. `asOf` opcional
   * permite anclar el "ahora" (útil para tests + reconciliación
   * histórica). Sin asOf usa `new Date()`.
   *
   * El job calcula sobre el ÚLTIMO BUCKET CERRADO según el `periodDays`
   * de cada definition cashback activa. Idempotente: re-correr el mismo
   * día → 0 grants nuevos.
   *
   * Requiere `bonuses.force_clear` (mismo nivel de sensibilidad que el
   * job de expiración).
   */
  @Post('jobs/cashback')
  @RequirePermissions('bonuses.force_clear')
  @HttpCode(HttpStatus.OK)
  async runCashback(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
    @Query('asOf') asOf?: string,
  ) {
    const db = req.tenantContext!.db;
    const asOfDate = asOf ? new Date(asOf) : new Date();
    if (asOf && Number.isNaN(asOfDate.getTime())) {
      throw new BadRequestException('asOf inválido (esperado ISO 8601).');
    }
    const result = await this.cashbackService.runForTenant(db, asOfDate);

    if (result.grantsCreated > 0) {
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'bonus.cashback_job.manual',
        targetType: 'bonus_batch',
        targetId: null,
        metadata: {
          severity: 'medium',
          asOf: asOfDate.toISOString(),
          ...result,
        },
        ...extractRequestContext(req),
      });
    }

    return result;
  }

  @Get(':id')
  @RequirePermissions('bonuses.view_any')
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
  ) {
    const db = req.tenantContext!.db;
    try {
      return await this.service.findById(db, id);
    } catch (err) {
      if (err instanceof UserBonusNotFoundError) {
        throw new NotFoundException({ message: err.message, error: 'USER_BONUS_NOT_FOUND' });
      }
      throw err;
    }
  }

  /**
   * POST /tenant/bonuses/grant — grant manual.
   *
   * Rate-limit conservador: máximo 60 grants/hora por user actor. Un
   * cajero legítimo puede otorgar bonos en racha; un atacante con sesión
   * robada no debería poder vaciar la caja del funder en un minuto.
   */
  @Post('grant')
  @RequirePermissions('bonuses.grant_manual')
  @ScopeTarget('userId', 'body')
  @RateLimit({
    rule: 'bonuses.grant',
    limit: 60,
    windowSec: 60 * 60,
    scope: 'user',
  })
  @HttpCode(HttpStatus.CREATED)
  async grant(
    @Body() dto: GrantBonusDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    this.requireIdempotencyKey(idempotencyKey);
    const db = req.tenantContext!.db;

    // Antifraude (doc 15 §D3): pre-chequeo antes del grant manual.
    // A DIFERENCIA del auto-grant (que bloquea), el grant manual SOLO
    // ADVIERTE: el cajero hizo una decisión humana explícita y tiene
    // contexto (puede ser una promo legítima a una cuenta marginalmente
    // sospechosa). Pero auditamos severity:high y devolvemos un flag
    // en la response para que la UI del cajero muestre la advertencia.
    //
    // Threshold: usa `fraud.welcome_block_threshold` (default 90) +
    // status='confirmed' — el chequeo estricto, no por suspected.
    const fraudFlagged = await this.fraudService.isUserInConfirmedHighRiskCluster(
      db,
      dto.userId,
    );

    let granted;
    try {
      granted = await this.service.grantManual(db, {
        actorUserId: actor.id,
        userId: dto.userId,
        definitionId: dto.definitionId,
        amount: dto.amount,
        reason: dto.reason,
        grantIdempotencyKey: idempotencyKey!,
        notes: dto.notes,
        sourceEvent: dto.sourceEvent,
      });
    } catch (err) {
      throw this.mapError(err);
    }

    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'bonus.grant_manual',
      targetType: 'user_bonus',
      targetId: granted.id,
      after: {
        userId: granted.userId,
        definitionId: granted.definitionId,
        amount: granted.grantedAmount,
      },
      reason: dto.reason,
      metadata: {
        severity: 'high',
        idempotencyKey,
        funderUserId: granted.fundedByUserId,
        fraudFlagged: fraudFlagged || undefined,
      },
      ...extractRequestContext(req),
    });

    // Si el target estaba flagged, audit extra severity:high para que
    // el admin lo vea en su panel "manual grants a cuentas flagged".
    if (fraudFlagged) {
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'bonus.grant_manual.fraud_warning',
        targetType: 'user_bonus',
        targetId: granted.id,
        metadata: {
          severity: 'high',
          userId: granted.userId,
          amount: granted.grantedAmount,
          reason: 'target_in_confirmed_high_risk_cluster',
        },
        ...extractRequestContext(req),
      });
    }

    return {
      ...granted,
      fraudWarning: fraudFlagged || undefined,
    };
  }

  @Post(':id/cancel')
  @RequirePermissions('bonuses.cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelBonusDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;

    // Scope check manual (el bonus.userId no viene en el body — hay que
    // mirarlo del entity primero).
    const before = await this.fetchOr404(db, id);
    await this.requireScope(db, actor.id, before.userId);

    let cancelled;
    try {
      cancelled = await this.service.cancel(db, id, actor.id, dto.reason);
    } catch (err) {
      throw this.mapError(err);
    }

    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'bonus.cancel',
      targetType: 'user_bonus',
      targetId: id,
      before: { status: before.status, remainingAmount: before.remainingAmount },
      after: { status: cancelled.status, remainingAmount: cancelled.remainingAmount },
      reason: dto.reason,
      metadata: { severity: 'high' },
      ...extractRequestContext(req),
    });

    return cancelled;
  }

  /**
   * Force-clear: pasa las fichas del bono al wallet real del user.
   * Operación destructiva (no se puede deshacer fácilmente). Exige
   * permiso `bonuses.force_clear` (no-delegable en seed) + 2FA del actor.
   */
  @Post(':id/force-clear')
  @RequirePermissions('bonuses.force_clear')
  @HttpCode(HttpStatus.OK)
  async forceClear(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ForceClearBonusDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;

    const before = await this.fetchOr404(db, id);
    await this.requireScope(db, actor.id, before.userId);
    await this.requireTwoFaIfEnabled(db, actor.id, dto.twoFaCode);

    let cleared;
    try {
      cleared = await this.service.forceClear(db, id, actor.id, dto.reason);
    } catch (err) {
      throw this.mapError(err);
    }

    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'bonus.force_clear',
      targetType: 'user_bonus',
      targetId: id,
      before: { status: before.status, remainingAmount: before.remainingAmount },
      after: { status: cleared.status, remainingAmount: cleared.remainingAmount },
      reason: dto.reason,
      metadata: { severity: 'high' },
      ...extractRequestContext(req),
    });

    return cleared;
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

  private async fetchOr404(db: TenantDb, id: string) {
    try {
      return await this.service.findById(db, id);
    } catch (err) {
      if (err instanceof UserBonusNotFoundError) {
        throw new NotFoundException({ message: err.message, error: 'USER_BONUS_NOT_FOUND' });
      }
      throw err;
    }
  }

  private async requireScope(
    db: TenantDb,
    actorId: string,
    targetUserId: string,
  ): Promise<void> {
    try {
      await this.hierarchy.assertScope(db, actorId, targetUserId);
    } catch (err: unknown) {
      if (err instanceof OutOfScopeError) {
        throw new ForbiddenException({ message: err.message, error: 'OUT_OF_SCOPE' });
      }
      throw err;
    }
  }

  private async requireTwoFaIfEnabled(
    db: TenantDb,
    actorUserId: string,
    code: string | undefined,
  ): Promise<void> {
    const enabled = await this.twoFa.isEnabled(db, actorUserId);
    if (!enabled) return;
    if (!code) {
      throw new BadRequestException({
        message: 'Esta operación requiere código 2FA.',
        error: 'TWO_FA_REQUIRED',
      });
    }
    try {
      await this.twoFa.verify(db, actorUserId, code);
    } catch (err) {
      if (err instanceof TwoFaCodeInvalidError) {
        throw new BadRequestException({ message: err.message, error: 'TWO_FA_CODE_INVALID' });
      }
      if (err instanceof TwoFaError) {
        throw new BadRequestException({ message: err.message, error: 'TWO_FA_ERROR' });
      }
      throw err;
    }
  }

  private mapError(err: unknown): Error {
    if (err instanceof BonusDefinitionNotFoundError) {
      return new NotFoundException({
        message: err.message,
        error: 'BONUS_DEFINITION_NOT_FOUND',
      });
    }
    if (err instanceof BonusDefinitionNotActiveError) {
      return new ConflictException({
        message: err.message,
        error: 'BONUS_DEFINITION_NOT_ACTIVE',
      });
    }
    if (err instanceof BonusTargetNotFoundError) {
      return new NotFoundException({
        message: err.message,
        error: 'BONUS_TARGET_NOT_FOUND',
      });
    }
    if (err instanceof FunderInsufficientBalanceError) {
      return new ConflictException({
        message: err.message,
        error: 'FUNDER_INSUFFICIENT_BALANCE',
        required: err.required,
        available: err.available,
      });
    }
    if (err instanceof GrantIdempotencyConflictError) {
      return new ConflictException({
        message: err.message,
        error: 'IDEMPOTENCY_CONFLICT',
        idempotencyKey: err.key,
      });
    }
    if (err instanceof UserBonusInvalidStatusError) {
      return new ConflictException({
        message: err.message,
        error: 'USER_BONUS_INVALID_STATUS',
      });
    }
    if (err instanceof UserBonusNotFoundError) {
      return new NotFoundException({
        message: err.message,
        error: 'USER_BONUS_NOT_FOUND',
      });
    }
    return err as Error;
  }
}
