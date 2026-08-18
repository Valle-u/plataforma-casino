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

import { Calculator, ChevronDown, Info, Network, Percent, Play, Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { HelpNote } from '@/components/ui/help-note';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { PageShell } from '@/components/ui/page-shell';
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
    <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius)] overflow-x-auto p-4 flex flex-col gap-4">
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
              <TH className="text-right">Diferencia</TH>
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

function HousePnlCard({
  pnl,
  period,
  settlement,
}: {
  pnl: HousePnl;
  period: string;
  settlement: { pending: number; paid: number };
}) {
  const d = pnl.dependent;
  const netWin = Number(d.netWin);
  const fee = Number(d.providerFee);
  const commissions = Number(d.commissions);
  const houseNet = Number(d.houseNet);
  const margin = netWin > 0 ? (houseNet / netWin) * 100 : 0;
  const feePct = netWin > 0 ? (fee / netWin) * 100 : 0;
  const a = pnl.activity;

  return (
    <section className="flex flex-col gap-2">
      <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium flex items-center gap-2">
        <Wallet className="size-3" />
        Resultado de la Casa · {period}
      </span>
      <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius)] p-5 flex flex-col gap-5">
        {!pnl.periodComputed && (
          <p className="text-[11px] text-[var(--color-warning)]">
            Este mes todavía no se calculó — las comisiones figuran en 0.
            Apretá &quot;Calcular&quot; para el número real.
          </p>
        )}

        {/* KPIs destacados */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi
            label="NetWin del mes"
            value={fmt(netWin)}
            hint="lo que perdieron los jugadores de tu red central"
          />
          <Kpi
            label="Comisiones a operadores"
            value={fmt(commissions)}
            tone="danger"
          />
          <Kpi
            label="Retiene la Casa"
            value={fmt(houseNet)}
            tone="success"
            strong
          />
          <Kpi
            label="Margen de la Casa"
            value={`${margin.toLocaleString('es-AR', { maximumFractionDigits: 1 })}%`}
            hint="retiene ÷ NetWin"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Desglose (waterfall) */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
              De dónde sale la ganancia
            </span>
            <div className="flex flex-col divide-y divide-[var(--color-border)]">
              <PnlLine label="NetWin de tu red central" value={fmt(netWin)} />
              <PnlLine
                label={`Costo del proveedor (${feePct.toLocaleString('es-AR', { maximumFractionDigits: 1 })}%)`}
                value={fmt(fee)}
                sign="−"
              />
              <PnlLine label="Base de comisión" value={fmt(d.base)} dim />
              <PnlLine
                label="Comisiones a la red"
                value={fmt(commissions)}
                sign="−"
              />
              <PnlLine
                label="Ganancia de la Casa"
                value={fmt(houseNet)}
                strong
              />
            </div>
          </div>

          {/* Liquidación + Actividad */}
          <div className="flex flex-col gap-4">
            <div className="rounded-lg bg-[var(--color-bg-subtle)] p-3 flex flex-col gap-1.5">
              <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
                Liquidación de comisiones
              </span>
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-[var(--color-fg-muted)]">
                  Pendiente de liquidar
                </span>
                <span
                  className="font-mono tabular-nums font-semibold"
                  style={{ color: settlement.pending > 0 ? 'var(--color-warning)' : 'var(--color-fg-muted)' }}
                >
                  {fmt(settlement.pending)}
                </span>
              </div>
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-[var(--color-fg-muted)]">
                  Ya liquidado (este mes)
                </span>
                <span className="font-mono tabular-nums">
                  {fmt(settlement.paid)}
                </span>
              </div>
            </div>

            <div className="rounded-lg bg-[var(--color-bg-subtle)] p-3 flex flex-col gap-1.5">
              <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
                Actividad de juego (red central)
              </span>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
                <ActLine label="Apuestas" value={fmt(a.bets)} />
                <ActLine label="Premios pagados" value={fmt(a.wins)} />
                <ActLine label="Jugadas" value={a.rounds.toLocaleString('es-AR')} />
                <ActLine
                  label="Jugadores activos"
                  value={a.players.toLocaleString('es-AR')}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
  strong,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'success' | 'danger';
  strong?: boolean;
}) {
  const color =
    tone === 'success'
      ? 'var(--color-success)'
      : tone === 'danger'
        ? 'var(--color-danger)'
        : 'var(--color-fg)';
  return (
    <div
      className={cn(
        'flex flex-col gap-1 p-3 bg-[var(--color-bg-subtle)] border border-[var(--color-border)]',
        strong && 'ring-1 ring-[var(--color-success)]/30',
      )}
    >
      <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        {label}
      </span>
      <span
        className="font-display text-xl tabular-nums tracking-tight"
        style={{ color }}
      >
        {value}
      </span>
      {hint && (
        <span className="text-[10px] text-[var(--color-fg-subtle)]">{hint}</span>
      )}
    </div>
  );
}

function PnlLine({
  label,
  value,
  sign,
  strong,
  dim,
}: {
  label: string;
  value: string;
  sign?: '−';
  strong?: boolean;
  dim?: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between py-1.5"
      style={strong ? { borderTop: '1px solid var(--color-border)' } : undefined}
    >
      <span
        className={
          strong
            ? 'text-[13px] font-semibold'
            : `text-[13px] ${dim ? 'text-[var(--color-fg-subtle)]' : 'text-[var(--color-fg-muted)]'}`
        }
      >
        {label}
      </span>
      <span
        className="text-[13px] font-mono tabular-nums"
        style={{
          color: strong
            ? 'var(--color-success)'
            : sign
              ? 'var(--color-danger)'
              : 'var(--color-fg)',
        }}
      >
        {sign ?? ''}
        {value}
      </span>
    </div>
  );
}

function ActLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[var(--color-fg-muted)]">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
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

  // Pendiente vs liquidado del período (para la card de la Casa).
  const settlement = useMemo(() => {
    let pending = 0;
    let paid = 0;
    for (const net of networks) {
      for (const op of net.operators) {
        const v = Number(op.finalCommission) || 0;
        if (op.status === 'accrued') pending += v;
        else if (op.status === 'paid') paid += v;
      }
    }
    return { pending, paid };
  }, [networks]);

  return (
    <PageShell className="max-w-[1100px]">
      <PageHeader
        icon={Percent}
        title="Comisiones por red"
        description="Acá configurás y pagás lo que le corresponde a cada socio, distribuidor y cajero por lo que genera su red."
      />

      <HelpNote id="network-commissions">
        <span className="block">
          Cada operador de tu red (socio, distribuidor, cajero) cobra una{' '}
          <strong>comisión</strong>: un porcentaje de la <strong>netwin</strong>{' '}
          de su red (la plata que pierden sus jugadores). Se reparte{' '}
          <strong>en cascada</strong>: cada nivel cobra{' '}
          <strong>la diferencia entre su porcentaje y el del que tiene abajo</strong>.
        </span>
        <span className="block mt-2">
          <strong>Ejemplo:</strong> si el socio tiene 10% y su cajero 4%, sobre
          una netwin de $1.000 el <strong>cajero cobra $40</strong> (su 4%) y el{' '}
          <strong>socio cobra $60</strong> (el 10% − 4% = 6% que queda). La Casa
          nunca paga más que el porcentaje del socio (el 10%, o sea $100 en total).
        </span>
        <span className="block mt-2 font-medium text-[var(--color-fg)]">
          Cómo se opera, paso a paso:
        </span>
        <span className="block mt-1">
          <strong>1.</strong> Fijás el <strong>porcentaje de cada socio</strong>{' '}
          más abajo, en cada red (solo tocás a tus hijos directos; cada operador
          reparte hacia los suyos, nunca más que su propia tasa).{' '}
          <strong>2.</strong> Si querés, <strong>probás una cadena</strong> de
          porcentajes en el Simulador (abajo de todo) antes de fijarla.{' '}
          <strong>3.</strong> Elegís el <strong>mes</strong> y apretás{' '}
          <strong>Calcular</strong>: el sistema saca cuánto le toca a cada uno
          sobre la netwin real de ese mes. <strong>4.</strong> Después{' '}
          <strong>liquidás</strong> (pagás) lo que quedó pendiente de cada
          operador, y queda registrado.
        </span>
        <span className="block mt-2 text-[var(--color-fg-subtle)]">
          Los operadores <strong>independientes</strong> no cobran comisión: ellos
          ganan por la reventa de fichas, no por un porcentaje.
        </span>
      </HelpNote>

      {/* Controles: período + computar */}
      <section className="flex flex-wrap items-end gap-3 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius)] p-4">
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
              Calculando…
            </>
          ) : (
            <>
              <Play className="size-3.5" />
              Calcular
            </>
          )}
        </Button>
        <p className="text-[11px] text-[var(--color-fg-subtle)] flex-1 min-w-[200px]">
          Saca lo que le toca a cada operador sobre la netwin del mes elegido.
          Podés recalcular las veces que quieras: no toca lo que ya pagaste.
        </p>
      </section>

      {/* P&L total de la Casa */}
      {pnl.data && (
        <HousePnlCard pnl={pnl.data} period={period} settlement={settlement} />
      )}

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
          Solo podés editar la tasa de tus <strong>hijos directos</strong>. Los
          niveles de más abajo los fija cada operador desde su propia sucursal.{' '}
          <strong>“A cobrar”</strong> = lo que le toca este mes + lo que quedó
          arrastrado de meses anteriores; nunca baja de 0 (si una red da
          negativo, esa deuda se pasa al mes siguiente).
        </p>
      </section>

      {/* Redes independientes (no aplica — LEY C5) */}
      {independents.length > 0 && (
        <section className="border border-[var(--color-border)] rounded-[var(--radius)] bg-[var(--color-bg-subtle)]">
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
      <section className="border border-[var(--color-border)] rounded-[var(--radius)] bg-[var(--color-bg-elevated)]">
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
    </PageShell>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Errores
// ──────────────────────────────────────────────────────────────────────

function mapComputeError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.code === 'INVERTED_MARKUP')
    return 'Hay un hijo con una tasa mayor que la de su padre (daría una diferencia negativa). Corregí los % antes de calcular.';
  if (err.code === 'CONSERVATION_VIOLATED')
    return 'Hay socios anidados (un socio cuelga de otro). Corregí la jerarquía.';
  if (err.code === 'INVALID_PERIOD') return 'Período inválido.';
  if (err.status === 403) return 'No tenés permiso para computar.';
  return err.message || 'Error inesperado.';
}
