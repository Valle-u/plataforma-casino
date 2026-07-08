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

import { Calculator, Network, Percent, Play, Wallet } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { SettleNetworkModal } from '@/components/admin/settle-network-modal';
import { isApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import {
  useComputeNetwork,
  useNetworkPeriods,
  useSetSocioRate,
  useSocioRates,
  type NetworkPeriodRow,
  type SocioRate,
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
// Fila editable de % por socio (el admin fija la del socio; cada operador
// reparte hacia abajo con tasas ≤ la suya — regla del techo, C2).
// ──────────────────────────────────────────────────────────────────────

function SocioRateRow({ socio }: { socio: SocioRate }) {
  const setRate = useSetSocioRate();
  const [value, setValue] = useState(socio.commissionRate);

  useEffect(() => {
    setValue(socio.commissionRate);
  }, [socio.commissionRate]);

  const num = Number(value);
  const valid = Number.isFinite(num) && num >= 0 && num <= 100;
  const changed = valid && num !== Number(socio.commissionRate);

  async function save(): Promise<void> {
    if (!changed) return;
    try {
      await setRate.mutateAsync({ childUserId: socio.id, rate: num });
      toast.success(
        `Comisión de ${socio.displayName ?? socio.username} → ${num}%`,
      );
    } catch (err) {
      toast.error('No se pudo guardar', { description: mapRateError(err) });
      setValue(socio.commissionRate);
    }
  }

  return (
    <TR>
      <TD>
        <div className="flex flex-col">
          <span className="text-[13px] text-[var(--color-fg)]">
            {socio.displayName ?? socio.username}
          </span>
          <span className="text-[11px] text-[var(--color-fg-subtle)] font-mono">
            @{socio.username}
          </span>
        </div>
      </TD>
      <TD>
        {socio.isIndependent && <Badge variant="neutral">Independiente</Badge>}
      </TD>
      <TD className="text-right">
        {socio.isIndependent ? (
          <span className="text-[12px] text-[var(--color-fg-subtle)]">
            no aplica
          </span>
        ) : (
          <div className="flex items-center justify-end gap-1.5">
            <Input
              type="number"
              min="0"
              max="100"
              step="0.01"
              className="w-20 font-mono text-right"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save();
              }}
            />
            <span className="text-[12px] text-[var(--color-fg-subtle)]">%</span>
          </div>
        )}
      </TD>
      <TD className="text-right">
        {!socio.isIndependent && (
          <Button
            size="sm"
            variant="secondary"
            disabled={!changed || setRate.isPending}
            onClick={() => void save()}
          >
            Guardar
          </Button>
        )}
      </TD>
    </TR>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'paid') return <Badge variant="success">Pagado</Badge>;
  if (status === 'void') return <Badge variant="neutral">Anulado</Badge>;
  return <Badge variant="warning">Pendiente</Badge>;
}

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
    <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] p-4 flex flex-col gap-4">
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

export default function NetworkCommissionsPage() {
  const { user } = useAuth();
  const socios = useSocioRates();
  const [period, setPeriod] = useState(defaultPeriod());
  const compute = useComputeNetwork();
  const periods = useNetworkPeriods(period);
  const [settleOpen, setSettleOpen] = useState(false);

  const rows: NetworkPeriodRow[] = periods.data?.periods ?? [];
  // C4: sin deducciones → lo liquidable es `payable`. El motor persiste
  // finalCommission == payable, así que filtramos por finalCommission (que ya
  // es el monto a cobrar) para el pendiente.
  const pending = rows.filter(
    (r) => r.status === 'accrued' && Number(r.finalCommission) > 0,
  );
  const totalPending = pending.reduce(
    (s, r) => s + Number(r.finalCommission),
    0,
  );

  const canSettle =
    user?.effectivePermissions === undefined ||
    user.effectivePermissions.includes('commissions.settle');

  async function handleCompute(): Promise<void> {
    try {
      const res = await compute.mutateAsync({ period });
      toast.success(
        `Período ${period}: ${res.sociosComputed} operador(es), ${fmt(res.totalPayable)} a pagar`,
      );
      void periods.refetch();
    } catch (err) {
      toast.error('No se pudo computar', { description: mapComputeError(err) });
    }
  }

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1100px] mx-auto">
      {/* Header */}
      <header className="flex flex-col gap-2 pb-2">
        <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
          <Network className="size-3" />
          Negocio · Comisiones por red
        </span>
        <h1 className="font-display text-[2.5rem] leading-none tracking-tight">
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

      {/* Sección 1: % por socio */}
      <section className="flex flex-col gap-2">
        <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium flex items-center gap-2">
          <Percent className="size-3" />
          Comisión por socio
        </span>
        {socios.isLoading ? (
          <Skeleton className="h-32" />
        ) : socios.isError || !socios.data ? (
          <EmptyState hint="data" label="No se pudo cargar la lista de socios." />
        ) : socios.data.socios.length === 0 ? (
          <EmptyState hint="data" label="Todavía no hay socios en este tenant." />
        ) : (
          <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
            <Table>
              <THead>
                <TR>
                  <TH>Socio</TH>
                  <TH></TH>
                  <TH className="text-right">% de comisión</TH>
                  <TH className="text-right"></TH>
                </TR>
              </THead>
              <TBody>
                {socios.data.socios.map((s) => (
                  <SocioRateRow key={s.id} socio={s} />
                ))}
              </TBody>
            </Table>
          </div>
        )}
        <p className="text-[11px] text-[var(--color-fg-subtle)]">
          El admin fija el % del <strong>socio</strong>. Cada operador reparte
          hacia abajo fijando la tasa de sus hijos directos, siempre{' '}
          <strong>≤ la suya</strong> (regla del techo). El sistema rechaza una
          tasa que supere a la del padre.
        </p>
      </section>

      {/* Sección 2: Simulador del override diferencial (C6) */}
      <section className="flex flex-col gap-2">
        <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium flex items-center gap-2">
          <Calculator className="size-3" />
          Simulador del override por nivel
        </span>
        <DifferentialSimulator />
      </section>

      {/* Sección 3: Computar período */}
      <section className="flex flex-col gap-2">
        <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium flex items-center gap-2">
          <Calculator className="size-3" />
          Computar período
        </span>
        <div className="flex flex-wrap items-end gap-3 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] p-4">
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
            Calcula el override de cada operador sobre la NetWin del mes. Es
            idempotente: podés recomputar las veces que quieras (no toca lo ya
            liquidado). Si hay una tasa invertida, frena y avisa.
          </p>
        </div>
      </section>

      {/* Sección 4: Resultados del período */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium flex items-center gap-2">
            <Wallet className="size-3" />
            Resultados de {period}
          </span>
          {canSettle && pending.length > 0 && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setSettleOpen(true)}
            >
              Liquidar {pending.length} pendiente(s)
            </Button>
          )}
        </div>
        {periods.isLoading ? (
          <Skeleton className="h-28" />
        ) : periods.isError || !periods.data ? (
          <EmptyState hint="data" label="No se pudieron cargar los resultados." />
        ) : rows.length === 0 ? (
          <EmptyState
            hint="data"
            label="No hay resultados para este mes. Computá el período para generarlos."
          />
        ) : (
          <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  <TH>Operador</TH>
                  <TH className="text-right">NetWin de la red</TH>
                  <TH className="text-right">Override</TH>
                  <TH className="text-right">Arrastre</TH>
                  <TH className="text-right">A cobrar</TH>
                  <TH>Estado</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.operatorUserId}>
                    <TD className="text-[12px]">
                      {r.operatorUsername ? `@${r.operatorUsername}` : '—'}
                    </TD>
                    <TD className="text-right num font-mono text-[var(--color-fg-muted)]">
                      {fmt(r.subNetWin)}
                    </TD>
                    <TD className="text-right num font-mono">
                      {fmt(r.grossCommission)}
                    </TD>
                    <TD className="text-right num font-mono text-[var(--color-fg-subtle)]">
                      {Number(r.carryoverIn) === 0 ? '—' : fmt(r.carryoverIn)}
                    </TD>
                    <TD className="text-right num font-mono text-[var(--color-success)]">
                      {fmt(r.finalCommission)}
                    </TD>
                    <TD>
                      <StatusBadge status={r.status} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
        <p className="text-[11px] text-[var(--color-fg-subtle)]">
          “A cobrar” = override del mes + arrastre. Nunca baja de 0. Si la red
          dio negativo, la deuda se arrastra al mes siguiente (el operador no
          pone de su bolsillo). La Casa liquida en cash a cada nivel.
        </p>
      </section>

      <SettleNetworkModal
        open={settleOpen}
        onOpenChange={setSettleOpen}
        period={period}
        pendingCount={pending.length}
        totalPayable={String(totalPending)}
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Errores
// ──────────────────────────────────────────────────────────────────────

function mapRateError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.code === 'RATE_EXCEEDS_PARENT')
    return 'La tasa no puede superar la del nivel de arriba.';
  if (err.code === 'RATE_BELOW_CHILDREN')
    return 'La tasa no puede ser menor que la de un hijo (override negativo).';
  if (err.code === 'NOT_DIRECT_CHILD')
    return 'Solo el admin fija el % de los socios.';
  if (err.status === 403) return 'No tenés permiso.';
  if (err.status === 400) return err.message || 'Valor inválido (0–100).';
  return err.message || 'Error inesperado.';
}

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
