/**
 * MovementAlertsPanel — "Movimientos sospechosos" (fraude interno). Lista
 * alertas de reglas sobre el ledger (minteo/cupos/transferencias/cash-out),
 * con confirmar/descartar. Espeja el antifraude de cuentas, en criollo.
 */

'use client';

import { Ban, ScanSearch, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { isApiError } from '@/lib/api-client';
import {
  useConfirmMovementAlert,
  useDismissMovementAlert,
  useMovementAlerts,
  useMovementAlertStats,
  useRunMovementScan,
  type MovAlertSeverity,
  type MovAlertStatus,
  type MovementAlertRow,
} from '@/lib/hooks/use-movement-alerts';
import { cn } from '@/lib/cn';

const RULE: Record<string, { label: string; what: string }> = {
  mint_near_cap: {
    label: 'Minteo cerca del tope',
    what: 'La creación de fichas del mes se acercó o pasó el límite mensual configurado.',
  },
  employee_cap_abuse: {
    label: 'Empleado cerca del cupo',
    what: 'Un empleado usó casi todo (o más) su cupo mensual de correcciones + bonos.',
  },
  actor_burst: {
    label: 'Ráfaga de movimientos',
    what: 'Un actor hizo muchos movimientos sensibles (minteo/cargas/correcciones/transfers) en poco tiempo.',
  },
  actor_concentration: {
    label: 'Concentración anómala',
    what: 'Un actor concentra una tajada muy grande del movimiento sensible del mes.',
  },
  repeat_counterparty: {
    label: 'Cargas repetidas a la misma cuenta',
    what: 'Un actor cargó o transfirió muchas veces a la misma cuenta (posible cómplice).',
  },
  fast_cashout: {
    label: 'Depósito y retiro rápido',
    what: 'Un jugador depositó y retiró casi lo mismo enseguida (patrón de cash-out / lavado).',
  },
};

const SEVERITY: Record<MovAlertSeverity, { label: string; variant: BadgeVariant }> = {
  high: { label: 'Alta', variant: 'danger' },
  medium: { label: 'Media', variant: 'warning' },
  low: { label: 'Baja', variant: 'neutral' },
};

const STATUS_LABEL: Record<MovAlertStatus, string> = {
  suspected: 'por revisar',
  confirmed: 'confirmada',
  dismissed: 'descartada',
};

const TABS: { id: MovAlertStatus; label: string }[] = [
  { id: 'suspected', label: 'Por revisar' },
  { id: 'confirmed', label: 'Confirmadas' },
  { id: 'dismissed', label: 'Descartadas' },
];

function fmt(x: string | null): string {
  if (x === null) return '—';
  const n = Number(x);
  if (!Number.isFinite(n)) return x;
  return n.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
function actorLabel(r: MovementAlertRow): string {
  if (!r.actorUserId) return 'La Casa (global)';
  return r.actorDisplayName ?? (r.actorUsername ? `@${r.actorUsername}` : '—');
}
function mapErr(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.status === 409) return 'La alerta ya fue resuelta.';
  if (err.status === 404) return 'La alerta ya no existe.';
  if (err.status === 403) return 'No tenés permiso.';
  return err.message || 'Error inesperado.';
}

export function MovementAlertsPanel() {
  const [tab, setTab] = useState<MovAlertStatus>('suspected');
  const [detail, setDetail] = useState<MovementAlertRow | null>(null);
  const alertsQ = useMovementAlerts({ status: tab, limit: 50 });
  const statsQ = useMovementAlertStats();
  const confirmM = useConfirmMovementAlert();
  const dismissM = useDismissMovementAlert();
  const scanM = useRunMovementScan();

  const rows = alertsQ.data?.data ?? [];
  const stats = statsQ.data;

  async function runScan() {
    try {
      const r = await scanM.mutateAsync();
      toast.success('Análisis completado', {
        description: `${r.newSuspected} nuevas · ${r.preservedDismissed} descartadas se mantienen.`,
      });
    } catch (err) {
      toast.error('El análisis falló', { description: mapErr(err) });
    }
  }
  async function act(id: string, kind: 'confirm' | 'dismiss') {
    try {
      if (kind === 'confirm') await confirmM.mutateAsync(id);
      else await dismissM.mutateAsync(id);
      toast.success(kind === 'confirm' ? 'Alerta confirmada' : 'Alerta descartada');
    } catch (err) {
      toast.error('No se pudo', { description: mapErr(err) });
    }
  }

  return (
    <>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <p className="text-sm text-[var(--color-fg-muted)] max-w-2xl">
            Analiza los <strong>movimientos válidos</strong> del sistema (que el
            cuadre de fichas no pesca) para detectar <strong>fraude interno</strong>:
            minteo cerca del tope, empleados abusando de su cupo, ráfagas,
            transferencias a cómplices o cash-out sospechoso.
          </p>
          <Button
            variant="primary"
            size="md"
            onClick={() => void runScan()}
            disabled={scanM.isPending}
            className="shrink-0"
          >
            {scanM.isPending ? (
              <>
                <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                Buscando…
              </>
            ) : (
              <>
                <ScanSearch className="size-3.5" />
                Buscar ahora
              </>
            )}
          </Button>
        </div>

        <section className="grid grid-cols-3 gap-px bg-[var(--color-border)] border border-[var(--color-border)]">
          <StatTile label="Por revisar" value={stats ? String(stats.suspected) : '—'} hint="sospechosas" variant={stats && stats.suspected > 0 ? 'accent' : 'default'} />
          <StatTile label="Confirmadas" value={stats ? String(stats.confirmed) : '—'} hint="fraude" />
          <StatTile label="Descartadas" value={stats ? String(stats.dismissed) : '—'} hint="falsos positivos" />
        </section>

        <div className="flex items-center gap-px bg-[var(--color-border)] border border-[var(--color-border)] self-start">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'px-4 h-8 text-[11px] uppercase tracking-[0.08em] font-medium transition-colors duration-150',
                tab === t.id
                  ? 'bg-[var(--color-bg)] text-[var(--color-fg)] border-b-2 border-b-[var(--color-accent)]'
                  : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto">
          {alertsQ.isLoading ? (
            <div className="p-4 flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full bg-[var(--color-bg-subtle)]" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                hint="movement-alerts"
                label={
                  tab === 'suspected'
                    ? 'Sin alertas por revisar. Corré el análisis o esperá al nocturno.'
                    : tab === 'confirmed'
                      ? 'Ninguna alerta confirmada.'
                      : 'Nada descartado.'
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Regla</TH>
                  <TH>Actor</TH>
                  <TH className="text-right">Monto</TH>
                  <TH>Severidad</TH>
                  <TH className="text-right">Cuándo</TH>
                  <TH className="text-right w-24"></TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.id} className="cursor-pointer" onClick={() => setDetail(r)}>
                    <TD>
                      <span className="text-[13px] text-[var(--color-fg)]">
                        {RULE[r.rule]?.label ?? r.rule}
                      </span>
                    </TD>
                    <TD className="text-[12px]">{actorLabel(r)}</TD>
                    <TD className="text-right num font-mono text-[var(--color-fg-muted)]">
                      {fmt(r.amount)}
                    </TD>
                    <TD>
                      <Badge variant={SEVERITY[r.severity].variant} dot>
                        {SEVERITY[r.severity].label}
                      </Badge>
                    </TD>
                    <TD numeric className="text-[var(--color-fg-subtle)]">
                      {fmtDate(r.lastUpdatedAt)}
                    </TD>
                    <TD>
                      {r.status === 'suspected' && (
                        <div
                          className="flex items-center justify-end gap-px bg-[var(--color-border)]"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => void act(r.id, 'confirm')}
                            className="size-10 flex items-center justify-center bg-[var(--color-bg-elevated)] text-[var(--color-fg-subtle)] hover:text-[var(--color-accent-text)] hover:bg-[var(--color-bg-subtle)] transition-colors"
                            title="Confirmar (es fraude)"
                          >
                            <ShieldCheck className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void act(r.id, 'dismiss')}
                            className="size-10 flex items-center justify-center bg-[var(--color-bg-elevated)] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg-subtle)] transition-colors"
                            title="Descartar (falso positivo)"
                          >
                            <Ban className="size-3.5" />
                          </button>
                        </div>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>
      </div>

      <Drawer
        open={!!detail}
        onOpenChange={(o) => !o && setDetail(null)}
        title={detail ? (RULE[detail.rule]?.label ?? detail.rule) : 'Alerta'}
        subtitle={detail?.id}
      >
        {detail && (
          <div className="flex flex-col gap-4 text-[13px]">
            <p className="text-[var(--color-fg-muted)]">
              {RULE[detail.rule]?.what ?? 'Regla de movimientos sospechosos.'}
            </p>
            <Field label="Actor">{actorLabel(detail)}</Field>
            {detail.subjectUserId && (
              <Field label="Contraparte">
                {detail.subjectDisplayName ??
                  (detail.subjectUsername ? `@${detail.subjectUsername}` : '—')}
              </Field>
            )}
            <Field label="Monto relevante">{fmt(detail.amount)}</Field>
            <Field label="Severidad">
              <Badge variant={SEVERITY[detail.severity].variant} dot>
                {SEVERITY[detail.severity].label}
              </Badge>
            </Field>
            <Field label="Estado">{STATUS_LABEL[detail.status]}</Field>
            <Field label="Detalle">
              <pre className="text-[11px] font-mono bg-[var(--color-bg)] border border-[var(--color-border)] p-3 overflow-x-auto whitespace-pre-wrap break-all text-[var(--color-fg)]">
                {JSON.stringify(detail.details, null, 2)}
              </pre>
            </Field>
            <Field label="Detectada / actualizada">
              {fmtDate(detail.detectedAt)} · {fmtDate(detail.lastUpdatedAt)}
            </Field>
          </div>
        )}
      </Drawer>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] font-medium">
        {label}
      </span>
      <div className="text-[var(--color-fg)]">{children}</div>
    </div>
  );
}
