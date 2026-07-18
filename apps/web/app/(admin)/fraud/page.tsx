/**
 * /fraud — panel antifraude del operador.
 *
 * Composición:
 *   - Header: título + botón "Run scan" (manual).
 *   - Stats hero: 4 KPIs (signals total, suspected, confirmed, dismissed).
 *   - Tabs: Sospechosos (default) / Confirmados / Descartados.
 *   - Tabla densa: Score + Par (userA ↔ userB) + Signals (chips por type)
 *     + Estado + Fecha + Acciones inline (confirm/dismiss cuando suspected).
 *   - Click row → drawer detalle: signals payload + reviewedBy/At + warning
 *     "este par está confirmado: bloqueá welcome bonus si aplica".
 *
 * Filosofía:
 *   - El admin DECIDE — el sistema solo señala. NUNCA bloquea
 *     automáticamente (excepto welcome bonus block, que es config aparte).
 *   - Confirmar un link es high-severity: graba audit con severity:high y
 *     dispara notif a admins.
 */

'use client';

import {
  AlertTriangle,
  Ban,
  RefreshCw,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { isApiError } from '@/lib/api-client';
import {
  useConfirmFraudLink,
  useDismissFraudLink,
  useFraudLinks,
  useFraudStats,
  useRunFraudScan,
  type FraudLinkRow,
  type FraudLinkStatus,
} from '@/lib/hooks/use-fraud';
import { cn } from '@/lib/cn';

const PAGE_SIZE = 25;

const STATUS_VARIANT: Record<FraudLinkStatus, BadgeVariant> = {
  suspected: 'warning',
  confirmed: 'danger',
  dismissed: 'neutral',
};

const STATUS_LABEL: Record<FraudLinkStatus, string> = {
  suspected: 'sospechado',
  confirmed: 'confirmado',
  dismissed: 'descartado',
};

const SIGNAL_TYPE_LABEL: Record<string, string> = {
  shared_ip: 'IP compartida',
  similar_email: 'email similar',
};

interface FilterTab {
  id: FraudLinkStatus;
  label: string;
}

const FILTER_TABS: FilterTab[] = [
  { id: 'suspected', label: 'Sospechosos' },
  { id: 'confirmed', label: 'Confirmados' },
  { id: 'dismissed', label: 'Descartados' },
];

type PendingAction = { kind: 'confirm' | 'dismiss'; row: FraudLinkRow } | null;

export default function FraudPage() {
  const [tabId, setTabId] = useState<FraudLinkStatus>('suspected');
  const [page, setPage] = useState(0);
  const [openDetail, setOpenDetail] = useState<FraudLinkRow | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [scanOpen, setScanOpen] = useState(false);

  const linksQ = useFraudLinks({
    status: tabId,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    // Para dismissed mostrar SIEMPRE (sin threshold) — el backend ya lo
    // ignora cuando status=dismissed, pero pasamos 0 explícito para que
    // el filter de minScore no se aplique en suspected/confirmed tampoco
    // (queremos ver TODO lo que el backend marcó, no solo lo que pasa
    // el threshold del tenant).
    minScore: 0,
  });
  const statsQ = useFraudStats();
  const confirmMutation = useConfirmFraudLink();
  const dismissMutation = useDismissFraudLink();
  const scanMutation = useRunFraudScan();

  const rows = linksQ.data?.data ?? [];
  const total = linksQ.data?.total ?? 0;

  const handleConfirm = async () => {
    if (!pendingAction || pendingAction.kind !== 'confirm') return;
    const row = pendingAction.row;
    try {
      await confirmMutation.mutateAsync(row.id);
      toast.success('Link confirmado', {
        description: `${labelFor(row.userAUsername, row.userAId)} ↔ ${labelFor(row.userBUsername, row.userBId)} marcado como duplicado.`,
      });
      setPendingAction(null);
    } catch (err) {
      toast.error('No se pudo confirmar', { description: mapError(err) });
    }
  };

  const handleDismiss = async () => {
    if (!pendingAction || pendingAction.kind !== 'dismiss') return;
    const row = pendingAction.row;
    try {
      await dismissMutation.mutateAsync(row.id);
      toast.success('Link descartado', {
        description: 'No se re-flagueará en futuros scans.',
      });
      setPendingAction(null);
    } catch (err) {
      toast.error('No se pudo descartar', { description: mapError(err) });
    }
  };

  const handleRunScan = async () => {
    try {
      const res = await scanMutation.mutateAsync();
      toast.success('Scan completado', {
        description: `${res.signalsCreated} signals · ${res.newSuspectedLinks} nuevos · ${res.preservedDismissedLinks} preservados como dismissed.`,
      });
      setScanOpen(false);
    } catch (err) {
      toast.error('Scan falló', { description: mapError(err) });
    }
  };

  const stats = statsQ.data;
  const flaggedTotal = useMemo(
    () => (stats ? stats.suspectedLinks + stats.confirmedLinks : 0),
    [stats],
  );

  return (
    <>
      <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1600px] mx-auto">
        {/* Header */}
        <header className="flex items-end justify-between gap-6 pb-2">
          <div className="flex flex-col gap-2">
            <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
              <ShieldAlert className="size-3" />
              Compliance · Antifraude
            </span>
            <h1 className="font-display text-[2.5rem] leading-none tracking-tight">
              Cuentas duplicadas
            </h1>
            <p className="text-sm text-[var(--color-fg-muted)] mt-1">
              {flaggedTotal > 0
                ? `${flaggedTotal} pares activos · ${stats?.confirmedLinks ?? 0} confirmados`
                : 'Sin actividad sospechosa.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                linksQ.refetch();
                statsQ.refetch();
              }}
              disabled={linksQ.isFetching || statsQ.isFetching}
            >
              <RefreshCw
                className={cn(
                  'size-3.5',
                  (linksQ.isFetching || statsQ.isFetching) && 'animate-spin',
                )}
              />
              Refrescar
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={() => setScanOpen(true)}
              disabled={scanMutation.isPending}
            >
              {scanMutation.isPending ? (
                <>
                  <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                  Escaneando…
                </>
              ) : (
                <>
                  <ScanSearch className="size-3.5" />
                  Run scan
                </>
              )}
            </Button>
          </div>
        </header>

        {/* Stats hero */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-[var(--color-border)] border border-[var(--color-border)]">
          <StatTile
            label="Signals totales"
            value={stats ? String(stats.totalSignals) : '—'}
            hint="último scan"
          />
          <StatTile
            label="Sospechosos"
            value={stats ? String(stats.suspectedLinks) : '—'}
            hint="pending review"
          />
          <StatTile
            label="Confirmados"
            value={stats ? String(stats.confirmedLinks) : '—'}
            hint="duplicados"
            variant={
              stats && stats.confirmedLinks > 0 ? 'accent' : 'default'
            }
          />
          <StatTile
            label="Descartados"
            value={stats ? String(stats.dismissedLinks) : '—'}
            hint="false positives"
          />
        </section>

        {/* Tabs filter */}
        <div className="flex items-center gap-px bg-[var(--color-border)] border border-[var(--color-border)] self-start">
          {FILTER_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTabId(t.id);
                setPage(0);
              }}
              className={cn(
                'px-4 h-8 text-[11px] uppercase tracking-[0.08em] font-medium',
                'transition-colors duration-150',
                tabId === t.id
                  ? 'bg-[var(--color-bg)] text-[var(--color-fg)] border-b-2 border-b-[var(--color-accent)]'
                  : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tabla */}
        <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
          {linksQ.isLoading ? (
            <LoadingTable />
          ) : linksQ.isError ? (
            <div className="p-6">
              <EmptyState
                hint="fraud_links"
                label="No se pudo cargar la lista."
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => linksQ.refetch()}
                  >
                    Reintentar
                  </Button>
                }
              />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                hint="fraud_links"
                stream={`tenant · status=${tabId}`}
                label={
                  tabId === 'suspected'
                    ? 'Sin pares sospechosos'
                    : tabId === 'confirmed'
                      ? 'Ningún duplicado confirmado todavía'
                      : 'Nada descartado'
                }
                action={
                  tabId === 'suspected' ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setScanOpen(true)}
                    >
                      <ScanSearch className="size-3.5" />
                      Correr scan ahora
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH align="right" className="w-16">Score</TH>
                  <TH>Par de cuentas</TH>
                  <TH>Signals</TH>
                  <TH>Estado</TH>
                  <TH align="right">Última actualización</TH>
                  <TH align="right" className="w-24"></TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((row, i) => (
                  <TR
                    key={row.id}
                    className="animate-fade-up-staggered cursor-pointer"
                    style={{ animationDelay: `${Math.min(i * 25, 500)}ms` }}
                    onClick={() => setOpenDetail(row)}
                  >
                    <TD numeric>
                      <ScoreBadge score={Number(row.score)} />
                    </TD>
                    <TD>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[13px] text-[var(--color-fg)]">
                          {labelFor(row.userAUsername, row.userAId)}
                          <span className="text-[var(--color-fg-subtle)] mx-1.5">
                            ↔
                          </span>
                          {labelFor(row.userBUsername, row.userBId)}
                        </span>
                        <span className="text-[10px] text-[var(--color-fg-subtle)] font-mono">
                          {row.userAId.slice(0, 8)}… ↔ {row.userBId.slice(0, 8)}…
                        </span>
                      </div>
                    </TD>
                    <TD>
                      <SignalChips signals={row.signals} />
                    </TD>
                    <TD>
                      <Badge variant={STATUS_VARIANT[row.status]} dot>
                        {STATUS_LABEL[row.status]}
                      </Badge>
                    </TD>
                    <TD numeric className="text-[var(--color-fg-subtle)]">
                      {formatDateTime(row.lastUpdatedAt)}
                    </TD>
                    <TD>
                      {row.status === 'suspected' && (
                        <div
                          className="flex items-center justify-end gap-px bg-[var(--color-border)]"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setPendingAction({ kind: 'confirm', row })
                            }
                            className="size-10 flex items-center justify-center bg-[var(--color-bg-elevated)] text-[var(--color-fg-subtle)] hover:text-[var(--color-accent-text)] hover:bg-[var(--color-bg-subtle)] transition-colors"
                            aria-label="Confirmar duplicado"
                            title="Confirmar duplicado"
                          >
                            <ShieldCheck className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setPendingAction({ kind: 'dismiss', row })
                            }
                            className="size-10 flex items-center justify-center bg-[var(--color-bg-elevated)] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg-subtle)] transition-colors"
                            aria-label="Descartar (false positive)"
                            title="Descartar (false positive)"
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

        {/* Pager */}
        {linksQ.data && total > PAGE_SIZE && (
          <Pager
            page={page}
            total={total}
            onPrev={() => setPage((p) => Math.max(0, p - 1))}
            onNext={() => setPage((p) => p + 1)}
            hasMore={(page + 1) * PAGE_SIZE < total}
          />
        )}
      </div>

      {/* Drawer detalle */}
      <FraudLinkDrawer
        link={openDetail}
        open={!!openDetail}
        onOpenChange={(o) => !o && setOpenDetail(null)}
      />

      {/* Confirmar duplicado */}
      <ConfirmModal
        open={pendingAction?.kind === 'confirm'}
        onOpenChange={(o) => !o && setPendingAction(null)}
        title="Confirmar duplicado"
        description={
          pendingAction
            ? `Vas a marcar a ${labelFor(pendingAction.row.userAUsername, pendingAction.row.userAId)} y ${labelFor(pendingAction.row.userBUsername, pendingAction.row.userBId)} como cuentas duplicadas.`
            : ''
        }
        warning="Severity HIGH. Queda en audit_log y notifica a todos los admins. Considerá banear una de las cuentas después."
        confirmLabel="Confirmar duplicado"
        confirmIcon={<ShieldCheck className="size-3.5" />}
        confirmVariant="primary"
        onConfirm={handleConfirm}
        isPending={confirmMutation.isPending}
      />

      {/* Dismiss (false positive) */}
      <ConfirmModal
        open={pendingAction?.kind === 'dismiss'}
        onOpenChange={(o) => !o && setPendingAction(null)}
        title="Descartar como false positive"
        description={
          pendingAction
            ? `Marcar la coincidencia entre ${labelFor(pendingAction.row.userAUsername, pendingAction.row.userAId)} y ${labelFor(pendingAction.row.userBUsername, pendingAction.row.userBId)} como NO duplicado.`
            : ''
        }
        warning="Futuros scans NO van a re-flagear este par (status=dismissed se preserva)."
        confirmLabel="Descartar"
        confirmIcon={<Ban className="size-3.5" />}
        confirmVariant="secondary"
        onConfirm={handleDismiss}
        isPending={dismissMutation.isPending}
      />

      {/* Run scan */}
      <ConfirmModal
        open={scanOpen}
        onOpenChange={setScanOpen}
        title="Correr scan antifraude"
        description="Reescanea sesiones recientes (IPs compartidas) y emails similares (Levenshtein ≤ 2). Reemplaza signals + UPSERT links."
        warning="Puede tardar varios segundos en tenants grandes. Los pares dismissed quedan preservados."
        confirmLabel="Iniciar scan"
        confirmIcon={<ScanSearch className="size-3.5" />}
        confirmVariant="primary"
        onConfirm={handleRunScan}
        isPending={scanMutation.isPending}
      />
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number }) {
  const variant: BadgeVariant =
    score >= 90 ? 'danger' : score >= 70 ? 'warning' : 'neutral';
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center min-w-[40px] h-[22px] px-1.5',
        'text-[12px] font-mono tabular-nums font-medium border',
        variant === 'danger' &&
          'text-[var(--color-accent-text)] border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)]',
        variant === 'warning' &&
          'text-[var(--color-warning)] border-[var(--color-warning)] bg-[var(--color-warning-bg)]',
        variant === 'neutral' &&
          'text-[var(--color-fg-muted)] border-[var(--color-border)] bg-[var(--color-bg-subtle)]',
      )}
      title={`Score ${score}/100`}
    >
      {Math.round(score)}
    </span>
  );
}

function SignalChips({ signals }: { signals: FraudLinkRow['signals'] }) {
  if (!signals || signals.length === 0) {
    return (
      <span className="text-[11px] text-[var(--color-fg-subtle)] italic">—</span>
    );
  }
  // Dedupe por type — el backend a veces guarda múltiples signals del
  // mismo type con weights distintos por payload distinto.
  const seen = new Set<string>();
  const uniq = signals.filter((s) => {
    if (seen.has(s.type)) return false;
    seen.add(s.type);
    return true;
  });
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {uniq.map((s) => (
        <span
          key={s.type}
          className="inline-flex items-center gap-1 px-1.5 h-[18px] text-[10px] uppercase tracking-[0.08em] font-medium border border-[var(--color-border)] bg-[var(--color-bg-subtle)] text-[var(--color-fg-muted)]"
          title={`weight ${s.weight}`}
        >
          {SIGNAL_TYPE_LABEL[s.type] ?? s.type}
          <span className="font-mono tabular-nums text-[var(--color-fg-subtle)]">
            +{s.weight}
          </span>
        </span>
      ))}
    </div>
  );
}

function FraudLinkDrawer({
  link,
  open,
  onOpenChange,
}: {
  link: FraudLinkRow | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={link ? 'Link sospechoso' : 'Link'}
      subtitle={link?.id}
    >
      {link && (
        <div className="flex flex-col gap-5">
          {link.status === 'confirmed' && (
            <div className="flex items-start gap-3 px-3 py-2.5 border border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)] border-l-2 border-l-[var(--color-accent)]">
              <AlertTriangle className="size-4 text-[var(--color-accent-text)] mt-0.5 shrink-0" />
              <div className="flex flex-col gap-0.5">
                <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-accent-text)] font-medium">
                  Duplicado confirmado
                </span>
                <span className="text-[12px] text-[var(--color-fg)]">
                  Considerá banear una de las cuentas. El welcome bonus
                  para esos users queda bloqueado automáticamente.
                </span>
              </div>
            </div>
          )}

          <DetailField label="Score">
            <div className="flex items-center gap-2">
              <ScoreBadge score={Number(link.score)} />
              <span className="text-[11px] text-[var(--color-fg-subtle)]">
                {Number(link.score) >= 90
                  ? 'altísima probabilidad'
                  : Number(link.score) >= 70
                    ? 'sospechoso'
                    : 'baja confianza'}
              </span>
            </div>
          </DetailField>

          <DetailField label="Estado">
            <Badge variant={STATUS_VARIANT[link.status]} dot>
              {STATUS_LABEL[link.status]}
            </Badge>
          </DetailField>

          <DetailField label="Cuenta A">
            <UserBlock
              username={link.userAUsername}
              displayName={link.userADisplayName}
              userId={link.userAId}
            />
          </DetailField>

          <DetailField label="Cuenta B">
            <UserBlock
              username={link.userBUsername}
              displayName={link.userBDisplayName}
              userId={link.userBId}
            />
          </DetailField>

          <DetailField label="Signals">
            <SignalChips signals={link.signals} />
            <pre className="text-[11px] font-mono leading-relaxed bg-[var(--color-bg)] border border-[var(--color-border)] p-3 overflow-x-auto whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto text-[var(--color-fg)] mt-2">
              {JSON.stringify(link.signals, null, 2)}
            </pre>
          </DetailField>

          <DetailField label="Última actualización">
            <span className="text-[13px] font-mono text-[var(--color-fg)]">
              {formatDateTime(link.lastUpdatedAt)}
            </span>
          </DetailField>

          {link.reviewedAt && (
            <DetailField label="Revisado">
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px] font-mono text-[var(--color-fg)]">
                  {formatDateTime(link.reviewedAt)}
                </span>
                <span className="text-[10px] font-mono text-[var(--color-fg-subtle)]">
                  por {link.reviewedByUserId ?? '—'}
                </span>
              </div>
            </DetailField>
          )}
        </div>
      )}
    </Drawer>
  );
}

function UserBlock({
  username,
  displayName,
  userId,
}: {
  username: string | null;
  displayName: string | null;
  userId: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[13px] text-[var(--color-fg)]">
        {displayName ?? username ?? '—'}
      </span>
      <span className="text-[10px] font-mono text-[var(--color-fg-subtle)] break-all">
        {username ? `@${username} · ` : ''}
        {userId}
      </span>
    </div>
  );
}

function DetailField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] font-medium">
        {label}
      </span>
      {children}
    </div>
  );
}

function Pager({
  page,
  total,
  onPrev,
  onNext,
  hasMore,
}: {
  page: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  hasMore: boolean;
}) {
  const start = page * PAGE_SIZE + 1;
  const end = Math.min(start + PAGE_SIZE - 1, total);
  return (
    <div className="flex items-center justify-end gap-3 text-[11px] text-[var(--color-fg-subtle)]">
      <span className="font-mono tabular-nums">
        {total === 0 ? '—' : `${start}–${end} de ${total}`}
      </span>
      <div className="flex items-center gap-px bg-[var(--color-border)]">
        <button
          type="button"
          onClick={onPrev}
          disabled={page === 0}
          className="px-3 h-7 text-[11px] uppercase tracking-[0.08em] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Anterior
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!hasMore}
          className="px-3 h-7 text-[11px] uppercase tracking-[0.08em] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}

function LoadingTable() {
  return (
    <div className="p-4 flex flex-col gap-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full bg-[var(--color-bg-subtle)]" />
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function labelFor(username: string | null, userId: string): string {
  return username ? `@${username}` : userId.slice(0, 8) + '…';
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('es-AR', {
      day: '2-digit',
      month: 'short',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function mapError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.status === 409) {
    if (err.code === 'FRAUD_LINK_ALREADY_RESOLVED') {
      return 'El link ya está resuelto (alguien lo procesó antes).';
    }
    return err.message || 'Conflicto.';
  }
  if (err.status === 404) return 'El link ya no existe.';
  if (err.status === 403) return 'No tenés permiso para esta operación.';
  return err.message || 'Error inesperado.';
}
