/**
 * FinancialSummarySection — resumen ejecutivo de plata (Sprint post-56).
 *
 * Responde de un vistazo: cuánta plata real entró/salió, cuánto se le debe
 * a los game providers, y cuánto en comisiones pendientes por rol. Se usa en
 * DOS lugares — `/dashboard` y `/wallet-stats` (modo "Netwin por red") — con
 * el MISMO componente (no dos implementaciones) para que los números sean
 * garantizado-iguales entre ambas vistas: no hay forma de que diverjan
 * porque es literalmente el mismo fetch.
 *
 * Fuentes (ver panel "¿De dónde salen estos números?" dentro del componente):
 *   - Depósitos/retiros: GET /tenant/wallet-stats/scoped-audit?scope=platform
 *     (mismo endpoint que alimenta "Netwin por red").
 *   - Deuda a game providers: GET /tenant/commissions/network/house-pnl
 *     (mismo cálculo que el P&L de /network-commissions). Se computa EN VIVO
 *     desde `game_rounds` liquidadas — no depende de que el período de
 *     comisiones esté "computado".
 *   - Comisiones pendientes: GET /tenant/commissions/network/payables-by-role
 *     (mismos montos que el tablero de deudas de /network-commissions,
 *     agrupados por rol primario del operador).
 *
 * OJO — no es comparable con /game-stats: esa página cuenta por `placedAt`
 * e incluye rondas todavía en curso (`status='placed'`, excluye solo
 * `rolled_back`), mientras que acá (y en wallet-stats/comisiones) solo
 * cuentan rondas `status='settled'` por `settledAt`. Es una diferencia de
 * diseño documentada en `game-stats.service.ts`, no un bug — pero los
 * números de GGR/netwin de ambas páginas NO van a coincidir exactamente.
 *
 * Gating: el componente se auto-gatea por permisos (devuelve `null` si el
 * user no tiene nada que ver) — los callers lo pueden montar sin condición.
 */

'use client';

import { ArrowUpRight, Banknote, ChevronDown, Info } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { hasPermission, useAuth } from '@/lib/auth-context';
import { arStartOfCurrentMonthIso, arTodayDateStr } from '@/lib/format-date';
import {
  useHousePnl,
  usePayablesByRole,
  type PayablesByRoleEntry,
} from '@/lib/hooks/use-network-commissions';
import { useWalletStatsScopedAudit } from '@/lib/hooks/use-wallet-stats';

const ROLE_LABEL: Record<PayablesByRoleEntry['role'], string> = {
  socio: 'Socios',
  distribuidor: 'Distribuidores',
  cajero: 'Cajeros',
  otro: 'Otros',
};

const MONTH_LABEL_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/** 'YYYY-MM' actual (calendario AR), en la misma convención que usa el motor de comisiones. */
function currentPeriodLabel(): string {
  const [y, m] = arTodayDateStr().split('-');
  return `${y}-${m}`;
}

function periodLabelEs(period: string): string {
  const [y, m] = period.split('-');
  const idx = Number(m) - 1;
  return `${MONTH_LABEL_ES[idx] ?? m} ${y}`;
}

function fmtMoney(x: string | number | null | undefined): string {
  if (x === null || x === undefined) return '—';
  const n = Number(x);
  if (!Number.isFinite(n)) return String(x);
  return n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function FinancialSummarySection() {
  const { user } = useAuth();
  const canViewMoney = hasPermission(user, 'wallet_stats.view_any');
  const canViewCommissions = hasPermission(user, 'commissions.view_all');

  const period = useMemo(() => currentPeriodLabel(), []);
  // Mismo mes que `period`, pero como rango de fechas para el scoped-audit
  // de wallet-stats (que no entiende 'YYYY-MM').
  const range = useMemo(
    () => ({ dateFrom: arStartOfCurrentMonthIso(), dateTo: new Date().toISOString() }),
    [],
  );

  const [showInfo, setShowInfo] = useState(false);

  const audit = useWalletStatsScopedAudit({ scope: 'platform', ...range }, canViewMoney);
  const pnl = useHousePnl(period, canViewCommissions);
  const payables = usePayablesByRole(canViewCommissions);

  if (!canViewMoney && !canViewCommissions) return null;

  const loading =
    (canViewMoney && audit.isLoading) ||
    (canViewCommissions && (pnl.isLoading || payables.isLoading));
  const hasError =
    (canViewMoney && audit.isError) ||
    (canViewCommissions && (pnl.isError || payables.isError));

  const providerFeeTotal = pnl.data
    ? Number(pnl.data.dependent.providerFee) + Number(pnl.data.independent.providerFee)
    : null;

  return (
    <section className="flex flex-col gap-4 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
            <Banknote className="size-3.5 text-[var(--color-accent-text)]" />
            Resumen financiero · {periodLabelEs(period)}
          </span>
          <span className="text-[11px] text-[var(--color-fg-subtle)]">
            Plata real del mes en curso
            {canViewCommissions && ', deuda a proveedores de juego en vivo, y comisiones pendientes acumuladas (todos los períodos)'}.
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {hasError && (
            <Badge variant="danger" dot>
              Datos parciales
            </Badge>
          )}
          <button
            type="button"
            onClick={() => setShowInfo((v) => !v)}
            className="inline-flex items-center gap-1.5 px-2.5 h-7 text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] transition-colors"
          >
            <Info className="size-3" />
            ¿De dónde salen estos números?
            <ChevronDown
              className={`size-3 transition-transform ${showInfo ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
      </div>

      {showInfo && (
        <div className="flex flex-col gap-2.5 px-4 py-3 border border-[var(--color-border)] bg-[var(--color-bg)] border-l-2 border-l-[var(--color-accent)] text-[11px] text-[var(--color-fg-muted)] leading-snug">
          <FormulaLine
            label="Depósitos / Retiros / Neto"
            desc="Suma de wallet_transactions tipo deposit/withdrawal del mes en curso, toda la plataforma. Mismo endpoint que Estadísticas de pago → pestaña “Netwin por red” → Plata real."
          />
          <FormulaLine
            label="Deuda a game providers"
            desc="(Apostado − Ganado) de las rondas de juego LIQUIDADAS (status=settled) del mes, × el fee % de cada proveedor. Se calcula en vivo, no requiere que el período de comisiones esté “computado”. Mismo cálculo que Comisiones por red → Resultado de la Casa → “Costo del proveedor”."
          />
          <FormulaLine
            label="Comisiones pendientes"
            desc="Suma de comisiones ya calculadas pero no liquidadas (estado “accrued”), de TODOS los períodos históricos — no solo el mes en curso. Agrupadas por el rol principal de cada operador (prioridad socio > distribuidor > cajero). Mismos montos que el tablero de deudas de Comisiones por red, acá sumados por rol."
          />
          <p className="pt-1.5 border-t border-[var(--color-border)] text-[var(--color-fg-subtle)]">
            <strong className="text-[var(--color-fg-muted)]">No es comparable con “Stats de juego”</strong> (
            <Link href="/game-stats" className="underline decoration-dotted hover:text-[var(--color-fg)]">
              /game-stats
            </Link>
            ): esa página cuenta las apuestas por cuándo se hicieron (incluye juego todavía en curso, sin liquidar), mientras que este resumen y Estadísticas de pago/Comisiones cuentan solo lo ya liquidado. Son fuentes distintas a propósito, no un error.
          </p>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {Array.from({ length: canViewCommissions ? 5 : 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 bg-[var(--color-bg-subtle)]" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {canViewMoney && (
            <>
              <StatTile
                label="Depósitos (mes)"
                value={audit.data ? fmtMoney(audit.data.plata.depositos) : '—'}
                hint="plata que entró"
              />
              <StatTile
                label="Retiros (mes)"
                value={audit.data ? fmtMoney(audit.data.plata.retiros) : '—'}
                hint="plata que salió"
              />
              <StatTile
                label="Neto de caja"
                value={audit.data ? fmtMoney(audit.data.plata.neto) : '—'}
                hint="depósitos − retiros"
                variant={
                  audit.data && Number(audit.data.plata.neto) < 0 ? 'accent' : 'default'
                }
              />
            </>
          )}
          {canViewCommissions && (
            <>
              <StatTile
                label="Deuda a game providers"
                value={providerFeeTotal !== null ? fmtMoney(providerFeeTotal) : '—'}
                hint="netwin del mes × fee%"
              />
              <StatTile
                label="Comisiones pendientes"
                value={payables.data ? fmtMoney(payables.data.totalPending) : '—'}
                hint="acumulado, todo período"
                variant={
                  payables.data && Number(payables.data.totalPending) > 0
                    ? 'accent'
                    : 'default'
                }
              />
            </>
          )}
        </div>
      )}

      {!loading && canViewCommissions && !!payables.data?.byRole.length && (
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-[var(--color-border)]">
          <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
            Comisiones pendientes por rol
          </span>
          {payables.data.byRole.map((r) => (
            <span
              key={r.role}
              className="inline-flex items-center gap-1.5 px-2.5 h-7 text-[11px] bg-[var(--color-bg-subtle)] border border-[var(--color-border)]"
            >
              <span className="text-[var(--color-fg-muted)]">{ROLE_LABEL[r.role]}</span>
              <span className="font-mono text-[var(--color-fg)]">{fmtMoney(r.pending)}</span>
              <span className="text-[var(--color-fg-subtle)]">({r.operatorCount})</span>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
        <Link
          href="/wallet-stats"
          className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] transition-colors flex items-center gap-1"
        >
          Ver estadísticas de pago
          <ArrowUpRight className="size-3" />
        </Link>
        {canViewCommissions && (
          <Link
            href="/network-commissions"
            className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] transition-colors flex items-center gap-1"
          >
            Ver comisiones por red
            <ArrowUpRight className="size-3" />
          </Link>
        )}
      </div>
    </section>
  );
}

function FormulaLine({ label, desc }: { label: string; desc: string }) {
  return (
    <p>
      <strong className="text-[var(--color-fg)]">{label}:</strong> {desc}
    </p>
  );
}
