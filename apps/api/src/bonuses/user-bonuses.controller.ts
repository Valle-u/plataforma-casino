/**
 * UserBonusesController — instancias de bono.
 *
 * Endpoints:
 *   GET    /tenant/bonuses/me                       → mis bonos (cualquier user logueado)
 *   GET    /tenant/bonuses/user/:userId             → bonos de un user (permiso bonuses.view_any)
 *   GET    /tenant/bonuses/:id                      → uno (permiso bonuses.view_any)
 *   POST   /tenant/bonuses/grant                    → grant manual (permiso bonuses.grant_manual)
 *   POST   /tenant/bonuses/remove                   → débito manual de bono (permiso bonuses.grant_manual)
 *   GET    /tenant/bonuses/stats/active             → KPIs (permiso bonuses.view_any)
 *
 * Grant manual exige header `Idempotency-Key` para evitar duplicados.
 * Las fichas del bono se acreditan directamente en `bonus_balance` del
 * jugador (dual wallet, no toca `balance` regular).
 *
 * Lifecycle eliminado: no hay cancel/force-clear/expire/cashback.
 * Las fichas de bono se consumen al apostar con `placeBetWithBonus`.
 *
 * Scope: el grant manual se valida con el ScopeGuard sobre
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
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { users } from '@casino/db';
import { AuditLogService } from '../audit/audit-log.service';
import {
  buildCsv,
  buildCsvFilename,
  CSV_EXPORT_MAX_ROWS,
  type CsvColumn,
} from '../common/csv';
import { FraudDetectionService } from '../fraud/fraud-detection.service';
import { EffectivePermissionsService } from '../permissions/effective-permissions.service';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { RequirePermissions } from '../permissions/require-permissions.decorator';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { extractRequestContext } from '../request-context/request-context';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import type { RequestWithTenantContext, TenantDb } from '../tenant-resolver/tenant-context';
import { AdminNetworkBypass } from '../user-hierarchy/admin-network-bypass.decorator';
import { ScopeTarget } from '../user-hierarchy/scope-target.decorator';
import { ScopeGuard } from '../user-hierarchy/scope.guard';
import { UserHierarchyService } from '../user-hierarchy/user-hierarchy.service';
import {
  BonusActorRoleError,
  BonusDefinitionNotActiveError,
  BonusDefinitionNotFoundError,
  BonusInsufficientBalanceError,
  BonusOutOfBranchScopeError,
  BonusTargetNotFoundError,
  BonusTargetNotPlayerError,
  FunderInsufficientBalanceError,
  GrantIdempotencyConflictError,
  UserBonusNotFoundError,
} from './bonuses.errors';
import {
  GrantBonusDto,
  RemoveBonusDto,
} from './dto/grant-bonus.dto';
import { UserBonusesService, type UserBonusWithRelations } from './user-bonuses.service';

@Controller('tenant/bonuses')
@UseGuards(TenantJwtGuard, PermissionsGuard, ScopeGuard)
export class UserBonusesController {

  constructor(
    private readonly service: UserBonusesService,
    private readonly hierarchy: UserHierarchyService,
    private readonly audit: AuditLogService,
    private readonly fraudService: FraudDetectionService,
    private readonly effectivePermissions: EffectivePermissionsService,
  ) {}

  /**
   * Resuelve scope downstream del actor. Análogo a deposits/withdrawals.
   *   - `bonuses.view_all` → ve TODO el tenant PERO se poda el subárbol de
   *     socios independientes (aislamiento del modelo económico).
   *   - Sino → [actor.id, ...descendants] filtrado por independientes también.
   */
  private async resolveScope(
    db: TenantDb,
    actorId: string,
  ): Promise<string[] | undefined> {
    const hasViewAll = await this.effectivePermissions.hasAllPermissions(
      db,
      actorId,
      ['bonuses.view_all'],
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
    return [actorId, ...downstream].filter(
      (id) => id === actorId || !excluded.has(id),
    );
  }

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

  @Get()
  @RequirePermissions('bonuses.view_any')
  async listAll(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
    @Query('statuses') statuses?: string,
    @Query('userId') userId?: string,
    @Query('definitionId') definitionId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const db = req.tenantContext!.db;
    const statusList = statuses ? statuses.split(',').map((s) => s.trim()) : undefined;
    const userIds = await this.resolveScope(db, actor.id);
    return this.service.listAll(db, {
      statuses: statusList,
      userId,
      userIds,
      definitionId,
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
   * GET /tenant/bonuses/export
   * Export CSV de instancias de bono con los mismos filtros que `listAll`
   * (statuses, userId, definitionId). Respeta el scope downstream del actor
   * (`resolveScope`). Cap `CSV_EXPORT_MAX_ROWS`. Records audit `bonus.export`.
   */
  @Get('export')
  @RequirePermissions('bonuses.export')
  async exportCsv(
    @Req() req: RequestWithTenantContext,
    @Res() res: Response,
    @CurrentTenantUser() actor: { id: string; username: string },
    @Query('statuses') statuses?: string,
    @Query('userId') userId?: string,
    @Query('definitionId') definitionId?: string,
  ): Promise<void> {
    const db = req.tenantContext!.db;
    const statusList = statuses ? statuses.split(',').map((s) => s.trim()) : undefined;
    const userIds = await this.resolveScope(db, actor.id);
    const { data, total } = await this.service.listAll(db, {
      statuses: statusList,
      userId,
      userIds,
      definitionId,
      limit: CSV_EXPORT_MAX_ROWS,
      offset: 0,
    });
    const truncated = total > data.length;

    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'bonus.export',
      targetType: 'user_bonus',
      targetId: null,
      metadata: {
        rowCount: data.length,
        totalMatched: total,
        truncated,
        filters: {
          statuses: statusList ?? null,
          userId: userId ?? null,
          definitionId: definitionId ?? null,
        },
        severity: 'medium',
      },
      ...extractRequestContext(req),
    });

    const csv = buildCsv<UserBonusWithRelations>(BONUS_CSV_COLUMNS, data);
    const filename = buildCsvFilename('bonuses');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Total-Rows', String(data.length));
    if (truncated) res.setHeader('X-Truncated', 'true');
    res.send(csv);
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
   * Crédita directamente al `bonus_balance` del jugador (dual wallet).
   * Debita el `balance` del funder (definition.fundedByUserId) en la misma TX.
   *
   * Rate-limit conservador: máximo 60 grants/hora por user actor.
   */
  @Post('grant')
  @RequirePermissions('bonuses.grant_manual')
  @ScopeTarget('userId', 'body')
  @AdminNetworkBypass('bonuses.grant_manual_admin_network')
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

    // Antifraude: pre-chequeo antes del grant manual.
    // El grant manual SOLO advierte (el cajero hizo una decisión humana).
    const fraudFlagged = await this.fraudService.isUserInConfirmedHighRiskCluster(
      db,
      dto.userId,
    );

    // Comodín externo (bonuses.grant_manual_admin_network): se saltea
    // la validación de "actor debe ser owner de la definition".
    const isComodinGrant = await this.effectivePermissions.hasAllPermissions(
      db,
      actor.id,
      ['bonuses.grant_manual_admin_network'],
    );

    let result;
    try {
      result = await this.service.grantManual(db, {
        actorUserId: actor.id,
        userId: dto.userId,
        definitionId: dto.definitionId,
        amount: dto.amount,
        reason: dto.reason,
        grantIdempotencyKey: idempotencyKey!,
        notes: dto.notes,
        sourceEvent: dto.sourceEvent,
        skipActorRoleCheck: isComodinGrant,
      });
    } catch (err) {
      throw this.mapError(err);
    }
    const { bonus: granted, independentBranchSocioId } = result;

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
        independentBranchSocioId: independentBranchSocioId ?? undefined,
      },
      ...extractRequestContext(req),
    });

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
      independentBranchSocioId: independentBranchSocioId ?? undefined,
    };
  }

  /**
   * POST /tenant/bonuses/remove — débito manual de dinero de bono.
   *
   * Debita `bonus_balance` del jugador (dual wallet) y acredita el reverso
   * al funder original / Casa (LEYES E3/B4, docs/15 §Reverso). No está
   * atada a una planilla: monto arbitrario elegido por el operador.
   *
   * Rate-limit conservador: máximo 60 removes/hora por user actor.
   */
  @Post('remove')
  @RequirePermissions('bonuses.grant_manual')
  @ScopeTarget('userId', 'body')
  @AdminNetworkBypass('bonuses.grant_manual_admin_network')
  @RateLimit({
    rule: 'bonuses.remove',
    limit: 60,
    windowSec: 60 * 60,
    scope: 'user',
  })
  @HttpCode(HttpStatus.OK)
  async remove(
    @Body() dto: RemoveBonusDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    this.requireIdempotencyKey(idempotencyKey);
    const db = req.tenantContext!.db;

    let result;
    try {
      result = await this.service.removeManual(db, {
        actorUserId: actor.id,
        userId: dto.userId,
        amount: dto.amount,
        reason: dto.reason,
        removeIdempotencyKey: idempotencyKey!,
        notes: dto.notes,
      });
    } catch (err) {
      throw this.mapError(err);
    }

    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'bonus.remove_manual',
      targetType: 'user',
      targetId: dto.userId,
      reason: dto.reason,
      metadata: {
        severity: 'high',
        amount: dto.amount,
        funderUserId: result.funderUserId,
        anchorBonusId: result.anchorBonusId,
        debitTxId: result.debitTxId,
        revertTxId: result.revertTxId,
        notes: dto.notes ?? null,
        idempotencyKey,
      },
      ...extractRequestContext(req),
    });

    return {
      userId: dto.userId,
      amount: dto.amount,
      funderUserId: result.funderUserId,
      anchorBonusId: result.anchorBonusId,
      debitTxId: result.debitTxId,
      revertTxId: result.revertTxId,
    };
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
    if (err instanceof BonusTargetNotPlayerError) {
      return new BadRequestException({
        message: err.message,
        error: 'BONUS_TARGET_NOT_PLAYER',
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
    if (err instanceof BonusInsufficientBalanceError) {
      return new ConflictException({
        message: err.message,
        error: 'BONUS_INSUFFICIENT_BALANCE',
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
    if (err instanceof UserBonusNotFoundError) {
      return new NotFoundException({
        message: err.message,
        error: 'USER_BONUS_NOT_FOUND',
      });
    }
    if (err instanceof BonusActorRoleError) {
      return new ForbiddenException({
        message: err.message,
        error: 'BONUS_ACTOR_ROLE',
      });
    }
    if (err instanceof BonusOutOfBranchScopeError) {
      return new ForbiddenException({
        message: err.message,
        error: 'BONUS_OUT_OF_BRANCH_SCOPE',
      });
    }
    return err as Error;
  }
}

const BONUS_CSV_COLUMNS: CsvColumn<UserBonusWithRelations>[] = [
  { header: 'granted_at', value: (r) => r.grantedAt },
  { header: 'id', value: (r) => r.id },
  { header: 'user_id', value: (r) => r.userId },
  { header: 'username', value: (r) => r.userUsername },
  { header: 'display_name', value: (r) => r.userDisplayName },
  { header: 'definition_id', value: (r) => r.definitionId },
  { header: 'definition_code', value: (r) => r.definitionCode },
  { header: 'definition_name', value: (r) => r.definitionName },
  { header: 'definition_type', value: (r) => r.definitionType },
  { header: 'granted_amount', value: (r) => r.grantedAmount },
  { header: 'remaining_amount', value: (r) => r.remainingAmount },
  { header: 'status', value: (r) => r.status },
  { header: 'funded_by_user_id', value: (r) => r.fundedByUserId },
  { header: 'granted_by_user_id', value: (r) => r.grantedByUserId },
  { header: 'reason', value: (r) => r.reason },
  { header: 'activated_at', value: (r) => r.activatedAt },
  { header: 'expires_at', value: (r) => r.expiresAt },
  { header: 'cleared_at', value: (r) => r.clearedAt },
  { header: 'cancelled_at', value: (r) => r.cancelledAt },
];
