/**
 * NetworkCard — una red de comisiones (Red de la Casa o red de un socio) como
 * card colapsable. Muestra el árbol de operadores anidado (indent por depth),
 * con TODO en una fila: tasa (editable solo si es hijo directo del admin —
 * delegación estricta, LEY C2), NetWin, comisión del mes, a cobrar, estado y
 * Liquidar (por operador). Al pie, el P&L de la red (lo que retiene la Casa).
 */

'use client';

import { ChevronDown, Network } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { isApiError } from '@/lib/api-client';
import {
  useSetNetworkRate,
  type NetworkOverviewNetwork,
  type NetworkOverviewOperator,
} from '@/lib/hooks/use-network-commissions';
import { cn } from '@/lib/cn';

function fmt(x: string | number): string {
  const n = Number(x);
  if (!Number.isFinite(n)) return String(x);
  return n.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const ROLE_LABEL: Record<string, string> = {
  socio: 'Socio',
  distribuidor: 'Distribuidor',
  cajero: 'Cajero',
};

function mapRateError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.code === 'RATE_EXCEEDS_PARENT')
    return 'La tasa no puede superar la del nivel de arriba.';
  if (err.code === 'RATE_BELOW_CHILDREN')
    return 'La tasa no puede ser menor que la de un hijo (override negativo).';
  if (err.code === 'NOT_DIRECT_CHILD') return 'No es tu hijo directo.';
  if (err.status === 403) return 'No tenés permiso.';
  if (err.status === 400) return err.message || 'Valor inválido (0–100).';
  return err.message || 'Error inesperado.';
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'paid') return <Badge variant="success">Pagado</Badge>;
  if (status === 'void') return <Badge variant="neutral">Anulado</Badge>;
  if (status === 'none')
    return <span className="text-[11px] text-[var(--color-fg-subtle)]">—</span>;
  return <Badge variant="warning">Pendiente</Badge>;
}

export function NetworkCard({
  network,
  canSettle,
  onSettle,
}: {
  network: NetworkOverviewNetwork;
  canSettle: boolean;
  onSettle: (op: NetworkOverviewOperator) => void;
}) {
  const [open, setOpen] = useState(true);
  const { pnl } = network;

  return (
    <section className="border border-[var(--color-border)] rounded-[var(--radius)] bg-[var(--color-bg-elevated)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-[var(--color-bg-subtle)] transition-colors"
      >
        <span className="flex items-center gap-2">
          <Network className="size-4 text-[var(--color-fg-muted)]" />
          <span className="font-medium text-[15px]">{network.label}</span>
          <Badge variant={network.kind === 'house' ? 'info' : 'neutral'}>
            {network.kind === 'house' ? 'Casa' : 'Socio'}
          </Badge>
          <span className="text-[11px] text-[var(--color-fg-subtle)]">
            {network.operators.length} operador
            {network.operators.length === 1 ? '' : 'es'}
          </span>
        </span>
        <ChevronDown
          className={cn(
            'size-4 text-[var(--color-fg-muted)] transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div className="border-t border-[var(--color-border)]">
          {/* Desktop: tabla completa (7 columnas). */}
          <div className="hidden lg:block overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)]">
                <Th>Operador</Th>
                <Th className="text-right" title="El porcentaje que cobra sobre la netwin de su red. Podés editarlo solo si es tu hijo directo.">Tasa</Th>
                <Th className="text-right" title="La netwin (lo que perdieron los jugadores) de toda la red de este operador.">NetWin red</Th>
                <Th className="text-right" title="Su tasa × la netwin de su red — la comisión bruta, antes de descontar lo que cobran los niveles de abajo.">Comisión</Th>
                <Th className="text-right" title="Lo que realmente se le paga: su diferencia de este mes + lo que quedó arrastrado de antes. Nunca baja de 0.">A cobrar</Th>
                <Th>Estado</Th>
                <Th className="text-right">Acción</Th>
              </tr>
            </thead>
            <tbody>
              {network.operators.map((op) => (
                <OperatorRow
                  key={op.id}
                  op={op}
                  canSettle={canSettle}
                  onSettle={onSettle}
                />
              ))}
            </tbody>
          </table>
          </div>

          {/* Mobile: una tarjeta apilada por operador. El input de tasa, el
              botón OK y Liquidar quedan SIEMPRE a la vista (antes vivían dentro
              de una tabla de 7 columnas que se salía de pantalla). */}
          <div className="lg:hidden flex flex-col">
            {network.operators.map((op) => (
              <OperatorCard
                key={op.id}
                op={op}
                canSettle={canSettle}
                onSettle={onSettle}
              />
            ))}
          </div>

          {/* P&L de la red */}
          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 p-3 border-t border-[var(--color-border)] text-[12px]">
            <span className="text-[var(--color-fg-subtle)]">
              NetWin <span className="font-mono">{fmt(pnl.netWin)}</span>
            </span>
            <span className="text-[var(--color-fg-subtle)]">
              − fee <span className="font-mono">{fmt(pnl.providerFee)}</span>
            </span>
            <span className="text-[var(--color-fg-subtle)]">
              − comisiones{' '}
              <span className="font-mono">{fmt(pnl.commissions)}</span>
            </span>
            <span className="font-medium">
              Retiene la Casa:{' '}
              <span className="font-mono tabular-nums text-[var(--color-success,#22c55e)]">
                {fmt(pnl.houseKeeps)}
              </span>
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

/** Lógica compartida de edición de tasa (tabla desktop + tarjeta mobile). */
function useOperatorRate(op: NetworkOverviewOperator) {
  const setRate = useSetNetworkRate();
  const [value, setValue] = useState(op.rate);

  useEffect(() => {
    setValue(op.rate);
  }, [op.rate]);

  const num = Number(value);
  const valid = Number.isFinite(num) && num >= 0 && num <= 100;
  const changed = valid && num !== Number(op.rate);

  async function save(): Promise<void> {
    if (!changed) return;
    try {
      await setRate.mutateAsync({ childUserId: op.id, rate: num });
      toast.success(`Comisión de ${op.displayName ?? op.username} → ${num}%`);
    } catch (err) {
      toast.error('No se pudo guardar', { description: mapRateError(err) });
      setValue(op.rate);
    }
  }

  return { value, setValue, changed, save, isPending: setRate.isPending };
}

function OperatorRow({
  op,
  canSettle,
  onSettle,
}: {
  op: NetworkOverviewOperator;
  canSettle: boolean;
  onSettle: (op: NetworkOverviewOperator) => void;
}) {
  const { value, setValue, changed, save, isPending } = useOperatorRate(op);
  const hasPending = op.pendingRowIds.length > 0;

  return (
    <tr className="border-b border-[var(--color-border)] last:border-0">
      <td className="p-2.5">
        <div
          className="flex flex-col"
          style={{ paddingLeft: `${op.depth * 18}px` }}
        >
          <span className="text-[13px] text-[var(--color-fg)] flex items-center gap-2">
            {op.depth > 0 && (
              <span className="text-[var(--color-fg-subtle)]">└</span>
            )}
            {op.displayName ?? op.username}
            <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] border border-[var(--color-border)] rounded-full px-1.5 py-0.5">
              {ROLE_LABEL[op.role] ?? op.role}
            </span>
          </span>
          <span className="text-[11px] text-[var(--color-fg-subtle)] font-mono">
            @{op.username}
          </span>
        </div>
      </td>
      <td className="p-2.5">
        {op.editableByAdmin ? (
          <div className="flex items-center justify-end gap-1.5">
            <Input
              type="number"
              min="0"
              max="100"
              step="0.01"
              className="w-20 font-mono text-right"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save();
              }}
            />
            <span className="text-[12px] text-[var(--color-fg-subtle)]">%</span>
            {changed && (
              <Button
                size="sm"
                variant="secondary"
                disabled={isPending}
                onClick={() => void save()}
              >
                OK
              </Button>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-end gap-1">
            <span
              className="font-mono tabular-nums text-[var(--color-fg-muted)]"
              title="La fija su padre desde su propia sucursal (delegación)"
            >
              {op.rate}%
            </span>
          </div>
        )}
      </td>
      <td className="p-2.5 text-right tabular-nums font-mono text-[var(--color-fg-muted)]">
        {fmt(op.subNetWin)}
      </td>
      <td className="p-2.5 text-right tabular-nums font-mono">
        {fmt(op.grossCommission)}
      </td>
      <td className="p-2.5 text-right tabular-nums font-mono text-[var(--color-success,#22c55e)]">
        {fmt(op.finalCommission)}
      </td>
      <td className="p-2.5">
        <StatusBadge status={op.status} />
      </td>
      <td className="p-2.5 text-right">
        {canSettle && hasPending && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onSettle(op)}
          >
            Liquidar
          </Button>
        )}
      </td>
    </tr>
  );
}

/** Versión mobile de una fila: tarjeta apilada (OK y Liquidar siempre a la vista). */
function OperatorCard({
  op,
  canSettle,
  onSettle,
}: {
  op: NetworkOverviewOperator;
  canSettle: boolean;
  onSettle: (op: NetworkOverviewOperator) => void;
}) {
  const { value, setValue, changed, save, isPending } = useOperatorRate(op);
  const hasPending = op.pendingRowIds.length > 0;

  return (
    <div
      className="border-b border-[var(--color-border)] last:border-0 p-3 flex flex-col gap-3"
      style={{ paddingLeft: `${12 + op.depth * 14}px` }}
    >
      {/* Identidad */}
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-[14px] text-[var(--color-fg)] flex items-center gap-2 flex-wrap">
          {op.depth > 0 && (
            <span className="text-[var(--color-fg-subtle)]">└</span>
          )}
          <span className="truncate">{op.displayName ?? op.username}</span>
          <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] border border-[var(--color-border)] rounded-full px-1.5 py-0.5 shrink-0">
            {ROLE_LABEL[op.role] ?? op.role}
          </span>
        </span>
        <span className="text-[11px] text-[var(--color-fg-subtle)] font-mono">
          @{op.username}
        </span>
      </div>

      {/* Tasa (editable) + OK */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[12px] text-[var(--color-fg-subtle)] w-16">
          Tasa
        </span>
        {op.editableByAdmin ? (
          <>
            <Input
              type="number"
              min="0"
              max="100"
              step="0.01"
              className="w-24 font-mono text-right"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save();
              }}
            />
            <span className="text-[12px] text-[var(--color-fg-subtle)]">%</span>
            {changed && (
              <Button
                size="sm"
                variant="secondary"
                disabled={isPending}
                onClick={() => void save()}
              >
                OK
              </Button>
            )}
          </>
        ) : (
          <span
            className="font-mono tabular-nums text-[var(--color-fg-muted)]"
            title="La fija su padre desde su propia sucursal (delegación)"
          >
            {op.rate}%
          </span>
        )}
      </div>

      {/* Números */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
        <CardField label="NetWin red" value={fmt(op.subNetWin)} />
        <CardField label="Comisión" value={fmt(op.grossCommission)} />
        <CardField
          label="A cobrar"
          value={fmt(op.finalCommission)}
          className="text-[var(--color-success,#22c55e)]"
        />
        <div className="flex flex-col gap-0.5">
          <span className="text-[var(--color-fg-subtle)]">Estado</span>
          <StatusBadge status={op.status} />
        </div>
      </div>

      {/* Liquidar */}
      {canSettle && hasPending && (
        <Button
          size="sm"
          variant="secondary"
          className="w-full"
          onClick={() => onSettle(op)}
        >
          Liquidar
        </Button>
      )}
    </div>
  );
}

function CardField({
  label,
  value,
  className = '',
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[var(--color-fg-subtle)]">{label}</span>
      <span className={cn('font-mono tabular-nums', className)}>{value}</span>
    </div>
  );
}

function Th({
  children,
  className = '',
  title,
}: {
  children?: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <th
      title={title}
      className={cn(
        'p-2.5 text-left text-[11px] uppercase tracking-[0.06em] font-medium text-[var(--color-fg-muted)]',
        title && 'underline decoration-dotted decoration-[var(--color-fg-subtle)] underline-offset-4 cursor-help',
        className,
      )}
    >
      {children}
    </th>
  );
}
