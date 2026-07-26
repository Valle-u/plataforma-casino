'use client';

import { ReactFlowProvider } from '@xyflow/react';
import { useState, useCallback, useEffect, useRef } from 'react';
import { Network, Users, RefreshCw } from 'lucide-react';
import { useNetworkTree } from '@/lib/hooks/use-network-tree';
import { NetworkGraph } from '@/components/admin/network-graph';
import { NetworkTreePanel } from '@/components/admin/network-tree-panel';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

export default function NetworkPage() {
  const { data, isLoading, refetch, isFetching } = useNetworkTree();
  const [focusUserId, setFocusUserId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const handleSelectUser = useCallback((id: string | null) => {
    setFocusUserId(id);
  }, []);

  const handleToggleNode = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const nodes = data?.nodes ?? [];

  // Initialize expanded state when data loads (roots expanded by default)
  const initializedRef = useRef(false);
  useEffect(() => {
    if (nodes.length > 0 && !initializedRef.current) {
      initializedRef.current = true;
      const roots = nodes.filter((n) => !n.parentUserId);
      setExpandedIds(new Set(roots.map((r) => r.id)));
    }
  }, [nodes]);

  return (
    <ReactFlowProvider>
      <div className="px-4 py-4 sm:px-6 sm:py-5 lg:px-8 lg:py-6 flex flex-col gap-6 max-w-[1600px] mx-auto h-[calc(100vh-2rem)]">
        {/* Header */}
        <header className="shrink-0 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-subtle)] font-medium">
              <Network className="size-3" />
              Sistema
            </span>
            <div className="flex items-center gap-3">
              <h1 className="font-display text-3xl lg:text-[2.5rem] leading-none tracking-tight">
                Red
              </h1>
              {data && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-2.5 py-0.5 text-[10px] tabular-nums text-[var(--color-fg-muted)]">
                  <Users size={10} />
                  {data.total} nodos
                </span>
              )}
            </div>
          </div>
          <Button
            variant="outline-accent"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
            Actualizar
          </Button>
        </header>

        {/* Content */}
        <div className="flex-1 min-h-0 flex rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] overflow-hidden">
          {/* Left: Tree panel */}
          <div className="w-[300px] shrink-0 border-r border-[var(--color-border)] bg-[var(--color-bg-elevated)] hidden lg:flex flex-col">
            {isLoading ? (
              <div className="flex flex-col gap-2 p-3">
                <Skeleton className="h-4 w-24 bg-[var(--color-bg-subtle)]" />
                <Skeleton className="h-8 w-full bg-[var(--color-bg-subtle)]" />
                <Skeleton className="h-8 w-full bg-[var(--color-bg-subtle)]" />
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full bg-[var(--color-bg-subtle)]" style={{ marginLeft: `${(i % 3) * 16}px` }} />
                ))}
              </div>
            ) : (
              <NetworkTreePanel
                nodes={nodes}
                onSelectUser={handleSelectUser}
                selectedUserId={focusUserId}
                expandedIds={expandedIds}
                onToggleNode={handleToggleNode}
              />
            )}
          </div>

          {/* Right: Graph */}
          <div className="flex-1 min-w-0">
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <div className="flex flex-col items-center gap-3">
                  <div className="size-8 border-2 border-[var(--color-accent)] border-r-transparent animate-spin rounded-full" />
                  <span className="text-[11px] text-[var(--color-fg-subtle)]">Cargando red...</span>
                </div>
              </div>
            ) : nodes.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="flex flex-col items-center gap-3 text-center">
                  <Network size={40} className="text-[var(--color-fg-subtle)]" />
                  <span className="text-[13px] text-[var(--color-fg-muted)]">No hay usuarios en la red</span>
                </div>
              </div>
            ) : (
              <NetworkGraph
                nodes={nodes}
                focusUserId={focusUserId}
                onSelectUser={handleSelectUser}
                expandedIds={expandedIds}
                onToggleNode={handleToggleNode}
              />
            )}
          </div>
        </div>
      </div>
    </ReactFlowProvider>
  );
}
