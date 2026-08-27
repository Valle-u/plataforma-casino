/**
 * /promotions — panel admin de promociones/sorteos.
 *
 * Composición:
 *   - Header con título + acción "Crear promoción".
 *   - Tabs filter por status (Activas / Programadas / Borradores / Cerradas /
 *     Canceladas / Todas).
 *   - Tabla densa: code (mono), nombre, type badge, status badge, ventana
 *     (startsAt → endsAt), fecha de creación.
 *   - Click row → PromotionDetailDrawer con view/edit.
 *   - Empty state con CTA "Crear primera promoción" cuando la tab "Activas"
 *     está vacía (caso fresh-install).
 */

'use client';

import { Info, Plus, RefreshCw, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CreatePromotionModal } from '@/components/admin/create-promotion-modal';
import { PromotionDetailDrawer } from '@/components/admin/promotion-detail-drawer';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CsvExportButton } from '@/components/ui/csv-export-button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { useAuth } from '@/lib/auth-context';
import {
  usePromotions,
  type PromotionStatus,
  type PromotionType,
} from '@/lib/hooks/use-promotions';
import { cn } from '@/lib/cn';

const PAGE_SIZE = 25;

const STATUS_VARIANT: Record<PromotionStatus, BadgeVariant> = {
  draft: 'neutral',
  scheduled: 'info',
  active: 'success',
  closed: 'neutral',
  cancelled: 'danger',
};

const STATUS_LABEL: Record<PromotionStatus, string> = {
  draft: 'borrador',
  scheduled: 'programada',
  active: 'activa',
  closed: 'cerrada',
  cancelled: 'cancelada',
};

const TYPE_LABEL: Record<PromotionType, string> = {
  daily_wheel: 'ruleta diaria',
  login_streak: 'racha login',
  lottery_tickets: 'lotería',
  lottery_ranking: 'ranking',
  missions: 'misiones',
  level_chests: 'cofres',
};

interface FilterTab {
  id: string;
  label: string;
  status?: PromotionStatus;
}

const FILTER_TABS: FilterTab[] = [
  { id: 'active', label: 'Activas', status: 'active' },
  { id: 'scheduled', label: 'Programadas', status: 'scheduled' },
  { id: 'draft', label: 'Borradores', status: 'draft' },
  { id: 'closed', label: 'Cerradas', status: 'closed' },
  { id: 'cancelled', label: 'Canceladas', status: 'cancelled' },
  { id: 'all', label: 'Todas' },
];

export default function PromotionsPage() {
  const { user } = useAuth();
  // Sprint 51.3: solo admin_tenant puede crear promotions (servicio
  // plataforma). Para el resto la vista es read-only — ocultamos el
  // botón "Crear" y mostramos un banner explicativo.
  const canCreate = user?.roles?.includes('admin_tenant') ?? false;
  const [tabId, setTabId] = useState<string>('active');
  const [page, setPage] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const tab = useMemo(
    () => FILTER_TABS.find((t) => t.id === tabId) ?? FILTER_TABS[0]!,
    [tabId],
  );

  const { data, isLoading, isError, refetch, isFetching } = usePromotions({
    status: tab.status,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;

  return (
    <>
      <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1600px] mx-auto">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-2">
          <div className="flex flex-col gap-2">
            <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
              <Sparkles className="size-3" />
              Engagement · Promociones
            </span>
            <h1 className="font-display text-3xl lg:text-[2.5rem] leading-none tracking-tight">
              Promociones del tenant
            </h1>
            <p className="text-sm text-[var(--color-fg-muted)] mt-1">
              {data ? `${rows.length} de ${total} en esta vista` : 'Cargando…'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CsvExportButton
              path="/tenant/promotions/export"
              params={{ status: tab.status }}
              filenameHint="promotions"
              permission="promotions.export"
              entityLabel="promociones"
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
              <Button
                variant="primary"
                size="md"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="size-3.5" />
                Crear promoción
              </Button>
            )}
          </div>
        </header>

        {/* Sprint 51.3: banner read-only para no-admin (socios, cajeros).
            Las promotions son servicio plataforma — solo el admin del
            tenant las configura, pero aplican a TODOS los players
            (incluso los de sucursales independent). */}
        {!canCreate && (
          <div className="flex items-start gap-3 p-3 bg-[var(--color-bg-elevated)] border-l-2 border-l-[var(--color-accent)] border border-[var(--color-border)]">
            <Info className="size-4 text-[var(--color-accent-text)] shrink-0 mt-0.5" />
            <div className="flex flex-col gap-1">
              <span className="text-[12px] text-[var(--color-fg)] font-medium">
                Vista de solo lectura
              </span>
              <span className="text-[11px] text-[var(--color-fg-muted)]">
                Las promociones son un servicio de la plataforma —
                las configura el admin del tenant y aplican a todos los
                jugadores (incluso los de sucursales independientes).
                Podés ver el detalle y los premios pero no editarlas.
              </span>
            </div>
          </div>
        )}

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
                'px-4 h-11 lg:h-8 text-[11px] uppercase tracking-[0.08em] font-medium',
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
                hint="promotions"
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
                hint="promotions"
                stream={`tenant · status=${tab.status ?? '*'}`}
                label={
                  tabId === 'active'
                    ? 'No hay promociones activas'
                    : 'Sin promociones en este filtro'
                }
                action={
                  tabId === 'active' && canCreate ? (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => setCreateOpen(true)}
                    >
                      <Plus className="size-3.5" />
                      Crear primera promoción
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
                  <TH>Ventana</TH>
                  <TH align="right">Creada</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((p, i) => (
                  <TR
                    key={p.id}
                    onClick={() => setSelectedId(p.id)}
                    className="animate-fade-up-staggered cursor-pointer"
                    style={{ animationDelay: `${Math.min(i * 25, 500)}ms` }}
                  >
                    <TD>
                      <span className="text-[12px] font-mono text-[var(--color-fg)]">
                        {p.code}
                      </span>
                    </TD>
                    <TD>
                      <span className="text-[13px] text-[var(--color-fg)]">
                        {p.name}
                      </span>
                    </TD>
                    <TD>
                      <Badge variant="neutral">
                        {TYPE_LABEL[p.type] ?? p.type}
                      </Badge>
                    </TD>
                    <TD>
                      <Badge variant={STATUS_VARIANT[p.status]} dot>
                        {STATUS_LABEL[p.status]}
                      </Badge>
                    </TD>
                    <TD>
                      <WindowCell
                        startsAt={p.startsAt}
                        endsAt={p.endsAt}
                      />
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

      <CreatePromotionModal open={createOpen} onOpenChange={setCreateOpen} />

      <PromotionDetailDrawer
        promotionId={selectedId}
        open={!!selectedId}
        onOpenChange={(o) => !o && setSelectedId(null)}
      />
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────

function WindowCell({
  startsAt,
  endsAt,
}: {
  startsAt: string | null;
  endsAt: string | null;
}) {
  if (!startsAt && !endsAt)
    return (
      <span className="text-[11px] text-[var(--color-fg-subtle)] italic">
        perpetua
      </span>
    );
  return (
    <div className="flex flex-col gap-0.5 text-[11px] font-mono text-[var(--color-fg-muted)]">
      <span>{startsAt ? formatDate(startsAt) : '— sin inicio'}</span>
      <span className="text-[var(--color-fg-subtle)]">
        → {endsAt ? formatDate(endsAt) : 'sin fin'}
      </span>
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
    <div className="flex flex-wrap items-center justify-end gap-3 text-[11px] text-[var(--color-fg-subtle)]">
      <span className="font-mono tabular-nums">
        {total === 0 ? '—' : `${start}–${end} de ${total}`}
      </span>
      <div className="flex items-center gap-px bg-[var(--color-border)]">
        <button
          type="button"
          onClick={onPrev}
          disabled={page === 0}
          className="px-3 h-11 lg:h-7 text-[11px] uppercase tracking-[0.08em] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Anterior
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!hasMore}
          className="px-3 h-11 lg:h-7 text-[11px] uppercase tracking-[0.08em] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
      timeZone: 'America/Argentina/Buenos_Aires',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}
