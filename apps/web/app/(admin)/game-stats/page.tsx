/**
 * /game-stats — Estadísticas de juego (Sprint 46).
 *
 * Pedido del dueño 2026-05-20 item B: "registre todas las jugadas".
 *
 * Sprint post-56 (2026-08-14): lenguaje y UX alineados con Estadísticas de
 * pago (`/wallet-stats`), a pedido del dueño — mismos términos para el mismo
 * concepto en las dos pantallas de reporting (Netwin en vez de GGR, etc.),
 * buscador de jugador por nombre en vez de pegar un UUID a mano, y un
 * glosario colapsable con las definiciones (mismo patrón que el panel
 * "¿De dónde salen estos números?" del Resumen financiero).
 *
 * Tabs:
 *   - Resumen: KPIs globales (Netwin, Devolución/RTP, jugadores únicos).
 *   - Por juego: breakdown con flag si la devolución real diverge >5pts del objetivo.
 *   - Por jugador: ranking por volumen apostado.
 *   - Rondas: tabla detallada filtrable de cada jugada individual.
 *
 * Permisos: game_stats.view_any (admin) / view_own_network (red) / export.
 */

'use client';

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Dices,
  Filter,
  Info,
  RefreshCw,
} from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CsvExportButton } from '@/components/ui/csv-export-button';
import { EmptyState } from '@/components/ui/empty-state';
import { HelpNote } from '@/components/ui/help-note';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { PageShell } from '@/components/ui/page-shell';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { TabStrip } from '@/components/ui/tab-strip';
import { UserSelect } from '@/components/ui/user-select';
import { operatorAudience, useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';
import { arDatetimeLocalToIso, isoToArDatetimeLocal } from '@/lib/format-date';
import { useActiveGames } from '@/lib/hooks/use-games';
import { type TenantUserRow } from '@/lib/hooks/use-users';
import {
  buildGameStatsExportUrl,
  ROUND_STATUS_LABELS,
  useGameRounds,
  useGameStatsByGame,
  useGameStatsByPlayer,
  useGameStatsReconciliation,
  useGameStatsSummary,
  type RoundRow,
  type RoundsFilters,
} from '@/lib/hooks/use-game-stats';

const BUCKET_LABELS: Record<string, string> = {
  today: 'Hoy',
  '7d': '7 días',
  '30d': '30 días',
  custom: 'Personalizado',
};

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

  // Audiencia: solo para el copy de ayuda. El admin ve todo el tenant; el
  // operador (dependiente o independiente) ya sale scopeado a su red por el
  // backend. No toca la lógica de scope ni el gating existente.
  const { user } = useAuth();
  const isOperator = operatorAudience(user) !== 'admin';

  return (
    <PageShell className="max-w-[1400px]">
      {/* Header */}
      <PageHeader
        icon={Dices}
        title="Estadísticas de juego"
        description={
          isOperator
            ? 'Cómo vienen los juegos en tu red: cuánto se apostó, la netwin, la devolución (RTP) real vs la objetivo, el ranking de jugadores y el historial de rondas.'
            : 'Cómo vienen los juegos en todo el tenant: cuánto se apostó, la netwin, la devolución (RTP) real vs la objetivo, el ranking de jugadores y el historial de rondas.'
        }
        actions={
          <CsvExportButton
            path={buildGameStatsExportUrl(filters)}
            filenameHint="game_stats"
            permission="game_stats.export"
            entityLabel="estadísticas de juego"
            label="Exportar CSV"
          />
        }
      />

      <HelpNote id="game-stats">
        {isOperator ? (
          <>Acá ves cómo le va a tu red con los juegos. </>
        ) : (
          <>Acá ves cómo le va al casino con los juegos. </>
        )}
        Tiene{' '}
        <strong>4 pestañas</strong>: <strong>Resumen</strong> (los números
        generales del período), <strong>Por juego</strong> (cómo rinde cada
        juego, con su devolución real vs la esperada), <strong>Por jugador</strong>{' '}
        (quiénes más apostaron y cuánto dejaron) y <strong>Rondas</strong> (cada
        jugada, una por fila, para revisar algo puntual). Es de{' '}
        <strong>solo lectura</strong> y no cuenta las rondas que se revirtieron.
        Si algún término no te cierra, abrí <strong>“¿Qué significa cada cosa?”</strong>{' '}
        acá abajo.
      </HelpNote>

      <GlossaryPanel />

      {/* Tabs */}
      <TabStrip className="sm:self-start" label="Secciones de estadísticas">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'shrink-0 whitespace-nowrap px-4 h-11 lg:h-8 text-[11px] uppercase tracking-[0.08em] font-medium',
              'transition-colors duration-150',
              tab === t.id
                ? 'bg-[var(--color-bg)] text-[var(--color-fg)] border-b-2 border-b-[var(--color-accent)]'
                : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]',
            )}
          >
            {t.label}
          </button>
        ))}
      </TabStrip>

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
    </PageShell>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Glosario — mismo patrón que "¿De dónde salen estos números?" del
// Resumen financiero. Colapsable, cerrado por defecto.
// ──────────────────────────────────────────────────────────────────────

function GlossaryPanel() {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius)] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-[var(--color-bg-subtle)]"
      >
        <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
          <Info className="size-3.5 text-[var(--color-accent-text)]" />
          ¿Qué significa cada cosa?
        </span>
        <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="p-4 border-t border-[var(--color-border)] flex flex-col gap-2.5 text-[12px] text-[var(--color-fg-muted)] leading-snug">
          <GlossaryLine
            term="Netwin"
            desc="Apostado − ganado. Es la ganancia del casino con el juego (si es negativo, ganaron los jugadores). Mismo concepto y nombre que en Estadísticas de pago."
          />
          <GlossaryLine
            term="Devolución (RTP)"
            desc="Return to Player — de $100 apostados, cuánto volvió a los jugadores en premios. RTP objetivo es el configurado para el juego; si el real diverge más de 5 puntos, la fila queda marcada para revisar."
          />
          <GlossaryLine
            term="Ronda"
            desc="Una jugada individual: una apuesta con su resultado. Puede estar En curso (sin resultado todavía), Cerrada (liquidada) o Revertida (se anuló, no cuenta para nada)."
          />
          <GlossaryLine
            term="Aporta al casino"
            desc="Lo opuesto al neto del jugador — si el jugador perdió $500, esta columna muestra +$500 (lo que le quedó al casino de ese jugador)."
          />
          <p className="pt-1.5 border-t border-[var(--color-border)] text-[var(--color-fg-subtle)]">
            Esta página cuenta las rondas por <strong className="text-[var(--color-fg-muted)]">cuándo se apostaron</strong>{' '}
            e incluye las que están en curso. <strong className="text-[var(--color-fg-muted)]">Estadísticas de pago</strong> y{' '}
            <strong className="text-[var(--color-fg-muted)]">Comisiones</strong> cuentan solo lo ya cerrado — por eso el
            Netwin de acá puede no coincidir exacto con esas páginas para el mismo rango de fechas. El panel
            "¿Por qué esto puede no coincidir…?" de la pestaña Resumen desglosa la diferencia.
          </p>
        </div>
      )}
    </div>
  );
}

function GlossaryLine({ term, desc }: { term: string; desc: string }) {
  return (
    <p>
      <strong className="text-[var(--color-fg)]">{term}:</strong> {desc}
    </p>
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
  const [player, setPlayer] = useState<TenantUserRow | null>(null);
  const games = useActiveGames({ limit: 500 });

  const activeCount =
    (filters.gameCode ? 1 : 0) +
    (filters.userId ? 1 : 0) +
    (filters.dateFrom ? 1 : 0) +
    (filters.dateTo ? 1 : 0) +
    (filters.outcome ? 1 : 0);

  function clearAll() {
    setPlayer(null);
    onChange({ limit: PAGE_SIZE, offset: 0 });
  }

  return (
    <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius)] overflow-x-auto p-4 flex flex-col gap-4">
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
            value={filters.dateFrom ? isoToArDatetimeLocal(filters.dateFrom) : ''}
            onChange={(e) =>
              onChange({
                ...filters,
                dateFrom: arDatetimeLocalToIso(e.target.value),
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
            value={filters.dateTo ? isoToArDatetimeLocal(filters.dateTo) : ''}
            onChange={(e) =>
              onChange({
                ...filters,
                dateTo: arDatetimeLocalToIso(e.target.value),
                offset: 0,
              })
            }
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gs-game-code">Juego</Label>
          <Select
            id="gs-game-code"
            value={filters.gameCode ?? ''}
            onChange={(e) =>
              onChange({ ...filters, gameCode: e.target.value || undefined, offset: 0 })
            }
          >
            <option value="">Todos</option>
            {games.data?.data.map((g) => (
              <option key={g.code} value={g.code}>
                {g.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Jugador</Label>
          <UserSelect
            value={player}
            onSelect={(u) => {
              setPlayer(u);
              onChange({ ...filters, userId: u?.id, offset: 0 });
            }}
            placeholder="Buscar por nombre…"
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
                    ? 'bg-[var(--color-bg-subtle)] text-[var(--color-fg)] border-[var(--color-border-strong)]'
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
        <Kpi label="Apostado" value={data.totalBet} tone="muted" help="lo que apostaron los jugadores" />
        <Kpi label="Ganado" value={data.totalWin} tone="muted" help="lo que ganaron los jugadores" />
        <Kpi
          label="Netwin (casino)"
          value={data.ggr}
          tone={Number(data.ggr) >= 0 ? 'success' : 'danger'}
          help="apostado − ganado"
        />
        <Kpi
          label="Devolución (RTP)"
          value={`${data.rtpRealPct}%`}
          tone="muted"
          help="de $100 apostados, cuánto volvió"
        />
      </div>

      <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius)] overflow-x-auto p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-[12px]">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)]">
            Ventana
          </span>
          <span className="text-[var(--color-fg)] font-mono">
            {new Date(data.dateFrom).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })} →{' '}
            {new Date(data.dateTo).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}
          </span>
          <Badge variant="neutral">{BUCKET_LABELS[data.bucket] ?? data.bucket}</Badge>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)]">
            Rondas
          </span>
          <span className="text-[var(--color-fg)] font-mono num text-[1.25rem]">
            {data.roundsCount}
          </span>
          <span className="text-[10px] text-[var(--color-fg-subtle)]">
            {data.rolledBackCount} revertidas (no cuentan)
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

      <ReconciliationPanel filters={{ dateFrom: filters.dateFrom, dateTo: filters.dateTo }} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Diagnóstico de reconciliación — por qué esto puede no matchear con
// Estadísticas de pago/Comisiones. Colapsable, cerrado por defecto.
// ──────────────────────────────────────────────────────────────────────

function ReconciliationPanel({
  filters,
}: {
  filters: { dateFrom?: string; dateTo?: string };
}) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError } = useGameStatsReconciliation(filters, open);

  const fmt = (x: string) => Number(x).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const oldest = data?.oldestInFlightAgeHours ?? null;
  const oldestSuspicious = oldest !== null && oldest > 24;

  return (
    <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius)] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-[var(--color-bg-subtle)]"
      >
        <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
          <Info className="size-3.5 text-[var(--color-accent-text)]" />
          ¿Por qué esto puede no coincidir con Estadísticas de pago?
        </span>
        <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="p-4 border-t border-[var(--color-border)] flex flex-col gap-4 text-[12px]">
          <p className="text-[var(--color-fg-muted)] leading-snug">
            Esta página cuenta por <strong className="text-[var(--color-fg)]">cuándo se apostó</strong> e
            incluye rondas todavía en curso. Estadísticas de pago/Comisiones cuentan solo por{' '}
            <strong className="text-[var(--color-fg)]">cuándo se liquidó</strong>, y solo lo ya cerrado.
            Acá vas a ver esas tres partes separadas para la misma ventana de fechas elegida arriba.
          </p>

          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
          ) : isError || !data ? (
            <EmptyState hint="data" label="No se pudo cargar el diagnóstico." />
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <ReconciliationTile
                  label="Ya liquidado (por fecha de apuesta)"
                  bucket={data.byPlacedAt.settled}
                  fmt={fmt}
                  hint="parte de esta página que ya cerró"
                />
                <ReconciliationTile
                  label="En curso, sin liquidar"
                  bucket={data.byPlacedAt.inFlight}
                  fmt={fmt}
                  hint="incluido acá, NO en Pago/Comisiones"
                  accent
                />
                <ReconciliationTile
                  label="Liquidado (por fecha de liquidación)"
                  bucket={data.bySettledAt.settled}
                  fmt={fmt}
                  hint="esto debería matchear Pago/Comisiones"
                />
              </div>

              <div
                className={cn(
                  'flex items-center gap-2 px-3 py-2 border text-[11px]',
                  oldestSuspicious
                    ? 'border-[var(--color-warning)] bg-[var(--color-warning-bg)] text-[var(--color-warning)]'
                    : 'border-[var(--color-border)] text-[var(--color-fg-subtle)]',
                )}
              >
                {oldestSuspicious && <AlertTriangle className="size-3.5 shrink-0" />}
                {oldest === null
                  ? 'No hay ninguna ronda en curso ahora mismo.'
                  : oldestSuspicious
                    ? `La ronda en curso más vieja tiene ${oldest.toFixed(1)}hs sin liquidar — si esto se repite, puede haber rondas trabadas en el proveedor de juego (vale la pena revisar).`
                    : `La ronda en curso más vieja tiene ${oldest.toFixed(1)}hs — normal para juego activo.`}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ReconciliationTile({
  label,
  bucket,
  fmt,
  hint,
  accent,
}: {
  label: string;
  bucket: { count: number; bet: string; win: string };
  fmt: (x: string) => string;
  hint: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        'p-3 border flex flex-col gap-1.5',
        accent
          ? 'border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)]'
          : 'border-[var(--color-border)] bg-[var(--color-bg)]',
      )}
    >
      <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)]">{label}</span>
      <span className="font-mono text-[15px] text-[var(--color-fg)]">
        {fmt((Number(bucket.bet) - Number(bucket.win)).toFixed(2))}
      </span>
      <span className="text-[10px] text-[var(--color-fg-subtle)]">
        {bucket.count} rondas · apostado {fmt(bucket.bet)} · ganado {fmt(bucket.win)}
      </span>
      <span className="text-[10px] text-[var(--color-fg-subtle)] italic">{hint}</span>
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
    <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius)] overflow-x-auto p-4 flex flex-col gap-1">
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
    <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius)] overflow-x-auto">
      <div className="px-3 py-2 border-b border-[var(--color-border)]">
        <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium">
          {data.length} juegos con actividad · se marcan los que divergen {'>'} ±5 puntos de su objetivo
        </span>
      </div>
      <Table>
        <THead>
          <TR>
            <TH>Juego</TH>
            <TH className="text-right">Rondas</TH>
            <TH className="text-right">Jugadores</TH>
            <TH className="text-right">Apostado</TH>
            <TH className="text-right">Ganado</TH>
            <TH className="text-right">Netwin</TH>
            <TH className="text-right">Devolución</TH>
            <TH className="text-right">Objetivo</TH>
            <TH className="text-right">Diferencia</TH>
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
                      aria-label="Devolución fuera del objetivo"
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
    <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius)] overflow-x-auto">
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
            <TH className="text-right">Apostado</TH>
            <TH className="text-right">Ganado</TH>
            <TH className="text-right">Neto del jugador</TH>
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
    <div className="relative bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius)] overflow-x-auto">
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
                <TH>Proveedor</TH>
                <TH>Juego</TH>
                <TH>Jugador</TH>
                <TH>ID jugada</TH>
                <TH className="text-right">Apostado</TH>
                <TH className="text-right">Ganado</TH>
                <TH className="text-right">Neto</TH>
                <TH className="text-right">Saldo</TH>
                <TH>Estado</TH>
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
          timeZone: 'America/Argentina/Buenos_Aires',
          day: '2-digit',
          month: '2-digit',
          year: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </TD>
      <TD>
        <span className="text-[11px] text-[var(--color-fg-muted)] uppercase font-mono">
          {row.providerCode}
        </span>
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
        <span
          className="text-[11px] text-[var(--color-fg-subtle)] font-mono"
          title={row.roundExternalId}
        >
          {row.roundExternalId.length > 14
            ? `${row.roundExternalId.slice(0, 14)}…`
            : row.roundExternalId}
        </span>
      </TD>
      <TD className="text-right num font-mono">{row.betAmount}</TD>
      <TD className="text-right num font-mono">{row.winAmount}</TD>
      <TD
        className={cn(
          'text-right num font-mono',
          isWin
            ? 'text-[var(--color-success)]'
            : net < 0
              ? 'text-[var(--color-danger)]'
              : 'text-[var(--color-fg-muted)]',
        )}
      >
        {/* El flex va en un span, NO en el TD: `display:flex` sobre una celda
            pisa el `display:table-cell` y la saca de la alineación vertical de
            la fila — se veía levantada respecto de las demás columnas. */}
        <span className="inline-flex items-center justify-end gap-1">
          {/* La flecha sigue el signo del número que se muestra, que es el neto
              DEL JUGADOR. Antes iba al revés (ganancia → flecha abajo) porque
              estaba pensada desde el lado del casino, y chocaba con el número y
              el color de la misma celda, que sí son del lado del jugador. */}
          {isWin ? (
            <ArrowUp className="size-3" />
          ) : net < 0 ? (
            <ArrowDown className="size-3" />
          ) : null}
          {isWin ? '+' : ''}
          {row.netAmount}
        </span>
      </TD>
      <TD className="text-right num font-mono text-[var(--color-fg-muted)]">
        {row.balanceAfter ?? '—'}
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
    </TR>
  );
}
