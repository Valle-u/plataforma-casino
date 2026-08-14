/**
 * LedgerPanel — "Integridad de fichas". Contenido del tab de integridad del
 * ledger dentro de /integrity. Chequea que el saldo de cada billetera coincida
 * con la suma de sus movimientos (LEY E2). Read-only + botón para correr el
 * chequeo. Textos en criollo, sin jerga.
 */

'use client';

import {
  AlertTriangle,
  CheckCircle2,
  Coins,
  Flame,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  Wallet,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import {
  useLatestReconciliation,
  useLedgerSupply,
  useReconciliations,
  useRunReconciliation,
  type ReconciliationRun,
  type ReconciliationStatus,
  type SupplySnapshot,
} from '@/lib/hooks/use-ledger';

function fmt(x: string | number | null | undefined): string {
  if (x === null || x === undefined) return '—';
  const n = Number(x);
  if (!Number.isFinite(n)) return String(x);
  return n.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDate(x: string): string {
  return new Date(x).toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function LedgerPanel() {
  const latest = useLatestReconciliation();
  const supply = useLedgerSupply();
  const history = useReconciliations(20, 0);
  const run = useRunReconciliation();

  async function handleRun() {
    try {
      const result = await run.mutateAsync();
      if (result.status === 'ok') {
        toast.success('Todo cuadra ✅', {
          description: `${result.walletsChecked} billeteras revisadas, sin descuadres.`,
        });
      } else if (result.status === 'mismatch') {
        toast.warning('Se detectaron descuadres', {
          description: `${result.walletsMismatched} en saldo · ${result.holdsMismatched} en retenido. Revisá el detalle.`,
        });
      } else {
        toast.error('El chequeo no se pudo completar', {
          description: result.error ?? 'Error inesperado.',
        });
      }
    } catch {
      toast.error('No se pudo correr el chequeo', {
        description: 'Verificá la conexión e intentá de nuevo.',
      });
    }
  }

  const run0 = latest.data?.run ?? null;

  return (
    <div className="flex flex-col gap-6">
      {/* Intro + acción */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <p className="text-sm text-[var(--color-fg-muted)] max-w-2xl">
          Verifica que <strong>ninguna ficha aparezca o desaparezca sin
          registro</strong>: el saldo de cada billetera tiene que coincidir
          exacto con la suma de sus movimientos, y lo retenido con los retiros
          en curso.{' '}
          <span className="text-[var(--color-fg-subtle)]">
            Corre solo cada noche; podés correrlo cuando quieras. Ante un
            descuadre solo avisa, no bloquea nada.
          </span>
        </p>
        <Button
          variant="primary"
          size="md"
          onClick={() => void handleRun()}
          disabled={run.isPending}
          className="shrink-0"
        >
          {run.isPending ? (
            <>
              <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
              Chequeando…
            </>
          ) : (
            <>
              <PlayCircle className="size-4" />
              Correr chequeo ahora
            </>
          )}
        </Button>
      </div>

      {/* Estado del último chequeo */}
      {latest.isLoading ? <Skeleton className="h-28" /> : <StatusHero run={run0} />}

      {/* Resumen de fichas */}
      <section className="flex flex-col gap-3">
        <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium flex items-center gap-2">
          <Coins className="size-3" />
          Resumen de fichas del sistema
        </span>
        {supply.isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        ) : supply.isError || !supply.data ? (
          <EmptyState hint="data" label="No se pudo cargar el resumen." />
        ) : (
          <SupplyGrid supply={supply.data} />
        )}
      </section>

      {/* Descuadres del último chequeo */}
      {run0 && run0.mismatches && run0.mismatches.items.length > 0 && (
        <MismatchesTable run={run0} />
      )}

      {/* Historial */}
      <section className="flex flex-col gap-3">
        <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium flex items-center gap-2">
          <RefreshCw className="size-3" />
          Chequeos anteriores
        </span>
        {history.isLoading ? (
          <Skeleton className="h-40" />
        ) : history.isError || !history.data ? (
          <EmptyState hint="data" label="No se pudo cargar el historial." />
        ) : history.data.runs.length === 0 ? (
          <EmptyState
            hint="data"
            label="Todavía no se corrió ningún chequeo. Tocá “Correr chequeo ahora”."
          />
        ) : (
          <HistoryTable runs={history.data.runs} />
        )}
      </section>
    </div>
  );
}

// ── Estado (hero) ─────────────────────────────────────────────────────────

function StatusHero({ run }: { run: ReconciliationRun | null }) {
  if (!run) {
    return (
      <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto p-5 flex items-center gap-4">
        <ShieldCheck className="size-8 text-[var(--color-fg-subtle)] shrink-0" />
        <div className="flex flex-col gap-0.5">
          <span className="text-[15px] text-[var(--color-fg)]">
            Todavía no se corrió ningún chequeo
          </span>
          <span className="text-[12px] text-[var(--color-fg-muted)]">
            Tocá “Correr chequeo ahora” para verificar que las fichas cuadran.
          </span>
        </div>
      </div>
    );
  }

  const tone = HERO_TONE[run.status];
  const Icon = tone.icon;

  return (
    <div className={cn('border p-5 flex items-start gap-4', tone.border, tone.bg)}>
      <Icon className={cn('size-8 shrink-0 mt-0.5', tone.fg)} />
      <div className="flex-1 flex flex-col gap-1">
        <div className="flex items-center gap-3 flex-wrap">
          <span className={cn('text-[17px] font-medium', tone.fg)}>
            {tone.title(run)}
          </span>
          <Badge variant="neutral">
            {run.trigger === 'manual' ? 'Manual' : 'Automático'}
          </Badge>
        </div>
        <span className="text-[13px] text-[var(--color-fg-muted)]">
          {tone.detail(run)}
        </span>
        <span className="text-[11px] text-[var(--color-fg-subtle)] mt-1">
          Último chequeo: {fmtDate(run.runAt)} · {run.walletsChecked} billeteras
          revisadas
          {run.durationMs != null && <> · {run.durationMs} ms</>}
        </span>
      </div>
    </div>
  );
}

const HERO_TONE: Record<
  ReconciliationStatus,
  {
    icon: typeof CheckCircle2;
    fg: string;
    bg: string;
    border: string;
    title: (r: ReconciliationRun) => string;
    detail: (r: ReconciliationRun) => string;
  }
> = {
  ok: {
    icon: CheckCircle2,
    fg: 'text-[var(--color-success)]',
    bg: 'bg-[var(--color-success-bg)]',
    border: 'border-[var(--color-success)]',
    title: () => 'Todo cuadra',
    detail: (r) =>
      `Las ${r.walletsChecked} billeteras coinciden con sus movimientos. No hay fichas sin respaldo en el registro.`,
  },
  mismatch: {
    icon: AlertTriangle,
    fg: 'text-[var(--color-accent-text)]',
    bg: 'bg-[var(--color-accent-subtle)]',
    border: 'border-[var(--color-accent)]',
    title: (r) =>
      `Hay ${r.walletsMismatched + r.holdsMismatched} descuadre(s)`,
    detail: (r) =>
      `${r.walletsMismatched} billetera(s) con el saldo descuadrado y ${r.holdsMismatched} con lo retenido descuadrado. Revisá el detalle abajo.`,
  },
  error: {
    icon: XCircle,
    fg: 'text-[var(--color-accent-text)]',
    bg: 'bg-[var(--color-bg-elevated)]',
    border: 'border-[var(--color-border-strong)]',
    title: () => 'El chequeo no se pudo completar',
    detail: (r) => r.error ?? 'Ocurrió un error inesperado durante el chequeo.',
  },
};

// ── Resumen de fichas ──────────────────────────────────────────────────────

function SupplyGrid({ supply }: { supply: SupplySnapshot }) {
  const cards: {
    label: string;
    value: string;
    icon: typeof Coins;
    tone: 'success' | 'accent' | 'neutral';
    hint?: string;
  }[] = [
    { label: 'Creadas', value: supply.totalMinted, icon: Coins, tone: 'success', hint: 'Fichas que emitió la Casa' },
    { label: 'Destruidas', value: supply.totalBurned, icon: Flame, tone: 'accent', hint: 'Fichas que se quemaron' },
    { label: 'Depositado', value: supply.totalDeposited, icon: Wallet, tone: 'success', hint: 'Cargas de jugadores' },
    { label: 'Retirado', value: supply.totalWithdrawn, icon: Wallet, tone: 'accent', hint: 'Salió del sistema' },
    { label: 'En billeteras', value: supply.circulating, icon: Coins, tone: 'neutral', hint: 'Suma de todos los saldos' },
    { label: 'Retenido', value: supply.locked, icon: ShieldCheck, tone: 'neutral', hint: 'En retiros pendientes' },
  ];

  const conservationOk = Number(supply.conservationDiff) === 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <div
              key={c.label}
              className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto p-3 flex flex-col gap-1"
            >
              <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] flex items-center gap-1.5">
                <Icon className="size-3" />
                {c.label}
              </span>
              <span
                className={cn(
                  'text-[1.15rem] font-mono num leading-tight',
                  c.tone === 'success' && 'text-[var(--color-success)]',
                  c.tone === 'accent' && 'text-[var(--color-accent-text)]',
                  c.tone === 'neutral' && 'text-[var(--color-fg)]',
                )}
              >
                {fmt(c.value)}
              </span>
              {c.hint && (
                <span className="text-[10px] text-[var(--color-fg-subtle)]">
                  {c.hint}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Verificación global. */}
      <div
        className={cn(
          'border p-3 flex items-center gap-3 text-[12px]',
          conservationOk
            ? 'border-[var(--color-border)] bg-[var(--color-bg-elevated)]'
            : 'border-[var(--color-accent)] bg-[var(--color-accent-subtle)]',
        )}
      >
        {conservationOk ? (
          <CheckCircle2 className="size-4 text-[var(--color-success)] shrink-0" />
        ) : (
          <AlertTriangle className="size-4 text-[var(--color-accent-text)] shrink-0" />
        )}
        <span className="text-[var(--color-fg-muted)]">
          Verificación global: lo que hay en billeteras ({fmt(supply.circulating)})
          coincide con el neto de todos los movimientos ({fmt(supply.netLedger)}){' '}
          — diferencia{' '}
          <strong
            className={cn(
              conservationOk
                ? 'text-[var(--color-success)]'
                : 'text-[var(--color-accent-text)]',
            )}
          >
            {fmt(supply.conservationDiff)}
          </strong>
          {conservationOk
            ? ' — cuadra.'
            : ' — hay un desvío global (coincide con los descuadres por billetera).'}
        </span>
      </div>
    </div>
  );
}

// ── Descuadres ─────────────────────────────────────────────────────────────

function MismatchesTable({ run }: { run: ReconciliationRun }) {
  const items = run.mismatches?.items ?? [];
  const truncated = run.mismatches?.truncated ?? 0;

  return (
    <section className="flex flex-col gap-3">
      <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-accent-text)] font-medium flex items-center gap-2">
        <AlertTriangle className="size-3" />
        Descuadres detectados
      </span>
      <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-accent-border)] border-l-2 border-l-[var(--color-accent)]">
        <Table>
          <THead>
            <TR>
              <TH>Billetera</TH>
              <TH>Qué</TH>
              <TH className="text-right">Registrado</TH>
              <TH className="text-right">Según movimientos</TH>
              <TH className="text-right">Diferencia</TH>
            </TR>
          </THead>
          <TBody>
            {items.map((m, i) => {
              const diffNum = Number(m.diff);
              return (
                <TR key={`${m.walletId}-${m.kind}-${i}`}>
                  <TD>
                    <span className="text-[12px] text-[var(--color-fg)] font-mono">
                      @{m.username ?? m.userId ?? m.walletId.slice(0, 8)}
                    </span>
                  </TD>
                  <TD>
                    <Badge variant="neutral">
                      {m.kind === 'balance' ? 'Saldo' : 'Retenido'}
                    </Badge>
                  </TD>
                  <TD className="text-right num font-mono">{fmt(m.stored)}</TD>
                  <TD className="text-right num font-mono text-[var(--color-fg-muted)]">
                    {fmt(m.ledger)}
                  </TD>
                  <TD className="text-right num font-mono text-[var(--color-accent-text)]">
                    {diffNum > 0 ? '+' : ''}
                    {fmt(m.diff)}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
        {truncated > 0 && (
          <div className="px-3 py-2 border-t border-[var(--color-border)] text-[11px] text-[var(--color-fg-subtle)]">
            … y {truncated} descuadre(s) más (se muestran los primeros 100).
          </div>
        )}
      </div>
      <p className="text-[11px] text-[var(--color-fg-subtle)]">
        “Registrado” = lo que dice el saldo de la billetera. “Según movimientos”
        = la suma de todos sus movimientos. Si difieren, alguien tocó el saldo
        por fuera del registro o hay una operación a medias — hay que
        investigarlo.
      </p>
    </section>
  );
}

// ── Historial ──────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<
  ReconciliationStatus,
  { label: string; variant: 'success' | 'danger' | 'neutral' }
> = {
  ok: { label: 'Cuadra', variant: 'success' },
  mismatch: { label: 'Descuadre', variant: 'danger' },
  error: { label: 'Error', variant: 'danger' },
};

function HistoryTable({ runs }: { runs: ReconciliationRun[] }) {
  return (
    <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto">
      <Table>
        <THead>
          <TR>
            <TH>Fecha</TH>
            <TH>Disparo</TH>
            <TH>Estado</TH>
            <TH className="text-right">Billeteras</TH>
            <TH className="text-right">Descuadres</TH>
            <TH className="text-right">Duración</TH>
          </TR>
        </THead>
        <TBody>
          {runs.map((r) => {
            const badge = STATUS_BADGE[r.status];
            const totalMismatch = r.walletsMismatched + r.holdsMismatched;
            return (
              <TR key={r.id}>
                <TD className="num text-[11px] text-[var(--color-fg-muted)]">
                  {fmtDate(r.runAt)}
                </TD>
                <TD className="text-[12px] text-[var(--color-fg-muted)]">
                  {r.trigger === 'manual' ? 'Manual' : 'Automático'}
                </TD>
                <TD>
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </TD>
                <TD className="text-right num">{r.walletsChecked}</TD>
                <TD
                  className={cn(
                    'text-right num font-mono',
                    totalMismatch > 0
                      ? 'text-[var(--color-accent-text)]'
                      : 'text-[var(--color-fg-subtle)]',
                  )}
                >
                  {totalMismatch}
                </TD>
                <TD className="text-right num text-[11px] text-[var(--color-fg-subtle)]">
                  {r.durationMs != null ? `${r.durationMs} ms` : '—'}
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}
