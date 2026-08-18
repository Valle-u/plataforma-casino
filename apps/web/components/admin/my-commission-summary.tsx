'use client';

import { TrendingUp } from 'lucide-react';
import { type OperatorCommissionSummary } from '@/lib/hooks/use-network-commissions';
import { cn } from '@/lib/cn';

function fmt(x: string): string {
  const n = Number(x);
  if (!Number.isFinite(n)) return x;
  return n.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const ROLE_LABEL: Record<string, string> = {
  socio: 'Socio',
  distribuidor: 'Distribuidor',
  cajero: 'Cajero',
  operador: 'Operador',
};

/**
 * Comisión del mes en curso: línea de contexto (rol + tasa) + estimado con
 * desglose (LEY C6). Pensado para ir dentro de una card ("Mi comisión del mes").
 */
export function MyCommissionCurrent({
  summary,
}: {
  summary: OperatorCommissionSummary;
}) {
  const { operator, current: b } = summary;
  const feePct =
    Number(b.netWin) > 0 ? (Number(b.providerFee) / Number(b.netWin)) * 100 : 0;
  const hasChildrenDed = Number(b.childrenDeduction) !== 0;
  const hasDebt = Number(b.carryoverIn) !== 0;
  const noDeductions = !hasChildrenDed && !hasDebt;
  // Deuda > comisión ⇒ queda en 0 y el resto se arrastra.
  const floored =
    Number(b.gross) + Number(b.carryoverIn) < 0 && Number(b.payable) === 0;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-[var(--color-fg-muted)]">
        {ROLE_LABEL[operator.role] ?? operator.role} · tu tasa es{' '}
        <span className="font-semibold text-[var(--color-fg)]">
          {operator.rate}%
        </span>{' '}
        sobre el NetWin de tu red.{' '}
        <span className="text-[var(--color-fg-subtle)]">
          Estimado · {b.period} en curso.
        </span>
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_1fr] gap-5">
        {/* Columna izquierda — cómo se forma la comisión bruta */}
        <div className="flex flex-col gap-1.5">
          <BlockTitle>
            <TrendingUp className="size-3 text-[var(--color-accent-text)]" />
            Cómo se forma tu comisión
          </BlockTitle>
          <div className="flex flex-col">
            <Line label="NetWin de tu red" value={fmt(b.netWin)} />
            <Line
              label={`Costo del proveedor (${feePct.toLocaleString('es-AR', { maximumFractionDigits: 1 })}%)`}
              value={fmt(b.providerFee)}
              sign="−"
            />
            <Line label="Base de comisión" value={fmt(b.base)} dim />
            <Line
              label={`Tu comisión bruta (${operator.rate}% de la base)`}
              value={fmt(b.ownShare)}
              emphasis="result"
            />
          </div>
        </div>

        {/* Columna derecha — qué se resta + a cobrar */}
        <div className="flex flex-col gap-1.5">
          <BlockTitle>Qué se le resta</BlockTitle>
          <div className="flex flex-col">
            {noDeductions ? (
              <p className="text-[12px] text-[var(--color-success)] py-1.5">
                Sin descuentos este mes — cobrás tu comisión bruta completa.
              </p>
            ) : (
              <>
                {hasChildrenDed && (
                  <Line
                    label="Lo que cobran tus operadores"
                    value={fmt(b.childrenDeduction)}
                    sign="−"
                  />
                )}
                {hasDebt && (
                  <Line
                    label="Deuda arrastrada del mes anterior"
                    value={fmt(Math.abs(Number(b.carryoverIn)).toFixed(2))}
                    sign="−"
                  />
                )}
              </>
            )}
          </div>

          {/* A cobrar — bloque destacado en color de marca */}
          <div className="mt-auto rounded-[var(--radius)] border border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)] p-4 flex items-end justify-between gap-3">
            <div className="flex flex-col gap-1 min-w-0">
              <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-accent-text)] font-semibold">
                A cobrar este mes
              </span>
              <span className="text-[11px] text-[var(--color-fg-muted)] leading-snug">
                Se paga en efectivo o transferencia, por fuera de las fichas.
              </span>
            </div>
            <span className="font-display text-[28px] leading-none tabular-nums text-[var(--color-accent-text)] whitespace-nowrap">
              {fmt(b.payable)}
            </span>
          </div>
        </div>
      </div>

      {floored && (
        <p className="text-[11px] text-[var(--color-warning)]">
          La deuda superó tu comisión: este mes cobrás 0 y el resto se arrastra
          al mes que viene.
        </p>
      )}
      <p className="text-[11px] text-[var(--color-fg-subtle)]">
        El mes todavía no cerró — el estimado puede cambiar hasta fin de mes.
      </p>
    </div>
  );
}

/** Histórico de comisiones (meses anteriores). Null si no hay histórico. */
export function MyCommissionHistory({
  summary,
}: {
  summary: OperatorCommissionSummary;
}) {
  const { history } = summary;
  if (history.length === 0) {
    return (
      <p className="text-[12px] text-[var(--color-fg-subtle)]">
        Todavía no hay meses cerrados. Cuando el admin compute un período previo,
        aparecerá acá.
      </p>
    );
  }
  return (
    <div className="border border-[var(--color-border)] rounded-[var(--radius)] overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)]">
            <Th>Período</Th>
            <Th className="text-right">NetWin red</Th>
            <Th className="text-right">Comisión</Th>
            <Th className="text-right">A cobrar</Th>
            <Th>Estado</Th>
          </tr>
        </thead>
        <tbody>
          {history.map((h) => (
            <tr
              key={h.period}
              className="border-b border-[var(--color-border)] last:border-0"
            >
              <td className="p-2.5 font-mono">{h.period}</td>
              <td className="p-2.5 text-right tabular-nums text-[var(--color-fg-muted)]">
                {fmt(h.netWin)}
              </td>
              <td className="p-2.5 text-right tabular-nums">{fmt(h.gross)}</td>
              <td className="p-2.5 text-right tabular-nums font-medium">
                {fmt(h.payable)}
              </td>
              <td className="p-2.5">
                <StatusBadge status={h.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BlockTitle({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-semibold mb-1">
      {children}
    </span>
  );
}

function Line({
  label,
  value,
  sign,
  dim,
  emphasis,
}: {
  label: string;
  value: string;
  sign?: '−';
  dim?: boolean;
  /** 'result' = cierre del bloque (comisión bruta). */
  emphasis?: 'result';
}) {
  const isResult = emphasis === 'result';
  return (
    <div className="flex items-center justify-between gap-3 py-[11px] border-b border-[var(--color-border)] last:border-b-0">
      <span
        className={
          isResult
            ? 'text-[12.5px] font-semibold text-[var(--color-fg)]'
            : `text-[12.5px] ${dim ? 'text-[var(--color-fg-subtle)]' : 'text-[var(--color-fg-muted)]'}`
        }
      >
        {label}
      </span>
      <span
        className={cn(
          'font-mono tabular-nums text-[13px] shrink-0',
          sign
            ? 'text-[var(--color-danger)]'
            : isResult
              ? 'text-[var(--color-fg)] font-semibold'
              : 'text-[var(--color-fg)]',
        )}
      >
        {sign ?? ''}
        {value}
      </span>
    </div>
  );
}

function Th({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`p-2.5 text-left text-[11px] uppercase tracking-[0.06em] font-medium text-[var(--color-fg-muted)] ${className}`}
    >
      {children}
    </th>
  );
}

function StatusBadge({ status }: { status?: 'accrued' | 'paid' | 'void' }) {
  const map = {
    paid: { label: 'Pagado', c: 'var(--color-success)' },
    accrued: { label: 'Por pagar', c: 'var(--color-warning)' },
    void: { label: 'Anulado', c: 'var(--color-fg-muted)' },
  };
  const s = map[status ?? 'accrued'];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
      style={{
        color: s.c,
        backgroundColor: `color-mix(in srgb, ${s.c} 12%, transparent)`,
      }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: s.c }} />
      {s.label}
    </span>
  );
}
