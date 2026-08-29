/**
 * WalletStatsController — endpoints read-only de reporting financiero.
 *
 * Endpoints:
 *   - GET /tenant/wallet-stats/movements        list filtrable + paginada
 *   - GET /tenant/wallet-stats/summary          totales in/out/net por bucket
 *   - GET /tenant/wallet-stats/by-role          breakdown por rol del owner
 *   - GET /tenant/wallet-stats/export           CSV con mismos filtros
 *
 * Permisos (Sprint 45):
 *   - `wallet_stats.view_any`        ve todo el tenant
 *   - `wallet_stats.view_own_network` ve solo su red downstream (jerarquía)
 *   - `wallet_stats.export`          CSV (suma a uno de los anteriores)
 *
 * Defense in depth:
 *   - @PanelOnly() bloquea players con JWT (no aplicable, no es info de player).
 *   - @PermissionsGuard valida los permisos atómicos por endpoint.
 *   - Scope downstream se calcula en el controller y se pasa al service
 *     como `restrictToUserIds` — el service NO sabe de jerarquía.
 */

import {
  BadRequestException,
  Controller,
  Get,
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
import { formatArDateTime } from '../common/ar-datetime';
import { EffectivePermissionsService } from '../permissions/effective-permissions.service';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { RequirePermissions } from '../permissions/require-permissions.decorator';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import { PanelOnly } from '../tenant-auth/panel-only.decorator';
import type {
  RequestWithTenantContext,
  TenantDb,
} from '../tenant-resolver/tenant-context';
import { UserHierarchyService } from '../user-hierarchy/user-hierarchy.service';
import {
  WalletStatsService,
  type MovementRow,
  type WalletTxType,
} from './wallet-stats.service';

/**
 * Etiquetas legibles del tipo de movimiento para el CSV de auditoría.
 * Espejo de `TX_TYPE_LABELS` del front (`apps/web/lib/hooks/use-wallet-stats.ts`)
 * para que el CSV y la pantalla digan lo mismo. Si aparece un tipo no mapeado,
 * el CSV cae al código crudo (fallback en el `value`).
 */
/**
 * Tipo de ronda en lenguaje claro para el CSV.
 *
 * Mismo texto que la pantalla, a proposito: si el CSV y la UI nombran
 * distinto la misma cosa, la auditoria se vuelve discutible.
 */
const CSV_ROUND_ACTION_LABELS: Record<string, string> = {
  bonus_buy: 'Compra de tiradas gratis',
  free_spins: 'Tiradas gratis',
  spin: 'Giro',
};

const CSV_TX_TYPE_LABELS: Record<WalletTxType, string> = {
  mint: 'Creación de fichas',
  burn: 'Destrucción de fichas',
  load: 'Carga de fichas',
  unload: 'Descarga de fichas',
  transfer_in: 'Transferencia recibida',
  transfer_out: 'Transferencia enviada',
  bet: 'Apuesta',
  win: 'Ganancia',
  rollback: 'Reversa de jugada',
  adjustment: 'Ajuste manual',
  bonus_grant: 'Bono otorgado',
  bonus_clear: 'Bono liberado',
  bonus_forfeit: 'Bono perdido',
  bonus_funding: 'Financiamiento de bono',
  bonus_funding_revert: 'Reversa de financiamiento',
  bonus_credit: 'Crédito de bono',
  bonus_debit: 'Débito de bono',
  deposit: 'Depósito',
  withdrawal: 'Retiro',
  jackpot_win: 'Jackpot',
  promo_reward: 'Premio de promoción',
  league_reward: 'Premio de liga',
  commission_payout: 'Pago de comisión',
  fund_reserve: 'Reserva de fondos',
  fund_release: 'Liberación de reserva',
};

@Controller('tenant/wallet-stats')
@UseGuards(TenantJwtGuard, PermissionsGuard)
@PanelOnly()
export class WalletStatsController {
  constructor(
    private readonly stats: WalletStatsService,
    private readonly hierarchy: UserHierarchyService,
    private readonly effectivePermissions: EffectivePermissionsService,
  ) {}

  /**
   * Resuelve restricción de scope para el actor:
   *   - view_any  → undefined (sin filtro = ve todo).
   *   - view_own_network → [actorId, ...descendants]. Si vacío, [actorId]
   *     (al menos ve sus propias tx).
   *
   * `@RequirePermissions('wallet_stats.view_own_network')` ya garantizó
   * que el actor tiene AL MENOS el permiso básico. Si tiene view_any,
   * lo bypaseamos.
   */
  private async resolveScope(
    db: TenantDb,
    actorId: string,
    scope?: string,
    scopeId?: string,
  ): Promise<string[] | undefined> {
    const hasViewAll = await this.effectivePermissions.hasAllPermissions(
      db,
      actorId,
      ['wallet_stats.view_any'],
    );
    // Filtro por ÁMBITO de red (solo para quien ve todo): plataforma /
    // dependiente / central / independiente / panel — reusa el resolvedor de
    // los endpoints de netwin. Un actor sin view_any no puede ampliar su scope
    // por acá (cae siempre al filtro por su descendencia).
    if (scope && hasViewAll) {
      return this.resolveScopeIds(db, scope, scopeId);
    }
    if (hasViewAll) return undefined;
    const downstream = await this.hierarchy.getActiveDescendants(db, actorId);
    return [actorId, ...downstream];
  }

  /**
   * GET /tenant/wallet-stats/movements
   *
   * Query params (todos opcionales):
   *   - type             single o repetible (?type=load&type=mint)
   *   - ownerRole        single o repetible (?ownerRole=usuario_final)
   *   - dateFrom         ISO datetime
   *   - dateTo           ISO datetime
   *   - userId           UUID — filtra por owner del wallet
   *   - actorId          UUID — filtra por created_by
   *   - minAmount        number
   *   - maxAmount        number
   *   - limit            default 50, max 200
   *   - offset           default 0
   */
  @Get('movements')
  @RequirePermissions('wallet_stats.view_own_network')
  async listMovements(
    @CurrentTenantUser() actor: { id: string },
    @Req() req: RequestWithTenantContext,
    @Query('type') type?: string | string[],
    @Query('ownerRole') ownerRole?: string | string[],
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('userId') userId?: string,
    @Query('actorId') actorId?: string,
    @Query('minAmount') minAmount?: string,
    @Query('maxAmount') maxAmount?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('scope') scope?: string,
    @Query('scopeId') scopeId?: string,
  ) {
    const db = this.requireDb(req);
    const restrictToUserIds = await this.resolveScope(db, actor.id, scope, scopeId);

    return this.stats.listMovements(db, {
      types: this.parseTypes(type),
      ownerRoles: this.parseRoles(ownerRole),
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      userId,
      actorId,
      minAmount: minAmount !== undefined ? Number(minAmount) : undefined,
      maxAmount: maxAmount !== undefined ? Number(maxAmount) : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      restrictToUserIds,
    });
  }

  /**
   * GET /tenant/wallet-stats/summary
   *
   * Query params:
   *   - dateFrom, dateTo — si no se pasan, default = últimos 30 días.
   */
  @Get('summary')
  @RequirePermissions('wallet_stats.view_own_network')
  async summary(
    @CurrentTenantUser() actor: { id: string },
    @Req() req: RequestWithTenantContext,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('scope') scope?: string,
    @Query('scopeId') scopeId?: string,
  ) {
    const db = this.requireDb(req);
    const restrictToUserIds = await this.resolveScope(db, actor.id, scope, scopeId);
    return this.stats.summary(db, {
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      restrictToUserIds,
    });
  }

  /** GET /tenant/wallet-stats/by-role — breakdown por rol del owner. */
  @Get('by-role')
  @RequirePermissions('wallet_stats.view_own_network')
  async byRole(
    @CurrentTenantUser() actor: { id: string },
    @Req() req: RequestWithTenantContext,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const db = this.requireDb(req);
    const restrictToUserIds = await this.resolveScope(db, actor.id);
    return this.stats.byRole(db, {
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      restrictToUserIds,
    });
  }

  /**
   * GET /tenant/wallet-stats/export
   * CSV con los mismos filtros que /movements pero hasta CSV_EXPORT_MAX_ROWS.
   */
  @Get('export')
  @RequirePermissions('wallet_stats.export')
  async export(
    @CurrentTenantUser() actor: { id: string },
    @Req() req: RequestWithTenantContext,
    @Res() res: Response,
    @Query('type') type?: string | string[],
    @Query('ownerRole') ownerRole?: string | string[],
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('userId') userId?: string,
    @Query('actorId') actorId?: string,
    @Query('minAmount') minAmount?: string,
    @Query('maxAmount') maxAmount?: string,
    @Query('scope') scope?: string,
    @Query('scopeId') scopeId?: string,
  ): Promise<void> {
    const db = this.requireDb(req);
    const restrictToUserIds = await this.resolveScope(db, actor.id, scope, scopeId);

    const rows = await this.stats.listForExport(
      db,
      {
        types: this.parseTypes(type),
        ownerRoles: this.parseRoles(ownerRole),
        dateFrom: dateFrom ? new Date(dateFrom) : undefined,
        dateTo: dateTo ? new Date(dateTo) : undefined,
        userId,
        actorId,
        minAmount: minAmount !== undefined ? Number(minAmount) : undefined,
        maxAmount: maxAmount !== undefined ? Number(maxAmount) : undefined,
        restrictToUserIds,
      },
      CSV_EXPORT_MAX_ROWS,
    );

    const columns: CsvColumn<MovementRow>[] = [
      { header: 'Fecha y hora', value: (r) => formatArDateTime(r.createdAt) },
      {
        header: 'Tipo de movimiento',
        value: (r) => CSV_TX_TYPE_LABELS[r.type as WalletTxType] ?? r.type,
      },
      {
        header: 'Entrada o salida',
        value: (r) => (r.direction === 'in' ? 'Entrada' : 'Salida'),
      },
      { header: 'Monto (fichas)', value: (r) => r.amount },
      { header: 'Saldo después', value: (r) => r.balanceAfter },
      { header: 'Usuario', value: (r) => r.ownerUsername },
      { header: 'Nombre', value: (r) => r.ownerDisplayName },
      { header: 'Rol', value: (r) => r.ownerRole ?? '' },
      { header: 'Realizado por (usuario)', value: (r) => r.actorUsername ?? 'sistema' },
      { header: 'Realizado por (rol)', value: (r) => r.actorRole ?? '' },
      { header: 'Origen', value: (r) => r.source ?? '' },
      { header: 'Motivo', value: (r) => r.reason ?? '' },
      { header: 'Notas', value: (r) => r.notes ?? '' },
      { header: 'Referencia interna', value: (r) => r.idempotencyKey ?? '' },
      // Contexto de JUEGO (solo apuestas/premios/devoluciones de una ronda).
      // Sin estas columnas una compra de tiradas gratis y un giro comun se
      // exportaban identicos: dos "Apuesta" con distinto monto y nada mas.
      { header: 'Juego', value: (r) => r.gameName ?? '' },
      { header: 'Proveedor', value: (r) => r.gameProviderCode ?? '' },
      {
        header: 'Tipo de jugada',
        value: (r) =>
          r.roundAction
            ? (CSV_ROUND_ACTION_LABELS[r.roundAction] ?? r.roundAction)
            : '',
      },
      { header: 'Ronda', value: (r) => r.roundExternalId ?? '' },
      // Totales de la RONDA entera: es lo que explica un premio de una tirada
      // gratis, que no tiene apuesta propia.
      { header: 'Ronda: apostado', value: (r) => r.roundBet ?? '' },
      { header: 'Ronda: pagado', value: (r) => r.roundWin ?? '' },
      // Transferencia bancaria conciliada (solo cargas/retiros manuales).
      { header: 'Transferencia: monto', value: (r) => r.bankTxAmount ?? '' },
      { header: 'Transferencia: referencia', value: (r) => r.bankTxReference ?? '' },
      { header: 'Transferencia: remitente', value: (r) => r.bankTxSender ?? '' },
      { header: 'Transferencia: banco', value: (r) => r.bankTxBank ?? '' },
      {
        header: 'Transferencia: fecha',
        value: (r) => formatArDateTime(r.bankTxReceivedAt),
      },
      { header: 'Transferencia: ID', value: (r) => r.bankTxId ?? '' },
    ];
    const csv = buildCsv(columns, rows);
    const filename = buildCsvFilename('wallet-stats');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }

  // ── Auditoría por ámbito (netwin por red) ──────────────────────────
  //
  // Herramienta de monitoreo del dueño: elige un ÁMBITO (toda la plataforma /
  // red dependiente / red central / un socio independiente / un panel puntual)
  // y ve su netwin + entradas-salidas + bonos + movimientos. Gate view_any
  // (nivel admin). Read-only. El monitor de movimientos de redes independientes
  // se habilita por la excepción de visibilidad a R6 (dueño 2026-08-13, solo
  // lectura — E8/P3 intactos).

  /**
   * GET /tenant/wallet-stats/scopes
   * Opciones de ámbito dinámicas: la lista de socios independientes (los ámbitos
   * plataforma/dependiente/central son fijos y conocidos por el front).
   */
  @Get('scopes')
  @RequirePermissions('wallet_stats.view_any')
  async scopes(@Req() req: RequestWithTenantContext) {
    const db = this.requireDb(req);
    const independientes = await this.stats.listIndependentSocios(db);
    return { independientes };
  }

  /**
   * GET /tenant/wallet-stats/comparativa
   * Netwin por red: plataforma, red dependiente, red central y cada socio
   * independiente. dependiente + Σindependientes = plataforma (disjuntos);
   * central ⊆ dependiente (subset informativo).
   */
  @Get('comparativa')
  @RequirePermissions('wallet_stats.view_any')
  async comparativa(
    @Req() req: RequestWithTenantContext,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const db = this.requireDb(req);
    const from = dateFrom ? new Date(dateFrom) : undefined;
    const to = dateTo ? new Date(dateTo) : undefined;

    const dependienteIds = [...(await this.hierarchy.getAdminNetworkIds(db))];
    const centralIds = [...(await this.hierarchy.getCentralNetworkIds(db))];
    const independientes = await this.stats.listIndependentSocios(db);

    const platform = await this.stats.netwinFor(db, { dateFrom: from, dateTo: to });
    const rows: Array<{
      key: string;
      label: string;
      indep: boolean;
    } & Awaited<ReturnType<WalletStatsService['netwinFor']>>> = [
      { key: 'platform', label: 'Toda la plataforma', indep: false, ...platform },
      {
        key: 'dependent',
        label: 'Red dependiente',
        indep: false,
        ...(await this.stats.netwinFor(db, {
          dateFrom: from,
          dateTo: to,
          restrictToUserIds: dependienteIds,
        })),
      },
      {
        key: 'central',
        label: 'Red central',
        indep: false,
        ...(await this.stats.netwinFor(db, {
          dateFrom: from,
          dateTo: to,
          restrictToUserIds: centralIds,
        })),
      },
    ];
    for (const s of independientes) {
      const ids = [...(await this.hierarchy.getUserIdsInSubnetwork(db, s.id))];
      const nw = await this.stats.netwinFor(db, {
        dateFrom: from,
        dateTo: to,
        restrictToUserIds: ids,
      });
      rows.push({
        key: `indep:${s.id}`,
        label: s.displayName || s.username,
        indep: true,
        ...nw,
      });
    }

    return { rows, platformNetwin: platform.netwin };
  }

  /**
   * GET /tenant/wallet-stats/scoped-audit
   * Detalle agregado de un ámbito: juego (netwin), plata minorista, fichas
   * mayorista, bonos, circulación.
   */
  @Get('scoped-audit')
  @RequirePermissions('wallet_stats.view_any')
  async scopedAudit(
    @Req() req: RequestWithTenantContext,
    @Query('scope') scope?: string,
    @Query('scopeId') scopeId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const db = this.requireDb(req);
    const restrictToUserIds = await this.resolveScopeIds(db, scope, scopeId);
    return this.stats.scopedAudit(db, {
      restrictToUserIds,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
    });
  }

  /**
   * GET /tenant/wallet-stats/scoped-movements
   * Monitor de movimientos de un ámbito. Incluye redes independientes por la
   * excepción de visibilidad a R6 (dueño 2026-08-13, solo lectura).
   */
  @Get('scoped-movements')
  @RequirePermissions('wallet_stats.view_any')
  async scopedMovements(
    @Req() req: RequestWithTenantContext,
    @Query('scope') scope?: string,
    @Query('scopeId') scopeId?: string,
    @Query('type') type?: string | string[],
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const db = this.requireDb(req);
    const restrictToUserIds = await this.resolveScopeIds(db, scope, scopeId);
    return this.stats.listMovements(db, {
      types: this.parseTypes(type),
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      restrictToUserIds,
    });
  }

  /**
   * Traduce un ámbito de auditoría a su conjunto de userIds (owner del wallet):
   *   - platform / (sin scope) → undefined (sin filtro = todo el tenant).
   *   - dependent  → red centralizada (getAdminNetworkIds).
   *   - central    → admin sin socios dependientes (getCentralNetworkIds).
   *   - independent / user → ese usuario + su sub-red (getUserIdsInSubnetwork).
   */
  private async resolveScopeIds(
    db: TenantDb,
    scope: string | undefined,
    scopeId: string | undefined,
  ): Promise<string[] | undefined> {
    switch (scope) {
      case undefined:
      case 'platform':
        return undefined;
      case 'dependent':
        return [...(await this.hierarchy.getAdminNetworkIds(db))];
      case 'central':
        return [...(await this.hierarchy.getCentralNetworkIds(db))];
      case 'independent':
      case 'user':
        if (!scopeId) {
          throw new BadRequestException('scopeId requerido para este ámbito.');
        }
        return [...(await this.hierarchy.getUserIdsInSubnetwork(db, scopeId))];
      default:
        throw new BadRequestException(`Ámbito inválido: ${scope}.`);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private requireDb(req: RequestWithTenantContext): TenantDb {
    if (!req.tenantContext) {
      throw new Error('TenantContext no resuelto.');
    }
    return req.tenantContext.db;
  }

  private parseTypes(input: string | string[] | undefined): WalletTxType[] | undefined {
    if (!input) return undefined;
    const arr = Array.isArray(input) ? input : [input];
    return arr as WalletTxType[];
  }

  private parseRoles(input: string | string[] | undefined): string[] | undefined {
    if (!input) return undefined;
    return Array.isArray(input) ? input : [input];
  }
}
