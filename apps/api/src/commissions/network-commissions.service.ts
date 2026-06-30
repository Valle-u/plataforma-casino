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
 */

import { Injectable, Logger } from '@nestjs/common';
import { and, eq, gt, gte, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import {
  commissionNetworkPeriods,
  gameRounds,
  roles,
  userHierarchy,
  userRoles,
  users,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { HouseNotProvisionedError, HouseService } from '../house/house.service';
import { WalletService } from '../wallet/wallet.service';
import { ConservationViolationError } from './commissions.errors';

const OPERATOR_ROLES = new Set(['socio', 'distribuidor', 'cajero']);

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
  baseConsistency: {
    ok: boolean;
    nestedSocios: number;
  };
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

@Injectable()
export class NetworkCommissionsService {
  private readonly logger = new Logger(NetworkCommissionsService.name);

  constructor(
    private readonly wallet: WalletService,
    private readonly house: HouseService,
  ) {}

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
  ): Promise<NetworkPeriodComputeResult> {
    const { periodStart, periodEnd } = params;

    return db.transaction(async (tx) => {
      // Serializa corridas concurrentes del mismo período (cae al commit).
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
        })
        .from(users)
        .leftJoin(userRoles, eq(userRoles.userId, users.id))
        .leftJoin(roles, eq(roles.id, userRoles.roleId));

      const userMap = new Map<
        string,
        { rate: string; isIndependent: boolean; isSystem: boolean; roles: Set<string> }
      >();
      for (const r of userRows) {
        let u = userMap.get(r.id);
        if (!u) {
          u = {
            rate: r.commissionRate,
            isIndependent: r.isIndependent,
            isSystem: r.isSystem,
            roles: new Set<string>(),
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

      // ── gross por socio = su % × NetWin de TODA su red (el monto COMPLETO,
      //    para que el socio reparta hacia abajo por fuera). Saltea socios ya
      //    liquidados ('paid'): su resultado es final, no se recomputa. ────────
      const computed: Array<{ op: string; subOp: bigint; gross: bigint; rate: string }> =
        [];
      for (const s of socios) {
        if (paidSet.has(s)) continue;
        const u = userMap.get(s)!;
        const subOp = subNetWin(s);
        const gross = divRoundCents(toCents(u.rate) * subOp, 10000n);
        computed.push({ op: s, subOp, gross, rate: u.rate });
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
      const computedIds = new Set(computed.map((c) => c.op));
      for (const [opId, prevCarryOut] of carryoverMap) {
        if (prevCarryOut < 0n && !computedIds.has(opId) && !paidSet.has(opId)) {
          computed.push({
            op: opId,
            subOp: 0n,
            gross: 0n,
            rate: userMap.get(opId)?.rate ?? '0',
          });
        }
      }

      const actualGross = computed.reduce((s, c) => s + c.gross, 0n);

      // ── Persistir: limpiar filas NO-pagadas del período (idempotencia real,
      //    sin filas STALE de operadores que dejaron de emitir) + insertar. ───
      await tx
        .delete(commissionNetworkPeriods)
        .where(
          and(
            eq(commissionNetworkPeriods.periodStart, periodStart),
            ne(commissionNetworkPeriods.status, 'paid'),
          ),
        );

      let totalPayable = 0n;
      let sociosComputed = 0;
      for (const c of computed) {
        const carryIn = carryoverMap.get(c.op) ?? 0n;
        const newBal = carryIn + c.gross;
        const payable = newBal > 0n ? newBal : 0n;
        const carryOut = newBal > 0n ? 0n : newBal;

        // Nada que registrar: sin actividad, sin gross, sin carryover.
        if (c.gross === 0n && carryIn === 0n && c.subOp === 0n) continue;

        totalPayable += payable;
        sociosComputed++;

        await tx.insert(commissionNetworkPeriods).values({
          operatorUserId: c.op,
          periodStart,
          periodEnd,
          subNetWin: fromCents(c.subOp),
          grossCommission: fromCents(c.gross),
          carryoverIn: fromCents(carryIn),
          carryoverOut: fromCents(carryOut),
          payable: fromCents(payable),
          rateSnapshot: c.rate,
          status: 'accrued',
        });
      }

      return {
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        sociosComputed,
        totalPayable: fromCents(totalPayable),
        totalGross: fromCents(actualGross),
        totalNetWin: fromCents(totalNetWin),
        baseConsistency: {
          ok: true,
          nestedSocios: 0,
        },
      } satisfies NetworkPeriodComputeResult;
    });
  }

  /**
   * Liquida (paga) comisiones accrued de SOCIOS — C3. Cada fila se paga atómica
   * e independientemente (una falla no tumba las demás):
   *   - method 'chips': transfer Casa → socio (las fichas siguen en la plataforma).
   *   - method 'cash':  la Casa QUEMA el equivalente en fichas (la plata sale por
   *     fuera; mantiene 1 ficha = 1 peso). Guarda `settlementReference`.
   * Marca la fila 'paid' + wallet_tx_id + método/fecha/quién. Idempotente: solo
   * toca filas 'accrued' con payable>0; el wallet tx tiene idempotency key por fila.
   */
  async settlePeriods(
    db: TenantDb,
    params: {
      rowIds?: string[];
      periodStart?: Date;
      method: 'chips' | 'cash';
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
      })
      .from(commissionNetworkPeriods)
      .where(and(...conds));

    let settled = 0;
    let failed = 0;
    let totalPaidCents = 0n;
    const results: NetworkSettleResult['results'] = [];

    for (const row of rows) {
      if (toCents(row.payable) <= 0n) continue; // nada que pagar

      try {
        await db.transaction(async (tx) => {
          const txDb = tx as unknown as TenantDb; // savepoint anidado
          let walletTxId: string;
          if (params.method === 'chips') {
            const transfer = await this.wallet.housePayCommission(txDb, {
              houseUserId: houseUser.id,
              beneficiaryUserId: row.operatorUserId,
              amount: row.payable,
              payoutId: row.id,
              actorUserId: params.actorUserId,
            });
            walletTxId = transfer.targetTx.id;
          } else {
            const burn = await this.wallet.houseBurn(txDb, {
              houseUserId: houseUser.id,
              amount: row.payable,
              referenceId: row.id,
              idempotencyKey: `commission_burn:${row.id}`,
              actorUserId: params.actorUserId,
              reason: `Liquidación comisión por red ${row.id} en plata real (quema)`,
            });
            walletTxId = burn.id;
          }

          await tx
            .update(commissionNetworkPeriods)
            .set({
              status: 'paid',
              walletTxId,
              settlementMethod: params.method,
              settlementReference:
                params.method === 'cash' ? (params.reference ?? null) : null,
              paidAt: new Date(),
              settledByUserId: params.actorUserId,
            })
            .where(eq(commissionNetworkPeriods.id, row.id));
        });

        settled++;
        totalPaidCents += toCents(row.payable);
        results.push({
          id: row.id,
          operatorUserId: row.operatorUserId,
          amount: row.payable,
          ok: true,
        });
      } catch (err) {
        failed++;
        results.push({
          id: row.id,
          operatorUserId: row.operatorUserId,
          amount: row.payable,
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
      grossCommission: string;
      carryoverIn: string;
      carryoverOut: string;
      payable: string;
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
        grossCommission: commissionNetworkPeriods.grossCommission,
        carryoverIn: commissionNetworkPeriods.carryoverIn,
        carryoverOut: commissionNetworkPeriods.carryoverOut,
        payable: commissionNetworkPeriods.payable,
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
}
