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
  Body,
  ConflictException,
  Controller,
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
} from './commissions.errors';
import { CommissionsService } from './commissions.service';
import {
  CreateCommissionRuleDto,
  UpdateCommissionRuleDto,
} from './dto/commission.dto';

@Controller('tenant/commissions')
@UseGuards(TenantJwtGuard, PermissionsGuard)
@PanelOnly()
export class CommissionsController {
  constructor(
    private readonly service: CommissionsService,
    private readonly audit: AuditLogService,
    private readonly hierarchy: UserHierarchyService,
    private readonly effectivePermissions: EffectivePermissionsService,
  ) {}

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
