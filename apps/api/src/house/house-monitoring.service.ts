/**
 * HouseMonitoringService — vistas de "salud" de la Casa (o de un socio indep).
 *
 * Complementa a HouseService con dos vistas que la UI del panel usa para
 * alertar al admin/socio indep antes de que la caja se drene:
 *
 *   - `stockAlertStatus(operatorUserId?)`: nivel `ok`/`low`/`critical` del
 *      balance de la Casa (o del bankroll del indep) comparado contra los
 *      umbrales configurables en `tenant_settings`.
 *
 *   - `capitalNeeded(days, operatorUserId?)`: cuánto se drenó (net) en los
 *      últimos N días vía depósitos y retiros de la sub-red del operator,
 *      y una sugerencia de cuánto inyectar para volver a stock sano.
 *
 * Reglas de sub-red:
 *   - operatorUserId=null → la Casa. La "sub-red" es la red admin =
 *     TODOS los users MENOS la sub-red de socios independientes
 *     (UserHierarchy.getAdminNetworkIds).
 *   - operatorUserId=X (indep) → la wallet de X + su sub-red completa
 *     (X + descendants; UserHierarchy.getUserIdsInSubnetwork).
 *
 * Los umbrales se leen de `tenant_settings` con estas keys:
 *   - `house.stock_threshold_low` (default $50.000)
 *   - `house.stock_threshold_critical` (default $10.000)
 * Los mismos umbrales aplican tanto para la Casa como para un socio indep
 * (MVP — un futuro podría querer umbrales por operador).
 */

import { Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import {
  users,
  walletTransactions,
  wallets,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { TenantSettingsService } from '../tenant-settings/tenant-settings.service';
import { UserHierarchyService } from '../user-hierarchy/user-hierarchy.service';
import {
  HouseNotProvisionedError,
  HouseService,
} from './house.service';
import { InjectOperatorInvalidError } from './house.errors';

/** Key de settings para el umbral "low". */
export const SETTING_STOCK_LOW = 'house.stock_threshold_low';
/** Key de settings para el umbral "critical". */
export const SETTING_STOCK_CRITICAL = 'house.stock_threshold_critical';

/** Fallbacks si el tenant no seteó umbrales. */
export const DEFAULT_STOCK_LOW = 50000;
export const DEFAULT_STOCK_CRITICAL = 10000;

export type StockAlertLevel = 'ok' | 'low' | 'critical';

export interface StockAlertStatus {
  level: StockAlertLevel;
  balance: string;
  thresholdLow: string;
  thresholdCritical: string;
  operatorUserId: string | null;
}

export interface CapitalNeeded {
  periodDays: number;
  totalWithdrawals: string;
  totalDeposits: string;
  netOutflow: string;
  currentBalance: string;
  suggestedInject: string;
  operatorUserId: string | null;
}

@Injectable()
export class HouseMonitoringService {
  constructor(
    private readonly settings: TenantSettingsService,
    private readonly hierarchy: UserHierarchyService,
    private readonly house: HouseService,
  ) {}

  /**
   * Nivel de stock del banco (Casa o socio indep) comparado contra los
   * umbrales configurables.
   *
   *   balance <= critical  → 'critical'
   *   balance <= low       → 'low'
   *   balance >  low       → 'ok'
   */
  async stockAlertStatus(
    db: TenantDb,
    operatorUserId: string | null,
  ): Promise<StockAlertStatus> {
    const balanceDecimal = await this.resolveBalance(db, operatorUserId);
    const low = await this.settings.getNumeric(
      db,
      SETTING_STOCK_LOW,
      DEFAULT_STOCK_LOW,
    );
    const critical = await this.settings.getNumeric(
      db,
      SETTING_STOCK_CRITICAL,
      DEFAULT_STOCK_CRITICAL,
    );

    const bal = Number(balanceDecimal);
    let level: StockAlertLevel;
    if (bal <= critical) level = 'critical';
    else if (bal <= low) level = 'low';
    else level = 'ok';

    return {
      level,
      balance: balanceDecimal,
      thresholdLow: low.toFixed(2),
      thresholdCritical: critical.toFixed(2),
      operatorUserId,
    };
  }

  /**
   * Cuánto capital hace falta inyectar para volver a stock sano dado el
   * drenaje neto de los últimos `days`.
   *
   * Cálculo:
   *   - `totalWithdrawals` = Σ wallet_transactions.type='withdrawal' de la
   *      sub-red del operator (o de la red admin si es la Casa) en la
   *      ventana. Estas son FICHAS que salieron a jugadores/empleados via
   *      retiro (drena el bankroll del operator).
   *   - `totalDeposits` = Σ wallet_transactions.type='deposit' de la sub-red
   *      en la ventana. Fichas que entraron via depósito aprobado.
   *   - `netOutflow` = totalWithdrawals - totalDeposits (cuánto se drenó
   *      neto de la sub-red).
   *   - `suggestedInject` = MAX(0, netOutflow - currentBalance + thresholdLow).
   *      La idea: si mantengo este ritmo, cuánto capital adicional necesito
   *      para volver a un balance por encima del umbral "low".
   *
   * Nota: NO cuenta bet/win porque el juego contra la Casa se compensa
   * (bet+win con RTP<1 dejan margen positivo). El drenaje real de la caja
   * son los retiros netos de depósitos — plata que salió del sistema.
   */
  async capitalNeeded(
    db: TenantDb,
    days: number,
    operatorUserId: string | null,
  ): Promise<CapitalNeeded> {
    const periodDays = days;
    const balanceDecimal = await this.resolveBalance(db, operatorUserId);

    const subnetworkIds = await this.resolveSubnetworkIds(db, operatorUserId);

    // Si por alguna razón no hay users en la sub-red, no hay tx que agregar
    // (caso raro pero defensivo — evita un IN vacío).
    let totalWithdrawals = 0;
    let totalDeposits = 0;
    if (subnetworkIds.size > 0) {
      const cutoff = new Date(Date.now() - periodDays * 24 * 3600 * 1000);
      const ids = Array.from(subnetworkIds);

      // Resolver todas las wallets de los users de la sub-red.
      const walletRows = await db
        .select({ id: wallets.id })
        .from(wallets)
        .where(inArray(wallets.userId, ids));
      const walletIds = walletRows.map((w) => w.id);

      if (walletIds.length > 0) {
        const withdrawalsRows = await db
          .select({
            sum: sql<string>`COALESCE(SUM(${walletTransactions.amount}), 0)::text`,
          })
          .from(walletTransactions)
          .where(
            and(
              inArray(walletTransactions.walletId, walletIds),
              eq(walletTransactions.type, 'withdrawal'),
              gte(walletTransactions.createdAt, cutoff),
            ),
          );
        totalWithdrawals = Number(withdrawalsRows[0]?.sum ?? 0);

        const depositsRows = await db
          .select({
            sum: sql<string>`COALESCE(SUM(${walletTransactions.amount}), 0)::text`,
          })
          .from(walletTransactions)
          .where(
            and(
              inArray(walletTransactions.walletId, walletIds),
              eq(walletTransactions.type, 'deposit'),
              gte(walletTransactions.createdAt, cutoff),
            ),
          );
        totalDeposits = Number(depositsRows[0]?.sum ?? 0);
      }
    }

    const netOutflow = totalWithdrawals - totalDeposits;
    const thresholdLow = await this.settings.getNumeric(
      db,
      SETTING_STOCK_LOW,
      DEFAULT_STOCK_LOW,
    );
    const currentBalance = Number(balanceDecimal);
    const suggested = Math.max(0, netOutflow - currentBalance + thresholdLow);

    return {
      periodDays,
      totalWithdrawals: totalWithdrawals.toFixed(2),
      totalDeposits: totalDeposits.toFixed(2),
      netOutflow: netOutflow.toFixed(2),
      currentBalance: Number(balanceDecimal).toFixed(2),
      suggestedInject: suggested.toFixed(2),
      operatorUserId,
    };
  }

  /**
   * Balance del bankroll: la wallet de la Casa (operator=null) o la del
   * socio indep. Devuelve string decimal preservando la precisión de DB.
   */
  private async resolveBalance(
    db: TenantDb,
    operatorUserId: string | null,
  ): Promise<string> {
    if (operatorUserId === null) {
      const casa = await this.house.getHouseWallet(db);
      return casa.balance;
    }
    // Validar que sea un indep — mismos criterios que injectCapital/injectBudget.
    const rows = await db
      .select({
        id: users.id,
        isIndep: users.isIndependentBranch,
      })
      .from(users)
      .where(eq(users.id, operatorUserId))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw new InjectOperatorInvalidError(operatorUserId, 'not_found');
    }
    if (!row.isIndep) {
      throw new InjectOperatorInvalidError(operatorUserId, 'not_indep');
    }
    const walletRows = await db
      .select({ balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.userId, operatorUserId))
      .limit(1);
    if (!walletRows[0]) {
      // Un indep sin wallet no debería pasar (auto-provisionada), pero
      // devolvemos "0" defensivo para no romper la vista.
      return '0';
    }
    return walletRows[0].balance;
  }

  /**
   * IDs de la sub-red cuya actividad drena/alimenta este bankroll:
   *   - Casa → red admin (getAdminNetworkIds: todos los users menos las
   *     sub-redes indep).
   *   - Indep → su sub-red completa (self + descendants), vía
   *     getUserIdsInSubnetwork.
   */
  private async resolveSubnetworkIds(
    db: TenantDb,
    operatorUserId: string | null,
  ): Promise<Set<string>> {
    if (operatorUserId === null) {
      return this.hierarchy.getAdminNetworkIds(db);
    }
    return this.hierarchy.getUserIdsInSubnetwork(db, operatorUserId);
  }
}

// Re-export por conveniencia para callers que ya importan de este módulo.
export { HouseNotProvisionedError };
