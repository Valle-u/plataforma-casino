/**
 * /game-stats — Estadísticas de juego (Sprint 46).
 *
 * Pedido del dueño 2026-05-20 item B: "registre todas las jugadas".
 *
 * Tabs:
 *   - Resumen: KPIs globales (GGR, RTP real, players únicos).
 *   - Por juego: breakdown con flag si RTP real diverge >5pts vs target.
 *   - Por jugador: top por volumen de apuesta.
 *   - Rondas: tabla detallada filtrable de cada round individual.
 *
 * Permisos: game_stats.view_any (admin) / view_own_network (red) / export.
 */

'use client';

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Dices,
  Filter,
  RefreshCw,
} from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CsvExportButton } from '@/components/ui/csv-export-button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import {
  buildGameStatsExportUrl,
  ROUND_STATUS_LABELS,
  useGameRounds,
  useGameStatsByGame,
  useGameStatsByPlayer,
  useGameStatsSummary,
  type RoundRow,
  type RoundsFilters,
} from '@/lib/hooks/use-game-stats';

type Tab = 'summary' | 'by-game' | 'by-player' | 'rounds';

const TABS: { id: Tab; label: string }[] = [
  { id: 'summary', label: 'Resumen' },
  { id: 'by-game', label: 'Por juego' },
  { id: 'by-player', label: 'Por jugador' },
  { id: 'rounds', label: 'Rondas' },
];

const PAGE_SIZE = 50;

export default function GameStatsPage() {
  const [tab, setTab] = useState<Tab>('summary');
  const [filters, setFilters] = useState<RoundsFilters>({
    limit: PAGE_SIZE,
    offset: 0,
  });

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-2">
        <div className="flex flex-col gap-2">
          <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
            <Dices className="size-3" />
            Reporting · Juego
          </span>
          <h1 className="font-display text-3xl lg:text-[2.5rem] leading-none tracking-tight">
            Estadísticas de juego
          </h1>
          <p className="text-sm text-[var(--color-fg-muted)] mt-1">
            GGR, RTP real vs target por juego, top players, historial de
            rondas.{' '}
            <span className="text-[var(--color-fg-subtle)]">
              Read-only sobre `game_rounds`. Excluye rolled_back de los agregados.
            </span>
          </p>
        </div>
        {/* Mismo fix que stats de pago: el <a download> nativo no manda
            Authorization ni X-Tenant-Host. CsvExportButton hace el fetch
            autenticado y baja el blob, reusando la serialización de filtros. */}
        <CsvExportButton
          path={buildGameStatsExportUrl(filters)}
          filenameHint="game_stats"
          entityLabel="estadísticas de juego"
          label="Exportar CSV"
        />
      </header>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-px bg-[var(--color-border)] border border-[var(--color-border)] self-start">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'px-4 h-8 text-[11px] uppercase tracking-[0.08em] font-medium',
              'transition-colors duration-150',
              tab === t.id
                ? 'bg-[var(--color-bg)] text-[var(--color-fg)] border-b-2 border-b-[var(--color-accent)]'
                : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filtros */}
      <FiltersBar filters={filters} onChange={setFilters} />

      {tab === 'summary' && <SummaryTab filters={filters} />}
      {tab === 'by-game' && <ByGameTab filters={filters} />}
      {tab === 'by-player' && <ByPlayerTab filters={filters} />}
      {tab === 'rounds' && (
        <RoundsTab
          filters={filters}
          onPage={(o) => setFilters({ ...filters, offset: o })}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// FiltersBar
// ──────────────────────────────────────────────────────────────────────

function FiltersBar({
  filters,
  onChange,
}: {
  filters: RoundsFilters;
  onChange: (f: RoundsFilters) => void;
}) {
  const activeCount =
    (filters.gameCode ? 1 : 0) +
    (filters.userId ? 1 : 0) +
    (filters.dateFrom ? 1 : 0) +
    (filters.dateTo ? 1 : 0) +
    (filters.outcome ? 1 : 0);

  function clearAll() {
    onChange({ limit: PAGE_SIZE, offset: 0 });
  }

  return (
    <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium flex items-center gap-2">
          <Filter className="size-3" />
          Filtros {activeCount > 0 && <Badge variant="neutral">{activeCount}</Badge>}
        </span>
        {activeCount > 0 && (
          <Button variant="ghost" size="sm" onClick={clearAll}>
            Limpiar
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gs-date-from">Desde</Label>
          <Input
            id="gs-date-from"
            type="datetime-local"
            value={filters.dateFrom ? filters.dateFrom.slice(0, 16) : ''}
            onChange={(e) =>
              onChange({
                ...filters,
                dateFrom: e.target.value ? new Date(e.target.value).toISOString() : undefined,
                offset: 0,
              })
            }
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gs-date-to">Hasta</Label>
          <Input
            id="gs-date-to"
            type="datetime-local"
            value={filters.dateTo ? filters.dateTo.slice(0, 16) : ''}
            onChange={(e) =>
              onChange({
                ...filters,
                dateTo: e.target.value ? new Date(e.target.value).toISOString() : undefined,
                offset: 0,
              })
            }
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gs-game-code">Game code</Label>
          <Input
            id="gs-game-code"
            placeholder="ej: mock_lucky_seven"
            value={filters.gameCode ?? ''}
            onChange={(e) =>
              onChange({ ...filters, gameCode: e.target.value || undefined, offset: 0 })
            }
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gs-user-id">User ID</Label>
          <Input
            id="gs-user-id"
            placeholder="UUID o vacío"
            value={filters.userId ?? ''}
            onChange={(e) =>
              onChange({ ...filters, userId: e.target.value || undefined, offset: 0 })
            }
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Resultado</Label>
          <div className="flex gap-1">
            {(['win', 'loss', 'zero'] as const).map((o) => (
              <button
                key={o}
                type="button"
                onClick={() =>
                  onChange({
                    ...filters,
                    outcome: filters.outcome === o ? undefined : o,
                    offset: 0,
                  })
                }
                className={cn(
                  'px-2 h-9 flex-1 text-[11px] border transition-colors',
                  filters.outcome === o
                    ? 'bg-[var(--color-accent)] text-[var(--color-accent-fg)] border-[var(--color-accent)]'
                    : 'bg-[var(--color-bg)] text-[var(--color-fg-muted)] border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg)]',
                )}
              >
                {o === 'win' ? 'Ganó' : o === 'loss' ? 'Perdió' : 'Empate'}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Tab Resumen
// ──────────────────────────────────────────────────────────────────────

function SummaryTab({ filters }: { filters: RoundsFilters }) {
  const { data, isLoading, isError } = useGameStatsSummary({
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }
  if (isError || !data) {
    return <EmptyState hint="summary" label="Error al cargar resumen." />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Total apostado" value={data.totalBet} tone="muted" />
        <Kpi label="Total pagado" value={data.totalWin} tone="muted" />
        <Kpi
          label="GGR (casino)"
          value={data.ggr}
          tone={Number(data.ggr) >= 0 ? 'success' : 'danger'}
          help="Gross Gaming Revenue = bet − win"
        />
        <Kpi
          label="RTP real"
          value={`${data.rtpRealPct}%`}
          tone="muted"
          help="Return to Player real del período"
        />
      </div>

      <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-[12px]">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)]">
            Ventana
          </span>
          <span className="text-[var(--color-fg)] font-mono">
            {new Date(data.dateFrom).toLocaleDateString('es-AR')} →{' '}
            {new Date(data.dateTo).toLocaleDateString('es-AR')}
          </span>
          <Badge variant="neutral">{data.bucket}</Badge>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)]">
            Rondas
          </span>
          <span className="text-[var(--color-fg)] font-mono num text-[1.25rem]">
            {data.roundsCount}
          </span>
          <span className="text-[10px] text-[var(--color-fg-subtle)]">
            {data.rolledBackCount} rolled back (no contadas)
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)]">
            Jugadores únicos
          </span>
          <span className="text-[var(--color-fg)] font-mono num text-[1.25rem]">
            {data.uniquePlayers}
          </span>
        </div>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
  help,
}: {
  label: string;
  value: string;
  tone: 'muted' | 'success' | 'danger';
  help?: string;
}) {
  const colorClass =
    tone === 'success'
      ? 'text-[var(--color-success)]'
      : tone === 'danger'
        ? 'text-[var(--color-danger)]'
        : 'text-[var(--color-fg)]';
  return (
    <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto p-4 flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
        {label}
      </span>
      <span className={cn('text-[1.75rem] font-mono num leading-none', colorClass)}>
        {value}
      </span>
      {help && (
        <span className="text-[10px] text-[var(--color-fg-disabled)] mt-1">{help}</span>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Tab Por juego
// ──────────────────────────────────────────────────────────────────────

function ByGameTab({ filters }: { filters: RoundsFilters }) {
  const { data, isLoading, isError } = useGameStatsByGame({
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
  });

  if (isLoading) return <Skeleton className="h-64" />;
  if (isError || !data) return <EmptyState hint="by-game" label="Error al cargar." />;
  if (data.length === 0)
    return (
      <EmptyState
        hint="by-game"
        label="Sin rondas para los filtros aplicados."
      />
    );

  return (
    <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto">
      <div className="px-3 py-2 border-b border-[var(--color-border)]">
        <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium">
          {data.length} juegos con actividad · RTP flag {'>'} ±5 puntos
        </span>
      </div>
      <Table>
        <THead>
          <TR>
            <TH>Juego</TH>
            <TH className="text-right">Rondas</TH>
            <TH className="text-right">Jugadores</TH>
            <TH className="text-right">Bet total</TH>
            <TH className="text-right">Win total</TH>
            <TH className="text-right">GGR</TH>
            <TH className="text-right">RTP real</TH>
            <TH className="text-right">RTP target</TH>
            <TH className="text-right">Δ</TH>
          </TR>
        </THead>
        <TBody>
          {data.map((r) => (
            <TR key={r.gameId}>
              <TD>
                <div className="flex flex-wrap items-center gap-2">
                  {r.flagged && (
                    <AlertTriangle
                      className="size-3.5 text-[var(--color-warning)]"
                      aria-label="RTP fuera de target"
                    />
                  )}
                  <div className="flex flex-col">
                    <span className="text-[12px] text-[var(--color-fg)]">
                      {r.gameName}
                    </span>
                    <span className="text-[10px] text-[var(--color-fg-subtle)] font-mono">
                      {r.gameCode}
                    </span>
                  </div>
                </div>
              </TD>
              <TD className="text-right num">{r.roundsCount}</TD>
              <TD className="text-right num">{r.uniquePlayers}</TD>
              <TD className="text-right num font-mono">{r.totalBet}</TD>
              <TD className="text-right num font-mono">{r.totalWin}</TD>
              <TD
                className={cn(
                  'text-right num font-mono',
                  Number(r.ggr) >= 0
                    ? 'text-[var(--color-success)]'
                    : 'text-[var(--color-danger)]',
                )}
              >
                {Number(r.ggr) >= 0 ? '+' : ''}
                {r.ggr}
              </TD>
              <TD className="text-right num font-mono">{r.rtpRealPct}%</TD>
              <TD className="text-right num font-mono text-[var(--color-fg-muted)]">
                {r.rtpTargetPct !== null ? `${r.rtpTargetPct}%` : '—'}
              </TD>
              <TD
                className={cn(
                  'text-right num font-mono',
                  r.flagged && 'text-[var(--color-warning)]',
                )}
              >
                {r.rtpDivergencePts !== null ? `±${r.rtpDivergencePts}` : '—'}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Tab Por jugador
// ──────────────────────────────────────────────────────────────────────

function ByPlayerTab({ filters }: { filters: RoundsFilters }) {
  const { data, isLoading, isError } = useGameStatsByPlayer({
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    limit: 100,
  });

  if (isLoading) return <Skeleton className="h-64" />;
  if (isError || !data) return <EmptyState hint="by-player" label="Error al cargar." />;
  if (data.length === 0)
    return <EmptyState hint="by-player" label="Sin rondas para la ventana." />;

  return (
    <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto">
      <div className="px-3 py-2 border-b border-[var(--color-border)]">
        <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium">
          Top {data.length} jugadores por volumen de apuesta
        </span>
      </div>
      <Table>
        <THead>
          <TR>
            <TH>#</TH>
            <TH>Jugador</TH>
            <TH className="text-right">Rondas</TH>
            <TH className="text-right">Bet total</TH>
            <TH className="text-right">Win total</TH>
            <TH className="text-right">Net jugador</TH>
            <TH className="text-right">Aporta al casino</TH>
          </TR>
        </THead>
        <TBody>
          {data.map((r, i) => {
            const playerNet = Number(r.netAmount);
            const casinoEarn = -playerNet;
            return (
              <TR key={r.userId}>
                <TD className="text-[var(--color-fg-subtle)]">{i + 1}</TD>
                <TD>
                  <div className="flex flex-col">
                    <span className="text-[12px] text-[var(--color-fg)]">
                      {r.displayName}
                    </span>
                    <span className="text-[10px] text-[var(--color-fg-subtle)] font-mono">
                      @{r.username}
                    </span>
                  </div>
                </TD>
                <TD className="text-right num">{r.roundsCount}</TD>
                <TD className="text-right num font-mono">{r.totalBet}</TD>
                <TD className="text-right num font-mono">{r.totalWin}</TD>
                <TD
                  className={cn(
                    'text-right num font-mono',
                    playerNet >= 0
                      ? 'text-[var(--color-success)]'
                      : 'text-[var(--color-danger)]',
                  )}
                >
                  {playerNet >= 0 ? '+' : ''}
                  {r.netAmount}
                </TD>
                <TD
                  className={cn(
                    'text-right num font-mono',
                    casinoEarn >= 0
                      ? 'text-[var(--color-success)]'
                      : 'text-[var(--color-danger)]',
                  )}
                >
                  {casinoEarn >= 0 ? '+' : ''}
                  {casinoEarn.toFixed(2)}
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Tab Rondas
// ──────────────────────────────────────────────────────────────────────

function RoundsTab({
  filters,
  onPage,
}: {
  filters: RoundsFilters;
  onPage: (offset: number) => void;
}) {
  const { data, isLoading, isError, refetch, isFetching } = useGameRounds(filters);
  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const limit = data?.limit ?? PAGE_SIZE;
  const offset = data?.offset ?? 0;

  return (
    <div className="relative bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto">
      {/* Fetching overlay when filters change */}
      {isFetching && !isLoading && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[var(--color-bg)]/60 backdrop-blur-[1px]">
          <div className="flex items-center gap-2 text-[11px] text-[var(--color-fg-subtle)]">
            <Spinner size="sm" />
            <span className="uppercase tracking-[0.08em]">Actualizando…</span>
          </div>
        </div>
      )}
      <div className="px-3 py-2 border-b border-[var(--color-border)] flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium">
          {isLoading ? 'Cargando…' : `${total} rondas · página ${Math.floor(offset / limit) + 1}`}
        </span>
        <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn('size-3', isFetching && 'animate-spin')} />
          Refrescar
        </Button>
      </div>

      {isLoading ? (
        <div className="p-4 flex flex-col gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState hint="rounds" label="Error al cargar rondas." />
      ) : rows.length === 0 ? (
        <EmptyState hint="rounds" label="Sin rondas para los filtros aplicados." />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Fecha</TH>
                <TH>Juego</TH>
                <TH>Jugador</TH>
                <TH>Status</TH>
                <TH className="text-right">Bet</TH>
                <TH className="text-right">Win</TH>
                <TH className="text-right">Net</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <RoundRowComp key={r.id} row={r} />
              ))}
            </TBody>
          </Table>

          <div className="px-3 py-2 border-t border-[var(--color-border)] flex items-center justify-between">
            <span className="text-[11px] text-[var(--color-fg-subtle)] num">
              Mostrando {offset + 1}-{offset + rows.length} de {total}
            </span>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={offset === 0}
                onClick={() => onPage(Math.max(0, offset - limit))}
              >
                ← Anterior
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!data?.hasMore}
                onClick={() => onPage(offset + limit)}
              >
                Siguiente →
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function RoundRowComp({ row }: { row: RoundRow }) {
  const net = Number(row.netAmount);
  const isWin = net > 0;
  return (
    <TR>
      <TD className="num text-[11px] text-[var(--color-fg-muted)]">
        {new Date(row.placedAt).toLocaleString('es-AR', {
          day: '2-digit',
          month: '2-digit',
          year: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </TD>
      <TD>
        <div className="flex flex-col">
          <span className="text-[12px] text-[var(--color-fg)]">{row.gameName}</span>
          <span className="text-[10px] text-[var(--color-fg-subtle)] font-mono">
            {row.gameCode}
          </span>
        </div>
      </TD>
      <TD>
        <div className="flex flex-col">
          <span className="text-[12px] text-[var(--color-fg)]">{row.displayName}</span>
          <span className="text-[10px] text-[var(--color-fg-subtle)] font-mono">
            @{row.username}
          </span>
        </div>
      </TD>
      <TD>
        <Badge
          variant={
            row.status === 'settled'
              ? 'success'
              : row.status === 'rolled_back'
                ? 'danger'
                : 'warning'
          }
        >
          {ROUND_STATUS_LABELS[row.status]}
        </Badge>
      </TD>
      <TD className="text-right num font-mono">{row.betAmount}</TD>
      <TD className="text-right num font-mono">{row.winAmount}</TD>
      <TD
        className={cn(
          'text-right num font-mono flex items-center justify-end gap-1',
          isWin
            ? 'text-[var(--color-success)]'
            : net < 0
              ? 'text-[var(--color-danger)]'
              : 'text-[var(--color-fg-muted)]',
        )}
      >
        {isWin ? (
          <ArrowDown className="size-3" />
        ) : net < 0 ? (
          <ArrowUp className="size-3" />
        ) : null}
        {isWin ? '+' : ''}
        {row.netAmount}
      </TD>
    </TR>
  );
}
