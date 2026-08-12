'use client';

import { TrendingUp } from 'lucide-react';
import { type OperatorCommissionSummary } from '@/lib/hooks/use-network-commissions';

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
    <div className="flex flex-col gap-3">
      <p className="text-sm text-[var(--color-fg-muted)]">
        {ROLE_LABEL[operator.role] ?? operator.role} · tu tasa es{' '}
        <span className="font-semibold text-[var(--color-fg)]">
          {operator.rate}%
        </span>{' '}
        sobre el NetWin de tu red.
      </p>

      <div className="bg-[var(--color-bg-subtle)] border border-[var(--color-border)] p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold flex items-center gap-2">
            <TrendingUp className="size-4 text-[var(--color-accent-text)]" />
            Mes en curso ({b.period})
          </span>
          <span className="text-[10px] uppercase tracking-[0.1em] rounded-full px-2 py-0.5 border border-[var(--color-accent-border)] text-[var(--color-accent-text)]">
            Estimado
          </span>
        </div>

        {/* Bloque 1 — cómo se forma la comisión bruta */}
        <div className="flex flex-col">
          <BlockTitle>Cómo se forma tu comisión</BlockTitle>
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

        {/* Bloque 2 — qué se le resta */}
        <div className="flex flex-col">
          <BlockTitle>Qué se le resta</BlockTitle>
          {noDeductions ? (
            <p className="text-[12px] text-[var(--color-success,#22c55e)] py-1.5">
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

        {/* Total */}
        <div className="border-t border-[var(--color-border)] pt-1">
          <Line
            label="A cobrar este mes"
            value={fmt(b.payable)}
            emphasis="total"
          />
        </div>

        {floored && (
          <p className="text-[11px] text-[#eab308]">
            La deuda superó tu comisión: este mes cobrás 0 y el resto se arrastra
            al mes que viene.
          </p>
        )}
        <p className="text-[11px] text-[var(--color-fg-subtle)]">
          El mes todavía no cerró — el estimado puede cambiar hasta fin de mes.
        </p>
      </div>
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
    <div className="border border-[var(--color-border)] overflow-x-auto">
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
    <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-medium mb-1">
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
  /** 'result' = cierre del bloque (comisión bruta); 'total' = a cobrar. */
  emphasis?: 'result' | 'total';
}) {
  const isTotal = emphasis === 'total';
  const isResult = emphasis === 'result';
  const color = isTotal
    ? 'var(--color-success, #22c55e)'
    : sign
      ? '#ef4444'
      : 'var(--color-fg)';
  return (
    <div className="flex items-center justify-between py-1.5">
      <span
        className={
          isTotal || isResult
            ? 'text-[13px] font-semibold'
            : `text-[13px] ${dim ? 'text-[var(--color-fg-subtle)]' : 'text-[var(--color-fg-muted)]'}`
        }
      >
        {label}
      </span>
      <span
        className="font-mono tabular-nums"
        style={{
          color,
          fontSize: isTotal ? '16px' : '14px',
          fontWeight: isTotal || isResult ? 600 : 400,
        }}
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
    paid: { label: 'Pagado', c: 'var(--color-success, #22c55e)' },
    accrued: { label: 'Pendiente', c: '#eab308' },
    void: { label: 'Anulado', c: 'var(--color-fg-muted)' },
  };
  const s = map[status ?? 'accrued'];
  return (
    <span
      className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium border"
      style={{ color: s.c, borderColor: s.c }}
    >
      {s.label}
    </span>
  );
}
