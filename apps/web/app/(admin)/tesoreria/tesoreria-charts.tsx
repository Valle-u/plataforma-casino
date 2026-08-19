/**
 * Charts de Tesorería — se cargan con `next/dynamic` desde la página.
 *
 * recharts es pesado (~170 kB); vive en su propio módulo para no pesar en la
 * primera carga de /tesoreria. Se baja recién cuando los gráficos se renderizan.
 */

'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { BalanceHistoryPoint } from '@/lib/hooks/use-house';

const yAxisFormatter = (v: number) =>
  v >= 1e6
    ? `${(v / 1e6).toFixed(1)}M`
    : v >= 1e3
      ? `${(v / 1e3).toFixed(0)}k`
      : String(v);

function ChartTooltip({
  active,
  payload,
  label,
  valueLabel,
}: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
  valueLabel?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-lg px-3 py-2 text-xs shadow-lg"
      style={{
        background: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border-strong)',
        color: 'var(--color-fg)',
      }}
    >
      <div className="font-medium mb-1">{label}</div>
      <div className="tabular-nums">
        {valueLabel ? `${valueLabel}: ` : ''}
        {payload[0]?.value.toLocaleString('es-AR', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </div>
    </div>
  );
}

export function BalanceAreaChart({ data }: { data: BalanceHistoryPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={210}>
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
        <defs>
          <linearGradient id="balance-grad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 5" stroke="var(--color-border)" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={(d: string) => {
            const dt = new Date(d + 'T00:00:00');
            return dt.toLocaleDateString('es-AR', {
              timeZone: 'America/Argentina/Buenos_Aires',
              day: 'numeric',
              month: 'short',
            });
          }}
          tick={{ fontSize: 10, fill: 'var(--color-fg-subtle)' }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 10, fill: 'var(--color-fg-subtle)' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={yAxisFormatter}
        />
        <Tooltip content={<ChartTooltip valueLabel="Balance" />} />
        <Area
          type="monotone"
          dataKey={(d: { balance: string }) => Number(d.balance)}
          stroke="var(--color-accent)"
          strokeWidth={2}
          fill="url(#balance-grad)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function InjectionsBarChart({
  data,
}: {
  data: Array<{ month: string; amount: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={210}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
        <CartesianGrid strokeDasharray="3 5" stroke="var(--color-border)" vertical={false} />
        <XAxis
          dataKey="month"
          tick={{ fontSize: 10, fill: 'var(--color-fg-subtle)' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fill: 'var(--color-fg-subtle)' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={yAxisFormatter}
        />
        <Tooltip content={<ChartTooltip valueLabel="Monto" />} />
        <Bar dataKey="amount" fill="var(--color-accent)" radius={[6, 6, 2, 2]} barSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}
