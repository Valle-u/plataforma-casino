/**
 * UserBonusesController — instancias de bono.
 *
 * Endpoints:
 *   GET    /tenant/bonuses/me                       → mis bonos (cualquier user logueado)
 *   GET    /tenant/bonuses/user/:userId             → bonos de un user (permiso bonuses.view_any)
 *   GET    /tenant/bonuses/:id                      → uno (permiso bonuses.view_any)
 *   POST   /tenant/bonuses/grant                    → grant manual (permiso bonuses.grant_manual)
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
  UseGuards,
} from '@nestjs/common';
import { users } from '@casino/db';
import { AuditLogService } from '../audit/audit-log.service';
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
  BonusOutOfBranchScopeError,
  BonusTargetNotFoundError,
  BonusTargetNotPlayerError,
  FunderInsufficientBalanceError,
  GrantIdempotencyConflictError,
  UserBonusNotFoundError,
} from './bonuses.errors';
import {
  GrantBonusDto,
} from './dto/grant-bonus.dto';
import { UserBonusesService } from './user-bonuses.service';

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
