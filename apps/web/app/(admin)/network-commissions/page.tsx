/**
 * /network-commissions — Comisiones por red (modelo DIFERENCIAL / override, C1–C6).
 *
 * La plataforma le paga a CADA nivel dependiente (socio/distribuidor/cajero) su
 * override diferencial: `R_op·subNetWin(op) − Σ R_hijo·subNetWin(hijo)`. Cada
 * nivel cobra la diferencia entre su tasa y la del de abajo; el total que paga la
 * Casa queda capado a la tasa del nivel más alto (el socio). Desde acá el admin:
 * (1) fija el % de cada socio (cada operador reparte hacia abajo, ≤ su tasa),
 * (2) simula el override por nivel, (3) computa el período, (4) liquida en cash.
 *
 * C4: SIN deducciones por ahora (NetWin puro → comisión). Permisos:
 * commissions.configure (config + compute), commissions.settle (liquidar).
 */

'use client';

import { Calculator, ChevronDown, Info, Network, Play, Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { NetworkCard } from '@/components/admin/network-card';
import { isApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';
import {
  useComputeNetwork,
  useHousePnl,
  useNetworkOverview,
  useSettleNetwork,
  type HousePnl,
  type NetworkOverviewOperator,
} from '@/lib/hooks/use-network-commissions';

function fmt(x: string | number | null | undefined): string {
  if (x === null || x === undefined) return '—';
  const n = Number(x);
  if (!Number.isFinite(n)) return String(x);
  return n.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Mes anterior completo como 'YYYY-MM' (default operativo). */
function defaultPeriod(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ──────────────────────────────────────────────────────────────────────
// (Eliminado) Fila editable de % por socio → reemplazado por NetworkCard, que
// agrupa por red y edita las tasas de los hijos directos del admin inline.
// ──────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────
// Simulador del override diferencial (C6). Cliente puro: dada una cadena de
// tasas y una NetWin, muestra cuánto cobra CADA nivel y el total (cap a la
// tasa del socio), con validación de techo en vivo (cada tasa ≤ la del padre).
// ──────────────────────────────────────────────────────────────────────

type SimLevel = { key: string; label: string; rate: string };

function DifferentialSimulator() {
  const [netWin, setNetWin] = useState('1000');
  const [levels, setLevels] = useState<SimLevel[]>([
    { key: 'socio', label: 'Socio', rate: '10' },
    { key: 'distribuidor', label: 'Distribuidor', rate: '6' },
    { key: 'cajero', label: 'Cajero', rate: '4' },
  ]);

  const net = Math.max(0, Number(netWin) || 0);

  const computed = useMemo(() => {
    const rates = levels.map((l) => {
      const r = Number(l.rate);
      return Number.isFinite(r) ? r : 0;
    });
    return levels.map((l, i) => {
      const rate = rates[i]!;
      const childRate = i < rates.length - 1 ? rates[i + 1]! : 0;
      // Techo (C2): una tasa no puede ser menor que la del hijo (override < 0).
      const inverted = childRate > rate;
      const take = ((rate - childRate) / 100) * net;
      return { ...l, rate, childRate, take, inverted };
    });
  }, [levels, net]);

  const topRate = computed[0]?.rate ?? 0;
  const casaTotal = (topRate / 100) * net;
  const anyInverted = computed.some((c) => c.inverted);

  function setLevelRate(key: string, rate: string) {
    setLevels((prev) => prev.map((l) => (l.key === key ? { ...l, rate } : l)));
  }

  return (
    <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto p-4 flex flex-col gap-4">
      <p className="text-[12px] text-[var(--color-fg-muted)] max-w-2xl">
        Cada nivel cobra <strong>la diferencia entre su tasa y la del de abajo</strong>.
        La Casa paga en total la tasa del nivel más alto (el socio); los niveles
        intermedios se reparten ese total según sus tasas. Probá una cadena acá
        antes de fijarla.
      </p>

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label
            htmlFor="sim-netwin"
            className="text-[11px] text-[var(--color-fg-subtle)]"
          >
            NetWin de la red (lo que pierden los jugadores)
          </label>
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] text-[var(--color-fg-subtle)] font-mono">
              $
            </span>
            <Input
              id="sim-netwin"
              type="number"
              min="0"
              step="100"
              className="w-32 font-mono text-right"
              value={netWin}
              onChange={(e) => setNetWin(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <THead>
            <TR>
              <TH>Nivel</TH>
              <TH className="text-right">Su tasa</TH>
              <TH className="text-right">Tasa del hijo</TH>
              <TH className="text-right">Override</TH>
              <TH className="text-right">Cobra</TH>
            </TR>
          </THead>
          <TBody>
            {computed.map((c) => (
              <TR key={c.key}>
                <TD className="text-[13px]">{c.label}</TD>
                <TD className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="0.5"
                      className={`w-20 font-mono text-right ${
                        c.inverted
                          ? 'border-[var(--color-danger)] text-[var(--color-danger)]'
                          : ''
                      }`}
                      value={c.rate}
                      onChange={(e) => setLevelRate(c.key, e.target.value)}
                    />
                    <span className="text-[12px] text-[var(--color-fg-subtle)]">
                      %
                    </span>
                  </div>
                </TD>
                <TD className="text-right num font-mono text-[var(--color-fg-subtle)]">
                  {c.childRate.toLocaleString('es-AR', {
                    maximumFractionDigits: 2,
                  })}
                  %
                </TD>
                <TD className="text-right num font-mono text-[var(--color-fg-muted)]">
                  {c.inverted ? (
                    <span className="text-[var(--color-danger)]">
                      {c.rate}% &lt; {c.childRate}%
                    </span>
                  ) : (
                    `${(c.rate - c.childRate).toLocaleString('es-AR', {
                      maximumFractionDigits: 2,
                    })}%`
                  )}
                </TD>
                <TD className="text-right num font-mono">
                  {c.inverted ? (
                    <span className="text-[var(--color-danger)]">inválido</span>
                  ) : (
                    <span className="text-[var(--color-success)]">
                      {fmt(c.take)}
                    </span>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>

      {anyInverted ? (
        <div className="text-[12px] text-[var(--color-danger)] border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/8 p-3">
          <strong>Markup invertido:</strong> un nivel tiene una tasa menor que la
          de su hijo. Eso daría un override negativo — corregí las tasas (cada
          una ≤ la del nivel de arriba) antes de fijarlas. Al computar, el
          sistema frena si detecta esto.
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 border-t border-[var(--color-border)] pt-3">
          <span className="text-[12px] text-[var(--color-fg-muted)]">
            Total que paga la Casa (cap a la tasa del socio: {topRate}%)
          </span>
          <span className="font-mono text-[15px] font-semibold text-[var(--color-fg)]">
            {fmt(casaTotal)}
          </span>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Página
// ──────────────────────────────────────────────────────────────────────

function HousePnlCard({ pnl, period }: { pnl: HousePnl; period: string }) {
  const d = pnl.dependent;
  const hasIndep =
    Number(pnl.independent.netWin) !== 0 ||
    Number(pnl.independent.providerFee) !== 0;
  const rows: { label: string; value: string; sign?: '−'; strong?: boolean }[] = [
    { label: 'NetWin de la red dependiente', value: fmt(d.netWin) },
    { label: 'Costo del proveedor', value: fmt(d.providerFee), sign: '−' },
    { label: 'Base de comisión', value: fmt(d.base) },
    { label: 'Comisiones a la red', value: fmt(d.commissions), sign: '−' },
    { label: 'Ganancia neta de la Casa', value: fmt(d.houseNet), strong: true },
  ];
  return (
    <section className="flex flex-col gap-2">
      <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium flex items-center gap-2">
        <Wallet className="size-3" />
        Resultado de la Casa · {period}
      </span>
      <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] p-5 flex flex-col gap-4">
        {!pnl.periodComputed && (
          <p className="text-[11px] text-[#eab308]">
            Este período todavía no se computó — las comisiones figuran en 0.
            Apretá &quot;Computar&quot; para el cálculo real.
          </p>
        )}
        <div className="flex flex-col divide-y divide-[var(--color-border)]">
          {rows.map((r) => (
            <div
              key={r.label}
              className="flex items-center justify-between py-2"
              style={r.strong ? { borderTop: '1px solid var(--color-border)' } : undefined}
            >
              <span
                className={
                  r.strong
                    ? 'text-[13px] font-semibold'
                    : 'text-[13px] text-[var(--color-fg-muted)]'
                }
              >
                {r.label}
              </span>
              <span
                className="text-[14px] font-mono tabular-nums"
                style={{
                  color: r.strong
                    ? 'var(--color-success, #22c55e)'
                    : r.sign
                      ? '#ef4444'
                      : 'var(--color-fg)',
                }}
              >
                {r.sign ?? ''}
                {r.value}
              </span>
            </div>
          ))}
        </div>
        {hasIndep && (
          <div className="rounded-lg bg-[var(--color-bg-subtle)] p-3 flex flex-col gap-1.5">
            <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)]">
              Red independiente (informativo)
            </span>
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-[var(--color-fg-muted)]">
                NetWin de independientes (queda para ellos)
              </span>
              <span className="font-mono tabular-nums">
                {fmt(pnl.independent.netWin)}
              </span>
            </div>
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-[var(--color-fg-muted)]">
                Fee del proveedor que la Casa absorbe
              </span>
              <span className="font-mono tabular-nums text-[#ef4444]">
                −{fmt(pnl.independent.providerFee)}
              </span>
            </div>
            <div className="flex items-center justify-between text-[12px] pt-1.5 border-t border-[var(--color-border)]">
              <span className="font-medium">Ganancia neta total de la Casa</span>
              <span className="font-mono tabular-nums font-semibold">
                {fmt(pnl.houseNetTotal)}
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default function NetworkCommissionsPage() {
  const { user } = useAuth();
  const [period, setPeriod] = useState(defaultPeriod());
  const compute = useComputeNetwork();
  const overview = useNetworkOverview(period);
  const pnl = useHousePnl(period);
  const settleOne = useSettleNetwork();
  const [simOpen, setSimOpen] = useState(false);
  const [indepOpen, setIndepOpen] = useState(false);

  const canSettle =
    user?.effectivePermissions === undefined ||
    user.effectivePermissions.includes('commissions.settle');

  async function handleSettleOperator(
    op: NetworkOverviewOperator,
  ): Promise<void> {
    if (op.pendingRowIds.length === 0) return;
    const ref = window.prompt(
      `Liquidar ${op.displayName ?? op.username}: ${op.pendingRowIds.length} período(s) pendiente(s).\nComprobante/referencia (opcional):`,
      '',
    );
    if (ref === null) return; // canceló
    try {
      const res = await settleOne.mutateAsync({
        rowIds: op.pendingRowIds,
        reference: ref || undefined,
      });
      toast.success(
        `Liquidado: ${res.settled} pago(s), ${res.totalPaid}${res.failed ? ` · ${res.failed} fallaron` : ''}`,
      );
      void overview.refetch();
    } catch (err) {
      toast.error('Error al liquidar', {
        description: isApiError(err) ? err.message : 'Error de conexión',
      });
    }
  }

  async function handleCompute(): Promise<void> {
    try {
      const res = await compute.mutateAsync({ period });
      toast.success(
        `Período ${period}: ${res.sociosComputed} operador(es), ${fmt(res.totalPayable)} a pagar`,
      );
      void overview.refetch();
      void pnl.refetch();
    } catch (err) {
      toast.error('No se pudo computar', { description: mapComputeError(err) });
    }
  }

  const networks = overview.data?.networks ?? [];
  const independents = overview.data?.independents ?? [];

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1100px] mx-auto">
      {/* Header */}
      <header className="flex flex-col gap-2 pb-2">
        <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
          <Network className="size-3" />
          Negocio · Comisiones por red
        </span>
        <h1 className="font-display text-3xl lg:text-[2.5rem] leading-none tracking-tight">
          Comisiones por red
        </h1>
        <p className="text-sm text-[var(--color-fg-muted)] mt-1 max-w-2xl">
          La plataforma le paga a <strong>cada nivel</strong> (socio,
          distribuidor, cajero) su <strong>override diferencial</strong>: la
          diferencia entre su tasa y la del de abajo, sobre la NetWin de su red.
          El total que paga la Casa queda capado a la tasa del socio. Los
          independientes no cobran comisión (ganan por reventa).
        </p>
      </header>

      {/* Controles: período + computar */}
      <section className="flex flex-wrap items-end gap-3 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] p-4">
        <div className="flex flex-col gap-1">
          <label
            htmlFor="period"
            className="text-[11px] text-[var(--color-fg-subtle)]"
          >
            Mes
          </label>
          <Input
            id="period"
            type="month"
            className="font-mono"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          />
        </div>
        <Button
          variant="primary"
          size="md"
          onClick={() => void handleCompute()}
          disabled={compute.isPending || !period}
        >
          {compute.isPending ? (
            <>
              <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
              Computando…
            </>
          ) : (
            <>
              <Play className="size-3.5" />
              Computar
            </>
          )}
        </Button>
        <p className="text-[11px] text-[var(--color-fg-subtle)] flex-1 min-w-[200px]">
          Calcula el override de cada operador sobre la NetWin del mes.
          Idempotente: recomputá cuando quieras (no toca lo ya liquidado).
        </p>
      </section>

      {/* P&L total de la Casa */}
      {pnl.data && <HousePnlCard pnl={pnl.data} period={period} />}

      {/* Redes agrupadas (Red de la Casa primero, luego socios) */}
      <section className="flex flex-col gap-3">
        <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium flex items-center gap-2">
          <Network className="size-3" />
          Redes · {period}
        </span>
        {overview.isLoading ? (
          <Skeleton className="h-40 w-full bg-[var(--color-bg-subtle)]" />
        ) : overview.isError ? (
          <EmptyState hint="data" label="No se pudieron cargar las redes." />
        ) : networks.length === 0 ? (
          <EmptyState hint="data" label="Todavía no hay operadores en redes." />
        ) : (
          networks.map((net) => (
            <NetworkCard
              key={net.rootId ?? 'house'}
              network={net}
              canSettle={canSettle}
              onSettle={(op) => void handleSettleOperator(op)}
            />
          ))
        )}
        <p className="text-[11px] text-[var(--color-fg-subtle)]">
          Solo podés editar la tasa de tus <strong>hijos directos</strong>{' '}
          (delegación estricta). Los niveles más abajo los fija cada operador
          desde su propia sucursal. “A cobrar” = override + arrastre; nunca baja
          de 0 (la deuda de una red negativa se arrastra al mes siguiente).
        </p>
      </section>

      {/* Redes independientes (no aplica — LEY C5) */}
      {independents.length > 0 && (
        <section className="border border-[var(--color-border)] bg-[var(--color-bg-subtle)]">
          <button
            type="button"
            onClick={() => setIndepOpen((v) => !v)}
            className="w-full flex items-center justify-between gap-3 p-4 text-left"
          >
            <span className="flex items-center gap-2 text-[var(--color-fg-muted)]">
              <Info className="size-4" />
              <span className="font-medium text-[14px]">
                Redes independientes
              </span>
              <Badge variant="neutral">No aplica</Badge>
            </span>
            <ChevronDown
              className={cn(
                'size-4 text-[var(--color-fg-muted)] transition-transform',
                indepOpen && 'rotate-180',
              )}
            />
          </button>
          {indepOpen && (
            <div className="border-t border-[var(--color-border)] p-4 flex flex-col gap-2">
              <p className="text-[12px] text-[var(--color-fg-muted)]">
                Las redes independientes <strong>no cobran comisión</strong>:
                ganan por margen de reventa (LEY C5). No se les fija tasa acá; su
                operatoria vive en “Mi sucursal”.
              </p>
              <ul className="flex flex-col gap-1">
                {independents.map((i) => (
                  <li
                    key={i.id}
                    className="text-[13px] flex items-center gap-2"
                  >
                    <span>{i.displayName ?? i.username}</span>
                    <span className="text-[11px] font-mono text-[var(--color-fg-subtle)]">
                      @{i.username}
                    </span>
                    <Badge variant="neutral">Independiente</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Simulador diferencial (colapsable, al final) */}
      <section className="border border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
        <button
          type="button"
          onClick={() => setSimOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-[var(--color-bg-subtle)] transition-colors"
        >
          <span className="flex items-center gap-2">
            <Calculator className="size-4 text-[var(--color-fg-muted)]" />
            <span className="font-medium text-[14px]">
              Simulador — probar una cadena de tasas
            </span>
          </span>
          <ChevronDown
            className={cn(
              'size-4 text-[var(--color-fg-muted)] transition-transform',
              simOpen && 'rotate-180',
            )}
          />
        </button>
        {simOpen && (
          <div className="border-t border-[var(--color-border)] p-4">
            <DifferentialSimulator />
          </div>
        )}
      </section>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Errores
// ──────────────────────────────────────────────────────────────────────

function mapComputeError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.code === 'INVERTED_MARKUP')
    return 'Hay una tasa de hijo mayor que la del padre (override negativo). Corregí los % antes de computar.';
  if (err.code === 'CONSERVATION_VIOLATED')
    return 'Hay socios anidados (un socio cuelga de otro). Corregí la jerarquía.';
  if (err.code === 'INVALID_PERIOD') return 'Período inválido.';
  if (err.status === 403) return 'No tenés permiso para computar.';
  return err.message || 'Error inesperado.';
}
