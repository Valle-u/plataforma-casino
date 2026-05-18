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

import { Coins, Plus, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CommissionRuleDrawer } from '@/components/admin/commission-rule-drawer';
import { CreateCommissionRuleModal } from '@/components/admin/create-commission-rule-modal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import {
  useCommissionPayouts,
  useCommissionRules,
  type CommissionPayoutStatus,
} from '@/lib/hooks/use-commissions';
import { cn } from '@/lib/cn';

type Tab = 'rules' | 'payouts';

const TABS: { id: Tab; label: string }[] = [
  { id: 'rules', label: 'Reglas' },
  { id: 'payouts', label: 'Pagos' },
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

        {tab === 'rules' ? (
          <RulesTable onSelect={setSelectedRuleId} />
        ) : (
          <PayoutsTable />
        )}
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
