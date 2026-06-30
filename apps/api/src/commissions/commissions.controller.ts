/**
 * CommissionsController — admin del módulo de comisiones.
 *
 * Endpoints:
 *   - GET    /tenant/commissions/rules
 *   - GET    /tenant/commissions/rules/:id
 *   - POST   /tenant/commissions/rules              (commissions.configure)
 *   - PATCH  /tenant/commissions/rules/:id          (commissions.configure)
 *   - POST   /tenant/commissions/rules/:id/archive  (commissions.configure)
 *   - GET    /tenant/commissions/payouts            (commissions.view + scope)
 *   - POST   /tenant/commissions/preview            (commissions.configure)
 *     Body: { eventType, sourceUserId, sourceAmount } → devuelve plan
 *     sin persistir. Útil para que el admin valide "si apruebo este
 *     deposit de $1000, quién cobra qué" antes de hookear el apply
 *     automático (Sprint 25).
 *
 * Mutations auditadas: commission_rule.create/edit/archive.
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
  InternalServerErrorException,
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
import { EffectivePermissionsService } from '../permissions/effective-permissions.service';
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
import { UserHierarchyService } from '../user-hierarchy/user-hierarchy.service';
import {
  CommissionRuleConflictError,
  CommissionRuleNotFoundError,
  ConservationViolationError,
  InvalidNetworkRateError,
  InvertedMarkupError,
  NetworkRateBelowChildrenError,
  NetworkRateExceedsParentError,
  NotDirectChildError,
  PeriodAlreadySettledError,
} from './commissions.errors';
import { HouseNotProvisionedError } from '../house/house.service';
import { CommissionsService } from './commissions.service';
import { NetworkCommissionsService } from './network-commissions.service';
import {
  CreateCommissionRuleDto,
  UpdateCommissionRuleDto,
} from './dto/commission.dto';
import { SetNetworkRateDto } from './dto/network-rate.dto';
import { ComputeNetworkPeriodDto } from './dto/compute-network.dto';
import { SettleNetworkDto } from './dto/settle-network.dto';

@Controller('tenant/commissions')
@UseGuards(TenantJwtGuard, PermissionsGuard)
@PanelOnly()
export class CommissionsController {
  constructor(
    private readonly service: CommissionsService,
    private readonly network: NetworkCommissionsService,
    private readonly audit: AuditLogService,
    private readonly hierarchy: UserHierarchyService,
    private readonly effectivePermissions: EffectivePermissionsService,
  ) {}

  /**
   * PATCH /tenant/commissions/network-rate/:childUserId — comisiones por red (C1).
   * El operador fija el % que su hijo directo gana de la NetWin de su sub-red.
   * Valida hijo-directo + tope (rate ≤ lo que el actor cobra de su padre).
   */
  @Patch('network-rate/:childUserId')
  @RequirePermissions('commissions.configure_network')
  async setNetworkRate(
    @Param('childUserId', ParseUUIDPipe) childUserId: string,
    @Body() dto: SetNetworkRateDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    try {
      await this.service.setNetworkRate(db, {
        actorUserId: actor.id,
        childUserId,
        rate: dto.rate,
      });
    } catch (err) {
      if (err instanceof InvalidNetworkRateError) {
        throw new BadRequestException({
          message: err.message,
          error: 'INVALID_NETWORK_RATE',
        });
      }
      if (err instanceof NotDirectChildError) {
        throw new ForbiddenException({
          message: err.message,
          error: 'NOT_DIRECT_CHILD',
        });
      }
      if (err instanceof NetworkRateExceedsParentError) {
        throw new ConflictException({
          message: err.message,
          error: 'RATE_EXCEEDS_PARENT',
          cap: err.cap,
        });
      }
      if (err instanceof NetworkRateBelowChildrenError) {
        throw new ConflictException({
          message: err.message,
          error: 'RATE_BELOW_CHILDREN',
          maxChildRate: err.maxChildRate,
        });
      }
      throw err;
    }
    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'commissions.set_network_rate',
      targetType: 'user',
      targetId: childUserId,
      metadata: { rate: dto.rate, severity: 'medium' },
      ...extractRequestContext(req),
    });
    return { ok: true, childUserId, rate: dto.rate };
  }

  /**
   * POST /tenant/commissions/network/compute — motor NetWin (C2).
   * Computa (idempotente) las comisiones por red del período (default: mes
   * anterior completo). Operación de tenant ⇒ admin (commissions.configure).
   */
  @Post('network/compute')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('commissions.configure')
  async computeNetworkPeriod(
    @Body() dto: ComputeNetworkPeriodDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    let period: { periodStart: Date; periodEnd: Date };
    try {
      period = NetworkCommissionsService.resolvePeriod(dto.period);
    } catch {
      throw new BadRequestException({
        message: `Período inválido: ${dto.period}`,
        error: 'INVALID_PERIOD',
      });
    }

    let result;
    try {
      result = await this.network.computePeriod(db, period);
    } catch (err) {
      if (err instanceof PeriodAlreadySettledError) {
        throw new ConflictException({
          message: err.message,
          error: 'PERIOD_ALREADY_SETTLED',
        });
      }
      if (err instanceof InvertedMarkupError) {
        throw new ConflictException({
          message: err.message,
          error: 'INVERTED_MARKUP',
          offenders: err.offenders,
        });
      }
      if (err instanceof ConservationViolationError) {
        throw new InternalServerErrorException({
          message: err.message,
          error: 'CONSERVATION_VIOLATED',
          diff: err.diff,
        });
      }
      throw err;
    }

    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'commissions.compute_network',
      targetType: 'commission_network_period',
      targetId: result.periodStart,
      metadata: { ...result, severity: 'medium' },
      ...extractRequestContext(req),
    });
    return result;
  }

  /**
   * GET /tenant/commissions/network/periods?period=YYYY-MM — resultados del
   * motor NetWin, scopeados al downstream del actor (salvo commissions.view_all).
   */
  @Get('network/periods')
  @RequirePermissions('commissions.view')
  async listNetworkPeriods(
    @Query('period') period: string | undefined,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
  ) {
    const db = req.tenantContext!.db;
    const scope = await this.resolveScope(db, actor.id);

    let periodStart: Date | undefined;
    if (period && period.trim()) {
      try {
        periodStart = NetworkCommissionsService.resolvePeriod(period).periodStart;
      } catch {
        throw new BadRequestException({
          message: `Período inválido: ${period}`,
          error: 'INVALID_PERIOD',
        });
      }
    }

    const rows = await this.network.listPeriods(db, {
      periodStart,
      scopeUserIds: scope,
    });
    return { periods: rows };
  }

  /**
   * GET /tenant/commissions/network/socios — socios con su % configurado, para
   * que el admin fije la comisión de cada uno. Admin.
   */
  @Get('network/socios')
  @RequirePermissions('commissions.configure')
  async listNetworkSocios(@Req() req: RequestWithTenantContext) {
    const db = req.tenantContext!.db;
    const socios = await this.network.listSocioRates(db);
    return { socios };
  }

  /**
   * POST /tenant/commissions/network/settle — liquida comisiones de socios (C3).
   * En fichas (transfer desde la Casa) o plata real (quema + referencia). Admin.
   */
  @Post('network/settle')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('commissions.settle')
  async settleNetwork(
    @Body() dto: SettleNetworkDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;

    let periodStart: Date | undefined;
    if (dto.period && dto.period.trim()) {
      try {
        periodStart = NetworkCommissionsService.resolvePeriod(dto.period).periodStart;
      } catch {
        throw new BadRequestException({
          message: `Período inválido: ${dto.period}`,
          error: 'INVALID_PERIOD',
        });
      }
    }
    if (!dto.rowIds?.length && !periodStart) {
      throw new BadRequestException({
        message: 'Especificá rowIds o period para liquidar.',
        error: 'MISSING_FILTER',
      });
    }

    let result;
    try {
      result = await this.network.settlePeriods(db, {
        rowIds: dto.rowIds,
        periodStart,
        method: dto.method,
        reference: dto.reference ?? null,
        actorUserId: actor.id,
      });
    } catch (err) {
      if (err instanceof HouseNotProvisionedError) {
        throw new ConflictException({
          message:
            'La Casa (tesorería) no está provisionada; no se puede liquidar.',
          error: 'HOUSE_NOT_PROVISIONED',
        });
      }
      throw err;
    }

    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'commissions.settle_network',
      targetType: 'commission_network_period',
      targetId: periodStart ? periodStart.toISOString() : (dto.rowIds?.[0] ?? 'batch'),
      metadata: {
        method: dto.method,
        settled: result.settled,
        failed: result.failed,
        totalPaid: result.totalPaid,
        severity: 'high',
      },
      ...extractRequestContext(req),
    });
    return result;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Rules
  // ──────────────────────────────────────────────────────────────────────

  /**
   * GET /tenant/commissions/rules?eventType=&activeOnly=true
   *
   * Sin permission extra — cualquier user logueado puede ver las reglas
   * (transparencia + permite a cajeros/socios saber qué cobrarían).
   * El admin las modifica via `commissions.configure`.
   */
  @Get('rules')
  async listRules(
    @Req() req: RequestWithTenantContext,
    @Query('eventType') eventType?: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    const db = req.tenantContext!.db;
    const data = await this.service.listRules(db, {
      eventType,
      activeOnly: activeOnly === 'true',
    });
    return { data };
  }

  @Get('rules/:id')
  async findRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
  ) {
    const db = req.tenantContext!.db;
    try {
      return await this.service.findRuleById(db, id);
    } catch (err) {
      if (err instanceof CommissionRuleNotFoundError) {
        throw new NotFoundException({
          message: err.message,
          error: 'COMMISSION_RULE_NOT_FOUND',
        });
      }
      throw err;
    }
  }

  @Post('rules')
  @RequirePermissions('commissions.configure')
  @HttpCode(HttpStatus.CREATED)
  async createRule(
    @Body() dto: CreateCommissionRuleDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    let created;
    try {
      created = await this.service.createRule(db, {
        role: dto.role,
        eventType: dto.eventType,
        pct: dto.pct,
        active: dto.active,
        notes: dto.notes,
      });
    } catch (err) {
      if (err instanceof CommissionRuleConflictError) {
        throw new ConflictException({
          message: err.message,
          error: 'COMMISSION_RULE_CONFLICT',
        });
      }
      throw err;
    }
    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'commission_rule.create',
      targetType: 'commission_rule',
      targetId: created.id,
      after: {
        role: created.role,
        eventType: created.eventType,
        pct: created.pct,
        active: created.active,
      },
      metadata: { severity: 'high' }, // afecta revenue share — high
      ...extractRequestContext(req),
    });
    return created;
  }

  @Patch('rules/:id')
  @RequirePermissions('commissions.configure')
  async updateRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCommissionRuleDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    let before;
    try {
      before = await this.service.findRuleById(db, id);
    } catch (err) {
      if (err instanceof CommissionRuleNotFoundError) {
        throw new NotFoundException({
          message: err.message,
          error: 'COMMISSION_RULE_NOT_FOUND',
        });
      }
      throw err;
    }
    const updated = await this.service.updateRule(db, id, {
      pct: dto.pct,
      active: dto.active,
      notes: dto.notes,
    });
    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'commission_rule.edit',
      targetType: 'commission_rule',
      targetId: id,
      before: { pct: before.pct, active: before.active },
      after: { pct: updated.pct, active: updated.active },
      metadata: { severity: 'high' },
      ...extractRequestContext(req),
    });
    return updated;
  }

  @Post('rules/:id/archive')
  @RequirePermissions('commissions.configure')
  @HttpCode(HttpStatus.OK)
  async archiveRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    let before;
    try {
      before = await this.service.findRuleById(db, id);
    } catch (err) {
      if (err instanceof CommissionRuleNotFoundError) {
        throw new NotFoundException({
          message: err.message,
          error: 'COMMISSION_RULE_NOT_FOUND',
        });
      }
      throw err;
    }
    const updated = await this.service.archiveRule(db, id);
    if (before.active) {
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'commission_rule.archive',
        targetType: 'commission_rule',
        targetId: id,
        before: { active: true },
        after: { active: false },
        metadata: { severity: 'high' },
        ...extractRequestContext(req),
      });
    }
    return updated;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Payouts (scope-aware)
  // ──────────────────────────────────────────────────────────────────────

  /**
   * GET /tenant/commissions/payouts?beneficiaryUserId=&status=...
   *
   * Scope: actor con `commissions.view_all` ve TODO; sino solo donde el
   * `beneficiaryUserId` ES el actor o un descendant del actor. Mismo
   * pattern que deposits/withdrawals/bonuses (Sprint 23).
   */
  @Get('payouts')
  @RequirePermissions('commissions.view')
  async listPayouts(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
    @Query('beneficiaryUserId') beneficiaryUserId?: string,
    @Query('sourceEventType') sourceEventType?: string,
    @Query('sourceEventId') sourceEventId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const db = req.tenantContext!.db;
    const userIds = await this.resolveScope(db, actor.id);
    return this.service.listPayouts(db, {
      beneficiaryUserId,
      userIds,
      sourceEventType,
      sourceEventId,
      status: status as 'pending' | 'paid' | 'failed' | 'refunded' | undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // Stats (Sprint 32): widget en /admin/dashboard
  // ──────────────────────────────────────────────────────────────────────

  /**
   * GET /tenant/commissions/stats
   *
   * Devuelve totales pre-computados (today, last 7d, last 30d) para el
   * widget del dashboard. Scope:
   *   - `earnedByMe`: beneficiary_user_id = actor.
   *   - `earnedByTeam`: beneficiary_user_id ∈ descendants(actor).
   *   - `tenantTotal`: SOLO si actor tiene `commissions.view_all`.
   *
   * Permission `commissions.view` (mismo que listing payouts).
   */
  @Get('stats')
  @RequirePermissions('commissions.view')
  async getStats(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
  ) {
    const db = req.tenantContext!.db;
    const [hasViewAll, descendants] = await Promise.all([
      this.effectivePermissions.hasAllPermissions(db, actor.id, [
        'commissions.view_all',
      ]),
      this.hierarchy.getActiveDescendants(db, actor.id),
    ]);
    return this.service.getStatsForActor(
      db,
      actor.id,
      descendants,
      hasViewAll,
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // Preview compute (no persiste — Sprint 24 deja solo esto; apply en 25)
  // ──────────────────────────────────────────────────────────────────────

  /**
   * POST /tenant/commissions/preview
   * Body: { eventType, sourceUserId, sourceAmount }
   *
   * Devuelve qué payouts se calcularían SIN persistir nada. Útil para que
   * el admin valide "si apruebo este deposit, quién cobra cuánto" antes
   * de tener el apply automático conectado (Sprint 25).
   *
   * Permission `commissions.configure` — operación admin para tunear rules.
   */
  @Post('preview')
  @RequirePermissions('commissions.configure')
  @HttpCode(HttpStatus.OK)
  async preview(
    @Body()
    body: {
      eventType: string;
      sourceUserId: string;
      sourceAmount: string;
    },
    @Req() req: RequestWithTenantContext,
  ) {
    const db = req.tenantContext!.db;
    const plan = await this.service.computeForEvent(
      db,
      body.eventType,
      body.sourceUserId,
      body.sourceAmount,
    );
    const totalPayout = plan.reduce(
      (acc, p) => acc + Number(p.payoutAmount),
      0,
    );
    return {
      plan,
      summary: {
        beneficiaries: plan.length,
        sourceAmount: body.sourceAmount,
        totalPayout: totalPayout.toFixed(2),
        tenantKeeps: (Number(body.sourceAmount) - totalPayout).toFixed(2),
      },
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Sprint 50: settle + pending-summary
  // ──────────────────────────────────────────────────────────────────────

  /**
   * GET /tenant/commissions/payouts/pending-summary
   * Devuelve por beneficiary: cuánto se le debe (status='accrued').
   * Usado por el dashboard widget + tab Pendientes.
   *
   * Scope: si actor tiene `commissions.view_all` ve todo el tenant;
   * sino solo su red downstream (+ él mismo).
   */
  @Get('payouts/pending-summary')
  @RequirePermissions('commissions.view')
  async pendingSummary(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
  ) {
    const db = req.tenantContext!.db;
    const restrictToUserIds = await this.resolveScope(db, actor.id);
    const data = await this.service.pendingSummary(db, { restrictToUserIds });
    const totalPending = data.reduce(
      (acc, r) => acc + Number(r.pendingAmount),
      0,
    );
    return { data, totalPending: totalPending.toFixed(2) };
  }

  /**
   * POST /tenant/commissions/payouts/settle
   * Body: { payoutIds?: string[] }   // si vacío, liquida TODOS los accrued
   * Mintea fichas para cada beneficiary y marca los payouts como paid.
   *
   * Permission: commissions.settle (admin only, no delegable).
   * Audit severity:high con el detalle de qué se liquidó.
   */
  @Post('payouts/settle')
  @RequirePermissions('commissions.settle')
  @HttpCode(HttpStatus.OK)
  async settle(
    @Body() body: { payoutIds?: string[] },
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    const result = await this.service.settle(
      db,
      body.payoutIds ?? [],
      actor.id,
    );
    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'commissions.settle',
      targetType: 'commission_payout_batch',
      targetId: actor.id, // sin entity individual — es un batch
      metadata: {
        severity: 'high',
        settled: result.settled,
        failed: result.failed,
        totalPaid: result.totalPaid,
        idsRequested: body.payoutIds?.length ?? 'all',
      },
      ...extractRequestContext(req),
    });
    return result;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Mismo patrón que en deposits/withdrawals/bonuses: actor con
   * `commissions.view_all` bypassa scope; sino limita a `[actor.id,
   * ...descendants]`.
   */
  private async resolveScope(
    db: TenantDb,
    actorId: string,
  ): Promise<string[] | undefined> {
    const hasViewAll = await this.effectivePermissions.hasAllPermissions(
      db,
      actorId,
      ['commissions.view_all'],
    );
    if (hasViewAll) return undefined;
    const downstream = await this.hierarchy.getActiveDescendants(db, actorId);
    return [actorId, ...downstream];
  }
}
