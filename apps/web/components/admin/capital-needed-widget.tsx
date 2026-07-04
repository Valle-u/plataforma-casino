/**
 * CapitalNeededWidget — proyección de capital necesario para el bankroll.
 *
 * Consume `GET /tenant/house/capital-needed?days=N` con selector de ventana
 * (7 / 30 / 90 días). Muestra:
 *
 *   - Retiros del período (fichas salidas via retiros aprobados).
 *   - Depósitos del período (fichas ingresadas via depósitos).
 *   - Net outflow (retiros − depósitos).
 *   - Balance actual del bankroll.
 *   - **Sugerido a inyectar** (destacado): cuánto capital fresco hace falta
 *      para volver a stock sano manteniendo este ritmo de drenaje.
 *
 * Props:
 *   - `operatorUserId` — para socios indep (calcula su sub-red en lugar
 *      de la red admin).
 *   - `defaultDays` — ventana inicial. Default: 30.
 */

'use client';

import { ArrowDownToLine, ArrowUpToLine, TrendingDown, Wallet } from 'lucide-react';
import { useState } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useHouseCapitalNeeded } from '@/lib/hooks/use-house';
import { cn } from '@/lib/cn';

function fmt(x: string | number | null | undefined): string {
  if (x === null || x === undefined) return '—';
  const n = typeof x === 'number' ? x : Number(x);
  if (!Number.isFinite(n)) return String(x);
  return n.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

type WindowDays = 7 | 30 | 90;

export interface CapitalNeededWidgetProps {
  operatorUserId?: string | null;
  defaultDays?: WindowDays;
  /** Label del bloque (default: "Capital necesario"). */
  title?: string;
}

export function CapitalNeededWidget({
  operatorUserId,
  defaultDays = 30,
  title = 'Capital necesario',
}: CapitalNeededWidgetProps) {
  const [days, setDays] = useState<WindowDays>(defaultDays);
  const query = useHouseCapitalNeeded(days, operatorUserId);

  const suggested = query.data?.suggestedInject ?? '0';
  const netNum = Number(query.data?.netOutflow ?? '0');
  const suggestedNum = Number(suggested);
  const noAction = suggestedNum <= 0;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium flex items-center gap-2">
          <TrendingDown className="size-3" />
          {title} · últimos {days} días
        </span>
        <div className="flex items-center gap-px bg-[var(--color-border)] border border-[var(--color-border)] self-start">
          {([7, 30, 90] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={cn(
                'px-3 h-7 text-[11px] uppercase tracking-[0.08em] font-medium',
                'transition-colors duration-150',
                days === d
                  ? 'bg-[var(--color-bg)] text-[var(--color-fg)] border-b-2 border-b-[var(--color-accent)]'
                  : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]',
              )}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {query.isLoading ? (
        <Skeleton className="h-32" />
      ) : query.isError || !query.data ? (
        <EmptyState
          hint="data"
          label="No se pudo cargar la proyección de capital."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-px bg-[var(--color-border)] border border-[var(--color-border)]">
          <Tile
            icon={<ArrowUpToLine className="size-3.5" />}
            label="Retiros"
            hint="Fichas salidas via withdrawals aprobados"
            value={fmt(query.data.totalWithdrawals)}
            tone="danger"
          />
          <Tile
            icon={<ArrowDownToLine className="size-3.5" />}
            label="Depósitos"
            hint="Fichas ingresadas via deposits aprobados"
            value={fmt(query.data.totalDeposits)}
            tone="success"
          />
          <Tile
            icon={<TrendingDown className="size-3.5" />}
            label="Drenaje neto"
            hint={
              netNum > 0
                ? `Salió más de lo que entró (${fmt(netNum)})`
                : 'Sin drenaje: entradas ≥ salidas'
            }
            value={fmt(query.data.netOutflow)}
            tone={netNum > 0 ? 'danger' : 'success'}
          />
          <Tile
            icon={<Wallet className="size-3.5" />}
            label="Sugerido inyectar"
            hint={
              noAction
                ? 'La caja aguanta, no hace falta reponer'
                : 'Para volver a stock sano en la próxima ventana'
            }
            value={fmt(suggested)}
            tone={noAction ? 'neutral' : 'accent'}
            emphasized
          />
        </div>
      )}
      <p className="text-[11px] text-[var(--color-fg-subtle)]">
        Modelo: cuánto capital fresco hace falta si el ritmo de retiros netos
        de los últimos {days} días se repite. Balance actual:{' '}
        <span className="font-mono text-[var(--color-fg)]">
          {fmt(query.data?.currentBalance)}
        </span>
        .
      </p>
    </section>
  );
}

function Tile({
  icon,
  label,
  hint,
  value,
  tone,
  emphasized,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  value: string;
  tone: 'neutral' | 'success' | 'danger' | 'accent';
  emphasized?: boolean;
}) {
  return (
    <div
      className={cn(
        'bg-[var(--color-bg-elevated)] p-3 flex flex-col gap-1',
        tone === 'success' && 'border-l-2 border-l-[var(--color-success)]',
        tone === 'danger' && 'border-l-2 border-l-[var(--color-danger)]',
        tone === 'accent' && 'border-l-2 border-l-[var(--color-accent)]',
      )}
    >
      <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] flex items-center gap-1.5">
        {icon}
        {label}
      </span>
      <span
        className={cn(
          'font-mono num leading-tight tabular-nums',
          emphasized ? 'text-[1.4rem]' : 'text-[1.1rem]',
          tone === 'accent' && 'text-[var(--color-accent-text)]',
          tone === 'danger' && 'text-[var(--color-danger)]',
          tone === 'success' && 'text-[var(--color-success)]',
          tone === 'neutral' && 'text-[var(--color-fg)]',
        )}
      >
        {value}
      </span>
      <span className="text-[10px] text-[var(--color-fg-subtle)] leading-tight">
        {hint}
      </span>
    </div>
  );
}
