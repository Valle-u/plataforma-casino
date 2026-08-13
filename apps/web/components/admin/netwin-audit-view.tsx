/**
 * NetwinAuditView — modo "Netwin por red" de Estadísticas de pago.
 *
 * Auditoría de monitoreo del dueño: elegís un ÁMBITO (toda la plataforma /
 * red dependiente / red central / un socio independiente / un panel puntual)
 * y ves su netwin + entradas-salidas (minorista vs mayorista) + bonos +
 * circulación, con un monitor de movimientos del ámbito.
 *
 * Todo read-only. NO muestra el % del proveedor (eso lo maneja el módulo de
 * comisiones, C4b) — acá solo netwin puro. El monitor de movimientos incluye
 * redes independientes por la excepción de visibilidad a R6 (dueño 2026-08-13).
 */

'use client';

import { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Coins,
  Dice5,
  Gift,
  Layers,
  Package,
} from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { StatTile } from '@/components/ui/stat-tile';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { UserSelect } from '@/components/ui/user-select';
import { cn } from '@/lib/cn';
import { type TenantUserRow } from '@/lib/hooks/use-users';
import {
  TX_TYPE_LABELS,
  useWalletStatsComparativa,
  useWalletStatsScopedAudit,
  useWalletStatsScopedMovements,
  useWalletStatsScopes,
  type ComparativaRow,
  type ScopeKind,
  type ScopeParams,
} from '@/lib/hooks/use-wallet-stats';

// ── Formato ───────────────────────────────────────────────────────────

function fmt(x: string | number | null | undefined): string {
  if (x === null || x === undefined) return '—';
  const n = Number(x);
  if (!Number.isFinite(n)) return String(x);
  return n.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtKpi(x: string | number | null | undefined): string {
  if (x === null || x === undefined) return '—';
  const n = Number(x);
  if (!Number.isFinite(n)) return String(x);
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return n.toLocaleString('es-AR', { maximumFractionDigits: 2 });
}

function fmtRtp(rtp: string | null): string {
  if (rtp === null) return '—';
  const n = Number(rtp);
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

// ── Rango de fechas ───────────────────────────────────────────────────

type Preset = '7d' | '30d' | 'mes' | 'custom';

const PRESETS: { id: Preset; label: string }[] = [
  { id: '7d', label: '7 días' },
  { id: '30d', label: '30 días' },
  { id: 'mes', label: 'Este mes' },
  { id: 'custom', label: 'Personalizado' },
];

function startOfDayIso(d: Date): string {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString();
}
function endOfDayIso(d: Date): string {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x.toISOString();
}

// ── Ámbitos ───────────────────────────────────────────────────────────

const SCOPE_OPTIONS: { id: ScopeKind; label: string }[] = [
  { id: 'platform', label: 'Toda la plataforma' },
  { id: 'dependent', label: 'Red dependiente' },
  { id: 'central', label: 'Red central' },
  { id: 'independent', label: 'Socio independiente' },
  { id: 'user', label: 'Panel puntual' },
];

const PAGE_SIZE = 50;

// ── Componente principal ──────────────────────────────────────────────

export function NetwinAuditView() {
  const [preset, setPreset] = useState<Preset>('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const [scopeKind, setScopeKind] = useState<ScopeKind>('platform');
  const [indepId, setIndepId] = useState('');
  const [panelUser, setPanelUser] = useState<TenantUserRow | null>(null);
  const [movOffset, setMovOffset] = useState(0);

  const range = useMemo<{ dateFrom?: string; dateTo?: string }>(() => {
    const now = new Date();
    if (preset === '7d') {
      const from = new Date(now);
      from.setDate(from.getDate() - 7);
      return { dateFrom: startOfDayIso(from), dateTo: endOfDayIso(now) };
    }
    if (preset === '30d') {
      const from = new Date(now);
      from.setDate(from.getDate() - 30);
      return { dateFrom: startOfDayIso(from), dateTo: endOfDayIso(now) };
    }
    if (preset === 'mes') {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      return { dateFrom: startOfDayIso(from), dateTo: endOfDayIso(now) };
    }
    // custom
    return {
      dateFrom: customFrom ? startOfDayIso(new Date(`${customFrom}T00:00:00`)) : undefined,
      dateTo: customTo ? endOfDayIso(new Date(`${customTo}T00:00:00`)) : undefined,
    };
  }, [preset, customFrom, customTo]);

  const scopeReady =
    (scopeKind !== 'independent' || !!indepId) &&
    (scopeKind !== 'user' || !!panelUser);

  const scopeParams = useMemo<ScopeParams>(
    () => ({
      scope: scopeKind,
      scopeId:
        scopeKind === 'independent'
          ? indepId
          : scopeKind === 'user'
            ? panelUser?.id
            : undefined,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
    }),
    [scopeKind, indepId, panelUser, range],
  );

  const scopeLabel = useMemo(() => {
    if (scopeKind === 'independent') {
      return indepId ? undefined : 'Elegí un socio independiente';
    }
    if (scopeKind === 'user') {
      return panelUser
        ? `${panelUser.displayName || panelUser.username} + su red`
        : 'Elegí un panel';
    }
    return SCOPE_OPTIONS.find((s) => s.id === scopeKind)?.label;
  }, [scopeKind, indepId, panelUser]);

  return (
    <div className="flex flex-col gap-6">
      {/* Rango de fechas */}
      <DateRangeBar
        preset={preset}
        onPreset={(p) => {
          setPreset(p);
          setMovOffset(0);
        }}
        customFrom={customFrom}
        customTo={customTo}
        onCustomFrom={setCustomFrom}
        onCustomTo={setCustomTo}
      />

      {/* Comparativa: netwin por red */}
      <ComparativaTable range={range} />

      {/* Selector de ámbito */}
      <ScopeSelector
        scopeKind={scopeKind}
        onScopeKind={(k) => {
          setScopeKind(k);
          setMovOffset(0);
        }}
        indepId={indepId}
        onIndepId={(id) => {
          setIndepId(id);
          setMovOffset(0);
        }}
        panelUser={panelUser}
        onPanelUser={(u) => {
          setPanelUser(u);
          setMovOffset(0);
        }}
      />

      {/* Detalle del ámbito */}
      {scopeReady ? (
        <>
          <ScopeDetail scopeParams={scopeParams} scopeLabel={scopeLabel} />
          <ScopeMovements
            scopeParams={scopeParams}
            offset={movOffset}
            onOffset={setMovOffset}
            isIndependent={scopeKind === 'independent'}
          />
        </>
      ) : (
        <EmptyState
          hint="data"
          label={
            scopeKind === 'independent'
              ? 'Elegí un socio independiente para ver su detalle.'
              : 'Elegí un panel para ver su detalle.'
          }
        />
      )}
    </div>
  );
}

// ── Rango de fechas (barra) ───────────────────────────────────────────

function DateRangeBar({
  preset,
  onPreset,
  customFrom,
  customTo,
  onCustomFrom,
  onCustomTo,
}: {
  preset: Preset;
  onPreset: (p: Preset) => void;
  customFrom: string;
  customTo: string;
  onCustomFrom: (v: string) => void;
  onCustomTo: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] font-medium">
        Período
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPreset(p.id)}
            className={cn(
              'px-3 h-8 text-[11px] font-medium border transition-colors',
              preset === p.id
                ? 'bg-[var(--color-accent)] text-[var(--color-accent-fg)] border-[var(--color-accent)]'
                : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] border-[var(--color-border)] hover:text-[var(--color-fg)]',
            )}
          >
            {p.label}
          </button>
        ))}
        {preset === 'custom' && (
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => onCustomFrom(e.target.value)}
              className="h-8 px-2 text-[12px] bg-[var(--color-bg-subtle)] border border-[var(--color-border)] text-[var(--color-fg)]"
            />
            <span className="text-[var(--color-fg-subtle)] text-[12px]">→</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => onCustomTo(e.target.value)}
              className="h-8 px-2 text-[12px] bg-[var(--color-bg-subtle)] border border-[var(--color-border)] text-[var(--color-fg)]"
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Comparativa: netwin por red ───────────────────────────────────────

function ComparativaTable({
  range,
}: {
  range: { dateFrom?: string; dateTo?: string };
}) {
  const { data, isLoading, isError } = useWalletStatsComparativa(range);

  const platformNetwin = Number(data?.platformNetwin ?? 0);
  const pctOf = (netwin: string): string => {
    if (!platformNetwin) return '—';
    return `${((Number(netwin) / platformNetwin) * 100).toFixed(1)}%`;
  };

  return (
    <section className="flex flex-col gap-2">
      <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium flex items-center gap-2">
        <Layers className="size-3" />
        Netwin por red
      </span>
      <p className="text-[11px] text-[var(--color-fg-subtle)]">
        Red dependiente + independientes = plataforma. La red central es un
        subconjunto de la dependiente (informativa). El netwin incluye las
        apuestas con bono.
      </p>
      {isLoading ? (
        <Skeleton className="h-40" />
      ) : isError || !data ? (
        <EmptyState hint="data" label="No se pudo cargar la comparativa." />
      ) : (
        <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto">
          <Table>
            <THead>
              <TR>
                <TH>Red</TH>
                <TH className="text-right">Apostado</TH>
                <TH className="text-right">Ganado</TH>
                <TH className="text-right">Netwin</TH>
                <TH className="text-right hidden sm:table-cell">RTP</TH>
                <TH className="text-right">% plat.</TH>
              </TR>
            </THead>
            <TBody>
              {data.rows.map((r) => (
                <ComparativaRowView key={r.key} row={r} pct={pctOf(r.netwin)} />
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </section>
  );
}

function ComparativaRowView({ row, pct }: { row: ComparativaRow; pct: string }) {
  const netwin = Number(row.netwin);
  const isTotal = row.key === 'platform';
  const isCentral = row.key === 'central';

  return (
    <TR className={cn(isTotal && 'bg-[var(--color-bg-subtle)]')}>
      <TD>
        <div className="flex items-center gap-2">
          {isCentral && (
            <span className="text-[var(--color-fg-subtle)] text-[10px]">└</span>
          )}
          <span
            className={cn(
              'text-[12px]',
              isTotal ? 'font-medium text-[var(--color-fg)]' : 'text-[var(--color-fg)]',
              isCentral && 'text-[var(--color-fg-muted)]',
            )}
          >
            {row.label}
          </span>
          {row.indep && (
            <span className="inline-flex items-center px-1.5 h-4 text-[9px] rounded border border-[#A78BFA55] text-[#A78BFA] bg-[#A78BFA14]">
              indep
            </span>
          )}
        </div>
      </TD>
      <TD className="text-right num font-mono text-[12px] text-[var(--color-fg-muted)] whitespace-nowrap">
        {fmt(row.apostado)}
      </TD>
      <TD className="text-right num font-mono text-[12px] text-[var(--color-fg-muted)] whitespace-nowrap">
        {fmt(row.ganado)}
      </TD>
      <TD
        className={cn(
          'text-right num font-mono text-[12px] font-medium whitespace-nowrap',
          netwin >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]',
        )}
      >
        {fmt(row.netwin)}
      </TD>
      <TD className="text-right num font-mono text-[12px] text-[var(--color-fg-muted)] hidden sm:table-cell">
        {fmtRtp(row.rtp)}
      </TD>
      <TD className="text-right num font-mono text-[12px] text-[var(--color-fg-subtle)] whitespace-nowrap">
        {pct}
      </TD>
    </TR>
  );
}

// ── Selector de ámbito ────────────────────────────────────────────────

function ScopeSelector({
  scopeKind,
  onScopeKind,
  indepId,
  onIndepId,
  panelUser,
  onPanelUser,
}: {
  scopeKind: ScopeKind;
  onScopeKind: (k: ScopeKind) => void;
  indepId: string;
  onIndepId: (id: string) => void;
  panelUser: TenantUserRow | null;
  onPanelUser: (u: TenantUserRow | null) => void;
}) {
  const scopes = useWalletStatsScopes();

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] font-medium">
        Ámbito a analizar
      </span>
      <div className="flex flex-wrap gap-1.5">
        {SCOPE_OPTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onScopeKind(s.id)}
            className={cn(
              'px-3 h-9 text-[11px] font-medium border transition-colors',
              scopeKind === s.id
                ? 'bg-[var(--color-accent)] text-[var(--color-accent-fg)] border-[var(--color-accent)]'
                : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] border-[var(--color-border)] hover:text-[var(--color-fg)]',
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Sub-selector según el ámbito */}
      {scopeKind === 'independent' && (
        <div className="max-w-sm mt-1">
          {scopes.isLoading ? (
            <Skeleton className="h-9" />
          ) : (
            <select
              value={indepId}
              onChange={(e) => onIndepId(e.target.value)}
              className="h-9 w-full px-2 text-[13px] bg-[var(--color-bg-subtle)] border border-[var(--color-border)] text-[var(--color-fg)]"
            >
              <option value="">— Elegí un socio independiente —</option>
              {(scopes.data?.independientes ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName || s.username} (@{s.username})
                </option>
              ))}
            </select>
          )}
          {!scopes.isLoading &&
            (scopes.data?.independientes.length ?? 0) === 0 && (
              <p className="text-[11px] text-[var(--color-fg-subtle)] mt-1">
                No hay socios independientes en este tenant.
              </p>
            )}
        </div>
      )}
      {scopeKind === 'user' && (
        <div className="max-w-md mt-1">
          <UserSelect
            value={panelUser}
            onSelect={onPanelUser}
            includeSelf
            placeholder="Buscar cajero / socio / distribuidor…"
          />
        </div>
      )}
    </div>
  );
}

// ── Detalle del ámbito ────────────────────────────────────────────────

function ScopeDetail({
  scopeParams,
  scopeLabel,
}: {
  scopeParams: ScopeParams;
  scopeLabel?: string;
}) {
  const { data, isLoading, isError, isFetching } =
    useWalletStatsScopedAudit(scopeParams);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }
  if (isError || !data) {
    return <EmptyState hint="data" label="No se pudo cargar el detalle del ámbito." />;
  }

  const netwin = Number(data.juego.netwin);

  return (
    <div className="flex flex-col gap-5">
      {scopeLabel && (
        <div className="flex items-center gap-2 text-[12px] text-[var(--color-fg-muted)]">
          <span className="uppercase tracking-[0.08em] text-[10px] text-[var(--color-fg-subtle)]">
            Mostrando
          </span>
          <span className="font-medium text-[var(--color-fg)]">{scopeLabel}</span>
          {isFetching && <Spinner size="sm" className="text-[var(--color-fg-subtle)]" />}
        </div>
      )}

      {/* Juego (netwin) */}
      <DetailSection icon={<Dice5 className="size-3" />} title="Juego">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile label="Apostado" value={fmtKpi(data.juego.apostado)} hint="incl. bonos" />
          <StatTile label="Ganado" value={fmtKpi(data.juego.ganado)} />
          <StatTile
            label="Netwin"
            value={fmtKpi(data.juego.netwin)}
            variant={netwin < 0 ? 'accent' : 'default'}
            hint={netwin >= 0 ? 'a favor de la Casa' : 'ganaron los jugadores'}
          />
          <StatTile label="RTP real" value={fmtRtp(data.juego.rtp)} hint="ganado ÷ apostado" />
        </div>
      </DetailSection>

      {/* Plata minorista */}
      <DetailSection icon={<Banknote className="size-3" />} title="Plata — minorista (jugadores)">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatTile label="Depósitos" value={fmtKpi(data.plata.depositos)} hint="entra" />
          <StatTile label="Retiros" value={fmtKpi(data.plata.retiros)} hint="sale" />
          <StatTile
            label="Neto de caja"
            value={fmtKpi(data.plata.neto)}
            variant={Number(data.plata.neto) < 0 ? 'accent' : 'default'}
          />
        </div>
      </DetailSection>

      {/* Fichas mayorista */}
      <DetailSection icon={<Package className="size-3" />} title="Fichas — mayorista (operadores)">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatTile
            label="Cargadas a operadores"
            value={fmtKpi(data.fichas.cargasOperadores)}
          />
          <StatTile
            label="Descargadas"
            value={fmtKpi(data.fichas.descargasOperadores)}
          />
          <StatTile label="Neto entregado" value={fmtKpi(data.fichas.neto)} />
        </div>
        <p className="text-[11px] text-[var(--color-fg-subtle)]">
          Cargas directas a jugadores (retail):{' '}
          <span className="font-mono text-[var(--color-fg-muted)]">
            {fmt(data.fichas.cargasJugadores)}
          </span>
        </p>
      </DetailSection>

      {/* Bonos + circulación */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <DetailSection icon={<Gift className="size-3" />} title="Bonos">
          <div className="grid grid-cols-3 gap-3">
            <StatTile label="Otorgados" value={fmtKpi(data.bonos.otorgados)} />
            <StatTile label="Liberados" value={fmtKpi(data.bonos.liberados)} />
            <StatTile label="Perdidos" value={fmtKpi(data.bonos.perdidos)} />
          </div>
        </DetailSection>
        <DetailSection icon={<Coins className="size-3" />} title="Circulación">
          <StatTile
            label="Fichas en manos de jugadores"
            value={fmtKpi(data.circulacion)}
            hint="balance activo"
          />
        </DetailSection>
      </div>
    </div>
  );
}

function DetailSection({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium flex items-center gap-2">
        {icon}
        {title}
      </span>
      {children}
    </section>
  );
}

// ── Monitor de movimientos del ámbito ─────────────────────────────────

function ScopeMovements({
  scopeParams,
  offset,
  onOffset,
  isIndependent,
}: {
  scopeParams: ScopeParams;
  offset: number;
  onOffset: (o: number) => void;
  isIndependent: boolean;
}) {
  const { data, isLoading, isError, isFetching } = useWalletStatsScopedMovements({
    ...scopeParams,
    limit: PAGE_SIZE,
    offset,
  });

  const page = offset / PAGE_SIZE + 1;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium flex items-center gap-2">
          <ArrowDownLeft className="size-3" />
          Movimientos del ámbito
          {isFetching && <Spinner size="sm" className="text-[var(--color-fg-subtle)]" />}
        </span>
        {data && (
          <span className="text-[11px] text-[var(--color-fg-subtle)] tabular-nums">
            {data.total} movimientos
          </span>
        )}
      </div>

      {isIndependent && (
        <p className="text-[11px] text-[var(--color-fg-subtle)] italic">
          Incluye el detalle interno de esta red independiente — auditoría
          autorizada por el dueño (solo lectura).
        </p>
      )}

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : isError || !data ? (
        <EmptyState hint="data" label="No se pudieron cargar los movimientos." />
      ) : data.data.length === 0 ? (
        <EmptyState hint="data" label="Sin movimientos en este período." />
      ) : (
        <>
          <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  <TH>Fecha</TH>
                  <TH>Tipo</TH>
                  <TH className="text-right">Monto</TH>
                  <TH className="hidden sm:table-cell">Titular</TH>
                  <TH className="hidden md:table-cell">Ejecutó</TH>
                </TR>
              </THead>
              <TBody>
                {data.data.map((m) => (
                  <TR key={m.id}>
                    <TD className="num text-[11px] text-[var(--color-fg-muted)] whitespace-nowrap">
                      {new Date(m.createdAt).toLocaleString('es-AR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </TD>
                    <TD className="text-[12px] text-[var(--color-fg)] whitespace-nowrap">
                      {TX_TYPE_LABELS[m.type] ?? m.type}
                    </TD>
                    <TD
                      className={cn(
                        'text-right num font-mono text-[12px] whitespace-nowrap',
                        m.direction === 'in'
                          ? 'text-[var(--color-success)]'
                          : 'text-[var(--color-danger)]',
                      )}
                    >
                      {m.direction === 'in' ? '+' : '−'}
                      {fmt(m.amount)}
                    </TD>
                    <TD className="hidden sm:table-cell text-[12px] text-[var(--color-fg-muted)]">
                      {m.ownerDisplayName || m.ownerUsername}
                    </TD>
                    <TD className="hidden md:table-cell text-[12px] text-[var(--color-fg-subtle)]">
                      {m.actorUsername ?? 'sistema'}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>

          {/* Paginación */}
          <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--color-fg-muted)]">
            <span>
              Página {page} de {totalPages}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => onOffset(Math.max(0, offset - PAGE_SIZE))}
                className="px-3 h-8 border border-[var(--color-border)] bg-[var(--color-bg-elevated)] hover:text-[var(--color-fg)] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
              >
                <ArrowUpRight className="size-3 rotate-[225deg]" />
                Anterior
              </button>
              <button
                type="button"
                disabled={!data.hasMore}
                onClick={() => onOffset(offset + PAGE_SIZE)}
                className="px-3 h-8 border border-[var(--color-border)] bg-[var(--color-bg-elevated)] hover:text-[var(--color-fg)] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
              >
                Siguiente
                <ArrowUpRight className="size-3 rotate-45" />
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
