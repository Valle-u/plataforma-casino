/**
 * /commissions — admin del módulo de comisiones (revenue share).
 *
 * Tabs:
 *   - Reglas: CRUD de commission_rules (pct por rol + event_type).
 *   - Pagos: listado de commission_payouts (scope-aware via backend).
 *
 * Sprint 24 deja solo CRUD + preview compute (no automático). Sprint 25
 * conecta el apply automático en deposits.approve / withdrawals.markPaid.
 *
 * Permisos:
 *   - GET rules: cualquier user logueado (transparencia).
 *   - POST/PATCH/archive rules: `commissions.configure` (admin).
 *   - GET payouts: `commissions.view` (scope downstream del actor).
 *   - `commissions.view_all` bypassa el scope (panel admin).
 */

'use client';

import { CheckCircle2, Coins, HandCoins, Plus, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CommissionRuleDrawer } from '@/components/admin/commission-rule-drawer';
import { CreateCommissionRuleModal } from '@/components/admin/create-commission-rule-modal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { isApiError } from '@/lib/api-client';
import {
  useCommissionsPendingSummary,
  useSettleCommissions,
} from '@/lib/hooks/use-bank-transactions';
import {
  useCommissionPayouts,
  useCommissionRules,
  type CommissionPayoutStatus,
} from '@/lib/hooks/use-commissions';
import { cn } from '@/lib/cn';

type Tab = 'rules' | 'payouts' | 'pending';

const TABS: { id: Tab; label: string }[] = [
  { id: 'rules', label: 'Reglas' },
  { id: 'pending', label: 'Pendientes de liquidar' },
  { id: 'payouts', label: 'Pagos históricos' },
];

export default function CommissionsPage() {
  const [tab, setTab] = useState<Tab>('rules');
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);

  return (
    <>
      <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1400px] mx-auto">
        {/* Header */}
        <header className="flex items-end justify-between gap-6 pb-2">
          <div className="flex flex-col gap-2">
            <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
              <Coins className="size-3" />
              Sistema · Comisiones
            </span>
            <h1 className="font-display text-[2.5rem] leading-none tracking-tight">
              Revenue share
            </h1>
            <p className="text-sm text-[var(--color-fg-muted)] mt-1">
              Reglas por rol + evento. Aplican al ancestor del cliente cuando
              ocurre el evento.{' '}
              <span className="text-[var(--color-fg-subtle)]">
                Apply automático: pendiente (Sprint 25).
              </span>
            </p>
          </div>
          {tab === 'rules' && (
            <Button
              variant="primary"
              size="md"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="size-3.5" />
              Nueva regla
            </Button>
          )}
        </header>

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

        {tab === 'rules' && <RulesTable onSelect={setSelectedRuleId} />}
        {tab === 'pending' && <PendingPayoutsTab />}
        {tab === 'payouts' && <PayoutsTable />}
      </div>

      <CreateCommissionRuleModal
        open={createOpen}
        onOpenChange={setCreateOpen}
      />

      <CommissionRuleDrawer
        ruleId={selectedRuleId}
        open={!!selectedRuleId}
        onOpenChange={(o) => !o && setSelectedRuleId(null)}
      />
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Rules tab
// ──────────────────────────────────────────────────────────────────────

function RulesTable({ onSelect }: { onSelect: (id: string) => void }) {
  const { data, isLoading, isError, refetch, isFetching } = useCommissionRules();

  const rows = useMemo(() => data?.data ?? [], [data]);

  return (
    <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
      <div className="px-3 py-2 border-b border-[var(--color-border)] flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium">
          {data ? `${rows.length} reglas` : 'Cargando…'}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw
            className={cn('size-3', isFetching && 'animate-spin')}
          />
          Refrescar
        </Button>
      </div>
      {isLoading ? (
        <LoadingRows count={4} />
      ) : isError ? (
        <div className="p-6">
          <EmptyState
            hint="commission_rules"
            label="No se pudieron cargar las reglas."
            action={
              <Button variant="secondary" size="sm" onClick={() => refetch()}>
                Reintentar
              </Button>
            }
          />
        </div>
      ) : rows.length === 0 ? (
        <div className="p-6">
          <EmptyState
            hint="commission_rules"
            label="Todavía no hay reglas configuradas."
          />
        </div>
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Rol</TH>
              <TH>Evento</TH>
              <TH align="right">Porcentaje</TH>
              <TH>Estado</TH>
              <TH align="right">Actualizada</TH>
            </tr>
          </THead>
          <TBody>
            {rows.map((r, i) => (
              <TR
                key={r.id}
                onClick={() => onSelect(r.id)}
                className="animate-fade-up-staggered cursor-pointer"
                style={{ animationDelay: `${Math.min(i * 25, 500)}ms` }}
              >
                <TD>
                  <span className="text-[12px] font-mono text-[var(--color-fg)]">
                    {r.role}
                  </span>
                </TD>
                <TD>
                  <span className="text-[12px] font-mono text-[var(--color-fg-muted)]">
                    {r.eventType}
                  </span>
                </TD>
                <TD numeric>
                  <span className="text-[13px] font-mono text-[var(--color-fg)]">
                    {r.pct}%
                  </span>
                </TD>
                <TD>
                  {r.active ? (
                    <Badge variant="success" dot>
                      activa
                    </Badge>
                  ) : (
                    <Badge variant="neutral" dot>
                      archivada
                    </Badge>
                  )}
                </TD>
                <TD numeric className="text-[var(--color-fg-subtle)]">
                  {formatDate(r.updatedAt)}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Payouts tab
// ──────────────────────────────────────────────────────────────────────

const PAYOUT_STATUS_VARIANT: Record<
  CommissionPayoutStatus,
  'success' | 'warning' | 'neutral' | 'danger'
> = {
  paid: 'success',
  pending: 'warning',
  failed: 'danger',
  refunded: 'neutral',
};

function PayoutsTable() {
  const { data, isLoading, isError, refetch, isFetching } =
    useCommissionPayouts({ limit: 100 });

  const rows = useMemo(() => data?.data ?? [], [data]);

  return (
    <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
      <div className="px-3 py-2 border-b border-[var(--color-border)] flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium">
          {data ? `${rows.length} pagos · total ${data.total}` : 'Cargando…'}
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
        <LoadingRows count={6} />
      ) : isError ? (
        <div className="p-6">
          <EmptyState
            hint="commission_payouts"
            label="No se pudieron cargar los pagos."
            action={
              <Button variant="secondary" size="sm" onClick={() => refetch()}>
                Reintentar
              </Button>
            }
          />
        </div>
      ) : rows.length === 0 ? (
        <div className="p-6">
          <EmptyState
            hint="commission_payouts"
            label="Todavía no hay pagos de commission."
          />
        </div>
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Beneficiario</TH>
              <TH>Rol</TH>
              <TH>Evento</TH>
              <TH align="right">Source</TH>
              <TH align="right">%</TH>
              <TH align="right">Pago</TH>
              <TH>Estado</TH>
              <TH align="right">Fecha</TH>
            </tr>
          </THead>
          <TBody>
            {rows.map((p, i) => (
              <TR
                key={p.id}
                className="animate-fade-up-staggered"
                style={{ animationDelay: `${Math.min(i * 20, 400)}ms` }}
              >
                <TD>
                  <div className="flex flex-col leading-tight">
                    <span className="text-[12px] text-[var(--color-fg)]">
                      {p.beneficiaryDisplayName ??
                        p.beneficiaryUsername ??
                        '—'}
                    </span>
                    {p.beneficiaryUsername && (
                      <span className="text-[10px] font-mono text-[var(--color-fg-subtle)]">
                        @{p.beneficiaryUsername}
                      </span>
                    )}
                  </div>
                </TD>
                <TD>
                  <span className="text-[12px] font-mono text-[var(--color-fg-muted)]">
                    {p.beneficiaryRoleAtTime}
                  </span>
                </TD>
                <TD>
                  <span className="text-[11px] font-mono text-[var(--color-fg-muted)]">
                    {p.sourceEventType}
                  </span>
                </TD>
                <TD numeric className="font-mono text-[var(--color-fg-muted)]">
                  {p.sourceAmount}
                </TD>
                <TD numeric className="font-mono text-[var(--color-fg-muted)]">
                  {p.pct}%
                </TD>
                <TD numeric>
                  <span className="text-[13px] font-mono text-[var(--color-fg)]">
                    {p.payoutAmount}
                  </span>
                </TD>
                <TD>
                  <Badge variant={PAYOUT_STATUS_VARIANT[p.status]} dot>
                    {p.status}
                  </Badge>
                </TD>
                <TD numeric className="text-[var(--color-fg-subtle)]">
                  {formatDate(p.createdAt)}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function LoadingRows({ count }: { count: number }) {
  return (
    <div className="p-4 flex flex-col gap-2">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full bg-[var(--color-bg-subtle)]" />
      ))}
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('es-AR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

// ──────────────────────────────────────────────────────────────────────
// Sprint 50: PendingPayoutsTab — accrued commissions + botón Liquidar
// ──────────────────────────────────────────────────────────────────────

function PendingPayoutsTab() {
  const { data, isLoading, isError, refetch, isFetching } = useCommissionsPendingSummary();
  const settle = useSettleCommissions();
  const rows = data?.data ?? [];
  const totalPending = data?.totalPending ?? '0.00';

  async function liquidarTodos() {
    if (rows.length === 0) return;
    if (!confirm(`¿Liquidar TODAS las commissions pendientes ($${totalPending})?`)) return;
    try {
      const res = await settle.mutateAsync(undefined);
      toast.success(
        `Liquidación: ${res.settled} OK, ${res.failed} fallaron · total $${res.totalPaid}`,
      );
    } catch (err) {
      toast.error('Settle falló', {
        description: isApiError(err) ? err.message : 'Error',
      });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Resumen */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] p-4 flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] flex items-center gap-1.5">
            <HandCoins className="size-3" />
            Total pendiente
          </span>
          <span className="text-[1.75rem] font-mono num leading-none text-[var(--color-warning)]">
            ${totalPending}
          </span>
        </div>
        <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] p-4 flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
            Beneficiarios
          </span>
          <span className="text-[1.75rem] font-mono num leading-none text-[var(--color-fg)]">
            {rows.length}
          </span>
        </div>
        <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] p-4 flex flex-col gap-1 justify-center">
          <Button
            variant="primary"
            size="md"
            onClick={liquidarTodos}
            disabled={settle.isPending || rows.length === 0}
          >
            {settle.isPending ? (
              <>
                <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                Liquidando…
              </>
            ) : (
              <>
                <CheckCircle2 className="size-3.5" />
                Liquidar todo
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Tabla por beneficiario */}
      <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
        <div className="px-3 py-2 border-b border-[var(--color-border)] flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium">
            Por beneficiario
          </span>
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn('size-3', isFetching && 'animate-spin')} />
            Refrescar
          </Button>
        </div>
        {isLoading ? (
          <div className="p-4 flex flex-col gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : isError ? (
          <EmptyState hint="pending" label="Error al cargar." />
        ) : rows.length === 0 ? (
          <EmptyState
            hint="pending"
            label="Sin commissions pendientes. Las que se vayan generando aparecerán acá hasta que se liquiden."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Beneficiario</TH>
                <TH>Rol</TH>
                <TH className="text-right">Payouts</TH>
                <TH className="text-right">Pendiente</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.beneficiaryUserId}>
                  <TD className="font-mono text-[12px]">
                    @{r.beneficiaryUsername ?? r.beneficiaryUserId.slice(0, 8)}
                  </TD>
                  <TD>
                    <Badge variant="neutral">{r.role ?? '—'}</Badge>
                  </TD>
                  <TD className="text-right num">{r.payoutsCount}</TD>
                  <TD className="text-right num font-mono text-[var(--color-warning)]">
                    ${r.pendingAmount}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </div>
  );
}
