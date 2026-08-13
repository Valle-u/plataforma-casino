/**
 * Nodos custom del mapa de red:
 *   - NetworkNodeCard: tarjeta de usuario (La Casa / admin / socio / distri /
 *     cajero) con ícono de rol, nombre, estado, total que cuelga y botón
 *     colapsar/expandir su rama.
 *   - PlayersNode: nodo agrupado "N jugadores" (click → lista).
 *   - GroupNode: recuadro contenedor de una rama independiente.
 *
 * Orientación horizontal: target a la izquierda, source a la derecha.
 */

'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Users, Plus, Minus, ChevronRight } from 'lucide-react';
import { CASA_STYLE, PLAYERS_STYLE, roleStyle } from './roles';
import { NODE_W } from './layout';
import type { UserNodeData, PlayersNodeData, GroupNodeData } from './layout';
import { useNetworkMapHandlers } from './network-map-context';
import { cn } from '@/lib/cn';

const STATUS_DOT: Record<string, string> = {
  active: '#22c55e',
  inactive: '#f59e0b',
  suspended: '#f59e0b',
  banned: '#ef4444',
  pending: '#94a3b8',
};

export function NetworkNodeCard({ id, data, selected }: NodeProps) {
  const d = data as UserNodeData;
  const { toggleCollapse } = useNetworkMapHandlers();
  const isCasa = d.kind === 'casa';
  const style = isCasa ? CASA_STYLE : roleStyle(d.roleCode);
  const Icon = style.icon;
  const dot = STATUS_DOT[d.status] ?? '#94a3b8';

  return (
    <div
      className={cn(
        'relative flex items-center gap-2.5 px-3 py-2 rounded-lg',
        'bg-[var(--color-bg-elevated)] border transition-shadow',
        selected
          ? 'border-[var(--color-accent)] shadow-[0_0_0_2px_var(--color-accent-glow)]'
          : 'border-[var(--color-border-strong)]',
      )}
      style={{ width: NODE_W, borderLeft: `3px solid ${style.color}` }}
    >
      <Handle type="target" position={Position.Left} className="!bg-transparent !border-0 !w-1 !h-1" />
      <span
        className="flex items-center justify-center size-8 rounded-md shrink-0"
        style={{ backgroundColor: `${style.color}1f`, color: style.color }}
      >
        <Icon className="size-4" />
      </span>
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-[12.5px] font-medium text-[var(--color-fg)] truncate leading-tight">
          {d.label}
        </span>
        <span className="flex items-center gap-1.5 text-[10.5px] text-[var(--color-fg-muted)] leading-tight">
          <span style={{ color: style.color }}>{style.label}</span>
          {!isCasa && (
            <span
              className="inline-block size-1.5 rounded-full shrink-0"
              style={{ backgroundColor: dot }}
              title={d.status}
            />
          )}
        </span>
      </div>
      {d.descendantCount > 0 && (
        <span
          className="flex items-center gap-1 text-[10px] text-[var(--color-fg-subtle)] shrink-0 tabular-nums"
          title="Total de gente que cuelga"
        >
          <Users className="size-3" />
          {d.descendantCount}
        </span>
      )}
      {d.hasChildren && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggleCollapse(id);
          }}
          className={cn(
            'nodrag flex items-center justify-center size-5 rounded-full shrink-0 border transition-colors',
            'border-[var(--color-border)] bg-[var(--color-bg-subtle)] text-[var(--color-fg-muted)]',
            'hover:border-[var(--color-accent)] hover:text-[var(--color-fg)]',
          )}
          title={d.collapsed ? 'Expandir rama' : 'Colapsar rama'}
        >
          {d.collapsed ? <Plus className="size-3" /> : <Minus className="size-3" />}
        </button>
      )}
      <Handle type="source" position={Position.Right} className="!bg-transparent !border-0 !w-1 !h-1" />
    </div>
  );
}

export function PlayersNode({ data, selected }: NodeProps) {
  const d = data as PlayersNodeData;
  const { openPlayers } = useNetworkMapHandlers();
  const style = PLAYERS_STYLE;
  const Icon = style.icon;
  return (
    <button
      type="button"
      onClick={() => openPlayers(d.parentUserId, d.parentLabel)}
      className={cn(
        'nodrag relative flex items-center gap-2.5 px-3 py-2 rounded-lg border border-dashed text-left',
        'transition-colors hover:border-[var(--color-accent)]',
        selected
          ? 'border-[var(--color-accent)] shadow-[0_0_0_2px_var(--color-accent-glow)]'
          : 'border-[var(--color-border-strong)]',
        'bg-[var(--color-bg-subtle)]',
      )}
      style={{ width: NODE_W }}
    >
      <Handle type="target" position={Position.Left} className="!bg-transparent !border-0 !w-1 !h-1" />
      <span
        className="flex items-center justify-center size-8 rounded-md shrink-0"
        style={{ backgroundColor: `${style.color}1f`, color: style.color }}
      >
        <Icon className="size-4" />
      </span>
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-[12.5px] font-medium text-[var(--color-fg)] truncate leading-tight">
          {d.label}
        </span>
        <span className="text-[10.5px] text-[var(--color-fg-subtle)] leading-tight">
          Ver la lista
        </span>
      </div>
      <ChevronRight className="size-3.5 text-[var(--color-fg-subtle)] shrink-0" />
    </button>
  );
}

export function GroupNode({ data }: NodeProps) {
  const d = data as GroupNodeData;
  return (
    <div className="w-full h-full rounded-xl border border-dashed border-[#A78BFA55] bg-[#A78BFA0a] pointer-events-none">
      <span className="absolute left-3 top-1.5 text-[10px] uppercase tracking-[0.1em] text-[#A78BFA] font-medium">
        {d.label}
      </span>
    </div>
  );
}
