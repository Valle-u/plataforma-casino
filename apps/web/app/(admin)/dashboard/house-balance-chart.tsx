/**
 * HouseBalanceChart — gráfico de área del saldo de la Casa a 30 días.
 *
 * Vive en su propio módulo para poder cargarse con `next/dynamic` desde el
 * dashboard: recharts es pesado (~170 kB) y la landing del admin no debería
 * pagarlo en la primera carga. Se baja recién cuando el gráfico se renderiza.
 */

'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { BalanceHistoryPoint } from '@/lib/hooks/use-house';

function money(s: string | number | null | undefined): string {
  const n = Number(s ?? 0);
  if (Number.isNaN(n)) return '—';
  return '$' + n.toLocaleString('es-AR', { maximumFractionDigits: 0 });
}

function shortDate(d: string): string {
  const [, m, day] = d.split('-');
  return day && m ? `${day}/${m}` : d;
}

interface TooltipPayload {
  value: number;
  name?: string;
}
function MoneyTooltip({
  active,
  payload,
  label,
  labelFormatter,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string;
  labelFormatter?: (l: string) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2.5 py-1.5 text-[12px] shadow-lg">
      {label && (
        <div className="text-[var(--color-fg-subtle)] mb-0.5">
          {labelFormatter ? labelFormatter(label) : label}
        </div>
      )}
      <div className="font-display tabular-nums text-[var(--color-fg)]">
        {money(payload[0]!.value)}
      </div>
    </div>
  );
}

export default function HouseBalanceChart({
  data,
}: {
  data: BalanceHistoryPoint[];
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id="casaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 5" stroke="#232323" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={shortDate}
          tick={{ fontSize: 10, fill: 'var(--color-fg-subtle)' }}
          axisLine={false}
          tickLine={false}
          minTickGap={28}
        />
        <YAxis
          tick={{ fontSize: 10, fill: 'var(--color-fg-subtle)' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) =>
            v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : String(v)
          }
          width={44}
        />
        <Tooltip content={<MoneyTooltip labelFormatter={shortDate} />} />
        <Area
          type="monotone"
          dataKey="balance"
          stroke="var(--color-accent)"
          strokeWidth={2}
          fill="url(#casaFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
