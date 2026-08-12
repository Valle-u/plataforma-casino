/**
 * NetworkCommissionsService — MOTOR de comisiones por red (modelo operativo, C2).
 * docs/16-tesoreria.md §11.
 *
 * Calcula, por (operador, período mensual), la comisión en cascada sobre la
 * NetWin (GGR del juego) de su sub-red:
 *
 *   subNetWin(u) = Σ NetWin de los jugadores en el subtree de u (excl. ramas
 *                  independientes), donde NetWin = Σ(bet) − Σ(win) de
 *                  game_rounds `status='settled'` atribuidos por settled_at al
 *                  período half-open [periodStart, periodEnd) UTC.
 *
 *   gross(op) = R_op · subNetWin(op) − Σ_{hijo operador c} R_c · subNetWin(c)
 *
 *   newBalance   = carryoverIn (carryoverOut del período anterior) + gross
 *   payable      = max(0, newBalance)
 *   carryoverOut = newBalance > 0 ? 0 : newBalance     (deuda arrastrada)
 *
 * Decisiones de correctitud (cerradas con crítica adversarial):
 *   - Base SOLO sobre status='settled' (excluye 'placed' en vuelo y 'rolled_back').
 *   - Ramas independientes podadas: ownNetWin=0 para todo usuario bajo un socio
 *     independiente → no propaga a ningún ancestro, y no se emite resultado.
 *   - Solo los hijos OPERADORES descuentan (R_c); jugadores/empleados no toman
 *     tajada (su NetWin es 100% del padre).
 *   - Aritmética en centavos enteros (BigInt), un solo redondeo (half away from
 *     zero) por operador. Tasa en "bps" = % × 100 (numeric(5,2)).
 *   - Markup invertido (hijo% > padre%) ⇒ aborta el compute (config inválida).
 *   - Idempotente: upsert ON CONFLICT(operator, periodStart); recomputa desde
 *     game_rounds; bloquea recomputar un período ya 'paid'. Advisory lock por
 *     período para serializar corridas concurrentes.
 *   - Invariante de conservación: Σ gross == Σ_{operadores raíz} R·subNetWin.
 *
 * Limitaciones MVP (documentadas): usa estructura/tasas ACTUALES (no snapshot
 * histórico por round); recomputar un período viejo NO recalcula en cascada los
 * siguientes (hacerlo en orden ascendente); rollbacks posteriores a un período
 * ya liquidado no se clawbackean.
 *
 * F1 · Deducciones operativas — DORMIDO (C4, 2026-07-08):
 *   Por LEY C4 la comisión vigente es NetWin puro → comisión, SIN deducciones.
 *   El bloque F1 (sueldos + costo bancario + costo plataforma) queda DORMIDO y
 *   reversible detrás del flag `DEDUCTIONS_ENABLED` (hoy `false`): las columnas
 *   deductions_* se persisten en 0 y `finalCommission == payable`, así que
 *   `settlePeriods` paga `payable`. Poner el flag en `true` reactiva el cómputo
 *   (era: deductionsSalaries = Σ sueldos del subtree; deductionsBankCost =
 *   subNetWin × bank_cost_pct; deductionsPlatformCost = platform_cost_flat;
 *   finalCommission = MAX(0, payable − Σ deductions)). Las deducciones NUNCA
 *   afectaron al carryover (sigue el `payable` bruto). Al revivir F1 con el
 *   modelo per-nivel habrá que revisar el double-count de sueldos entre niveles
 *   anidados (hoy inalcanzable por el flag).
 */

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  and,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  ne,
  sql,
} from 'drizzle-orm';
import {
  commissionNetworkPeriods,
  employeeSalaries,
  gameProviders,
  gameRounds,
  games,
  roles,
  userHierarchy,
  userRoles,
  users,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { HouseNotProvisionedError, HouseService } from '../house/house.service';
import { TenantSettingsService } from '../tenant-settings/tenant-settings.service';
import { UserHierarchyService } from '../user-hierarchy/user-hierarchy.service';
import { WalletService } from '../wallet/wallet.service';
import {
  ConservationViolationError,
  InvertedMarkupError,
} from './commissions.errors';

const OPERATOR_ROLES = new Set(['socio', 'distribuidor', 'cajero']);

/**
 * C4 (LEYES): por ahora la comisión es NetWin puro → comisión, SIN deducciones
 * (sueldos + costo bancario + costo plataforma). El bloque F1 queda DORMIDO y
 * reversible para el futuro "módulo de costos" (comisión neta). Poner en `true`
 * reactiva el cómputo de deducciones. Con `false`, `finalCommission == payable`.
 */
const DEDUCTIONS_ENABLED = false;

// ──────────────────────────────────────────────────────────────────────
// F1 · Deducciones operativas del socio dependiente.
// El settle mensual descuenta:
//   - Sueldos: Σ employee_salaries.monthly_amount de users con rol
//     cajero/distribuidor/empleado en la sub-red del socio dep.
//   - Costo bancario: subNetWin × commissions.bank_cost_pct_of_netwin.
//   - Costo plataforma: commissions.platform_cost_flat (flat mensual).
// Y `final_commission = MAX(0, payable - Σ deductions)`.
// Los socios INDEPENDIENTES no sufren estas deducciones — el motor los
// saltea (nunca emite fila para ellos por la poda del subtree indep).
// ──────────────────────────────────────────────────────────────────────

/** Roles cuyo sueldo se descuenta al socio dep dueño de la sub-red. */
const SALARIED_ROLES = new Set(['cajero', 'distribuidor', 'empleado']);

/** Setting key: costo bancario como fracción del NetWin (0.01 = 1%). Default 0.01. */
const SETTING_BANK_COST_PCT = 'commissions.bank_cost_pct_of_netwin';
/** Setting key: costo plataforma flat mensual del socio dep. Default 0. */
const SETTING_PLATFORM_COST_FLAT = 'commissions.platform_cost_flat';
/** Defaults documentados en tenant-settings.registry.ts. */
const DEFAULT_BANK_COST_PCT = 0.01;
const DEFAULT_PLATFORM_COST_FLAT = 0;

// ──────────────────────────────────────────────────────────────────────
// Aritmética exacta en centavos (sin floats)
// ──────────────────────────────────────────────────────────────────────

/** "12345.67" | "-12.5" | "5.25" | "100" → centavos como bigint (exacto). */
export function toCents(numericStr: string): bigint {
  const s = (numericStr ?? '0').trim();
  const neg = s.startsWith('-');
  const body = s.replace(/^[-+]/, '');
  const [intPart = '0', fracRaw = ''] = body.split('.');
  const frac = (fracRaw + '00').slice(0, 2);
  const cents = BigInt(intPart || '0') * 100n + BigInt(frac || '0');
  return neg ? -cents : cents;
}

/** centavos bigint → string numeric(.,2) ("123456" → "1234.56", "-50" → "-0.50"). */
export function fromCents(cents: bigint): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const intPart = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, '0');
  return `${neg ? '-' : ''}${intPart.toString()}.${frac}`;
}

/** División de bigint con redondeo half away from zero (simétrico en 0). */
export function divRoundCents(numer: bigint, denom: bigint): bigint {
  const neg = numer < 0n !== denom < 0n;
  const a = numer < 0n ? -numer : numer;
  const b = denom < 0n ? -denom : denom;
  const q = a / b;
  const r = a % b;
  const rounded = r * 2n >= b ? q + 1n : q;
  return neg ? -rounded : rounded;
}

export interface NetworkPeriodComputeResult {
  periodStart: string;
  periodEnd: string;
  sociosComputed: number;
  totalPayable: string;
  totalGross: string;
  totalNetWin: string;
  /**
   * F1: total efectivamente liquidable en C3 = Σ final_commission. Para
   * socios indep = payable; para socios dep aplica el cap `MAX(0, payable −
   * deductions)`.
   */
  totalFinalCommission: string;
  /** F1: suma de sueldos deducidos en todo el período. */
  totalDeductionsSalaries: string;
  /** F1: suma de costos bancarios deducidos en todo el período. */
  totalDeductionsBankCost: string;
  /** F1: suma de costos de plataforma flat deducidos en todo el período. */
  totalDeductionsPlatformCost: string;
  baseConsistency: {
    ok: boolean;
    nestedSocios: number;
  };
  /** Datos por operador (para el estimado por sucursal; ver `perOperator`). */
  perOperator: OperatorPeriodResult[];
}

/** Resultado calculado de UN operador en un período (subset persistible). */
export interface OperatorPeriodResult {
  operatorUserId: string;
  subNetWin: string;
  providerFee: string;
  grossCommission: string;
  carryoverIn: string;
  carryoverOut: string;
  payable: string;
  finalCommission: string;
  rate: string;
}

export interface NetworkSettleResult {
  settled: number;
  failed: number;
  totalPaid: string;
  results: Array<{
    id: string;
    operatorUserId: string;
    amount: string;
    ok: boolean;
    error?: string;
  }>;
}

/** P&L de la Casa por período (LEY C4b). Montos como string numeric. */
export interface HousePnlResult {
  periodStart: string;
  periodEnd: string;
  /** ¿El período ya se computó? (si no, `commissions` = 0 por falta de cómputo). */
  periodComputed: boolean;
  dependent: {
    netWin: string;
    providerFee: string;
    base: string;
    commissions: string;
    houseNet: string;
  };
  independent: {
    netWin: string;
    providerFee: string;
  };
  houseNetTotal: string;
}

// ──────────────────────────────────────────────────────────────────────
// Overview agrupado por red (para el panel del admin reorganizado).
// Read-only: compone árbol + filas de período + payables ya persistidos.
// ──────────────────────────────────────────────────────────────────────

/** Un operador dentro de una red, con su tasa + resultado del período. */
export interface NetworkOverviewOperator {
  id: string;
  username: string;
  displayName: string | null;
  role: string; // socio | distribuidor | cajero
  depth: number; // relativo al root de la red (top = 0)
  parentId: string | null;
  rate: string; // users.commission_rate (%)
  /** true solo si el padre activo es el admin (delegación estricta, C2). */
  editableByAdmin: boolean;
  subNetWin: string; // "0" si no hay fila computada
  grossCommission: string;
  payable: string;
  finalCommission: string;
  status: string; // 'none' si no hay fila; sino accrued|paid|void
  pendingRowIds: string[]; // para el botón Liquidar (por operador)
}

/** P&L de UNA red (puro de columnas persistidas). */
export interface NetworkOverviewPnl {
  netWin: string;
  providerFee: string;
  commissions: string;
  houseKeeps: string;
}

export interface NetworkOverviewNetwork {
  kind: 'house' | 'socio';
  rootId: string | null; // null para la Red de la Casa (sintética)
  label: string;
  operators: NetworkOverviewOperator[]; // flat, orden DFS para indentar
  pnl: NetworkOverviewPnl;
}

/** Red independiente: se muestra pero NO cobra comisión (LEY C5). */
export interface NetworkOverviewIndependent {
  id: string;
  username: string;
  displayName: string | null;
  role: string;
}

export interface NetworkOverviewResult {
  period: string; // 'YYYY-MM'
  periodStart: string; // ISO
  periodEnd: string; // ISO
  periodComputed: boolean;
  networks: NetworkOverviewNetwork[]; // house primero, luego socios
  independents: NetworkOverviewIndependent[];
}

/** Desglose "de dónde sale mi comisión" de un operador en un período (LEY C6). */
export interface CommissionBreakdown {
  /** 'YYYY-MM'. */
  period: string;
  /** NetWin de la red del operador (pre-fee). */
  netWin: string;
  /** Costo del proveedor sobre ese NetWin. */
  providerFee: string;
  /** Base = netWin − providerFee. */
  base: string;
  /** Tasa del operador (%). */
  rate: string;
  /** Lo que cobraría el operador si no tuviera hijos = base × tasa. */
  ownShare: string;
  /** Lo que cobran sus hijos operadores (se le descuenta) = ownShare − gross. */
  childrenDeduction: string;
  /** Comisión bruta del período (override). */
  gross: string;
  /** Deuda arrastrada del mes anterior (≤ 0). */
  carryoverIn: string;
  /** A pagar este período = max(0, carryoverIn + gross). */
  payable: string;
  /** Solo para histórico: estado de la fila. */
  status?: 'accrued' | 'paid' | 'void';
  paidAt?: string | null;
}

/** Resumen de comisión de un operador para "mi sucursal" (Fase 2). */
export interface OperatorCommissionSummary {
  operator: {
    id: string;
    username: string;
    displayName: string;
    role: string;
    rate: string;
  };
  /** ¿Este usuario cobra comisión? (operador dependiente, no independiente). */
  earnsCommission: boolean;
  /** Estimado del mes en curso (read-only, aún no liquidado). */
  current: CommissionBreakdown;
  /** Períodos cerrados (persistidos), más nuevo primero. */
  history: CommissionBreakdown[];
}

/** Fila del tablero de deudas/pagos del admin (agregado por operador). */
export interface PayableRow {
  operatorUserId: string;
  username: string | null;
  displayName: string | null;
  /** Σ payable de las filas 'accrued' (lo que se le debe). */
  pending: string;
  /** Σ payable de las filas 'paid' (lo ya liquidado, histórico). */
  paid: string;
  /** Cantidad de períodos pendientes. */
  pendingCount: number;
  /** IDs de las filas accrued (para liquidar a este operador de una). */
  pendingRowIds: string[];
}

@Injectable()
export class NetworkCommissionsService {
  private readonly logger = new Logger(NetworkCommissionsService.name);

  constructor(
    private readonly wallet: WalletService,
    private readonly house: HouseService,
    private readonly settings: TenantSettingsService,
    private readonly hierarchy: UserHierarchyService,
  ) {}

  /**
   * F1: `platform_cost_flat` a centavos exactos. Setting es number en la
   * moneda del tenant (ej. 500 → 50000 centavos). Se redondea a 2 decimales
   * antes de pasar por `toCents`: la unidad mínima del sistema es el centavo,
   * y aceptamos que un admin que setee 3 decimales pierda precisión sub-cent.
   */
  private static platformCostToCents(n: number): bigint {
    if (!Number.isFinite(n) || n <= 0) return 0n;
    return toCents(n.toFixed(2));
  }

  /**
   * F1: aplica `bank_cost_pct_of_netwin` (fracción [0, 1]) a un monto en
   * centavos, devolviendo centavos con redondeo half-away-from-zero. Se hace
   * en BigInt escalando el pct a "diez-millonésimos" (7 decimales) — con eso
   * un pct entre 0 y 1 usando number tiene precisión >6 dígitos, suficiente
   * para lo que un admin pueda razonablemente escribir en una config.
   */
  private static bankCostOnCents(cents: bigint, pct: number): bigint {
    if (cents === 0n) return 0n;
    if (!Number.isFinite(pct) || pct <= 0) return 0n;
    // Techo defensivo: aunque el schema lo valida en [0,1], si algo pasó,
    // truncar al 100% para no comerse todo el positivo con overflow.
    const clamped = pct >= 1 ? 1 : pct;
    // Escala 1e7: 0.0123456 → 123456n. round-half-away-from-zero.
    const SCALE = 10_000_000;
    const scaledFloat = clamped * SCALE;
    const scaled = BigInt(
      scaledFloat >= 0
        ? Math.floor(scaledFloat + 0.5)
        : -Math.floor(-scaledFloat + 0.5),
    );
    return divRoundCents(cents * scaled, BigInt(SCALE));
  }

  /** [periodStart, periodEnd) del mes que contiene `ref` (UTC). */
  static monthBoundsContaining(ref: Date): {
    periodStart: Date;
    periodEnd: Date;
  } {
    const periodStart = new Date(
      Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1),
    );
    const periodEnd = new Date(
      Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 1),
    );
    return { periodStart, periodEnd };
  }

  /**
   * Resuelve el período a computar. `input`:
   *   - 'YYYY-MM' o fecha ISO → el mes que la contiene.
   *   - ausente → el mes COMPLETO anterior al actual (default operativo).
   */
  static resolvePeriod(input?: string): { periodStart: Date; periodEnd: Date } {
    if (input && input.trim()) {
      const m = /^(\d{4})-(\d{2})$/.exec(input.trim());
      const ref = m
        ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1))
        : new Date(input);
      if (Number.isNaN(ref.getTime())) {
        throw new RangeError(`Período inválido: ${input}`);
      }
      return NetworkCommissionsService.monthBoundsContaining(ref);
    }
    const now = new Date();
    const prevMonthRef = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
    );
    return NetworkCommissionsService.monthBoundsContaining(prevMonthRef);
  }

  /**
   * Computa (o recomputa, idempotente) las comisiones por red del período.
   * Persiste filas 'accrued' en commission_network_periods. Todo en una
   * transacción con advisory lock por período.
   */
  async computePeriod(
    db: TenantDb,
    params: { periodStart: Date; periodEnd: Date },
    opts: { dryRun?: boolean } = {},
  ): Promise<NetworkPeriodComputeResult> {
    const { periodStart, periodEnd } = params;
    const dryRun = opts.dryRun === true;

    return db.transaction(async (tx) => {
      // Serializa corridas concurrentes del mismo período (cae al commit).
      // En dryRun (estimado read-only) igual tomamos el lock para consistencia.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${periodStart.getTime()})`,
      );

      // Socios ya liquidados ('paid') del período: NO se recomputan (su payable
      // es final). El resto ('accrued') sí. Así, liquidar PARTE de un período no
      // lo congela para corregir el resto.
      const paidRows = await tx
        .select({ op: commissionNetworkPeriods.operatorUserId })
        .from(commissionNetworkPeriods)
        .where(
          and(
            eq(commissionNetworkPeriods.periodStart, periodStart),
            eq(commissionNetworkPeriods.status, 'paid'),
          ),
        );
      const paidSet = new Set(paidRows.map((r) => r.op));

      // ── Cargar estado (3 queries) ──────────────────────────────────────
      const userRows = await tx
        .select({
          id: users.id,
          commissionRate: users.commissionRate,
          isIndependent: users.isIndependentBranch,
          isSystem: users.isSystem,
          roleCode: roles.code,
          eligibleFrom: users.commissionEligibleFrom,
          eligibleUntil: users.commissionEligibleUntil,
        })
        .from(users)
        .leftJoin(userRoles, eq(userRoles.userId, users.id))
        .leftJoin(roles, eq(roles.id, userRoles.roleId));

      const userMap = new Map<
        string,
        {
          rate: string;
          isIndependent: boolean;
          isSystem: boolean;
          roles: Set<string>;
          eligibleFrom: Date | null;
          eligibleUntil: Date | null;
        }
      >();
      for (const r of userRows) {
        let u = userMap.get(r.id);
        if (!u) {
          u = {
            rate: r.commissionRate,
            isIndependent: r.isIndependent,
            isSystem: r.isSystem,
            roles: new Set<string>(),
            eligibleFrom: r.eligibleFrom,
            eligibleUntil: r.eligibleUntil,
          };
          userMap.set(r.id, u);
        }
        if (r.roleCode) u.roles.add(r.roleCode);
      }

      const edges = await tx
        .select({
          userId: userHierarchy.userId,
          parentUserId: userHierarchy.parentUserId,
        })
        .from(userHierarchy)
        .where(isNull(userHierarchy.until));

      const childrenMap = new Map<string, string[]>();
      const parentMap = new Map<string, string | null>();
      for (const e of edges) {
        parentMap.set(e.userId, e.parentUserId);
        if (e.parentUserId) {
          const arr = childrenMap.get(e.parentUserId) ?? [];
          arr.push(e.userId);
          childrenMap.set(e.parentUserId, arr);
        }
      }

      const netRows = await tx
        .select({
          userId: gameRounds.userId,
          bet: sql<string>`COALESCE(SUM(${gameRounds.betAmount}), 0)::text`,
          win: sql<string>`COALESCE(SUM(${gameRounds.winAmount}), 0)::text`,
        })
        .from(gameRounds)
        .where(
          and(
            eq(gameRounds.status, 'settled'),
            gte(gameRounds.settledAt, periodStart),
            lt(gameRounds.settledAt, periodEnd),
          ),
        )
        .groupBy(gameRounds.userId);

      const ownNet = new Map<string, bigint>();
      let totalNetWin = 0n; // de jugadores NO excluidos (se acumula abajo)
      for (const r of netRows) {
        ownNet.set(r.userId, toCents(r.bet) - toCents(r.win));
      }

      // ── Excluir ramas independientes: poda el subtree de TODO usuario con
      //    is_independent_branch (sin importar el rol — más seguro que filtrar
      //    solo socios; un flag mal puesto en otro nivel igual poda). ─────────
      const excluded = new Set<string>();
      for (const [id, u] of userMap) {
        if (!u.isIndependent) continue;
        const stack = [id];
        while (stack.length) {
          const n = stack.pop()!;
          if (excluded.has(n)) continue;
          excluded.add(n);
          for (const c of childrenMap.get(n) ?? []) stack.push(c);
        }
      }

      // ── §14.4 corte de comisión: ventaneo por flip mid-período ────────────
      //    Un socio que flipeó DENTRO de este período tiene solo un TRAMO
      //    DEPENDIENTE comisionable. Ventaneamos la ownNet de su subtree a ese
      //    tramo (los rounds fuera del tramo no cuentan) y —si el flip fue
      //    dep→indep, hoy independiente → quedaría en `excluded`— des-excluimos
      //    su subtree para que el tramo dependiente igual se compute. El camino
      //    común (socio sin flip en el período) NO se toca.
      for (const [socioId, u] of userMap) {
        const from = u.eligibleFrom;
        const until = u.eligibleUntil;
        const fromInPeriod =
          from !== null && from >= periodStart && from < periodEnd;
        const untilInPeriod =
          until !== null && until >= periodStart && until < periodEnd;
        if (!fromInPeriod && !untilInPeriod) continue;

        const winFrom = from !== null && from > periodStart ? from : periodStart;
        const winUntil = until !== null && until < periodEnd ? until : periodEnd;

        // IDs del subtree (socio + descendientes).
        const subtreeIds: string[] = [];
        const stack = [socioId];
        while (stack.length) {
          const n = stack.pop()!;
          subtreeIds.push(n);
          for (const c of childrenMap.get(n) ?? []) stack.push(c);
        }

        // Des-excluir (el dep→indep dejó el subtree en `excluded`) y resetear su
        // ownNet full-período; recargamos SOLO los rounds del tramo dependiente.
        for (const sid of subtreeIds) {
          excluded.delete(sid);
          ownNet.set(sid, 0n);
        }
        if (winFrom < winUntil) {
          const windowed = await tx
            .select({
              userId: gameRounds.userId,
              bet: sql<string>`COALESCE(SUM(${gameRounds.betAmount}), 0)::text`,
              win: sql<string>`COALESCE(SUM(${gameRounds.winAmount}), 0)::text`,
            })
            .from(gameRounds)
            .where(
              and(
                eq(gameRounds.status, 'settled'),
                gte(gameRounds.settledAt, winFrom),
                lt(gameRounds.settledAt, winUntil),
                inArray(gameRounds.userId, subtreeIds),
              ),
            )
            .groupBy(gameRounds.userId);
          for (const r of windowed) {
            ownNet.set(r.userId, toCents(r.bet) - toCents(r.win));
          }
        }
      }

      // Aviso si el período aún no cerró (resultados parciales, se recomputan).
      if (periodEnd.getTime() > new Date().getTime()) {
        this.logger.warn(
          `Computando un período aún no cerrado (${periodStart.toISOString()}); ` +
            `los resultados son parciales y se recomputarán al cerrar.`,
        );
      }
      // Aviso si hay períodos POSTERIORES ya computados (su carryover quedaría
      // stale: recomputar este implica recomputar la cadena en orden ascendente).
      const laterRows = await tx
        .select({ id: commissionNetworkPeriods.id })
        .from(commissionNetworkPeriods)
        .where(gt(commissionNetworkPeriods.periodStart, periodStart))
        .limit(1);
      if (laterRows.length > 0) {
        this.logger.warn(
          `Recomputando ${periodStart.toISOString()} con períodos posteriores ya ` +
            `computados: su carryover puede quedar stale (recomputar en cascada).`,
        );
      }

      // ── Quién es operador (socio/distribuidor/cajero, no admin/sistema/excl) ─
      const isOperator = (id: string): boolean => {
        const u = userMap.get(id);
        if (!u) return false;
        if (excluded.has(id) || u.isSystem || u.roles.has('admin_tenant')) {
          return false;
        }
        for (const r of u.roles) if (OPERATOR_ROLES.has(r)) return true;
        return false;
      };

      // ── subNetWin memoizado: solo NO-operadores (jugadores) aportan su
      //    propia NetWin; un operador que juega NO genera comisión sobre su
      //    propio juego. Poda en nodos excluidos (ramas independientes). ──────
      const subMemo = new Map<string, bigint>();
      const subNetWin = (u: string): bigint => {
        if (excluded.has(u)) return 0n;
        const cached = subMemo.get(u);
        if (cached !== undefined) return cached;
        let total = isOperator(u) ? 0n : (ownNet.get(u) ?? 0n);
        for (const c of childrenMap.get(u) ?? []) total += subNetWin(c);
        subMemo.set(u, total);
        return total;
      };

      // La plataforma SOLO liquida a los SOCIOS (el admin arregla con el socio;
      // el socio reparte hacia abajo por fuera, no le interesa a la plataforma).
      // Un socio independiente queda excluido (compró fichas al por mayor).
      const isSocio = (id: string): boolean => {
        const u = userMap.get(id);
        if (!u) return false;
        if (excluded.has(id) || u.isSystem || u.roles.has('admin_tenant')) {
          return false;
        }
        return u.roles.has('socio');
      };
      // ¿El usuario tiene un socio como ancestro? (para el invariante de base).
      const hasSocioAncestor = (id: string): boolean => {
        let p = parentMap.get(id) ?? null;
        while (p) {
          if (isSocio(p)) return true;
          p = parentMap.get(p) ?? null;
        }
        return false;
      };

      // NetWin total comisionable (solo jugadores NO excluidos) — métrica.
      for (const [uid, net] of ownNet) {
        if (!excluded.has(uid) && !isOperator(uid)) totalNetWin += net;
      }

      const socios: string[] = [];
      for (const id of userMap.keys()) if (isSocio(id)) socios.push(id);

      // ── Invariante ESTRUCTURAL (fail-closed, early exit) ──────────────────
      //    H1c-2: ejecutamos este check ANTES del compute costoso (sueldos,
      //    deducciones, subtree). Si un socio cuelga de otro socio, la
      //    memoization de `subtreeSalaries` podía descontar el mismo sueldo
      //    dos veces (a A y a B). Aunque el throw revierte la tx, mejor
      //    abortar temprano — evita compute desperdiciado y hace el bug
      //    inalcanzable.
      const nestedSociosEarly = socios.filter((s) => hasSocioAncestor(s));
      if (nestedSociosEarly.length > 0) {
        this.logger.error(
          `Socios anidados en ${periodStart.toISOString()} (early check): ` +
            `${nestedSociosEarly.join(', ')} (un socio cuelga de otro → doble conteo).`,
        );
        throw new ConservationViolationError(
          periodStart.toISOString(),
          String(nestedSociosEarly.length),
          '0',
          String(nestedSociosEarly.length),
        );
      }

      // ── carryoverIn = carryoverOut del período anterior (excl. 'void') ─────
      const prevStart = new Date(
        Date.UTC(
          periodStart.getUTCFullYear(),
          periodStart.getUTCMonth() - 1,
          1,
        ),
      );
      const prevRows = await tx
        .select({
          op: commissionNetworkPeriods.operatorUserId,
          carryOut: commissionNetworkPeriods.carryoverOut,
        })
        .from(commissionNetworkPeriods)
        .where(
          and(
            eq(commissionNetworkPeriods.periodStart, prevStart),
            ne(commissionNetworkPeriods.status, 'void'),
          ),
        );
      const carryoverMap = new Map<string, bigint>();
      for (const r of prevRows) carryoverMap.set(r.op, toCents(r.carryOut));

      // ── F1 (DORMIDO si DEDUCTIONS_ENABLED=false): cargar sueldos activos +
      //    settings de costos operativos. Con F1 dormido NO se cargan (no se usan
      //    → el compute no depende de `this.settings`); quedan en sus defaults.
      const salaryByUser = new Map<string, bigint>();
      let bankCostPct = 0;
      let platformCostCents = 0n;
      if (DEDUCTIONS_ENABLED) {
        const salaryRows = await tx
          .select({
            userId: employeeSalaries.userId,
            monthly: employeeSalaries.monthlyAmount,
          })
          .from(employeeSalaries);
        for (const r of salaryRows) {
          salaryByUser.set(r.userId, toCents(r.monthly));
        }
        // H1c-3: leer settings desde `tx` (no `db`) para el aislamiento
        // serializable del compute. Cast a TenantDb (convención del repo).
        const txDb = tx as unknown as TenantDb;
        bankCostPct = await this.settings.getNumeric(
          txDb,
          SETTING_BANK_COST_PCT,
          DEFAULT_BANK_COST_PCT,
        );
        const platformCostFlat = await this.settings.getNumeric(
          txDb,
          SETTING_PLATFORM_COST_FLAT,
          DEFAULT_PLATFORM_COST_FLAT,
        );
        platformCostCents =
          NetworkCommissionsService.platformCostToCents(platformCostFlat);
      }

      /**
       * F1: ¿este user aporta sueldo a la deducción del socio dep dueño?
       * Cualquier user con rol salariado (cajero/distribuidor/empleado). No
       * incluye 'usuario_final' ni 'admin_tenant'; los socios anidados están
       * prohibidos por invariante estructural, así que su sueldo no cuenta.
       */
      const isSalaried = (id: string): boolean => {
        const u = userMap.get(id);
        if (!u) return false;
        if (excluded.has(id) || u.isSystem || u.roles.has('admin_tenant')) {
          return false;
        }
        for (const r of u.roles) if (SALARIED_ROLES.has(r)) return true;
        return false;
      };

      /**
       * F1: suma los sueldos activos de los users salariados en el subtree del
       * operador (excluyendo ramas independientes por poda). Memoizado por
       * operador. NO cuenta al operador mismo (un socio no se paga sueldo a sí
       * mismo).
       */
      const salaryMemo = new Map<string, bigint>();
      const subtreeSalaries = (u: string): bigint => {
        if (excluded.has(u)) return 0n;
        const cached = salaryMemo.get(u);
        if (cached !== undefined) return cached;
        let total = 0n;
        for (const c of childrenMap.get(u) ?? []) {
          if (excluded.has(c)) continue;
          if (isSalaried(c)) total += salaryByUser.get(c) ?? 0n;
          total += subtreeSalaries(c);
        }
        salaryMemo.set(u, total);
        return total;
      };

      // ── C1 (diferencial/override): una fila por CADA operador dependiente
      //    (socio/distribuidor/cajero). Cada nivel cobra SU override:
      //      gross(op) = R_op·subNetWin(op) − Σ R_hijo·subNetWin(hijo_operador)
      //    donde la resta es solo sobre HIJOS OPERADORES DIRECTOS (el resto de
      //    la cadena se computa al iterar ese hijo). Telescopa: el total que
      //    paga la Casa queda capado a la tasa del nivel más alto de la cadena.
      //    Saltea operadores ya 'paid' (resultado final, no se recomputa).
      //    C4: deducciones DORMIDAS (DEDUCTIONS_ENABLED=false) → finalCommission
      //    == payable. El bloque F1 queda referenciado pero inerte.
      // ── Costo del PROVEEDOR (LEY C): el proveedor (ej. Palace 7%) nos cobra un
      //    fee sobre el NetWin. Se descuenta de la BASE de comisión ANTES de
      //    aplicar las tasas de los operadores → los operadores cobran sobre
      //    `NetWin × (1 − fee)`. Solo aplica a bases POSITIVAS (el proveedor no
      //    reduce la deuda de una red que perdió). Como la comisión es lineal en
      //    la base, esto es matemáticamente idéntico a reducir cada base.
      //    MVP (un proveedor): fee exacto. Multi-proveedor: fee efectivo
      //    ponderado por NetWin (el split per-operador fino es refinamiento
      //    futuro). El monto de fee de cada operador se persiste (transparencia).
      const provFeeRows = await tx
        .select({
          code: gameProviders.code,
          feePct: gameProviders.commissionFeePct,
        })
        .from(gameProviders);
      const feeByProvider = new Map<string, bigint>(
        provFeeRows.map((r) => [r.code, toCents(r.feePct)]),
      );
      const provNetRows = await tx
        .select({
          providerCode: games.providerCode,
          net: sql<string>`COALESCE(SUM(${gameRounds.betAmount} - ${gameRounds.winAmount}), 0)::text`,
        })
        .from(gameRounds)
        .innerJoin(games, eq(games.id, gameRounds.gameId))
        .where(
          and(
            eq(gameRounds.status, 'settled'),
            gte(gameRounds.settledAt, periodStart),
            lt(gameRounds.settledAt, periodEnd),
          ),
        )
        .groupBy(games.providerCode);
      let feeWeightedNum = 0n; // Σ (netProvider × feeBp)
      let feeNetTotal = 0n; // Σ netProvider
      for (const r of provNetRows) {
        const net = toCents(r.net);
        feeWeightedNum += net * (feeByProvider.get(r.providerCode) ?? 0n);
        feeNetTotal += net;
      }
      // Fee efectivo en bp (centésimas de %). Si el NetWin total ≤ 0 → sin fee.
      const providerFeeBp =
        feeNetTotal > 0n ? divRoundCents(feeWeightedNum, feeNetTotal) : 0n;
      /** Fee (en cents) sobre una base dada; 0 si la base es ≤ 0. */
      const feeOn = (cents: bigint): bigint =>
        cents > 0n ? divRoundCents(cents * providerFeeBp, 10000n) : 0n;
      /** Base de comisión POST-fee de un nodo (para el diferencial). */
      const baseOf = (u: string): bigint => {
        const s = subNetWin(u);
        return s - feeOn(s);
      };

      const computed: Array<{
        op: string;
        subOp: bigint;
        /** Costo del proveedor aplicado a subOp (para transparencia/P&L). */
        providerFee: bigint;
        gross: bigint;
        rate: string;
        /** F1 (dormido): sueldos consolidados del subtree. */
        deductionsSalaries: bigint;
        /** F1 (dormido): costo bancario proporcional. */
        deductionsBankCost: bigint;
        /** F1 (dormido): costo plataforma flat. */
        deductionsPlatformCost: bigint;
      }> = [];

      const operators: string[] = [];
      for (const id of userMap.keys()) if (isOperator(id)) operators.push(id);

      // C2 fail-closed: juntamos TODAS las inversiones de markup (un hijo
      // operador con % > su padre → override negativo espurio) y abortamos el
      // período si hay alguna. El techo ya se valida al FIJAR la tasa; esto lo
      // re-verifica al COMPUTAR (defensa ante config que quedó inconsistente).
      const markupOffenders: Array<{
        parentUserId: string;
        childUserId: string;
        parentRate: number;
        childRate: number;
      }> = [];

      for (const op of operators) {
        if (paidSet.has(op)) continue;
        const u = userMap.get(op)!;
        const rateOpBp = toCents(u.rate); // % en centésimas (5.00 → 500)
        const subOp = subNetWin(op); // NetWin del subtree PRE-fee (se registra).
        const providerFee = feeOn(subOp); // costo proveedor sobre esa base.

        // Aporte propio menos el de cada hijo operador directo (diferencial),
        // sobre la BASE POST-fee de cada nodo (`baseOf` = subNetWin − fee).
        let num = rateOpBp * baseOf(op);
        for (const c of childrenMap.get(op) ?? []) {
          if (!isOperator(c)) continue;
          const child = userMap.get(c)!;
          const childRateBp = toCents(child.rate);
          if (childRateBp > rateOpBp) {
            markupOffenders.push({
              parentUserId: op,
              childUserId: c,
              parentRate: Number(u.rate),
              childRate: Number(child.rate),
            });
          }
          num -= childRateBp * baseOf(c);
        }
        const gross = divRoundCents(num, 10000n); // un solo redondeo

        const salariesDed = DEDUCTIONS_ENABLED ? subtreeSalaries(op) : 0n;
        const bankCostDed = DEDUCTIONS_ENABLED
          ? NetworkCommissionsService.bankCostOnCents(subOp, bankCostPct)
          : 0n;
        const platformDed = DEDUCTIONS_ENABLED ? platformCostCents : 0n;
        computed.push({
          op,
          subOp,
          providerFee,
          gross,
          rate: u.rate,
          deductionsSalaries: salariesDed,
          deductionsBankCost: bankCostDed,
          deductionsPlatformCost: platformDed,
        });
      }

      if (markupOffenders.length > 0) {
        this.logger.error(
          `Markup invertido en ${periodStart.toISOString()}: ` +
            markupOffenders
              .map(
                (o) =>
                  `${o.childUserId}(${o.childRate}%)>${o.parentUserId}(${o.parentRate}%)`,
              )
              .join(', '),
        );
        throw new InvertedMarkupError(markupOffenders);
      }

      // ── Invariante ESTRUCTURAL (fail-closed): ningún socio puede colgar de
      //    otro socio — duplicaría la misma red. Robusto: no depende de los
      //    montos (que podrían cancelarse a 0 y esconder el anidamiento). ──────
      const nestedSocios = socios.filter((s) => hasSocioAncestor(s));
      if (nestedSocios.length > 0) {
        this.logger.error(
          `Socios anidados en ${periodStart.toISOString()}: ` +
            `${nestedSocios.join(', ')} (un socio cuelga de otro → doble conteo).`,
        );
        throw new ConservationViolationError(
          periodStart.toISOString(),
          String(nestedSocios.length),
          '0',
          String(nestedSocios.length),
        );
      }

      // Arrastre de DEUDA de ex-socios: si un operador tenía carryoverOut<0 el
      // mes previo pero hoy ya NO es socio (cambió de rol / se volvió
      // independiente), la deuda NO desaparece — se arrastra en su propia fila
      // (payable 0) hasta saldarse. Evita que se "limpie" la deuda cambiando rol.
      // F1: la fila de arrastre no acumula deducciones (subOp=0, gross=0; el
      // socio no está operando, no le corresponde bank/platform/salary cost).
      const computedIds = new Set(computed.map((c) => c.op));
      for (const [opId, prevCarryOut] of carryoverMap) {
        if (prevCarryOut < 0n && !computedIds.has(opId) && !paidSet.has(opId)) {
          computed.push({
            op: opId,
            subOp: 0n,
            providerFee: 0n,
            gross: 0n,
            rate: userMap.get(opId)?.rate ?? '0',
            deductionsSalaries: 0n,
            deductionsBankCost: 0n,
            deductionsPlatformCost: 0n,
          });
        }
      }

      const actualGross = computed.reduce((s, c) => s + c.gross, 0n);

      // ── Persistir: limpiar filas NO-pagadas del período (idempotencia real,
      //    sin filas STALE de operadores que dejaron de emitir) + insertar. ───
      //    En dryRun (estimado read-only) NO se toca la DB — solo se devuelven
      //    los montos calculados por operador (idénticos al cómputo real).
      if (!dryRun) {
        await tx
          .delete(commissionNetworkPeriods)
          .where(
            and(
              eq(commissionNetworkPeriods.periodStart, periodStart),
              ne(commissionNetworkPeriods.status, 'paid'),
            ),
          );
      }

      let totalPayable = 0n;
      let totalFinal = 0n;
      let totalDedSal = 0n;
      let totalDedBank = 0n;
      let totalDedPlat = 0n;
      let sociosComputed = 0;
      const perOperator: OperatorPeriodResult[] = [];
      for (const c of computed) {
        const carryIn = carryoverMap.get(c.op) ?? 0n;
        const newBal = carryIn + c.gross;
        const payable = newBal > 0n ? newBal : 0n;
        const carryOut = newBal > 0n ? 0n : newBal;

        // F1: aplicar deducciones SOLO cuando hay algo por pagar. Si payable=0
        // (deuda pura o sin actividad), no cobramos costos operativos — el
        // socio dep no está siendo liquidado este mes.
        // Los indep NUNCA entran acá (poda de subtree indep + isSocio filter).
        // Ex-socios ahora indep con arrastre puro tienen payable=0 → no aplica.
        const applyDeductions = payable > 0n;
        const dedSalaries = applyDeductions ? c.deductionsSalaries : 0n;
        const dedBank = applyDeductions ? c.deductionsBankCost : 0n;
        const dedPlatform = applyDeductions ? c.deductionsPlatformCost : 0n;
        const totalDed = dedSalaries + dedBank + dedPlatform;
        const finalRaw = payable - totalDed;
        const finalCommission = finalRaw > 0n ? finalRaw : 0n;

        // Solo emitimos fila para operadores que GANAN algo (gross>0) o que
        // ARRASTRAN deuda (carryIn≠0). Un operador con tasa 0 / diferencial 0
        // (aunque tenga subNetWin en su red) no cobra nada este período → sin
        // fila (evita ruido de filas payable=0 por cada nivel intermedio). El
        // NetWin total de la red se mide aparte (`totalNetWin`), no depende de
        // estas filas. Short-circuit ANTES de tocar totals.
        if (c.gross === 0n && carryIn === 0n) continue;

        totalPayable += payable;
        totalFinal += finalCommission;
        totalDedSal += dedSalaries;
        totalDedBank += dedBank;
        totalDedPlat += dedPlatform;
        sociosComputed++;

        perOperator.push({
          operatorUserId: c.op,
          subNetWin: fromCents(c.subOp),
          providerFee: fromCents(c.providerFee),
          grossCommission: fromCents(c.gross),
          carryoverIn: fromCents(carryIn),
          carryoverOut: fromCents(carryOut),
          payable: fromCents(payable),
          finalCommission: fromCents(finalCommission),
          rate: c.rate,
        });

        if (!dryRun) {
          await tx.insert(commissionNetworkPeriods).values({
            operatorUserId: c.op,
            periodStart,
            periodEnd,
            subNetWin: fromCents(c.subOp),
            providerFee: fromCents(c.providerFee),
            grossCommission: fromCents(c.gross),
            carryoverIn: fromCents(carryIn),
            carryoverOut: fromCents(carryOut),
            payable: fromCents(payable),
            deductionsSalaries: fromCents(dedSalaries),
            deductionsBankCost: fromCents(dedBank),
            deductionsPlatformCost: fromCents(dedPlatform),
            finalCommission: fromCents(finalCommission),
            rateSnapshot: c.rate,
            status: 'accrued',
          });
        }
      }

      return {
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        sociosComputed,
        totalPayable: fromCents(totalPayable),
        totalGross: fromCents(actualGross),
        totalNetWin: fromCents(totalNetWin),
        totalFinalCommission: fromCents(totalFinal),
        totalDeductionsSalaries: fromCents(totalDedSal),
        totalDeductionsBankCost: fromCents(totalDedBank),
        totalDeductionsPlatformCost: fromCents(totalDedPlat),
        baseConsistency: {
          ok: true,
          nestedSocios: 0,
        },
        perOperator,
      } satisfies NetworkPeriodComputeResult;
    });
  }

  /**
   * P&L de la Casa para un período (LEY C4b). Desglosa a dónde va el NetWin:
   *   NetWin dependiente → − fee del proveedor → base → − comisiones → neto.
   * El NetWin INDEPENDIENTE se muestra aparte: la Casa paga su fee al proveedor
   * pero lo ABSORBE (lo cubre el margen de reventa, R4). Read-only, no persiste.
   */
  async getHousePnl(
    db: TenantDb,
    period: { periodStart: Date; periodEnd: Date },
  ): Promise<HousePnlResult> {
    const { periodStart, periodEnd } = period;
    const independentIds = await this.hierarchy.getIndependentSubtreeIds(db);

    const provFeeRows = await db
      .select({
        code: gameProviders.code,
        feePct: gameProviders.commissionFeePct,
      })
      .from(gameProviders);
    const feeByProvider = new Map<string, bigint>(
      provFeeRows.map((r) => [r.code, toCents(r.feePct)]),
    );

    const rows = await db
      .select({
        userId: gameRounds.userId,
        providerCode: games.providerCode,
        net: sql<string>`COALESCE(SUM(${gameRounds.betAmount} - ${gameRounds.winAmount}), 0)::text`,
      })
      .from(gameRounds)
      .innerJoin(games, eq(games.id, gameRounds.gameId))
      .where(
        and(
          eq(gameRounds.status, 'settled'),
          gte(gameRounds.settledAt, periodStart),
          lt(gameRounds.settledAt, periodEnd),
        ),
      )
      .groupBy(gameRounds.userId, games.providerCode);

    let netDep = 0n;
    let feeDep = 0n;
    let netIndep = 0n;
    let feeIndep = 0n;
    for (const r of rows) {
      const net = toCents(r.net);
      const feeBp = feeByProvider.get(r.providerCode) ?? 0n;
      const fee = net > 0n ? divRoundCents(net * feeBp, 10000n) : 0n;
      if (independentIds.has(r.userId)) {
        netIndep += net;
        feeIndep += fee;
      } else {
        netDep += net;
        feeDep += fee;
      }
    }

    // Comisiones del período = Σ gross_commission (telescopa al total que paga
    // la Casa). Filas 'void' excluidas.
    const commRows = await db
      .select({
        total: sql<string>`COALESCE(SUM(${commissionNetworkPeriods.grossCommission}), 0)::text`,
        n: sql<number>`count(*)::int`,
      })
      .from(commissionNetworkPeriods)
      .where(
        and(
          eq(commissionNetworkPeriods.periodStart, periodStart),
          ne(commissionNetworkPeriods.status, 'void'),
        ),
      );
    const commissions = toCents(commRows[0]?.total ?? '0');
    const periodComputed = (commRows[0]?.n ?? 0) > 0;

    const baseDep = netDep - feeDep;
    const houseNetDep = baseDep - commissions;
    const houseNetTotal = houseNetDep - feeIndep;

    return {
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      periodComputed,
      dependent: {
        netWin: fromCents(netDep),
        providerFee: fromCents(feeDep),
        base: fromCents(baseDep),
        commissions: fromCents(commissions),
        houseNet: fromCents(houseNetDep),
      },
      independent: {
        netWin: fromCents(netIndep),
        providerFee: fromCents(feeIndep),
      },
      houseNetTotal: fromCents(houseNetTotal),
    };
  }

  /**
   * Resumen de comisión de UN operador para "mi sucursal" (Fase 2). El estimado
   * del mes en curso se calcula con un dryRun del motor (idéntico al cómputo
   * real, sin persistir); el histórico se lee de las filas ya computadas.
   * Self-scoped: el caller pasa su propio id.
   */
  async getOperatorSummary(
    db: TenantDb,
    operatorId: string,
  ): Promise<OperatorCommissionSummary> {
    const uRows = await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        rate: users.commissionRate,
      })
      .from(users)
      .where(eq(users.id, operatorId))
      .limit(1);
    const u = uRows[0];
    if (!u) throw new NotFoundException('Operador no encontrado.');

    const roleRows = await db
      .select({ code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(userRoles.userId, operatorId));
    const roleCodes = roleRows.map((r) => r.code);
    const role =
      (['socio', 'distribuidor', 'cajero'] as const).find((r) =>
        roleCodes.includes(r),
      ) ?? 'operador';
    // Cobra comisión solo si es operador dependiente (no independiente, LEY C5).
    const isOperatorRole = roleCodes.some((r) => OPERATOR_ROLES.has(r));
    const independentIds = await this.hierarchy.getIndependentSubtreeIds(db);
    const earnsCommission = isOperatorRole && !independentIds.has(operatorId);

    // Estimado del mes EN CURSO (dryRun, no persiste).
    const now = new Date();
    const curLabel = `${now.getUTCFullYear()}-${String(
      now.getUTCMonth() + 1,
    ).padStart(2, '0')}`;
    const curPeriod = NetworkCommissionsService.resolvePeriod(curLabel);
    const dry = await this.computePeriod(db, curPeriod, { dryRun: true });
    const entry = dry.perOperator.find((o) => o.operatorUserId === operatorId);
    const current = this.buildBreakdown(
      curLabel,
      entry?.subNetWin ?? '0',
      entry?.providerFee ?? '0',
      entry?.grossCommission ?? '0',
      entry?.carryoverIn ?? '0',
      entry?.payable ?? '0',
      u.rate,
    );

    // Histórico: períodos anteriores ya computados (persistidos).
    const histRows = await db
      .select()
      .from(commissionNetworkPeriods)
      .where(
        and(
          eq(commissionNetworkPeriods.operatorUserId, operatorId),
          lt(commissionNetworkPeriods.periodStart, curPeriod.periodStart),
        ),
      )
      .orderBy(desc(commissionNetworkPeriods.periodStart))
      .limit(12);
    const history: CommissionBreakdown[] = histRows.map((r) => {
      const label = `${r.periodStart.getUTCFullYear()}-${String(
        r.periodStart.getUTCMonth() + 1,
      ).padStart(2, '0')}`;
      return {
        ...this.buildBreakdown(
          label,
          r.subNetWin,
          r.providerFee,
          r.grossCommission,
          r.carryoverIn,
          r.payable,
          r.rateSnapshot,
        ),
        status: r.status,
        paidAt: r.paidAt ? r.paidAt.toISOString() : null,
      };
    });

    return {
      operator: {
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        role,
        rate: u.rate,
      },
      earnsCommission,
      current,
      history,
    };
  }

  /**
   * Tablero de deudas/pagos del admin: agrega por operador cuánto se le debe
   * (Σ payable accrued) y cuánto se le pagó (Σ payable paid), a lo largo de
   * TODOS los períodos. Devuelve también los rowIds pendientes para liquidar.
   */
  async getPayables(
    db: TenantDb,
    scopeUserIds?: string[],
  ): Promise<PayableRow[]> {
    const conds = [ne(commissionNetworkPeriods.status, 'void')];
    if (scopeUserIds) {
      conds.push(inArray(commissionNetworkPeriods.operatorUserId, scopeUserIds));
    }
    const rows = await db
      .select({
        id: commissionNetworkPeriods.id,
        operatorUserId: commissionNetworkPeriods.operatorUserId,
        status: commissionNetworkPeriods.status,
        payable: commissionNetworkPeriods.payable,
        username: users.username,
        displayName: users.displayName,
      })
      .from(commissionNetworkPeriods)
      .innerJoin(users, eq(users.id, commissionNetworkPeriods.operatorUserId))
      .where(and(...conds));

    const map = new Map<
      string,
      {
        operatorUserId: string;
        username: string | null;
        displayName: string | null;
        pending: bigint;
        paid: bigint;
        pendingCount: number;
        pendingRowIds: string[];
      }
    >();
    for (const r of rows) {
      const e = map.get(r.operatorUserId) ?? {
        operatorUserId: r.operatorUserId,
        username: r.username,
        displayName: r.displayName,
        pending: 0n,
        paid: 0n,
        pendingCount: 0,
        pendingRowIds: [],
      };
      if (r.status === 'accrued') {
        e.pending += toCents(r.payable);
        e.pendingCount++;
        e.pendingRowIds.push(r.id);
      } else if (r.status === 'paid') {
        e.paid += toCents(r.payable);
      }
      map.set(r.operatorUserId, e);
    }
    return [...map.values()]
      .map((e) => ({
        operatorUserId: e.operatorUserId,
        username: e.username,
        displayName: e.displayName,
        pending: fromCents(e.pending),
        paid: fromCents(e.paid),
        pendingCount: e.pendingCount,
        pendingRowIds: e.pendingRowIds,
      }))
      .sort((a, b) => Number(b.pending) - Number(a.pending));
  }

  /** Arma el desglose (LEY C6) a partir de los montos crudos. */
  private buildBreakdown(
    period: string,
    netWin: string,
    providerFee: string,
    gross: string,
    carryoverIn: string,
    payable: string,
    rate: string,
  ): CommissionBreakdown {
    const baseC = toCents(netWin) - toCents(providerFee);
    const rateBp = toCents(rate);
    const ownShareC = divRoundCents(baseC * rateBp, 10000n);
    const childrenC = ownShareC - toCents(gross);
    return {
      period,
      netWin,
      providerFee,
      base: fromCents(baseC),
      rate,
      ownShare: fromCents(ownShareC),
      childrenDeduction: fromCents(childrenC),
      gross,
      carryoverIn,
      payable,
    };
  }

  /**
   * Liquida (paga) comisiones accrued de SOCIOS — C3. Cada fila se paga atómica
   * e independientemente (una falla no tumba las demás). SIEMPRE en plata real
   * (cash): la Casa QUEMA el equivalente en fichas (la plata sale por fuera;
   * mantiene 1 ficha = 1 peso). El socio dependiente NO maneja fichas (docs/20),
   * por eso no existe el método "fichas". Guarda `settlementReference`.
   * Marca la fila 'paid' + wallet_tx_id + fecha/quién, bajo FOR UPDATE de la
   * fila (cierra la carrera de settles concurrentes de la misma comisión).
   *
   * F1: el monto liquidado es `final_commission = MAX(0, payable −
   * deducciones)`. Idempotente: solo toca filas 'accrued' con
   * final_commission>0; el wallet tx tiene idempotency key por fila.
   * Filas con final=0 (ej. socio dep con sueldos > gross) NO se pagan pero
   * pueden marcarse como 'paid' para cerrar el ciclo — MVP: las salteamos y
   * quedan 'accrued' hasta que un endpoint de "cancelar/anular" las mueva.
   */
  async settlePeriods(
    db: TenantDb,
    params: {
      rowIds?: string[];
      periodStart?: Date;
      reference?: string | null;
      actorUserId: string;
    },
  ): Promise<NetworkSettleResult> {
    const houseUser = await this.house.getHouseUser(db);
    if (!houseUser) throw new HouseNotProvisionedError();

    if (!params.rowIds?.length && !params.periodStart) {
      return { settled: 0, failed: 0, totalPaid: '0.00', results: [] };
    }
    // Filtros se INTERSECTAN (si vienen ambos): no mezcla períodos en silencio.
    const conds = [eq(commissionNetworkPeriods.status, 'accrued')];
    if (params.rowIds && params.rowIds.length > 0) {
      conds.push(inArray(commissionNetworkPeriods.id, params.rowIds));
    }
    if (params.periodStart) {
      conds.push(eq(commissionNetworkPeriods.periodStart, params.periodStart));
    }

    const rows = await db
      .select({
        id: commissionNetworkPeriods.id,
        operatorUserId: commissionNetworkPeriods.operatorUserId,
        payable: commissionNetworkPeriods.payable,
        finalCommission: commissionNetworkPeriods.finalCommission,
      })
      .from(commissionNetworkPeriods)
      .where(and(...conds));

    let settled = 0;
    let failed = 0;
    let totalPaidCents = 0n;
    const results: NetworkSettleResult['results'] = [];

    for (const row of rows) {
      // F1: pagamos `final_commission`, no el `payable` bruto. Si es 0, no hay
      // qué pagar (sueldos/costos consumieron toda la comisión).
      const amountToPay = row.finalCommission;
      if (toCents(amountToPay) <= 0n) continue; // nada que pagar

      try {
        const didPay = await db.transaction(async (tx) => {
          const txDb = tx as unknown as TenantDb; // savepoint anidado

          // Candado + re-chequeo de estado DENTRO de la tx: bloquea la fila con
          // FOR UPDATE y valida que siga 'accrued'. Cierra la carrera de dos
          // settles concurrentes de la MISMA fila (el segundo la ve 'paid' y la
          // saltea, en vez de pagar de nuevo).
          const locked = await tx
            .select({ status: commissionNetworkPeriods.status })
            .from(commissionNetworkPeriods)
            .where(eq(commissionNetworkPeriods.id, row.id))
            .for('update')
            .limit(1);
          if (!locked[0] || locked[0].status !== 'accrued') {
            return false; // ya liquidada por otro request (o ya no existe)
          }

          // La comisión al socio se paga SIEMPRE en plata real (cash): la Casa
          // QUEMA el equivalente en fichas y el socio cobra por fuera. El socio
          // dependiente NO maneja fichas (docs/20). Idempotente por la key
          // `commission_burn:<rowId>`.
          const burn = await this.wallet.houseBurn(txDb, {
            houseUserId: houseUser.id,
            amount: amountToPay,
            referenceId: row.id,
            idempotencyKey: `commission_burn:${row.id}`,
            actorUserId: params.actorUserId,
            reason: `Liquidación comisión por red ${row.id} en plata real (quema)`,
          });

          await tx
            .update(commissionNetworkPeriods)
            .set({
              status: 'paid',
              walletTxId: burn.id,
              settlementMethod: 'cash',
              settlementReference: params.reference ?? null,
              paidAt: new Date(),
              settledByUserId: params.actorUserId,
            })
            .where(eq(commissionNetworkPeriods.id, row.id));
          return true;
        });

        if (didPay) {
          settled++;
          totalPaidCents += toCents(amountToPay);
          results.push({
            id: row.id,
            operatorUserId: row.operatorUserId,
            amount: amountToPay,
            ok: true,
          });
        }
        // Si !didPay: la fila ya estaba liquidada (carrera) — se saltea.
      } catch (err) {
        failed++;
        results.push({
          id: row.id,
          operatorUserId: row.operatorUserId,
          amount: amountToPay,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      settled,
      failed,
      totalPaid: fromCents(totalPaidCents),
      results,
    };
  }

  /**
   * Lee resultados de período(s). Si `scopeUserIds` está, filtra a esos
   * operadores (downstream del actor). `periodStart` opcional filtra un mes.
   */
  async listPeriods(
    db: TenantDb,
    filters: { periodStart?: Date; scopeUserIds?: string[] } = {},
  ): Promise<
    Array<{
      operatorUserId: string;
      operatorUsername: string | null;
      periodStart: Date;
      periodEnd: Date;
      subNetWin: string;
      providerFee: string;
      grossCommission: string;
      carryoverIn: string;
      carryoverOut: string;
      payable: string;
      deductionsSalaries: string;
      deductionsBankCost: string;
      deductionsPlatformCost: string;
      finalCommission: string;
      rateSnapshot: string;
      status: string;
    }>
  > {
    const conds = [];
    if (filters.periodStart) {
      conds.push(eq(commissionNetworkPeriods.periodStart, filters.periodStart));
    }
    if (filters.scopeUserIds) {
      if (filters.scopeUserIds.length === 0) return [];
      conds.push(
        inArray(
          commissionNetworkPeriods.operatorUserId,
          filters.scopeUserIds,
        ),
      );
    }

    const rows = await db
      .select({
        operatorUserId: commissionNetworkPeriods.operatorUserId,
        operatorUsername: users.username,
        periodStart: commissionNetworkPeriods.periodStart,
        periodEnd: commissionNetworkPeriods.periodEnd,
        subNetWin: commissionNetworkPeriods.subNetWin,
        providerFee: commissionNetworkPeriods.providerFee,
        grossCommission: commissionNetworkPeriods.grossCommission,
        carryoverIn: commissionNetworkPeriods.carryoverIn,
        carryoverOut: commissionNetworkPeriods.carryoverOut,
        payable: commissionNetworkPeriods.payable,
        deductionsSalaries: commissionNetworkPeriods.deductionsSalaries,
        deductionsBankCost: commissionNetworkPeriods.deductionsBankCost,
        deductionsPlatformCost: commissionNetworkPeriods.deductionsPlatformCost,
        finalCommission: commissionNetworkPeriods.finalCommission,
        rateSnapshot: commissionNetworkPeriods.rateSnapshot,
        status: commissionNetworkPeriods.status,
      })
      .from(commissionNetworkPeriods)
      .leftJoin(users, eq(users.id, commissionNetworkPeriods.operatorUserId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(commissionNetworkPeriods.periodStart);

    return rows;
  }

  /**
   * Lista los SOCIOS con su % configurado (para el panel del admin: fijar la
   * comisión de cada socio). Excluye cuentas de sistema; marca independientes
   * (que no generan comisión).
   */
  async listSocioRates(db: TenantDb): Promise<
    Array<{
      id: string;
      username: string;
      displayName: string | null;
      commissionRate: string;
      isIndependent: boolean;
    }>
  > {
    return db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        commissionRate: users.commissionRate,
        isIndependent: users.isIndependentBranch,
      })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(roles.code, 'socio'), eq(users.isSystem, false)))
      .orderBy(users.username);
  }

  /**
   * Fase 4 — Delegación de tasas nivel por nivel (LEY C2).
   * Lista los HIJOS DIRECTOS operadores (socio/distri/cajero) del actor con su
   * tasa actual + los topes para editarla:
   *   - `ownRate`  = tasa propia del actor → TECHO de cada hijo (rate ≤ ownRate).
   *   - `maxChildRate` (por hijo) = mayor tasa entre los hijos operadores de ESE
   *     hijo → PISO (rate ≥ maxChildRate; no cobrar menos de lo que ya paga).
   * Self-scoped: siempre el actor logueado (no cruza redes, P1).
   */
  async listChildRates(
    db: TenantDb,
    actorId: string,
  ): Promise<{
    ownRate: string;
    children: Array<{
      id: string;
      username: string;
      displayName: string | null;
      role: string;
      commissionRate: string;
      maxChildRate: string;
    }>;
  }> {
    const actorRows = await db
      .select({ rate: users.commissionRate })
      .from(users)
      .where(eq(users.id, actorId))
      .limit(1);
    // El admin fija a sus socios con tope 100 (mismo criterio que setNetworkRate);
    // los operadores dependientes tienen como tope su propia tasa.
    const adminRow = await db
      .select({ code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(userRoles.userId, actorId), eq(roles.code, 'admin_tenant')))
      .limit(1);
    const ownRate = adminRow.length > 0 ? '100.00' : (actorRows[0]?.rate ?? '0.00');

    const operatorRoles = ['socio', 'distribuidor', 'cajero'];
    const childRows = await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        role: roles.code,
        commissionRate: users.commissionRate,
      })
      .from(userHierarchy)
      .innerJoin(users, eq(users.id, userHierarchy.userId))
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(
        and(
          eq(userHierarchy.parentUserId, actorId),
          isNull(userHierarchy.until),
          inArray(roles.code, operatorRoles),
          eq(users.isSystem, false),
        ),
      )
      .orderBy(users.username);

    if (childRows.length === 0) return { ownRate, children: [] };

    // Piso por hijo = mayor tasa entre SUS hijos operadores activos.
    const childIds = childRows.map((c) => c.id);
    const grandRows = await db
      .select({
        parentId: userHierarchy.parentUserId,
        rate: users.commissionRate,
      })
      .from(userHierarchy)
      .innerJoin(users, eq(users.id, userHierarchy.userId))
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(
        and(
          inArray(userHierarchy.parentUserId, childIds),
          isNull(userHierarchy.until),
          inArray(roles.code, operatorRoles),
          eq(users.isSystem, false),
        ),
      );
    const floor = new Map<string, number>();
    for (const g of grandRows) {
      if (!g.parentId) continue;
      floor.set(g.parentId, Math.max(floor.get(g.parentId) ?? 0, Number(g.rate)));
    }

    return {
      ownRate,
      children: childRows.map((c) => ({
        id: c.id,
        username: c.username,
        displayName: c.displayName,
        role: c.role,
        commissionRate: c.commissionRate,
        maxChildRate: (floor.get(c.id) ?? 0).toFixed(2),
      })),
    };
  }

  /**
   * Overview agrupado por red para el panel del admin reorganizado.
   * Read-only: compone el árbol de operadores + las filas de período + los
   * payables YA persistidos. NO recalcula fee ni toca game_rounds.
   *
   * Redes: la "Red de la Casa" (distris/cajeros directos del admin + su subtree)
   * primero, luego una por cada socio dependiente. Los independientes se listan
   * aparte (no cobran comisión, LEY C5). Cada operador trae su tasa + resultado
   * del período + `editableByAdmin` (true solo si su padre es el admin: C2).
   */
  async getNetworkOverview(
    db: TenantDb,
    period: { periodStart: Date; periodEnd: Date },
  ): Promise<NetworkOverviewResult> {
    const ROLE_PRIORITY = ['socio', 'distribuidor', 'cajero'];
    const periodLabel = `${period.periodStart.getUTCFullYear()}-${String(
      period.periodStart.getUTCMonth() + 1,
    ).padStart(2, '0')}`;
    const base: NetworkOverviewResult = {
      period: periodLabel,
      periodStart: period.periodStart.toISOString(),
      periodEnd: period.periodEnd.toISOString(),
      periodComputed: false,
      networks: [],
      independents: [],
    };

    const adminId = await this.hierarchy.getPrimaryAdminUserId(db);
    if (!adminId) return base;

    const { nodes } = await this.hierarchy.getFullTree(db);
    const periodRows = await this.listPeriods(db, {
      periodStart: period.periodStart,
    });
    const payables = await this.getPayables(db);
    const independentIds = await this.hierarchy.getIndependentSubtreeIds(db);

    const byOperator = new Map(periodRows.map((r) => [r.operatorUserId, r]));
    const pendingByOperator = new Map(
      payables.map((p) => [p.operatorUserId, p.pendingRowIds]),
    );

    type TreeNode = (typeof nodes)[number];
    const childrenOf = new Map<string, TreeNode[]>();
    for (const n of nodes) {
      if (!n.parentUserId) continue;
      const list = childrenOf.get(n.parentUserId) ?? [];
      list.push(n);
      childrenOf.set(n.parentUserId, list);
    }

    const codesOf = (n: TreeNode) => new Set(n.roles.map((r) => r.code));
    const isOperator = (n: TreeNode) =>
      !n.isSystem && ROLE_PRIORITY.some((c) => codesOf(n).has(c));
    const roleOf = (n: TreeNode) =>
      ROLE_PRIORITY.find((c) => codesOf(n).has(c)) ?? 'operador';
    const isSocio = (n: TreeNode) => codesOf(n).has('socio');

    // Tasas de todos los operadores (getFullTree no trae commission_rate).
    const operatorIds = nodes.filter(isOperator).map((n) => n.id);
    const rateRows = operatorIds.length
      ? await db
          .select({ id: users.id, rate: users.commissionRate })
          .from(users)
          .where(inArray(users.id, operatorIds))
      : [];
    const rateById = new Map(rateRows.map((r) => [r.id, r.rate]));

    // DFS desde los tops de una red, podando independientes. Todos los nodos
    // recolectados son operadores (solo descendemos por hijos operadores).
    const collect = (tops: TreeNode[]): NetworkOverviewOperator[] => {
      const out: NetworkOverviewOperator[] = [];
      const walk = (n: TreeNode, depth: number) => {
        if (independentIds.has(n.id)) return;
        const row = byOperator.get(n.id);
        out.push({
          id: n.id,
          username: n.username,
          displayName: n.displayName,
          role: roleOf(n),
          depth,
          parentId: n.parentUserId,
          rate: rateById.get(n.id) ?? '0.00',
          editableByAdmin: n.parentUserId === adminId,
          subNetWin: row?.subNetWin ?? '0.00',
          grossCommission: row?.grossCommission ?? '0.00',
          payable: row?.payable ?? '0.00',
          finalCommission: row?.finalCommission ?? '0.00',
          status: row?.status ?? 'none',
          pendingRowIds: pendingByOperator.get(n.id) ?? [],
        });
        for (const c of childrenOf.get(n.id) ?? []) {
          if (isOperator(c)) walk(c, depth + 1);
        }
      };
      for (const t of tops) walk(t, 0);
      return out;
    };

    // P&L de una red: puro de columnas persistidas. netWin/fee solo de los tops
    // (subárboles disjuntos → no doble-contar); comisiones de TODOS.
    const pnlOf = (
      operators: NetworkOverviewOperator[],
      tops: TreeNode[],
    ): NetworkOverviewPnl => {
      let commissions = 0n;
      for (const op of operators) commissions += toCents(op.grossCommission);
      let netWin = 0n;
      let providerFee = 0n;
      for (const t of tops) {
        const row = byOperator.get(t.id);
        netWin += toCents(row?.subNetWin ?? '0');
        providerFee += toCents(row?.providerFee ?? '0');
      }
      const houseKeeps = netWin - providerFee - commissions;
      return {
        netWin: fromCents(netWin),
        providerFee: fromCents(providerFee),
        commissions: fromCents(commissions),
        houseKeeps: fromCents(houseKeeps),
      };
    };

    const directChildren = (childrenOf.get(adminId) ?? []).filter(isOperator);
    const houseTops: TreeNode[] = [];
    const socioNetworks: NetworkOverviewNetwork[] = [];
    const independents: NetworkOverviewIndependent[] = [];

    for (const c of directChildren) {
      if (independentIds.has(c.id)) {
        independents.push({
          id: c.id,
          username: c.username,
          displayName: c.displayName,
          role: roleOf(c),
        });
        continue;
      }
      if (isSocio(c)) {
        const operators = collect([c]);
        socioNetworks.push({
          kind: 'socio',
          rootId: c.id,
          label: c.displayName ?? c.username,
          operators,
          pnl: pnlOf(operators, [c]),
        });
      } else {
        houseTops.push(c);
      }
    }
    socioNetworks.sort((a, b) => a.label.localeCompare(b.label));

    const networks: NetworkOverviewNetwork[] = [];
    if (houseTops.length) {
      const operators = collect(houseTops);
      networks.push({
        kind: 'house',
        rootId: null,
        label: 'Red de la Casa',
        operators,
        pnl: pnlOf(operators, houseTops),
      });
    }
    networks.push(...socioNetworks);

    return {
      ...base,
      periodComputed: periodRows.length > 0,
      networks,
      independents,
    };
  }
}
