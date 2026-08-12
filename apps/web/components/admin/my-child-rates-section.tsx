/**
 * MyChildRatesSection — Fase 4 (LEY C2, delegación de tasas nivel por nivel).
 *
 * Un operador (socio o distribuidor) fija la comisión de sus HIJOS DIRECTOS
 * operadores. Reglas del techo (C2):
 *   - cada tasa ≤ la tasa propia del operador (`ownRate`) → no cobra más que él.
 *   - cada tasa ≥ la mayor tasa de los hijos de ESE hijo (`maxChildRate`) → no
 *     cobra menos de lo que ya paga hacia abajo (override no-negativo).
 * El operador se queda con la DIFERENCIA (ownRate − childRate) de la NetWin de
 * la sub-red de cada hijo. Self-scoped: el backend valida hijo-directo + topes.
 *
 * Se auto-oculta si el actor no tiene el permiso (403) o no tiene hijos
 * operadores (ej. cajero) — no es un error, simplemente no aplica.
 */

'use client';

import { Network } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CollapsibleCard } from '@/components/admin/collapsible-card';
import { isApiError } from '@/lib/api-client';
import {
  useMyNetworkChildren,
  useSetChildRate,
  type ChildRate,
} from '@/lib/hooks/use-network-commissions';

const ROLE_LABEL: Record<string, string> = {
  socio: 'Socio',
  distribuidor: 'Distribuidor',
  cajero: 'Cajero',
};

function mapErr(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.code === 'RATE_EXCEEDS_PARENT')
    return 'La tasa no puede superar la tuya.';
  if (err.code === 'RATE_BELOW_CHILDREN')
    return 'La tasa no puede ser menor que la de un hijo (override negativo).';
  if (err.code === 'NOT_DIRECT_CHILD')
    return 'Solo podés fijar la tasa de tus hijos directos.';
  if (err.status === 403) return 'No tenés permiso.';
  if (err.status === 400) return err.message || 'Valor inválido (0–100).';
  return err.message || 'Error inesperado.';
}

export function MyChildRatesSection() {
  const { data, isLoading, isError } = useMyNetworkChildren();

  // Sin permiso / sin datos / sin hijos operadores → no se muestra la sección.
  if (isLoading || isError || !data || data.children.length === 0) return null;

  return (
    <CollapsibleCard
      title="Comisiones de mi red"
      icon={<Network className="size-4" />}
      bodyClassName="flex flex-col gap-3"
    >
      <p className="text-sm text-[var(--color-fg-muted)]">
        Fijá cuánto gana cada uno de tus operadores directos sobre la NetWin de
        su sub-red. Vos te quedás la diferencia. Tope: tu tasa es{' '}
        <span className="font-semibold text-[var(--color-fg)]">
          {data.ownRate}%
        </span>{' '}
        — ninguno puede cobrar más que eso.
      </p>

      <div className="border border-[var(--color-border)] overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)]">
              <Th>Operador</Th>
              <Th className="text-right">Su tasa</Th>
              <Th className="text-right">Te quedás</Th>
              <Th className="text-right">Acción</Th>
            </tr>
          </thead>
          <tbody>
            {data.children.map((c) => (
              <ChildRow key={c.id} child={c} ownRate={Number(data.ownRate)} />
            ))}
          </tbody>
        </table>
      </div>
    </CollapsibleCard>
  );
}

function ChildRow({ child, ownRate }: { child: ChildRate; ownRate: number }) {
  const setRate = useSetChildRate();
  const [value, setValue] = useState(child.commissionRate);

  useEffect(() => {
    setValue(child.commissionRate);
  }, [child.commissionRate]);

  const num = Number(value);
  const floor = Number(child.maxChildRate);
  const valid =
    Number.isFinite(num) && num >= 0 && num <= 100 && num <= ownRate && num >= floor;
  const changed = valid && num !== Number(child.commissionRate);
  const keeps = Number.isFinite(num) ? Math.max(0, ownRate - num) : 0;

  async function save(): Promise<void> {
    if (!changed) return;
    try {
      await setRate.mutateAsync({ childUserId: child.id, rate: num });
      toast.success(
        `Comisión de ${child.displayName ?? child.username} → ${num}%`,
      );
    } catch (err) {
      toast.error('No se pudo guardar', { description: mapErr(err) });
      setValue(child.commissionRate);
    }
  }

  return (
    <tr className="border-b border-[var(--color-border)] last:border-0">
      <td className="p-2.5">
        <div className="flex flex-col">
          <span className="text-[13px] text-[var(--color-fg)] flex items-center gap-2">
            {child.displayName ?? child.username}
            <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] border border-[var(--color-border)] rounded-full px-1.5 py-0.5">
              {ROLE_LABEL[child.role] ?? child.role}
            </span>
          </span>
          <span className="text-[11px] text-[var(--color-fg-subtle)] font-mono">
            @{child.username}
          </span>
        </div>
      </td>
      <td className="p-2.5">
        <div className="flex items-center justify-end gap-1.5">
          <Input
            type="number"
            min="0"
            max={String(ownRate)}
            step="0.01"
            className="w-20 font-mono text-right"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save();
            }}
          />
          <span className="text-[12px] text-[var(--color-fg-subtle)]">%</span>
        </div>
        {!valid && (
          <p className="text-[10px] text-[#ef4444] text-right mt-1">
            Entre {floor}% y {ownRate}%
          </p>
        )}
      </td>
      <td className="p-2.5 text-right tabular-nums text-[var(--color-fg-muted)]">
        {keeps.toFixed(2)}%
      </td>
      <td className="p-2.5 text-right">
        <Button
          size="sm"
          variant="secondary"
          disabled={!changed || setRate.isPending}
          onClick={() => void save()}
        >
          Guardar
        </Button>
      </td>
    </tr>
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
