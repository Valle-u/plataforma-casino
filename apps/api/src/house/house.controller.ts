/**
 * HouseController — panel de la Casa / tesorería (Blindaje, Parte B).
 *
 *   - GET  /tenant/house                     (house.view)          estado de la Casa
 *   - GET  /tenant/house/mint-budget         (house.view)          estado del tope mensual de minteo
 *   - POST /tenant/house/inject-budget       (house.inject_capital) fondear presupuesto (ÚNICO minteo, capado)
 *   - GET  /tenant/house/capital-injections  (house.view)          historial de aportes
 *
 * Capa 3 · Fase 4 (2026-07 · docs/16-tesoreria-adenda.md):
 * La Casa es ÚNICA POR TENANT — admin-only por decisión de producto.
 *
 * El socio INDEPENDIENTE NO tiene Casa formal. Su "tesorería" es
 * simplemente su propia wallet + el historial de compras de fichas al
 * tenant (`branches.sellChips`). Ver `GET /tenant/branches/mine` para
 * la vista que el indep usa como "su tesorería".
 *
 * Rationale: el indep opera con fichas YA compradas al tenant (pagadas
 * mayorista). Su wallet es el techo absoluto de su banca — no puede
 * haber fuga porque no puede mintear más. Por lo tanto no necesita
 * (a) una Casa formal como source-of-truth de emisión, ni (b) un
 * historial de "inject-capital" — sus compras al tenant ya cumplen esa
 * función.
 *
 * Los permisos `house.view` y `house.inject_capital` NO se otorgan al
 * indep — ni por default, ni por el auto-grant de toggleIndependence,
 * ni por ninguna planilla. Verificado en `branches.service.ts`.
 */

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Patch,
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
import { PanelOnly } from '../tenant-auth/panel-only.decorator';
import type {
  RequestWithTenantContext,
  TenantDb,
} from '../tenant-resolver/tenant-context';
import { InjectBudgetDto } from './dto/inject-budget.dto';
import { InjectOperatorInvalidError } from './house.errors';
import {
  HouseNotProvisionedError,
  MintBudgetExceededError,
  HouseService,
} from './house.service';
import { HouseMonitoringService } from './house-monitoring.service';
import { BettingCapsService } from './betting-caps.service';
import { UserHierarchyService } from '../user-hierarchy/user-hierarchy.service';
import { OutOfScopeError } from '../user-hierarchy/user-hierarchy.errors';
import { ForbiddenException } from '@nestjs/common';
import { SetBettingCapsDto } from './dto/betting-caps.dto';
import {
  CapitalNeededQueryDto,
  StockAlertStatusQueryDto,
} from './dto/monitoring.dto';
import { IdempotencyConflictError } from '../wallet/wallet.errors';

@Controller('tenant/house')
@UseGuards(TenantJwtGuard, PermissionsGuard)
@PanelOnly()
export class HouseController {
  constructor(
    private readonly service: HouseService,
    private readonly bettingCaps: BettingCapsService,
    private readonly monitoring: HouseMonitoringService,
    private readonly audit: AuditLogService,
    private readonly hierarchy: UserHierarchyService,
  ) {}

  /**
   * Scope check preventivo para los endpoints de monitoring con
   * `operatorUserId` opcional. Si viene un operatorUserId, validamos que
   * el actor tenga autoridad sobre ese indep (admin_tenant, self, o
   * ancestro en la sub-red). Sin esto, si en el futuro se delega
   * `house.view` a empleados, cualquier empleado con override podría
   * espiar balance/drenaje de sub-redes indep ajenas.
   */
  private async assertMonitoringScope(
    db: TenantDb,
    actorId: string,
    operatorUserId: string | null,
  ): Promise<void> {
    if (operatorUserId === null) return;
    try {
      await this.hierarchy.assertScope(db, actorId, operatorUserId);
    } catch (err) {
      if (err instanceof OutOfScopeError) {
        throw new ForbiddenException({
          message: err.message,
          error: 'OUT_OF_SCOPE',
        });
      }
      throw err;
    }
  }

  /**
   * Scope check preventivo para los endpoints de inject-capital / inject-budget
   * con `operatorUserId` opcional (F5, docs/16-adenda):
   *
   *   - operatorUserId=null  → destino = Casa. Sin scope check (regla
   *     legacy: la Casa es única por tenant, solo importa el permiso
   *     `house.inject_capital` — admin_tenant o quien lo tenga delegado).
   *
   *   - operatorUserId=X     → destino = wallet del socio indep X. Ahora sí
   *     validamos que el actor tenga autoridad sobre X (admin_tenant, self,
   *     ancestro en la sub-red). Sin esto, si un empleado del admin tiene
   *     `house.inject_capital` delegado (el permiso es `isDelegatable=true`
   *     en el seed), podría mintear a la wallet de un indep de OTRA red.
   *
   * Semánticamente distinto a `assertMonitoringScope` (que es read-only /
   * observación), pero comparte el mismo mecanismo — separamos el método
   * para dejar explícito el criterio en audit / futuras variaciones (p.ej.
   * si en el futuro queremos exigir un permiso extra `house.inject_delegated`
   * antes del scope check).
   */
  private async assertInjectScope(
    db: TenantDb,
    actorId: string,
    operatorUserId: string | null,
  ): Promise<void> {
    if (operatorUserId === null) return;
    try {
      await this.hierarchy.assertScope(db, actorId, operatorUserId);
    } catch (err) {
      if (err instanceof OutOfScopeError) {
        throw new ForbiddenException({
          message: err.message,
          error: 'OUT_OF_SCOPE',
        });
      }
      throw err;
    }
  }

  private requireDb(req: RequestWithTenantContext): TenantDb {
    if (!req.tenantContext) throw new Error('TenantContext no resuelto.');
    return req.tenantContext.db;
  }

  /** GET /tenant/house — estado de la Casa / tesorería. */
  @Get()
  @RequirePermissions('house.view')
  async state(@Req() req: RequestWithTenantContext) {
    const db = this.requireDb(req);
    try {
      return await this.service.getHouseState(db);
    } catch (err) {
      if (err instanceof HouseNotProvisionedError) {
        throw new NotFoundException({
          message: err.message,
          error: 'HOUSE_NOT_PROVISIONED',
        });
      }
      throw err;
    }
  }

  /**
   * GET /tenant/house/mint-budget — estado del tope mensual de creación de
   * fichas (treasury.monthly_mint_budget): tope, minteado este mes, disponible.
   */
  @Get('mint-budget')
  @RequirePermissions('house.view')
  async mintBudget(@Req() req: RequestWithTenantContext) {
    const db = this.requireDb(req);
    return this.service.getMintBudgetStatus(db);
  }

  /**
   * POST /tenant/house/inject-budget — fondeo de PRESUPUESTO a la Casa
   * (docs/16 §12, modelo "banco central"). Sin bank_tx: el admin fija el monto
   * y el motivo directo. Severity high.
   *
   * Es el ÚNICO método de minteo, capado por `treasury.monthly_mint_budget`.
   * Si el monto excede el tope del mes → 409 MINT_BUDGET_EXCEEDED. Con
   * `fondeo: true` el cliente bypasea el tope a propósito (queda auditado).
   */
  @Post('inject-budget')
  @RequirePermissions('house.inject_capital')
  @HttpCode(HttpStatus.CREATED)
  async injectBudget(
    @Body() dto: InjectBudgetDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = this.requireDb(req);
    // F5 scope hardening — ver comentario en assertInjectScope.
    await this.assertInjectScope(db, actor.id, dto.operatorUserId ?? null);
    try {
      const injection = await this.service.injectBudget(db, {
        amount: dto.amount,
        reason: dto.reason,
        actorUserId: actor.id,
        notes: dto.notes ?? null,
        idempotencyKey: dto.idempotencyKey,
        operatorUserId: dto.operatorUserId ?? null,
        fondeo: dto.fondeo,
      });
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'house.inject_budget',
        targetType: 'house_capital_injection',
        targetId: injection.id,
        metadata: {
          type: 'budget',
          amount: injection.amount,
          reason: injection.reason,
          mintTxId: injection.mintTxId,
          operatorUserId: injection.operatorUserId,
          fondeo: dto.fondeo ?? false,
          severity: 'high',
        },
        ...extractRequestContext(req),
      });
      return injection;
    } catch (err) {
      if (err instanceof HouseNotProvisionedError) {
        throw new NotFoundException({
          message: err.message,
          error: 'HOUSE_NOT_PROVISIONED',
        });
      }
      if (err instanceof InjectOperatorInvalidError) {
        throw new BadRequestException({
          message: err.message,
          error: 'INJECT_OPERATOR_INVALID',
          operatorUserId: err.operatorUserId,
          reason: err.reason,
        });
      }
      // Tope mensual de minteo excedido (sin modo fondeo) → 409 accionable.
      if (err instanceof MintBudgetExceededError) {
        throw new ConflictException({
          message: err.message,
          error: 'MINT_BUDGET_EXCEEDED',
          monthlyBudget: err.monthlyBudget,
          mintedThisMonth: err.mintedThisMonth,
          available: err.available,
          requested: err.requested,
        });
      }
      // D5: idempotencyKey reusada con payload distinto (mismo key, distinto
      // monto/motivo/wallet) → 409 con la key en el body para debugging.
      if (err instanceof IdempotencyConflictError) {
        throw new ConflictException({
          message: err.message,
          error: 'IDEMPOTENCY_CONFLICT',
          idempotencyKey: err.key,
        });
      }
      throw err;
    }
  }

  /** GET /tenant/house/capital-injections — historial de aportes. */
  @Get('capital-injections')
  @RequirePermissions('house.view')
  async capitalInjections(
    @Req() req: RequestWithTenantContext,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const db = this.requireDb(req);
    return this.service.listInjections(
      db,
      limit ? Number(limit) : undefined,
      offset ? Number(offset) : undefined,
    );
  }

  /**
   * GET /tenant/house/stock-alert-status — nivel del bankroll (Casa o socio
   * indep) comparado contra los umbrales configurables. Consumido por el
   * widget de alerta del panel de tesorería / dashboard.
   */
  @Get('stock-alert-status')
  @RequirePermissions('house.view')
  async stockAlertStatus(
    @Query() query: StockAlertStatusQueryDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
  ) {
    const db = this.requireDb(req);
    const operatorUserId = query.operatorUserId ?? null;
    await this.assertMonitoringScope(db, actor.id, operatorUserId);
    try {
      return await this.monitoring.stockAlertStatus(db, operatorUserId);
    } catch (err) {
      if (err instanceof HouseNotProvisionedError) {
        throw new NotFoundException({
          message: err.message,
          error: 'HOUSE_NOT_PROVISIONED',
        });
      }
      if (err instanceof InjectOperatorInvalidError) {
        throw new BadRequestException({
          message: err.message,
          error: 'INJECT_OPERATOR_INVALID',
          operatorUserId: err.operatorUserId,
          reason: err.reason,
        });
      }
      throw err;
    }
  }

  /**
   * GET /tenant/house/capital-needed?days=30 — proyección del capital
   * necesario para volver a stock sano dado el drenaje neto de los últimos
   * `days` días. Ventana default 30, máx 365. Si `operatorUserId` viene,
   * calcula sobre la sub-red del socio indep en vez de la red admin.
   */
  @Get('capital-needed')
  @RequirePermissions('house.view')
  async capitalNeeded(
    @Query() query: CapitalNeededQueryDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
  ) {
    const db = this.requireDb(req);
    const days = query.days ?? 30;
    const operatorUserId = query.operatorUserId ?? null;
    await this.assertMonitoringScope(db, actor.id, operatorUserId);
    try {
      return await this.monitoring.capitalNeeded(db, days, operatorUserId);
    } catch (err) {
      if (err instanceof HouseNotProvisionedError) {
        throw new NotFoundException({
          message: err.message,
          error: 'HOUSE_NOT_PROVISIONED',
        });
      }
      if (err instanceof InjectOperatorInvalidError) {
        throw new BadRequestException({
          message: err.message,
          error: 'INJECT_OPERATOR_INVALID',
          operatorUserId: err.operatorUserId,
          reason: err.reason,
        });
      }
      throw err;
    }
  }

  /** GET /tenant/house/betting-caps — topes + turnover del mes (panel). */
  @Get('betting-caps')
  @RequirePermissions('house.view')
  async bettingCapsStatus(@Req() req: RequestWithTenantContext) {
    const db = this.requireDb(req);
    return this.bettingCaps.getStatus(db);
  }

  /** PATCH /tenant/house/betting-caps — setea los topes (0 = sin tope). */
  @Patch('betting-caps')
  @RequirePermissions('tenant.settings.edit')
  async setBettingCaps(
    @Body() dto: SetBettingCapsDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = this.requireDb(req);
    await this.bettingCaps.setCaps(
      db,
      { playerMonthly: dto.playerMonthly, globalMonthly: dto.globalMonthly },
      actor.id,
    );
    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'house.set_betting_caps',
      targetType: 'betting_caps',
      metadata: {
        playerMonthly: dto.playerMonthly,
        globalMonthly: dto.globalMonthly,
        severity: 'medium',
      },
      ...extractRequestContext(req),
    });
    return this.bettingCaps.getStatus(db);
  }
}
