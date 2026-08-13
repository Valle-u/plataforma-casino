'use client';

/**
 * /red-mapa — Mapa de red (rediseño, Fase 1: solo lectura).
 *
 * Convive temporalmente con la /red vieja (árbol de texto). Cuando esté
 * completo, reemplaza a /red. Mapa de nodos interactivo con React Flow:
 * layout horizontal automático, raíz "La Casa", cadena comercial expandida
 * hasta cajeros, jugadores agrupados, recuadros para ramas independientes.
 */

import { useMemo } from 'react';
import { Network, RefreshCw } from 'lucide-react';
import { useNetworkTree } from '@/lib/hooks/use-network-tree';
import { NetworkMap } from '@/components/admin/network-map/network-map';
import { buildGraph } from '@/components/admin/network-map/layout';
import { CASA_STYLE, PLAYERS_STYLE, ROLE_ORDER, roleStyle } from '@/components/admin/network-map/roles';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/cn';

export default function RedMapaPage() {
  const { data, isLoading, isError, refetch, isFetching } = useNetworkTree();

  const graph = useMemo(
    () => (data ? buildGraph(data.nodes) : { rfNodes: [], rfEdges: [] }),
    [data],
  );

  return (
    <div className="flex flex-col gap-4 h-[calc(100dvh-7.5rem)]">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
            <Network className="size-3" />
            Sistema · Red
            <span className="px-1.5 py-0.5 text-[9px] rounded bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)] border border-[var(--color-accent-border)]">
              nuevo · beta
            </span>
          </span>
          <h1 className="font-display text-3xl lg:text-[2.25rem] leading-none tracking-tight">
            Mapa de red
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Legend />
          <Button
            variant="secondary"
            size="md"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={cn('size-3.5', isFetching && 'animate-spin')} />
            Actualizar
          </Button>
        </div>
      </header>

      {/* Canvas */}
      <div className="flex-1 min-h-0 border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-bg)]">
        {isLoading ? (
          <div className="p-6 grid grid-cols-3 gap-4">
            {Array.from({ length: 9 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full bg-[var(--color-bg-subtle)]" />
            ))}
          </div>
        ) : isError ? (
          <div className="p-8">
            <EmptyState
              hint="network"
              label="No se pudo cargar la red."
              action={
                <Button variant="secondary" size="sm" onClick={() => void refetch()}>
                  Reintentar
                </Button>
              }
            />
          </div>
        ) : graph.rfNodes.length <= 1 ? (
          <div className="p-8">
            <EmptyState hint="network" label="Todavía no hay red para mostrar." />
          </div>
        ) : (
          <NetworkMap nodes={graph.rfNodes} edges={graph.rfEdges} />
        )}
      </div>
    </div>
  );
}

function Legend() {
  const items = [
    { label: CASA_STYLE.label, color: CASA_STYLE.color },
    ...ROLE_ORDER.filter((r) => r !== 'usuario_final').map((r) => {
      const s = roleStyle(r);
      return { label: s.label, color: s.color };
    }),
    { label: PLAYERS_STYLE.label, color: PLAYERS_STYLE.color },
  ];
  return (
    <div className="hidden lg:flex items-center gap-3 px-3 h-9 border border-[var(--color-border)] bg-[var(--color-bg-elevated)] rounded">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5 text-[11px] text-[var(--color-fg-muted)]">
          <span className="size-2 rounded-full" style={{ backgroundColor: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
