/**
 * /wallet-stats — Estadísticas de pago.
 *
 * Dos modos:
 *   - **General**: bitácora de movimientos. El registro crudo, uno por fila,
 *     para buscar o auditar un movimiento puntual. SIN KPIs agregados: los
 *     totales por red (que antes se inflaban al sumar cada nivel) viven en el
 *     modo "Netwin por red", calculados desde las fuentes autoritativas.
 *   - **Netwin por red**: tablero de negocio por ámbito (NetwinAuditView).
 */

'use client';

import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Banknote,
  Dice5,
  FileBarChart2,
  Filter,
  Gift,
  Info,
  Layers,
  Network,
  RefreshCw,
  Trophy,
  Zap,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CsvExportButton } from '@/components/ui/csv-export-button';
import { NetwinAuditView } from '@/components/admin/netwin-audit-view';
import {
  ScopePicker,
  isScopeReady,
  scopeToParams,
} from '@/components/admin/wallet-stats/scope-picker';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { UserSelect } from '@/components/ui/user-select';
import { type TenantUserRow } from '@/lib/hooks/use-users';
import { cn } from '@/lib/cn';
import {
  ROLE_LABELS,
  TX_TYPE_DESCRIPTIONS,
  TX_TYPE_LABELS,
  buildExportUrl,
  useWalletStatsMovements,
  useWalletStatsSummary,
  type MovementRow,
  type MovementsFilters,
  type ScopeKind,
  type WalletTxType,
} from '@/lib/hooks/use-wallet-stats';

// ── Dirección (in/out) según el tipo ──────────────────────────────

const INFLOW_TYPES: WalletTxType[] = [
  'mint', 'load', 'transfer_in', 'win', 'deposit',
  'bonus_grant', 'bonus_clear', 'bonus_funding_revert', 'bonus_credit',
  'jackpot_win', 'promo_reward', 'league_reward',
  'commission_payout', 'fund_release',
];

function directionOf(type: WalletTxType): 'in' | 'out' {
  return INFLOW_TYPES.includes(type) ? 'in' : 'out';
}

// ── Categorías (filtro simple de la bitácora) ─────────────────────

interface Category {
  id: string;
  label: string;
  icon: React.ReactNode;
  desc: string;
  types?: WalletTxType[];
}

const CATEGORIES: Category[] = [
  {
    id: 'all',
    label: 'Todo',
    icon: <Layers className="size-3.5" />,
    desc: 'Todos los movimientos, sin filtrar por tipo.',
  },
  {
    id: 'money',
    label: 'Depósitos, retiros y cargas',
    icon: <Banknote className="size-3.5" />,
    desc: 'Plata real (depósitos y retiros de jugadores) y cargas/retiros de fichas manuales. Mirá el motivo de cada fila en “Origen”.',
    types: ['deposit', 'withdrawal', 'load', 'unload'],
  },
  {
    id: 'game',
    label: 'Juego',
    icon: <Dice5 className="size-3.5" />,
    desc: 'Apuestas y ganancias de los jugadores. Podés separar las apuestas hechas con bono.',
    types: ['bet', 'win', 'bonus_debit'],
  },
  {
    id: 'bonus',
    label: 'Bonos',
    icon: <Gift className="size-3.5" />,
    desc: 'Bonos otorgados y fondeados, y bonos sacados o revertidos (manual o por expiración). Las apuestas con bono están en Juego.',
    types: [
      'bonus_grant', 'bonus_credit', 'bonus_funding',
      'bonus_funding_revert', 'bonus_clear',
    ],
  },
  {
    id: 'prizes',
    label: 'Premios',
    icon: <Trophy className="size-3.5" />,
    desc: 'Premios de promociones y ligas otorgados a jugadores.',
    types: ['promo_reward'],
  },
  {
    id: 'transfers',
    label: 'Transferencias',
    icon: <ArrowLeftRight className="size-3.5" />,
    desc: 'La contraparte (el lado de la Casa/emisor) de cargas, depósitos, retiros y correcciones.',
    types: ['transfer_in', 'transfer_out'],
  },
  {
    id: 'system',
    label: 'Sistema y ajustes',
    icon: <Zap className="size-3.5" />,
    desc: 'Creación y destrucción de fichas (tesorería; las comisiones pagadas en efectivo aparecen como quema) y correcciones manuales de empleados.',
    types: ['mint', 'burn', 'adjustment'],
  },
];

// ── Traducción del "origen" (source) a lenguaje claro ─────────────

const SOURCE_LABELS: Record<string, string> = {
  load_flow: 'Carga',
  unload_flow: 'Descarga',
  deposit_flow: 'Depósito',
  withdrawal_flow: 'Retiro',
  branch_chip_sale: 'Venta de fichas',
  house_budget: 'Fondeo de la Casa',
  employee_correction: 'Corrección',
  bonus_grant: 'Bono',
  deposit_bonus: 'Bono por depósito',
  vip_deposit_bonus: 'Bono VIP',
  cashier_panel: 'Caja',
  commission_burn: 'Comisión (efectivo)',
  commission_cash_settlement: 'Comisión (efectivo)',
  commission_settlement: 'Comisión',
  promo_reward: 'Premio',
  game_rollback: 'Reversa de juego',
  palace_callback: 'Juego',
};

function sourceLabel(s: string | null): string {
  if (!s) return '—';
  if (SOURCE_LABELS[s]) return SOURCE_LABELS[s];
  if (s.startsWith('test')) return '—';
  if (s.startsWith('game') || s.includes('palace')) return 'Juego';
  return s;
}

// ── Constantes ────────────────────────────────────────────────────

type Tab = 'movements' | 'summary';

const TABS: { id: Tab; label: string }[] = [
  { id: 'movements', label: 'Movimientos' },
  { id: 'summary', label: 'Resumen por tipo' },
];

type Mode = 'general' | 'audit';

const MODES: { id: Mode; label: string; icon: React.ReactNode }[] = [
  { id: 'general', label: 'General', icon: <FileBarChart2 className="size-3.5" /> },
  { id: 'audit', label: 'Netwin por red', icon: <Network className="size-3.5" /> },
];

const ROLE_FILTER_OPTIONS = [
  'usuario_final',
  'cajero',
  'distribuidor',
  'socio',
  'admin_tenant',
  'empleado',
];

const PAGE_SIZE = 50;

// ── Page ──────────────────────────────────────────────────────────

export default function WalletStatsPage() {
  const [tab, setTab] = useState<Tab>('movements');
  const [mode, setMode] = useState<Mode>('general');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [gameSub, setGameSub] = useState<'all' | 'real' | 'bonus'>('all');
  const [filters, setFilters] = useState<MovementsFilters>({
    limit: PAGE_SIZE,
    offset: 0,
  });

  // Ámbito de red (aplica a la bitácora y al export CSV).
  const [scopeKind, setScopeKind] = useState<ScopeKind>('platform');
  const [indepId, setIndepId] = useState('');
  const [panelUser, setPanelUser] = useState<TenantUserRow | null>(null);
  const scopeReady = isScopeReady(scopeKind, indepId, panelUser);

  function selectCategory(cat: Category) {
    setActiveCategory(cat.id);
    setGameSub('all');
    setFilters((prev) => ({ ...prev, type: cat.types, offset: 0 }));
  }

  // Filtros efectivos = filtros + ámbito de red (cuando aplica). Con
  // 'platform' o un ámbito sin elegir, no se manda scope (bitácora completa).
  const effectiveFilters = useMemo<MovementsFilters>(() => {
    if (scopeKind === 'platform' || !scopeReady) return filters;
    const { scope, scopeId } = scopeToParams(scopeKind, indepId, panelUser);
    return { ...filters, scope, scopeId };
  }, [filters, scopeKind, indepId, panelUser, scopeReady]);

  const exportUrl = useMemo(
    () => buildExportUrl(effectiveFilters),
    [effectiveFilters],
  );

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-2">
        <div className="flex flex-col gap-2">
          <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
            <FileBarChart2 className="size-3" />
            Reporting · Wallet
          </span>
          <h1 className="font-display text-3xl lg:text-[2.5rem] leading-none tracking-tight">
            Estadísticas de pago
          </h1>
          <p className="text-sm text-[var(--color-fg-muted)] mt-1">
            El registro de todos los movimientos de fichas y los totales de
            netwin por red.
          </p>
        </div>
        {mode === 'general' && (
          <CsvExportButton
            path={exportUrl}
            filenameHint="wallet_stats"
            entityLabel="movimientos"
            label="Exportar CSV"
          />
        )}
      </header>

      {/* Selector de modo: General vs Netwin por red */}
      <div className="flex flex-wrap gap-1.5">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            className={cn(
              'px-4 h-9 text-[12px] font-medium border transition-colors flex items-center gap-2',
              mode === m.id
                ? 'bg-[var(--color-accent)] text-[var(--color-accent-fg)] border-[var(--color-accent)]'
                : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] border-[var(--color-border)] hover:text-[var(--color-fg)]',
            )}
          >
            {m.icon}
            {m.label}
          </button>
        ))}
      </div>

      {mode === 'audit' ? (
        <NetwinAuditView />
      ) : (
        <>
          <GeneralIntro />

          {/* Ámbito de red — aplica a la bitácora y al export CSV */}
          <ScopePicker
            label="Ámbito de red (filtra la bitácora y el CSV)"
            scopeKind={scopeKind}
            onScopeKind={(k) => {
              setScopeKind(k);
              setFilters((f) => ({ ...f, offset: 0 }));
            }}
            indepId={indepId}
            onIndepId={(id) => {
              setIndepId(id);
              setFilters((f) => ({ ...f, offset: 0 }));
            }}
            panelUser={panelUser}
            onPanelUser={(u) => {
              setPanelUser(u);
              setFilters((f) => ({ ...f, offset: 0 }));
            }}
          />

          <CategoryBar
            activeCategory={activeCategory}
            onSelect={selectCategory}
            filters={effectiveFilters}
          />

          {/* Sub-filtro de Juego: discriminar apuestas con bono */}
          {activeCategory === 'game' && (
            <GameSubFilter
              value={gameSub}
              onChange={(v) => {
                setGameSub(v);
                const types: WalletTxType[] =
                  v === 'real'
                    ? ['bet', 'win']
                    : v === 'bonus'
                      ? ['bonus_debit']
                      : ['bet', 'win', 'bonus_debit'];
                setFilters((f) => ({ ...f, type: types, offset: 0 }));
              }}
            />
          )}

          {/* Tabs */}
          <div className="flex items-center gap-px bg-[var(--color-border)] border border-[var(--color-border)] self-start">
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

          <FiltersBar filters={filters} onChange={setFilters} />

          <TabContent
            tab={tab}
            filters={effectiveFilters}
            onPage={(o) => setFilters({ ...filters, offset: o })}
          />
        </>
      )}
    </div>
  );
}

// ── Intro de General ──────────────────────────────────────────────

function GeneralIntro() {
  return (
    <div className="flex items-start gap-3 px-4 py-3 border border-[var(--color-border)] bg-[var(--color-bg)] border-l-2 border-l-[var(--color-accent)]">
      <Info className="size-4 text-[var(--color-accent-text)] mt-0.5 shrink-0" />
      <div className="text-[12px] text-[var(--color-fg)] leading-snug">
        <strong>Registro de movimientos.</strong> Acá ves el detalle de cada
        movimiento de fichas (uno por fila) para <strong>buscar o auditar</strong>{' '}
        algo puntual. Para ver los <strong>totales por red</strong> — netwin,
        plata, bonos, bien calculados y sin repetir el mismo dinero — usá el modo{' '}
        <strong>“Netwin por red”</strong> de arriba.
      </div>
    </div>
  );
}

// ── Barra de categorías ───────────────────────────────────────────

function CategoryBar({
  activeCategory,
  onSelect,
  filters,
}: {
  activeCategory: string;
  onSelect: (cat: Category) => void;
  filters: MovementsFilters;
}) {
  const { isFetching } = useWalletStatsMovements(filters);

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] font-medium flex items-center gap-1.5">
        Categoría
        {isFetching && <Spinner size="sm" className="text-[var(--color-fg-subtle)]" />}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c)}
            className={cn(
              'group/c relative px-3 h-9 text-[11px] font-medium border transition-colors flex items-center gap-1.5',
              activeCategory === c.id
                ? 'bg-[var(--color-accent)] text-[var(--color-accent-fg)] border-[var(--color-accent)]'
                : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg)]',
            )}
          >
            {c.icon}
            {c.label}
            <div className="pointer-events-none absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 p-2 text-[11px] leading-snug text-[var(--color-fg)] bg-[var(--color-bg)] border border-[var(--color-border)] shadow-lg opacity-0 group-hover/c:opacity-100 transition-opacity duration-150">
              {c.desc}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Sub-filtro de Juego (apuestas con/ sin bono) ──────────────────

function GameSubFilter({
  value,
  onChange,
}: {
  value: 'all' | 'real' | 'bonus';
  onChange: (v: 'all' | 'real' | 'bonus') => void;
}) {
  const opts: { id: 'all' | 'real' | 'bonus'; label: string }[] = [
    { id: 'all', label: 'Todas las apuestas' },
    { id: 'real', label: 'Solo con fichas reales' },
    { id: 'bonus', label: 'Solo con bono' },
  ];
  return (
    <div className="flex flex-wrap items-center gap-1.5 pl-1">
      <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] mr-1">
        Apuestas:
      </span>
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={cn(
            'px-2.5 h-7 text-[10px] font-medium border transition-colors',
            value === o.id
              ? 'bg-[var(--color-accent)] text-[var(--color-accent-fg)] border-[var(--color-accent)]'
              : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] border-[var(--color-border)] hover:text-[var(--color-fg)]',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Contenido del tab (con overlay de carga) ──────────────────────

function TabContent({
  tab,
  filters,
  onPage,
}: {
  tab: Tab;
  filters: MovementsFilters;
  onPage: (offset: number) => void;
}) {
  const { isLoading, isFetching } = useWalletStatsMovements(
    tab === 'movements' ? filters : { limit: 1, offset: 0 },
  );
  const showOverlay = isFetching && !isLoading;

  return (
    <div className="relative min-h-[200px]">
      {showOverlay && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[var(--color-bg)]/60 backdrop-blur-[1px]">
          <div className="flex items-center gap-2 text-[11px] text-[var(--color-fg-subtle)]">
            <Spinner size="sm" />
            <span className="uppercase tracking-[0.08em]">Actualizando…</span>
          </div>
        </div>
      )}
      {tab === 'movements' && <MovementsTab filters={filters} onPage={onPage} />}
      {tab === 'summary' && <SummaryTab filters={filters} />}
    </div>
  );
}

// ── Filtros ───────────────────────────────────────────────────────

function FiltersBar({
  filters,
  onChange,
}: {
  filters: MovementsFilters;
  onChange: (f: MovementsFilters) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [titular, setTitular] = useState<TenantUserRow | null>(null);
  const [actor, setActor] = useState<TenantUserRow | null>(null);

  const selectedRoles = useMemo(
    () =>
      Array.isArray(filters.ownerRole)
        ? filters.ownerRole
        : filters.ownerRole
          ? [filters.ownerRole]
          : [],
    [filters.ownerRole],
  );

  function toggleRole(r: string) {
    const next = selectedRoles.includes(r)
      ? selectedRoles.filter((x) => x !== r)
      : [...selectedRoles, r];
    onChange({ ...filters, ownerRole: next.length ? next : undefined, offset: 0 });
  }

  function clearAdvanced() {
    setTitular(null);
    setActor(null);
    onChange({
      ...filters,
      dateFrom: undefined,
      dateTo: undefined,
      userId: undefined,
      actorId: undefined,
      ownerRole: undefined,
      offset: 0,
    });
  }

  function applyPreset(preset: { dateFrom?: string; dateTo?: string }) {
    onChange({ ...filters, ...preset, offset: 0 });
  }

  const activeCount =
    selectedRoles.length +
    (filters.dateFrom ? 1 : 0) +
    (filters.dateTo ? 1 : 0) +
    (filters.userId ? 1 : 0) +
    (filters.actorId ? 1 : 0);

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const startOf30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const presets = [
    { label: 'Hoy', dateFrom: startOfDay, dateTo: undefined },
    { label: '7 días', dateFrom: startOfWeek, dateTo: undefined },
    { label: '30 días', dateFrom: startOf30d, dateTo: undefined },
    { label: 'Este mes', dateFrom: startOfMonth, dateTo: undefined },
  ];
  const activePreset = presets.find(
    (p) => filters.dateFrom === p.dateFrom && !filters.dateTo,
  );

  return (
    <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] flex flex-col">
      {/* Barra principal */}
      <div className="px-4 py-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium hover:text-[var(--color-fg)] transition-colors"
        >
          <Filter className="size-3" />
          Buscar
          {activeCount > 0 && <Badge variant="neutral" className="ml-1">{activeCount}</Badge>}
          <span className="text-[var(--color-fg-disabled)] ml-1">{expanded ? '▲' : '▼'}</span>
        </button>

        {/* Presets de fecha */}
        <div className="flex items-center gap-1.5 ml-2">
          <span className="text-[10px] text-[var(--color-fg-subtle)] mr-1">Período:</span>
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() =>
                applyPreset(activePreset === p ? { dateFrom: undefined, dateTo: undefined } : p)
              }
              className={cn(
                'px-2.5 h-6 text-[10px] font-medium border transition-colors',
                activePreset === p
                  ? 'bg-[var(--color-accent)] text-[var(--color-accent-fg)] border-[var(--color-accent)]'
                  : 'bg-[var(--color-bg)] text-[var(--color-fg-muted)] border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg)]',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        {activeCount > 0 && (
          <Button variant="ghost" size="sm" onClick={clearAdvanced} className="ml-auto h-6 text-[10px]">
            Limpiar
          </Button>
        )}
      </div>

      {/* Panel expandido */}
      {expanded && (
        <div className="border-t border-[var(--color-border)] px-4 py-3 flex flex-col gap-4">
          {/* Buscadores de usuario + fechas custom */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label className="text-[10px]">Titular (de quién es el movimiento)</Label>
              <UserSelect
                value={titular}
                onSelect={(u) => {
                  setTitular(u);
                  onChange({ ...filters, userId: u?.id, offset: 0 });
                }}
                includeSelf
                placeholder="Buscar por nombre…"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[10px]">Quién lo hizo</Label>
              <UserSelect
                value={actor}
                onSelect={(u) => {
                  setActor(u);
                  onChange({ ...filters, actorId: u?.id, offset: 0 });
                }}
                includeSelf
                placeholder="Buscar por nombre…"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="ws-date-from" className="text-[10px]">Desde</Label>
              <Input
                id="ws-date-from"
                type="datetime-local"
                value={filters.dateFrom ? filters.dateFrom.slice(0, 16) : ''}
                onChange={(e) =>
                  onChange({
                    ...filters,
                    dateFrom: e.target.value ? new Date(e.target.value).toISOString() : undefined,
                    offset: 0,
                  })
                }
                className="h-8 text-[11px]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="ws-date-to" className="text-[10px]">Hasta</Label>
              <Input
                id="ws-date-to"
                type="datetime-local"
                value={filters.dateTo ? filters.dateTo.slice(0, 16) : ''}
                onChange={(e) =>
                  onChange({
                    ...filters,
                    dateTo: e.target.value ? new Date(e.target.value).toISOString() : undefined,
                    offset: 0,
                  })
                }
                className="h-8 text-[11px]"
              />
            </div>
          </div>

          {/* Rol del titular */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)]">
              Rol del titular
            </span>
            <div className="flex flex-wrap gap-1.5">
              {ROLE_FILTER_OPTIONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => toggleRole(r)}
                  className={cn(
                    'px-2.5 h-7 text-[10px] border transition-colors',
                    selectedRoles.includes(r)
                      ? 'bg-[var(--color-accent)] text-[var(--color-accent-fg)] border-[var(--color-accent)]'
                      : 'bg-[var(--color-bg)] text-[var(--color-fg-muted)] border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg)]',
                  )}
                >
                  {ROLE_LABELS[r] ?? r}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab: Movimientos (la bitácora) ────────────────────────────────

function MovementsTab({
  filters,
  onPage,
}: {
  filters: MovementsFilters;
  onPage: (offset: number) => void;
}) {
  const { data, isLoading, isError, refetch, isFetching } = useWalletStatsMovements(filters);
  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const limit = data?.limit ?? PAGE_SIZE;
  const offset = data?.offset ?? 0;

  return (
    <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto">
      <div className="px-3 py-2 border-b border-[var(--color-border)] flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium">
          {isLoading
            ? 'Cargando…'
            : `${total} movimientos · página ${Math.floor(offset / limit) + 1}`}
        </span>
        <Button variant="ghost" size="sm" onClick={() => void refetch()} disabled={isFetching}>
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
        <EmptyState
          hint="movements"
          label="Error al cargar — verificá la conexión o intentá refrescar."
        />
      ) : rows.length === 0 ? (
        <EmptyState hint="movements" label="Sin movimientos para lo que buscaste." />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Fecha</TH>
                <TH>Movimiento</TH>
                <TH className="text-right">Monto</TH>
                <TH>Titular</TH>
                <TH className="hidden md:table-cell">Quién lo hizo</TH>
                <TH className="hidden lg:table-cell">Origen</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <MovementRowComponent key={r.id} row={r} />
              ))}
            </TBody>
          </Table>

          {/* Paginación */}
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

function MovementRowComponent({ row }: { row: MovementRow }) {
  const dir = directionOf(row.type);
  return (
    <TR>
      <TD className="num text-[11px] text-[var(--color-fg-muted)] whitespace-nowrap">
        {new Date(row.createdAt).toLocaleString('es-AR', {
          day: '2-digit',
          month: '2-digit',
          year: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </TD>
      <TD>
        <div className="relative group/mt inline-flex items-center gap-1.5">
          {dir === 'in' ? (
            <ArrowDownLeft className="size-3 text-[var(--color-success)]" />
          ) : (
            <ArrowUpRight className="size-3 text-[var(--color-danger)]" />
          )}
          <span className="text-[12px]">{TX_TYPE_LABELS[row.type] ?? row.type}</span>
          {/* Tooltip explicando el tipo */}
          <div className="pointer-events-none absolute z-50 top-full left-0 mt-1.5 w-64 p-2.5 text-[11px] leading-snug text-[var(--color-fg-muted)] bg-[var(--color-bg)] border border-[var(--color-border)] shadow-lg opacity-0 group-hover/mt:opacity-100 transition-opacity duration-150">
            {TX_TYPE_DESCRIPTIONS[row.type]}
          </div>
        </div>
      </TD>
      <TD className="text-right num font-mono whitespace-nowrap">
        <span
          className={
            dir === 'in' ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'
          }
        >
          {dir === 'in' ? '+' : '−'}
          {row.amount}
        </span>
      </TD>
      <TD>
        <div className="flex flex-col">
          <span className="text-[12px] text-[var(--color-fg)]">{row.ownerDisplayName}</span>
          <span className="text-[10px] text-[var(--color-fg-subtle)] font-mono">
            @{row.ownerUsername}
            {row.ownerRole && (
              <span className="ml-1 text-[var(--color-fg-disabled)]">
                · {ROLE_LABELS[row.ownerRole] ?? row.ownerRole}
              </span>
            )}
          </span>
        </div>
      </TD>
      <TD className="hidden md:table-cell text-[11px] text-[var(--color-fg-muted)]">
        {row.actorUsername ? `@${row.actorUsername}` : 'sistema'}
      </TD>
      <TD className="hidden lg:table-cell text-[11px] text-[var(--color-fg-muted)]">
        {sourceLabel(row.source)}
      </TD>
    </TR>
  );
}

// ── Tab: Resumen por tipo ─────────────────────────────────────────

function SummaryTab({ filters }: { filters: MovementsFilters }) {
  const { data, isLoading, isError } = useWalletStatsSummary({
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    scope: filters.scope,
    scopeId: filters.scopeId,
  });

  if (isLoading) return <Skeleton className="h-64" />;
  if (isError || !data) {
    return <EmptyState hint="summary" label="Error al cargar el resumen — verificá la conexión." />;
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Aviso de suma cruda */}
      <div className="flex items-start gap-2 px-3 py-2 border border-[var(--color-border)] bg-[var(--color-bg)] text-[11px] text-[var(--color-fg-muted)] leading-snug">
        <Info className="size-3.5 text-[var(--color-fg-subtle)] mt-0.5 shrink-0" />
        <span>
          Son <strong>sumas crudas</strong> de los movimientos en el período (por
          tipo). El mismo dinero puede aparecer en varios niveles de la red — para
          los totales <strong>reales</strong> por red usá “Netwin por red”.
        </span>
      </div>

      {/* Ventana + count */}
      <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] p-4 flex flex-wrap items-center justify-between gap-2 text-[12px]">
        <span className="text-[var(--color-fg-muted)]">
          Período:{' '}
          <span className="text-[var(--color-fg)] font-mono">
            {new Date(data.dateFrom).toLocaleDateString('es-AR')} →{' '}
            {new Date(data.dateTo).toLocaleDateString('es-AR')}
          </span>
        </span>
        <span className="text-[var(--color-fg-muted)]">
          Movimientos:{' '}
          <span className="text-[var(--color-fg)] font-mono num">{data.txCount}</span>
        </span>
      </div>

      {/* Detalle por tipo */}
      <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto">
        <Table>
          <THead>
            <TR>
              <TH>Tipo de movimiento</TH>
              <TH className="text-right">Cantidad</TH>
              <TH className="text-right">Monto total</TH>
            </TR>
          </THead>
          <TBody>
            {Object.keys(data.countByType).length === 0 ? (
              <TR>
                <TD colSpan={3}>
                  <EmptyState hint="data" label="Sin movimientos en el período." />
                </TD>
              </TR>
            ) : (
              Object.entries(data.countByType)
                .sort(([, a], [, b]) => b - a)
                .map(([type, count]) => (
                  <TR key={type}>
                    <TD className="text-[12px]">
                      {TX_TYPE_LABELS[type as WalletTxType] ?? type}
                    </TD>
                    <TD className="text-right num">{count}</TD>
                    <TD className="text-right num font-mono">
                      {data.amountByType[type] ?? '0'}
                    </TD>
                  </TR>
                ))
            )}
          </TBody>
        </Table>
      </div>
    </div>
  );
}
