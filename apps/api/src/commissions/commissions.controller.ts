/**
 * CommissionsController — comisiones por red (modelo socios-only).
 *
 * El modelo viejo (reglas globales por rol + comisión sobre el depósito) se
 * eliminó por completo. Quedan solo los endpoints del motor por red:
 *   - PATCH /tenant/commissions/network-rate/:childUserId   (configure_network)
 *   - POST  /tenant/commissions/network/compute             (configure)
 *   - GET   /tenant/commissions/network/periods             (view + scope)
 *   - GET   /tenant/commissions/network/socios              (configure)
 *   - POST  /tenant/commissions/network/settle              (settle)
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
  ConservationViolationError,
  InvalidNetworkRateError,
  InvertedMarkupError,
  NetworkRateBelowChildrenError,
  NetworkRateExceedsParentError,
  NotDirectChildError,
  OpenRoundsInPeriodError,
  PeriodAlreadySettledError,
} from './commissions.errors';
import { CommissionsService } from './commissions.service';
import { NetworkCommissionsService } from './network-commissions.service';
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
   * El admin fija el % que un socio gana de la NetWin de su red. Valida
   * hijo-directo + tope (rate ≤ lo que el actor cobra de su padre).
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
    let cascaded: { periodStart: Date }[] = [];
    try {
      // Cascada: recomputar un período deja viejo el carryover de los
      // siguientes. Ver computePeriodCascade.
      const out = await this.network.computePeriodCascade(db, period);
      result = out.target;
      cascaded = out.cascaded.map((c) => ({ periodStart: c.periodStart }));
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
      metadata: {
        ...result,
        // Queda en la auditoría qué otros períodos se recalcularon por arrastre.
        cascadedPeriods: cascaded.map((c) => c.periodStart.toISOString()),
        severity: 'medium',
      },
      ...extractRequestContext(req),
    });
    return { ...result, cascadedPeriods: cascaded.map((c) => c.periodStart) };
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
   * GET /tenant/commissions/my-summary — resumen de comisión del operador
   * logueado (socio/distri/cajero): estimado del mes en curso + histórico +
   * desglose (LEY C6). Self-scoped (siempre el actor).
   */
  @Get('my-summary')
  @RequirePermissions('commissions.view')
  async mySummary(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
  ) {
    const db = req.tenantContext!.db;
    return this.network.getOperatorSummary(db, actor.id);
  }

  /**
   * GET /tenant/commissions/network/payables — tablero de deudas/pagos:
   * por operador, cuánto se le debe (pendiente) y cuánto se le pagó. Admin.
   */
  @Get('network/payables')
  @RequirePermissions('commissions.view_all')
  async payables(@Req() req: RequestWithTenantContext) {
    const db = req.tenantContext!.db;
    return { rows: await this.network.getPayables(db) };
  }

  /**
   * GET /tenant/commissions/network/payables-by-role — lo mismo que
   * `network/payables` pero agregado por rol (socio/distribuidor/cajero) en
   * vez de por operador individual. Para el resumen ejecutivo del dashboard.
   * Admin.
   */
  @Get('network/payables-by-role')
  @RequirePermissions('commissions.view_all')
  async payablesByRole(@Req() req: RequestWithTenantContext) {
    const db = req.tenantContext!.db;
    return this.network.getPayablesByRole(db);
  }

  /**
   * GET /tenant/commissions/network/house-pnl?period=YYYY-MM — P&L de la Casa
   * (LEY C4b): NetWin → −fee proveedor → base → −comisiones → neto. Admin.
   */
  @Get('network/house-pnl')
  @RequirePermissions('commissions.view_all')
  async housePnl(
    @Query('period') period: string | undefined,
    @Req() req: RequestWithTenantContext,
  ) {
    const db = req.tenantContext!.db;
    let resolved: { periodStart: Date; periodEnd: Date };
    try {
      resolved = NetworkCommissionsService.resolvePeriod(period);
    } catch {
      throw new BadRequestException({
        message: `Período inválido: ${period}`,
        error: 'INVALID_PERIOD',
      });
    }
    return this.network.getHousePnl(db, resolved);
  }

  /**
   * GET /tenant/commissions/network/overview?period=YYYY-MM — operadores
   * AGRUPADOS POR RED (Red de la Casa + una por socio + independientes aparte),
   * con tasa + resultado del período + P&L por red. Panel reorganizado. Admin.
   */
  @Get('network/overview')
  @RequirePermissions('commissions.view_all')
  async networkOverview(
    @Query('period') period: string | undefined,
    @Req() req: RequestWithTenantContext,
  ) {
    const db = req.tenantContext!.db;
    let resolved: { periodStart: Date; periodEnd: Date };
    try {
      resolved = NetworkCommissionsService.resolvePeriod(period);
    } catch {
      throw new BadRequestException({
        message: `Período inválido: ${period}`,
        error: 'INVALID_PERIOD',
      });
    }
    return this.network.getNetworkOverview(db, resolved);
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
   * GET /tenant/commissions/network/my-children — Fase 4 (LEY C2).
   * Los HIJOS DIRECTOS operadores del actor con su tasa + topes, para que cada
   * operador (socio/distri) delegue la comisión hacia abajo. Self-scoped.
   */
  @Get('network/my-children')
  @RequirePermissions('commissions.configure_network')
  async listMyChildren(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
  ) {
    const db = req.tenantContext!.db;
    return this.network.listChildRates(db, actor.id);
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

    // Liquidación SINCRÓNICA: acción manual y acotada, corre en el request y
    // devuelve el resultado al toque. No depende de Redis (prod no lo tiene).
    // settlePeriods es idempotente (FOR UPDATE + re-check de status por fila).
    let result;
    try {
      result = await this.network.settlePeriods(db, {
        rowIds: dto.rowIds,
        periodStart,
        reference: dto.reference ?? null,
        actorUserId: actor.id,
        force: dto.force === true,
      });
    } catch (err) {
      // 409 y no 400: no está mal lo que pidió, está mal el MOMENTO. El job
      // de reconciliación cierra las rondas solo y en un rato se puede.
      if (err instanceof OpenRoundsInPeriodError) {
        throw new ConflictException({
          message: err.message,
          error: 'OPEN_ROUNDS_IN_PERIOD',
          openRounds: err.openRounds,
          periods: err.periods,
        });
      }
      throw err;
    }

    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'commissions.settle_network',
      targetType: 'commission_network_period',
      targetId: dto.period ?? (dto.rowIds?.[0] ?? 'batch'),
      metadata: {
        // Que quede escrito si se liquidó pisando el freno de rondas
        // abiertas: es la explicación de por qué ese número puede cambiar.
        forced: dto.force === true,
        settled: result.settled,
        failed: result.failed,
        totalPaid: result.totalPaid,
        method: 'cash',
        severity: 'high',
      },
      ...extractRequestContext(req),
    });

    return { ok: true, ...result };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Actor con `commissions.view_all` bypassa scope; sino limita a
   * `[actor.id, ...descendants]`. Mismo patrón que deposits/withdrawals.
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
