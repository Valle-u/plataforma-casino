/**
 * /wallet-stats — Estadísticas de pago.
 *
 * Reporting consolidado read-only sobre `wallet_transactions`.
 *
 * Sistema de "vistas" (presets):
 *   - Todo: vista completa con todos los tipos.
 *   - Dinero real: cargas, retiros, depósitos.
 *   - Settlement: apuestas vs ganancias (proveedores).
 *   - Bonos: ciclo de vida de bonos.
 *   - Sistema: mint, burn, ajustes.
 *   - Transferencias: envíos entre usuarios + comisiones + premios.
 *
 * Cada vista auto-filtra por tipos y muestra KPIs contextuales.
 */

'use client';

import {
  ArrowDownLeft,
  ArrowUpRight,
  BadgePercent,
  Banknote,
  Coins,
  Dice5,
  FileBarChart2,
  Filter,
  Network,
  RefreshCw,
  Send,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CsvExportButton } from '@/components/ui/csv-export-button';
import { NetwinAuditView } from '@/components/admin/netwin-audit-view';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import {
  ROLE_LABELS,
  TX_TYPE_DESCRIPTIONS,
  TX_TYPE_GROUPS,
  TX_TYPE_LABELS,
  buildExportUrl,
  useWalletStatsByRole,
  useWalletStatsMovements,
  useWalletStatsSummary,
  type MovementRow,
  type MovementsFilters,
  type WalletTxType,
} from '@/lib/hooks/use-wallet-stats';

// ── Definición de vistas ──────────────────────────────────────────

interface ViewPreset {
  id: string;
  label: string;
  icon: React.ReactNode;
  types?: WalletTxType[];
  description: string;
}

const VIEW_PRESETS: ViewPreset[] = [
  {
    id: 'all',
    label: 'Todo',
    icon: <FileBarChart2 className="size-3.5" />,
    description: 'Todos los movimientos sin filtro de tipo.',
  },
  {
    id: 'cash',
    label: 'Dinero real',
    icon: <Banknote className="size-3.5" />,
    types: ['load', 'unload', 'deposit', 'withdrawal'],
    description: 'Cargas, retiros, depósitos — flujo de dinero real.',
  },
  {
    id: 'settlement',
    label: 'Settlement proveedores',
    icon: <Dice5 className="size-3.5" />,
    types: ['bet', 'win', 'jackpot_win', 'bonus_debit'],
    description: 'Apuestas vs ganancias — cuánto le debemos al proveedor.',
  },
  {
    id: 'bonuses',
    label: 'Bonos',
    icon: <BadgePercent className="size-3.5" />,
    types: [
      'bonus_grant', 'bonus_clear', 'bonus_forfeit',
      'bonus_credit', 'bonus_debit',
      'bonus_funding', 'bonus_funding_revert',
    ],
    description: 'Ciclo de vida de bonos: otorgados, liberados, perdidos.',
  },
  {
    id: 'system',
    label: 'Sistema',
    icon: <Zap className="size-3.5" />,
    types: ['mint', 'burn', 'adjustment', 'rollback'],
    description: 'Creación, destrucción y ajustes manuales de fichas.',
  },
  {
    id: 'transfers',
    label: 'Transferencias y otros',
    icon: <Send className="size-3.5" />,
    types: [
      'transfer_in', 'transfer_out',
      'commission_payout', 'promo_reward', 'league_reward',
      'fund_reserve', 'fund_release',
    ],
    description: 'Envíos entre usuarios, comisiones, premios, reservas.',
  },
];

// ── Tipos clasificados por dirección ──────────────────────────────

const INFLOW_TYPES: WalletTxType[] = [
  'mint', 'load', 'transfer_in', 'win', 'deposit',
  'bonus_grant', 'bonus_clear', 'bonus_funding_revert',
  'bonus_credit',
  'jackpot_win', 'promo_reward', 'league_reward',
  'commission_payout', 'fund_release',
];

function directionOf(type: WalletTxType): 'in' | 'out' {
  return INFLOW_TYPES.includes(type) ? 'in' : 'out';
}

// ── Constantes ────────────────────────────────────────────────────

type Tab = 'movements' | 'summary' | 'by-role';

const TABS: { id: Tab; label: string }[] = [
  { id: 'movements', label: 'Movimientos' },
  { id: 'summary', label: 'Resumen' },
  { id: 'by-role', label: 'Por rol' },
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
  const [activeView, setActiveView] = useState<string>('all');
  const [filters, setFilters] = useState<MovementsFilters>({
    limit: PAGE_SIZE,
    offset: 0,
  });

  const currentPreset = VIEW_PRESETS.find((v) => v.id === activeView) ?? VIEW_PRESETS[0]!;

  // Cuando cambia la vista, auto-aplicar tipos (pera si es "all")
  function selectView(preset: ViewPreset) {
    setActiveView(preset.id);
    setFilters((prev) => ({
      ...prev,
      type: preset.types,
      offset: 0,
    }));
  }

  // Filtros efectivos = preset types + filtros manuales del usuario
  const effectiveFilters = useMemo(() => ({
    ...filters,
    type: filters.type ?? currentPreset.types,
  }), [filters, currentPreset]);

  const exportUrl = useMemo(() => buildExportUrl(effectiveFilters), [effectiveFilters]);

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
            Flujo de fichas: apuestas, ganancias, cargas, retiros, transferencias,
            bonos y comisiones.
          </p>
        </div>
        {mode === 'general' && (
          <CsvExportButton
            path={exportUrl}
            filenameHint="wallet_stats"
            entityLabel="estadísticas de pago"
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
          {/* Selector de vista — presets */}
          <ViewSelector
            activeView={activeView}
            onSelect={selectView}
            filters={effectiveFilters}
          />

          {/* KPIs contextuales según la vista */}
          <ContextualKpi viewId={activeView} filters={effectiveFilters} />

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

          {/* Filtros */}
          <FiltersBar filters={filters} onChange={setFilters} />

          {/* Contenido del tab — con loading overlay */}
          <TabContent tab={tab} filters={effectiveFilters} onPage={(o) => setFilters({ ...filters, offset: o })} />
        </>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// ViewSelector — botones de vista con spinner cuando cargan
// ──────────────────────────────────────────────────────────────────────

function ViewSelector({
  activeView,
  onSelect,
  filters,
}: {
  activeView: string;
  onSelect: (preset: ViewPreset) => void;
  filters: MovementsFilters;
}) {
  // Use a separate hook to detect fetching state for the active view
  const { isFetching } = useWalletStatsMovements(filters);

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] font-medium flex items-center gap-1.5">
        Vista
        {isFetching && <Spinner size="sm" className="text-[var(--color-fg-subtle)]" />}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {VIEW_PRESETS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => onSelect(v)}
            className={cn(
              'group/v relative px-3 h-9 text-[11px] font-medium border transition-colors flex items-center gap-1.5',
              activeView === v.id
                ? 'bg-[var(--color-accent)] text-[var(--color-accent-fg)] border-[var(--color-accent)]'
                : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg)]',
            )}
          >
            {v.icon}
            {v.label}
            {/* Spinner inline when active and fetching */}
            {activeView === v.id && isFetching && (
              <Spinner size="sm" className="ml-1 text-current opacity-60" />
            )}
            {/* Tooltip */}
            <div className="pointer-events-none absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 p-2 text-[11px] leading-snug text-[var(--color-fg)] bg-[var(--color-bg)] border border-[var(--color-border)] shadow-lg opacity-0 group-hover/v:opacity-100 transition-opacity duration-150">
              {v.description}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// TabContent — wrapper con loading overlay para el contenido del tab
// ──────────────────────────────────────────────────────────────────────

function TabContent({
  tab,
  filters,
  onPage,
}: {
  tab: Tab;
  filters: MovementsFilters;
  onPage: (offset: number) => void;
}) {
  // Detect fetching state for any active query
  const { isLoading, isFetching } = useWalletStatsMovements(
    tab === 'movements' ? filters : { limit: 1, offset: 0 },
  );

  const showOverlay = isFetching && !isLoading;

  return (
    <div className="relative min-h-[200px]">
      {/* Loading overlay when refetching (not initial load) */}
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
      {tab === 'by-role' && <ByRoleTab filters={filters} />}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// KPIs contextuales — cambian según la vista activa
// ──────────────────────────────────────────────────────────────────────

function ContextualKpi({ viewId, filters }: { viewId: string; filters: MovementsFilters }) {
  const { data, isLoading } = useWalletStatsMovements(filters);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    );
  }

  if (!data) return null;

  switch (viewId) {
    case 'cash':
      return <CashKpis data={data} />;
    case 'settlement':
      return <SettlementKpis data={data} />;
    case 'bonuses':
      return <BonusKpis data={data} />;
    case 'system':
      return <SystemKpis data={data} />;
    case 'transfers':
      return <TransferKpis data={data} />;
    default:
      return <AllKpis data={data} />;
  }
}

// ── Vista: Todo ───────────────────────────────────────────────────

function AllKpis({ data }: { data: { totalIn: string; totalOut: string; net: string; totalBet: string; totalWon: string; netGaming: string } }) {
  const totalIn = Number(data.totalIn ?? 0);
  const totalOut = Number(data.totalOut ?? 0);
  const net = Number(data.net ?? 0);
  const totalBet = Number(data.totalBet ?? 0);
  const totalWon = Number(data.totalWon ?? 0);
  const netGaming = Number(data.netGaming ?? 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SettlementCard
          label="Total apostado"
          sublabel="Apuestas + bonus debitados"
          value={totalBet}
          icon={<TrendingDown className="size-4" />}
          colorClass="text-[var(--color-danger)]"
        />
        <SettlementCard
          label="Total ganado"
          sublabel="Ganancias + jackpots"
          value={totalWon}
          icon={<TrendingUp className="size-4" />}
          colorClass="text-[var(--color-success)]"
        />
        <SettlementCard
          label="Neto casino"
          sublabel={netGaming >= 0 ? 'Ganancia neta del casino' : 'Pérdida neta del casino'}
          value={netGaming}
          icon={<Dice5 className="size-4" />}
          colorClass={netGaming >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}
          isNet
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SmallStat label="Entradas totales" value={totalIn} color="success" />
        <SmallStat label="Salidas totales" value={totalOut} color="danger" />
        <SmallStat label="Neto flujos" value={net} color={net >= 0 ? 'success' : 'danger'} />
      </div>
    </div>
  );
}

// ── Vista: Dinero real ────────────────────────────────────────────

function CashKpis({ data }: { data: { totalIn: string; totalOut: string; net: string } }) {
  const totalIn = Number(data.totalIn ?? 0);
  const totalOut = Number(data.totalOut ?? 0);
  const net = Number(data.net ?? 0);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <SettlementCard
        label="Cargas + Depósitos"
        sublabel="Dinero que entró al casino"
        value={totalIn}
        icon={<ArrowDownLeft className="size-4" />}
        colorClass="text-[var(--color-success)]"
      />
      <SettlementCard
        label="Descargas + Retiros"
        sublabel="Dinero que salió del casino"
        value={totalOut}
        icon={<ArrowUpRight className="size-4" />}
        colorClass="text-[var(--color-danger)]"
      />
      <SettlementCard
        label="Neto"
        sublabel={net >= 0 ? 'Ganancia neta' : 'Pérdida neta'}
        value={net}
        icon={<Banknote className="size-4" />}
        colorClass={net >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}
        isNet
      />
    </div>
  );
}

// ── Vista: Settlement proveedores ─────────────────────────────────

function SettlementKpis({ data }: { data: { totalBet: string; totalWon: string; netGaming: string } }) {
  const totalBet = Number(data.totalBet ?? 0);
  const totalWon = Number(data.totalWon ?? 0);
  const netGaming = Number(data.netGaming ?? 0);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <SettlementCard
        label="Total apostado"
        sublabel="Apuestas + bonus debitados al proveedor"
        value={totalBet}
        icon={<TrendingDown className="size-4" />}
        colorClass="text-[var(--color-danger)]"
      />
      <SettlementCard
        label="Total ganado"
        sublabel="Ganancias + jackpots devueltos"
        value={totalWon}
        icon={<TrendingUp className="size-4" />}
        colorClass="text-[var(--color-success)]"
      />
      <SettlementCard
        label="Neto casino (GGR)"
        sublabel={netGaming >= 0 ? 'Lo que le debemos al proveedor es' : 'El proveedor nos debe'}
        value={netGaming}
        icon={<Dice5 className="size-4" />}
        colorClass={netGaming >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}
        isNet
      />
    </div>
  );
}

// ── Vista: Bonos ──────────────────────────────────────────────────

function BonusKpis({ data }: { data: { totalIn: string; totalOut: string; net: string } }) {
  const granted = Number(data.totalIn ?? 0);
  const spent = Number(data.totalOut ?? 0);
  const net = Number(data.net ?? 0);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <SettlementCard
        label="Bonos otorgados"
        sublabel="Créditos y grants de bonos"
        value={granted}
        icon={<BadgePercent className="size-4" />}
        colorClass="text-[var(--color-info)]"
      />
      <SettlementCard
        label="Bonos gastados / perdidos"
        sublabel="Clear, forfeit, débitos"
        value={spent}
        icon={<ShieldCheck className="size-4" />}
        colorClass="text-[var(--color-warning)]"
      />
      <SettlementCard
        label="Neto bonos"
        sublabel={net >= 0 ? 'Excedente de bonos' : 'Costo neto de bonos'}
        value={net}
        icon={<Coins className="size-4" />}
        colorClass={net >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}
        isNet
      />
    </div>
  );
}

// ── Vista: Sistema ────────────────────────────────────────────────

function SystemKpis({ data }: { data: { totalIn: string; totalOut: string; net: string } }) {
  const created = Number(data.totalIn ?? 0);
  const destroyed = Number(data.totalOut ?? 0);
  const net = Number(data.net ?? 0);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <SettlementCard
        label="Fichas creadas"
        sublabel="Mint, creaciones manuales"
        value={created}
        icon={<Zap className="size-4" />}
        colorClass="text-[var(--color-info)]"
      />
      <SettlementCard
        label="Fichas destruidas"
        sublabel="Burn, destrucciones manuales"
        value={destroyed}
        icon={<ShieldCheck className="size-4" />}
        colorClass="text-[var(--color-warning)]"
      />
      <SettlementCard
        label="Neto sistema"
        sublabel={net >= 0 ? 'Más fichas creadas que destruidas' : 'Más destruidas que creadas'}
        value={net}
        icon={<Coins className="size-4" />}
        colorClass={net >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}
        isNet
      />
    </div>
  );
}

// ── Vista: Transferencias y otros ─────────────────────────────────

function TransferKpis({ data }: { data: { totalIn: string; totalOut: string; net: string } }) {
  const received = Number(data.totalIn ?? 0);
  const sent = Number(data.totalOut ?? 0);
  const net = Number(data.net ?? 0);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <SettlementCard
        label="Recibidos"
        sublabel="Transferencias + comisiones + premios"
        value={received}
        icon={<ArrowDownLeft className="size-4" />}
        colorClass="text-[var(--color-success)]"
      />
      <SettlementCard
        label="Enviados"
        sublabel="Transferencias + reservas"
        value={sent}
        icon={<Send className="size-4" />}
        colorClass="text-[var(--color-danger)]"
      />
      <SettlementCard
        label="Neto transferencias"
        sublabel={net >= 0 ? 'Excedente' : 'Déficit'}
        value={net}
        icon={<Coins className="size-4" />}
        colorClass={net >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}
        isNet
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Componentes de KPI
// ──────────────────────────────────────────────────────────────────────

function SettlementCard({
  label,
  sublabel,
  value,
  icon,
  colorClass,
  isNet,
}: {
  label: string;
  sublabel: string;
  value: number;
  icon: React.ReactNode;
  colorClass: string;
  isNet?: boolean;
}) {
  return (
    <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] p-4 flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] flex items-center gap-1.5">
        {icon}
        {label}
      </span>
      <span className={cn('text-[1.75rem] font-mono num leading-none', colorClass)}>
        {isNet && value >= 0 ? '+' : ''}{Math.abs(value).toFixed(2)}
      </span>
      <span className="text-[10px] text-[var(--color-fg-disabled)]">{sublabel}</span>
    </div>
  );
}

function SmallStat({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: 'success' | 'danger';
}) {
  return (
    <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] p-3 flex items-center justify-between">
      <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)]">
        {label}
      </span>
      <span
        className={cn(
          'text-[14px] font-mono num font-medium',
          color === 'success'
            ? 'text-[var(--color-success)]'
            : 'text-[var(--color-danger)]',
        )}
      >
        {value >= 0 ? '+' : ''}{value.toFixed(2)}
      </span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Filtros — Barra colapsable con secciones claras
// ──────────────────────────────────────────────────────────────────────

function FiltersBar({
  filters,
  onChange,
}: {
  filters: MovementsFilters;
  onChange: (f: MovementsFilters) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const selectedTypes = useMemo(
    () => (Array.isArray(filters.type) ? filters.type : filters.type ? [filters.type] : []),
    [filters.type],
  );
  const selectedRoles = useMemo(
    () => (Array.isArray(filters.ownerRole) ? filters.ownerRole : filters.ownerRole ? [filters.ownerRole] : []),
    [filters.ownerRole],
  );

  function toggleType(t: WalletTxType) {
    const next = selectedTypes.includes(t)
      ? selectedTypes.filter((x) => x !== t)
      : [...selectedTypes, t];
    onChange({ ...filters, type: next.length ? next : undefined, offset: 0 });
  }
  function toggleRole(r: string) {
    const next = selectedRoles.includes(r)
      ? selectedRoles.filter((x) => x !== r)
      : [...selectedRoles, r];
    onChange({ ...filters, ownerRole: next.length ? next : undefined, offset: 0 });
  }
  function clearAll() {
    onChange({ limit: PAGE_SIZE, offset: 0 });
  }
  function applyPreset(preset: { dateFrom?: string; dateTo?: string }) {
    onChange({ ...filters, ...preset, offset: 0 });
  }

  const activeCount =
    selectedTypes.length +
    selectedRoles.length +
    (filters.dateFrom ? 1 : 0) +
    (filters.dateTo ? 1 : 0) +
    (filters.userId ? 1 : 0) +
    (filters.actorId ? 1 : 0);

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const startOf30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

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
      {/* Barra principal — siempre visible */}
      <div className="px-4 py-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium hover:text-[var(--color-fg)] transition-colors"
        >
          <Filter className="size-3" />
          Filtros
          {activeCount > 0 && (
            <Badge variant="neutral" className="ml-1">{activeCount}</Badge>
          )}
          <span className="text-[var(--color-fg-disabled)] ml-1">
            {expanded ? '▲' : '▼'}
          </span>
        </button>

        {/* Quick date presets — inline */}
        <div className="flex items-center gap-1.5 ml-2">
          <span className="text-[10px] text-[var(--color-fg-subtle)] mr-1">Período:</span>
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => applyPreset(activePreset === p ? { dateFrom: undefined, dateTo: undefined } : p)}
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

        {/* Limpiar */}
        {activeCount > 0 && (
          <Button variant="ghost" size="sm" onClick={clearAll} className="ml-auto h-6 text-[10px]">
            Limpiar filtros
          </Button>
        )}
      </div>

      {/* Panel expandido — filtros avanzados */}
      {expanded && (
        <div className="border-t border-[var(--color-border)] px-4 py-3 flex flex-col gap-3">
          {/* Fechas custom + User filters */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
            <div className="flex flex-col gap-1">
              <Label htmlFor="ws-user-id" className="text-[10px]">Jugador (User ID)</Label>
              <Input
                id="ws-user-id"
                placeholder="UUID del jugador"
                value={filters.userId ?? ''}
                onChange={(e) =>
                  onChange({ ...filters, userId: e.target.value || undefined, offset: 0 })
                }
                className="h-8 text-[11px]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="ws-actor-id" className="text-[10px]">Ejecutó (Actor ID)</Label>
              <Input
                id="ws-actor-id"
                placeholder="UUID del actor"
                value={filters.actorId ?? ''}
                onChange={(e) =>
                  onChange({ ...filters, actorId: e.target.value || undefined, offset: 0 })
                }
                className="h-8 text-[11px]"
              />
            </div>
          </div>

          {/* Roles */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)]">
              Rol del dueño del wallet
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

          {/* Tipos de movimiento */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)]">
              Tipos de movimiento
            </span>
            <div className="flex flex-col gap-1.5">
              {TX_TYPE_GROUPS.map((g) => (
                <div key={g.label} className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] text-[var(--color-fg-subtle)] uppercase tracking-[0.06em] min-w-[80px]">
                    {g.label}:
                  </span>
                  {g.types.map((t) => (
                    <div key={t} className="relative group/tip">
                      <button
                        type="button"
                        onClick={() => toggleType(t)}
                        className={cn(
                          'px-2 h-7 text-[10px] border transition-colors',
                          selectedTypes.includes(t)
                            ? 'bg-[var(--color-accent)] text-[var(--color-accent-fg)] border-[var(--color-accent)]'
                            : 'bg-[var(--color-bg)] text-[var(--color-fg-muted)] border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg)]',
                        )}
                      >
                        {TX_TYPE_LABELS[t]}
                      </button>
                      <div className="pointer-events-none absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2.5 text-[11px] leading-snug text-[var(--color-fg)] bg-[var(--color-bg)] border border-[var(--color-border)] shadow-lg opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150">
                        <span className="font-medium text-[var(--color-fg)]">{TX_TYPE_LABELS[t]}</span>
                        <span className="text-[var(--color-fg-disabled)] ml-1 font-mono text-[9px]">({t})</span>
                        <div className="mt-1 text-[var(--color-fg-muted)]">{TX_TYPE_DESCRIPTIONS[t]}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Tab: Movimientos
// ──────────────────────────────────────────────────────────────────────

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
          {isLoading ? 'Cargando…' : `${total} movimientos · página ${Math.floor(offset / limit) + 1}`}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
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
        <EmptyState
          hint="movements"
          label="Sin movimientos para los filtros aplicados."
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Fecha</TH>
                <TH>Tipo</TH>
                <TH className="text-right">Monto</TH>
                <TH>Owner</TH>
                <TH>Rol</TH>
                <TH>Actor</TH>
                <TH>Fuente</TH>
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
      <TD className="num text-[11px] text-[var(--color-fg-muted)]">
        {new Date(row.createdAt).toLocaleString('es-AR', {
          day: '2-digit',
          month: '2-digit',
          year: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </TD>
      <TD>
        <div className="flex items-center gap-1.5">
          {dir === 'in' ? (
            <ArrowDownLeft className="size-3 text-[var(--color-success)]" />
          ) : (
            <ArrowUpRight className="size-3 text-[var(--color-danger)]" />
          )}
          <span className="text-[12px]">{TX_TYPE_LABELS[row.type] ?? row.type}</span>
        </div>
      </TD>
      <TD className="text-right num font-mono">
        <span
          className={cn(
            dir === 'in' ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]',
          )}
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
          </span>
        </div>
      </TD>
      <TD>
        {row.ownerRole ? (
          <Badge variant="neutral">{ROLE_LABELS[row.ownerRole] ?? row.ownerRole}</Badge>
        ) : (
          <span className="text-[11px] text-[var(--color-fg-disabled)]">—</span>
        )}
      </TD>
      <TD>
        {row.actorUsername ? (
          <div className="flex flex-col">
            <span className="text-[11px] text-[var(--color-fg-muted)] font-mono">
              @{row.actorUsername}
            </span>
            {row.actorRole && (
              <span className="text-[10px] text-[var(--color-fg-subtle)]">
                {ROLE_LABELS[row.actorRole] ?? row.actorRole}
              </span>
            )}
          </div>
        ) : (
          <span className="text-[11px] text-[var(--color-fg-disabled)]">sistema</span>
        )}
      </TD>
      <TD className="text-[11px] text-[var(--color-fg-muted)]">{row.source ?? '—'}</TD>
    </TR>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Tab: Resumen — breakdown por tipo
// ──────────────────────────────────────────────────────────────────────

function SummaryTab({ filters }: { filters: MovementsFilters }) {
  const { data, isLoading, isError } = useWalletStatsSummary({
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
  });

  if (isLoading) {
    return <Skeleton className="h-64" />;
  }
  if (isError || !data) {
    return (
      <EmptyState hint="summary" label="Error al cargar resumen — verificá la conexión." />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Ventana + count */}
      <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto p-4 flex items-center justify-between text-[12px]">
        <span className="text-[var(--color-fg-muted)]">
          Ventana:{' '}
          <span className="text-[var(--color-fg)] font-mono">
            {new Date(data.dateFrom).toLocaleDateString('es-AR')} →{' '}
            {new Date(data.dateTo).toLocaleDateString('es-AR')}
          </span>{' '}
          <Badge variant="neutral">{data.bucket}</Badge>
        </span>
        <span className="text-[var(--color-fg-muted)]">
          Total transacciones:{' '}
          <span className="text-[var(--color-fg)] font-mono num">{data.txCount}</span>
        </span>
      </div>

      {/* Breakdown por type */}
      <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto">
        <div className="px-3 py-2 border-b border-[var(--color-border)]">
          <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium">
            Detalle por tipo de movimiento
          </span>
        </div>
        <Table>
          <THead>
            <TR>
              <TH>Tipo</TH>
              <TH className="text-right">Transacciones</TH>
              <TH className="text-right">Monto total</TH>
            </TR>
          </THead>
          <TBody>
            {Object.keys(data.countByType).length === 0 ? (
              <TR>
                <TD colSpan={3}>
                  <EmptyState hint="data" label="Sin movimientos en la ventana seleccionada." />
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

// ──────────────────────────────────────────────────────────────────────
// Tab: Por rol
// ──────────────────────────────────────────────────────────────────────

function ByRoleTab({ filters }: { filters: MovementsFilters }) {
  const { data, isLoading, isError } = useWalletStatsByRole({
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
  });

  if (isLoading) {
    return <Skeleton className="h-64" />;
  }
  if (isError || !data) {
    return <EmptyState hint="by-role" label="Error al cargar — verificá la conexión." />;
  }

  return (
    <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto">
      <div className="px-3 py-2 border-b border-[var(--color-border)]">
        <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium">
          Flujo neto de fichas por rol del owner
        </span>
      </div>
      {data.length === 0 ? (
        <EmptyState
          hint="data"
          label="Sin movimientos en la ventana seleccionada."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Rol</TH>
              <TH className="text-right">Users únicos</TH>
              <TH className="text-right">Transacciones</TH>
              <TH className="text-right">Entradas</TH>
              <TH className="text-right">Salidas</TH>
              <TH className="text-right">Neto</TH>
            </TR>
          </THead>
          <TBody>
            {data.map((r) => (
              <TR key={r.role}>
                <TD>
                  <Badge variant="neutral">{ROLE_LABELS[r.role] ?? r.role}</Badge>
                </TD>
                <TD className="text-right num">{r.uniqueUsers}</TD>
                <TD className="text-right num">{r.txCount}</TD>
                <TD className="text-right num font-mono text-[var(--color-success)]">
                  +{r.inflow}
                </TD>
                <TD className="text-right num font-mono text-[var(--color-danger)]">
                  −{r.outflow}
                </TD>
                <TD
                  className={cn(
                    'text-right num font-mono',
                    Number(r.net) >= 0
                      ? 'text-[var(--color-success)]'
                      : 'text-[var(--color-danger)]',
                  )}
                >
                  {Number(r.net) >= 0 ? '+' : ''}
                  {r.net}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
