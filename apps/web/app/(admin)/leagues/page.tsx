/**
 * /leagues — panel admin de ligas/torneos.
 *
 * Composición:
 *   - Header: título + "Crear liga".
 *   - Tabs por status (Activas / Programadas / Cerradas / Todas).
 *   - Tabla: code, name, period · metric, status badge, ventana, fecha.
 *   - Click row → LeagueDetailDrawer con standings + acciones recompute/close.
 */

'use client';

import { Info, Plus, RefreshCw, Trophy } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CreateLeagueModal } from '@/components/admin/create-league-modal';
import { LeagueDetailDrawer } from '@/components/admin/league-detail-drawer';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CsvExportButton } from '@/components/ui/csv-export-button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { useAuth } from '@/lib/auth-context';
import {
  useLeagues,
  type LeagueMetric,
  type LeagueStatus,
} from '@/lib/hooks/use-leagues';
import { cn } from '@/lib/cn';

const PAGE_SIZE = 25;

const STATUS_VARIANT: Record<LeagueStatus, BadgeVariant> = {
  scheduled: 'info',
  active: 'success',
  closed: 'neutral',
};

const STATUS_LABEL: Record<LeagueStatus, string> = {
  scheduled: 'programada',
  active: 'activa',
  closed: 'cerrada',
};

const METRIC_LABEL: Record<LeagueMetric, string> = {
  bet_volume: 'volumen apostado',
  rounds_count: 'rondas',
  gross_won: 'wins brutos',
  player_netwin: 'netwin',
  score_custom: 'score custom',
};

interface FilterTab {
  id: string;
  label: string;
  status?: LeagueStatus;
}

const FILTER_TABS: FilterTab[] = [
  { id: 'active', label: 'Activas', status: 'active' },
  { id: 'scheduled', label: 'Programadas', status: 'scheduled' },
  { id: 'closed', label: 'Cerradas', status: 'closed' },
  { id: 'all', label: 'Todas' },
];

export default function LeaguesPage() {
  const { user } = useAuth();
  // Sprint 51.3: solo admin_tenant puede crear leagues. Mismo modelo
  // que promotions — servicio plataforma.
  const canCreate = user?.roles?.includes('admin_tenant') ?? false;
  const [tabId, setTabId] = useState<string>('active');
  const [page, setPage] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const tab = useMemo(
    () => FILTER_TABS.find((t) => t.id === tabId) ?? FILTER_TABS[0]!,
    [tabId],
  );

  const { data, isLoading, isError, refetch, isFetching } = useLeagues({
    status: tab.status,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;

  return (
    <>
      <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1600px] mx-auto">
        {/* Header */}
        <header className="flex items-end justify-between gap-6 pb-2">
          <div className="flex flex-col gap-2">
            <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
              <Trophy className="size-3" />
              Engagement · Ligas
            </span>
            <h1 className="font-display text-[2.5rem] leading-none tracking-tight">
              Ligas del tenant
            </h1>
            <p className="text-sm text-[var(--color-fg-muted)] mt-1">
              {data ? `${rows.length} de ${total} en esta vista` : 'Cargando…'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <CsvExportButton
              path="/tenant/leagues/export"
              params={{ status: tab.status }}
              filenameHint="leagues"
              entityLabel="ligas"
            />
            <Button
              variant="secondary"
              size="md"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw
                className={cn('size-3.5', isFetching && 'animate-spin')}
              />
              Refrescar
            </Button>
            {canCreate && (
              <Button variant="primary" size="md" onClick={() => setCreateOpen(true)}>
                <Plus className="size-3.5" />
                Crear liga
              </Button>
            )}
          </div>
        </header>

        {/* Sprint 51.3: banner read-only para no-admin. Las ligas son
            servicio plataforma (mismo modelo que promotions). */}
        {!canCreate && (
          <div className="flex items-start gap-3 p-3 bg-[var(--color-bg-elevated)] border-l-2 border-l-[var(--color-accent)] border border-[var(--color-border)]">
            <Info className="size-4 text-[var(--color-accent-text)] shrink-0 mt-0.5" />
            <div className="flex flex-col gap-1">
              <span className="text-[12px] text-[var(--color-fg)] font-medium">
                Vista de solo lectura
              </span>
              <span className="text-[11px] text-[var(--color-fg-muted)]">
                Las ligas son un servicio de la plataforma — las configura
                el admin del tenant y compiten todos los jugadores activos,
                incluso los de sucursales independientes. Podés ver standings
                y resultados pero no editarlas.
              </span>
            </div>
          </div>
        )}

        {/* Tabs filter */}
        <div className="flex items-center gap-px bg-[var(--color-border)] border border-[var(--color-border)] self-start flex-wrap">
          {FILTER_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTabId(t.id);
                setPage(0);
              }}
              className={cn(
                'px-4 h-8 text-[11px] uppercase tracking-[0.08em] font-medium',
                'transition-colors duration-150',
                tabId === t.id
                  ? 'bg-[var(--color-bg)] text-[var(--color-fg)] border-b-2 border-b-[var(--color-accent)]'
                  : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
          {isLoading ? (
            <LoadingTable />
          ) : isError ? (
            <div className="p-6">
              <EmptyState
                hint="leagues"
                label="No se pudo cargar la lista."
                action={
                  <Button variant="secondary" size="sm" onClick={() => refetch()}>
                    Reintentar
                  </Button>
                }
              />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                hint="leagues"
                stream={`tenant · status=${tab.status ?? '*'}`}
                label={
                  tabId === 'active'
                    ? 'No hay ligas activas'
                    : 'Sin ligas en este filtro'
                }
                action={
                  tabId === 'active' && canCreate ? (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => setCreateOpen(true)}
                    >
                      <Plus className="size-3.5" />
                      Crear primera liga
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Código</TH>
                  <TH>Nombre</TH>
                  <TH>Período · métrica</TH>
                  <TH>Estado</TH>
                  <TH>Ventana</TH>
                  <TH align="right">Creada</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((l, i) => (
                  <TR
                    key={l.id}
                    onClick={() => setSelectedId(l.id)}
                    className="animate-fade-up-staggered cursor-pointer"
                    style={{ animationDelay: `${Math.min(i * 25, 500)}ms` }}
                  >
                    <TD>
                      <span className="text-[12px] font-mono text-[var(--color-fg)]">
                        {l.code}
                      </span>
                    </TD>
                    <TD>
                      <span className="text-[13px] text-[var(--color-fg)]">
                        {l.name}
                      </span>
                    </TD>
                    <TD>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)]">
                          {l.period}
                        </span>
                        <span className="text-[11px] font-mono text-[var(--color-fg-muted)]">
                          {METRIC_LABEL[l.metric] ?? l.metric}
                        </span>
                      </div>
                    </TD>
                    <TD>
                      <Badge variant={STATUS_VARIANT[l.status]} dot>
                        {STATUS_LABEL[l.status]}
                      </Badge>
                    </TD>
                    <TD>
                      <div className="flex flex-col gap-0.5 text-[11px] font-mono text-[var(--color-fg-muted)]">
                        <span>{formatDate(l.startsAt)}</span>
                        <span className="text-[var(--color-fg-subtle)]">
                          → {formatDate(l.endsAt)}
                        </span>
                      </div>
                    </TD>
                    <TD numeric className="text-[var(--color-fg-subtle)]">
                      {formatDate(l.createdAt)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>

        {/* Pager */}
        {data && total > PAGE_SIZE && (
          <Pager
            page={page}
            total={total}
            onPrev={() => setPage((p) => Math.max(0, p - 1))}
            onNext={() => setPage((p) => p + 1)}
            hasMore={(page + 1) * PAGE_SIZE < total}
          />
        )}
      </div>

      <CreateLeagueModal open={createOpen} onOpenChange={setCreateOpen} />

      <LeagueDetailDrawer
        leagueId={selectedId}
        open={!!selectedId}
        onOpenChange={(o) => !o && setSelectedId(null)}
      />
    </>
  );
}

function Pager({
  page,
  total,
  onPrev,
  onNext,
  hasMore,
}: {
  page: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  hasMore: boolean;
}) {
  const start = page * PAGE_SIZE + 1;
  const end = Math.min(start + PAGE_SIZE - 1, total);
  return (
    <div className="flex items-center justify-end gap-3 text-[11px] text-[var(--color-fg-subtle)]">
      <span className="font-mono tabular-nums">
        {total === 0 ? '—' : `${start}–${end} de ${total}`}
      </span>
      <div className="flex items-center gap-px bg-[var(--color-border)]">
        <button
          type="button"
          onClick={onPrev}
          disabled={page === 0}
          className="px-3 h-7 text-[11px] uppercase tracking-[0.08em] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          ← Prev
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!hasMore}
          className="px-3 h-7 text-[11px] uppercase tracking-[0.08em] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

function LoadingTable() {
  return (
    <div className="p-4 flex flex-col gap-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full bg-[var(--color-bg-subtle)]" />
      ))}
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('es-AR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}
