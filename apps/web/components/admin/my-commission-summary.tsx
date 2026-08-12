'use client';

import { Coins, TrendingUp } from 'lucide-react';
import {
  type CommissionBreakdown,
  type OperatorCommissionSummary,
} from '@/lib/hooks/use-network-commissions';

function fmt(x: string): string {
  const n = Number(x);
  if (!Number.isFinite(n)) return x;
  return n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const ROLE_LABEL: Record<string, string> = {
  socio: 'Socio',
  distribuidor: 'Distribuidor',
  cajero: 'Cajero',
  operador: 'Operador',
};

export function MyCommissionSummary({
  summary,
}: {
  summary: OperatorCommissionSummary;
}) {
  const { operator, current, history } = summary;
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
          <Coins className="size-3" />
          Mi comisión
        </span>
        <p className="text-sm text-[var(--color-fg-muted)]">
          {ROLE_LABEL[operator.role] ?? operator.role} · tu tasa es{' '}
          <span className="font-semibold text-[var(--color-fg)]">
            {operator.rate}%
          </span>{' '}
          sobre el NetWin de tu red.
        </p>
      </div>

      {/* Estimado del mes en curso */}
      <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold flex items-center gap-2">
            <TrendingUp className="size-4 text-[var(--color-accent-text)]" />
            Mes en curso ({current.period})
          </span>
          <span className="text-[10px] uppercase tracking-[0.1em] rounded-full px-2 py-0.5 border border-[var(--color-accent-border)] text-[var(--color-accent-text)]">
            Estimado
          </span>
        </div>
        <BreakdownRows b={current} rate={operator.rate} />
        <p className="text-[11px] text-[var(--color-fg-subtle)]">
          El mes todavía no cerró — el estimado puede cambiar hasta fin de mes.
        </p>
      </div>

      {/* Histórico */}
      {history.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium">
            Meses anteriores
          </span>
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
                    <td className="p-2.5 text-right tabular-nums">
                      {fmt(h.gross)}
                    </td>
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
        </div>
      )}
    </section>
  );
}

function BreakdownRows({ b, rate }: { b: CommissionBreakdown; rate: string }) {
  const rows: {
    label: string;
    value: string;
    sign?: '−';
    strong?: boolean;
    dim?: boolean;
  }[] = [
    { label: 'NetWin de tu red', value: fmt(b.netWin) },
    { label: 'Costo del proveedor', value: fmt(b.providerFee), sign: '−' },
    { label: 'Base de comisión', value: fmt(b.base), dim: true },
    { label: `Tu tasa (${rate}%) sobre la base`, value: fmt(b.ownShare) },
    {
      label: 'Lo que cobran tus operadores',
      value: fmt(b.childrenDeduction),
      sign: '−',
    },
    { label: 'Tu comisión del mes', value: fmt(b.gross) },
  ];
  if (Number(b.carryoverIn) !== 0) {
    rows.push({
      label: 'Deuda arrastrada del mes anterior',
      value: fmt(b.carryoverIn),
    });
  }
  rows.push({ label: 'A cobrar este mes', value: fmt(b.payable), strong: true });

  return (
    <div className="flex flex-col divide-y divide-[var(--color-border)]">
      {rows.map((r) => (
        <div
          key={r.label}
          className="flex items-center justify-between py-2"
          style={r.strong ? { borderTop: '1px solid var(--color-border)' } : undefined}
        >
          <span
            className={
              r.strong
                ? 'text-[13px] font-semibold'
                : `text-[13px] ${r.dim ? 'text-[var(--color-fg-subtle)]' : 'text-[var(--color-fg-muted)]'}`
            }
          >
            {r.label}
          </span>
          <span
            className="text-[14px] font-mono tabular-nums"
            style={{
              color: r.strong
                ? 'var(--color-success, #22c55e)'
                : r.sign
                  ? '#ef4444'
                  : 'var(--color-fg)',
            }}
          >
            {r.sign ?? ''}
            {r.value}
          </span>
        </div>
      ))}
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
