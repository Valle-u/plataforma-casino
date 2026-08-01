/**
 * /bonus-definitions — CRUD admin de plantillas de bono.
 *
 * Composición:
 *   - Header: título + "Crear definition".
 *   - Tabs status: Activas / Borradores / Pausadas / Archivadas / Todas.
 *   - Tabla: code (mono), name, type badge, status badge, expira en, fecha.
 *   - Click row → BonusDefinitionDrawer view/edit.
 *   - Empty state con CTA "Crear primera definition" cuando Activas vacía.
 *
 * Las instancias otorgadas (user_bonuses) viven en /bonuses — distinto.
 */

'use client';

import { FileText, Gift, Plus, RefreshCw, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { BonusDefinitionDrawer } from '@/components/admin/bonus-definition-drawer';
import { BonusWizardModal } from '@/components/admin/bonus-wizard-modal';
import { CreateBonusDefinitionModal } from '@/components/admin/create-bonus-definition-modal';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CsvExportButton } from '@/components/ui/csv-export-button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { useAuth } from '@/lib/auth-context';
import {
  bonusDefsScopeFor,
  useBonusDefinitions,
  type BonusDefinitionStatus,
  type BonusType,
} from '@/lib/hooks/use-bonuses';
import { cn } from '@/lib/cn';

const PAGE_SIZE = 25;

const STATUS_VARIANT: Record<BonusDefinitionStatus, BadgeVariant> = {
  draft: 'neutral',
  active: 'success',
  paused: 'warning',
  archived: 'neutral',
};

const STATUS_LABEL: Record<BonusDefinitionStatus, string> = {
  draft: 'borrador',
  active: 'activa',
  paused: 'pausada',
  archived: 'archivada',
};

const TYPE_LABEL: Record<BonusType, string> = {
  welcome: 'welcome',
  reload: 'reload',
  cashback: 'cashback',
  manual: 'manual',
  free_spins: 'free spins',
  no_deposit: 'no deposit',
  referral: 'referral',
};

interface FilterTab {
  id: string;
  label: string;
  status?: BonusDefinitionStatus;
}

const FILTER_TABS: FilterTab[] = [
  { id: 'active', label: 'Activas', status: 'active' },
  { id: 'draft', label: 'Borradores', status: 'draft' },
  { id: 'paused', label: 'Pausadas', status: 'paused' },
  { id: 'archived', label: 'Archivadas', status: 'archived' },
  { id: 'all', label: 'Todas' },
];

export default function BonusDefinitionsPage() {
  const { user } = useAuth();
  const isIndependentSocio = !!user?.isIndependentBranch;
  const [tabId, setTabId] = useState<string>('active');
  const [page, setPage] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const tab = useMemo(
    () => FILTER_TABS.find((t) => t.id === tabId) ?? FILTER_TABS[0]!,
    [tabId],
  );

  // Scope de listado: admin_tenant (y comodín admin_network) solo ve las
  // planillas del tenant — las de ramas independientes son exclusivas de la
  // sub-red de su socio y el admin no puede ni verlas ni otorgarlas (LEYES
  // R3/R4, 403 BonusOutOfBranchScopeError). bonusDefsScopeFor resuelve ese
  // caso; los socios independientes siguen viendo solo 'mine'.
  const scope = bonusDefsScopeFor(user);

  const { data, isLoading, isError, refetch, isFetching } = useBonusDefinitions({
    status: tab.status,
    ownerScope: scope.ownerScope ?? (isIndependentSocio ? 'mine' : undefined),
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;

  const isAdminTenant = user?.roles?.includes('admin_tenant') ?? false;
  const canCreate = isAdminTenant || isIndependentSocio;

  return (
    <>
      <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1600px] mx-auto">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-2">
          <div className="flex flex-col gap-2">
            <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
              <FileText className="size-3" />
              Engagement · Bonus definitions
            </span>
            <h1 className="font-display text-3xl lg:text-[2.5rem] leading-none tracking-tight">
              Plantillas de bono
            </h1>
            <p className="text-sm text-[var(--color-fg-muted)] mt-1">
              {data ? `${rows.length} de ${total} en esta vista` : 'Cargando…'}
              {' · '}
              <span className="text-[var(--color-fg-subtle)]">
                las instancias otorgadas viven en{' '}
                <a href="/bonuses" className="hover:text-[var(--color-accent-text)]">
                  /bonuses
                </a>
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CsvExportButton
              path="/tenant/bonus-definitions/export"
              params={{
                status: tab.status,
                ...(scope.ownerScope ? { ownerScope: scope.ownerScope } : {}),
              }}
              filenameHint="bonus_definitions"
              entityLabel="plantillas de bono"
            />
            <Button
              variant="secondary"
              size="md"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw
                className={cn('size-3.5', isFetching && 'animate-spin')}
              />
              Refrescar
            </Button>
            {canCreate && (
              <>
                <Button
                  variant="ghost"
                  size="md"
                  onClick={() => setCreateOpen(true)}
                  title="Modo avanzado: editar JSON crudo. Pensado para devs."
                >
                  <Plus className="size-3.5" />
                  Avanzado
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => setWizardOpen(true)}
                >
                  <Sparkles className="size-3.5" />
                  Nueva plantilla
                </Button>
              </>
            )}
          </div>
        </header>

        {/* Tabs filter */}
        <div className="flex items-center gap-px bg-[var(--color-border)] border border-[var(--color-border)] self-start flex-wrap">
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

        {/* Table */}
        <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto">
          {isLoading ? (
            <LoadingTable />
          ) : isError ? (
            <div className="p-6">
              <EmptyState
                hint="bonus_definitions"
                label="No se pudo cargar la lista."
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
                hint="bonus_definitions"
                stream={`tenant · status=${tab.status ?? '*'}`}
                label={
                  tabId === 'active'
                    ? 'No hay definitions activas'
                    : 'Sin definitions en este filtro'
                }
                action={
                  tabId === 'active' && canCreate ? (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => setWizardOpen(true)}
                    >
                      <Sparkles className="size-3.5" />
                      Crear primera plantilla
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Código</TH>
                  <TH>Nombre</TH>
                  <TH>Tipo</TH>
                  <TH>Estado</TH>
                  <TH align="right">Expira</TH>
                  <TH align="right">Creada</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((d, i) => (
                  <TR
                    key={d.id}
                    onClick={() => setSelectedId(d.id)}
                    className="animate-fade-up-staggered cursor-pointer"
                    style={{ animationDelay: `${Math.min(i * 25, 500)}ms` }}
                  >
                    <TD>
                      <span className="text-[12px] font-mono text-[var(--color-fg)]">
                        {d.code}
                      </span>
                    </TD>
                    <TD>
                      <div className="flex flex-wrap items-center gap-2">
                        <Gift className="size-3 text-[var(--color-fg-subtle)] shrink-0" />
                        <span className="text-[13px] text-[var(--color-fg)]">
                          {d.name}
                        </span>
                      </div>
                    </TD>
                    <TD>
                      <Badge variant="neutral">
                        {TYPE_LABEL[d.type] ?? d.type}
                      </Badge>
                    </TD>
                    <TD>
                      <Badge variant={STATUS_VARIANT[d.status]} dot>
                        {STATUS_LABEL[d.status]}
                      </Badge>
                    </TD>
                    <TD numeric className="text-[var(--color-fg-muted)]">
                      {d.expirationDays}d
                    </TD>
                    <TD numeric className="text-[var(--color-fg-subtle)]">
                      {formatDate(d.createdAt)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>

        {/* Pager */}
        {data && total > PAGE_SIZE && (
          <Pager
            page={page}
            total={total}
            onPrev={() => setPage((p) => Math.max(0, p - 1))}
            onNext={() => setPage((p) => p + 1)}
            hasMore={(page + 1) * PAGE_SIZE < total}
          />
        )}
      </div>

      <BonusWizardModal open={wizardOpen} onOpenChange={setWizardOpen} />

      <CreateBonusDefinitionModal
        open={createOpen}
        onOpenChange={setCreateOpen}
      />

      <BonusDefinitionDrawer
        definitionId={selectedId}
        open={!!selectedId}
        onOpenChange={(o) => !o && setSelectedId(null)}
      />
    </>
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
    <div className="flex flex-wrap items-center justify-end gap-3 text-[11px] text-[var(--color-fg-subtle)]">
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
