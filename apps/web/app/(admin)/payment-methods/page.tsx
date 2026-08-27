/**
 * /payment-methods — CRUD admin del catálogo del tenant.
 *
 * Composición:
 *   - Header con "Crear método".
 *   - Tabs: Activos / Inactivos / Todos.
 *   - Tabla con code (mono), name, type badge, status, fecha.
 *   - Click row → PaymentMethodDrawer (view/edit/archive).
 *
 * El catálogo lo consume `/play/deposits` y `/play/withdrawals` para
 * popular el dropdown del jugador. Archivar un método lo saca del
 * dropdown pero mantiene FK de deposits/withdrawals históricos.
 */

'use client';

import { CreditCard, Plus, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CreatePaymentMethodModal } from '@/components/admin/create-payment-method-modal';
import { PaymentMethodDrawer } from '@/components/admin/payment-method-drawer';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { HelpNote } from '@/components/ui/help-note';
import { PageHeader } from '@/components/ui/page-header';
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { TabStrip } from '@/components/ui/tab-strip';
import { useMyBranch } from '@/lib/hooks/use-branches';
import {
  usePaymentMethods,
  type PaymentMethodType,
} from '@/lib/hooks/use-payment-methods';
import { cn } from '@/lib/cn';

const TYPE_LABEL: Record<PaymentMethodType, string> = {
  bank_transfer: 'transferencia',
  crypto: 'cripto',
  other: 'otro',
};

const TYPE_VARIANT: Record<PaymentMethodType, BadgeVariant> = {
  bank_transfer: 'success',
  crypto: 'info',
  other: 'neutral',
};

interface Tab {
  id: string;
  label: string;
  /** Si está, filtra client-side por isActive. */
  isActive?: boolean;
}

const TABS: Tab[] = [
  { id: 'active', label: 'Activos', isActive: true },
  { id: 'inactive', label: 'Inactivos', isActive: false },
  { id: 'all', label: 'Todos' },
];

export default function PaymentMethodsPage() {
  const [tabId, setTabId] = useState<string>('active');
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Traemos TODO siempre (activeOnly=false) y filtramos client-side por tab.
  // El catálogo no escala — esperar <100 métodos por tenant es razonable.
  const { data, isLoading, isError, refetch, isFetching } = usePaymentMethods(false);
  const branch = useMyBranch(1);
  const isBranchUser = branch.data?.isIndependent || branch.data?.underIndependentBranch;

  const tab = useMemo(() => TABS.find((t) => t.id === tabId) ?? TABS[0]!, [tabId]);

  const rows = useMemo(() => {
    const all = data?.data ?? [];
    if (tab.isActive === undefined) return all;
    return all.filter((m) => m.isActive === tab.isActive);
  }, [data, tab.isActive]);

  // Los operadores de red independiente gestionan sus métodos de pago dentro
  // de "Mi sucursal". Si caen acá por URL directa, los mandamos ahí.
  if (isBranchUser) {
    return (
      <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[900px] mx-auto">
        <EmptyState
          hint="payment-methods-branch"
          label="Tus métodos de pago ahora están en la sección 'Mi sucursal'."
          action={
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                window.location.href = '/my-branch';
              }}
            >
              Ir a Mi sucursal
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <>
      <PageShell className="max-w-[1400px]">
        {/* Header */}
        <PageHeader
          icon={CreditCard}
          title="Métodos de pago"
          description={
            data
              ? `Las formas en que tus jugadores cargan y retiran plata. ${rows.length} de ${data.data.length} en esta vista.`
              : 'Cargando…'
          }
          actions={
            <>
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
              <Button
                variant="primary"
                size="md"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="size-3.5" />
                Crear método
              </Button>
            </>
          }
        />

        <HelpNote id="payment-methods">
          Acá cargás las <strong>formas de pago</strong> que tus jugadores van a
          usar para <strong>depositar y retirar</strong> (por ejemplo una cuenta
          bancaria para transferencias, o cripto). Cada método que creás y dejás{' '}
          <strong>activo</strong> le aparece al jugador cuando quiere cargar o
          sacar plata. Si <strong>archivás</strong> uno, deja de aparecerle a los
          jugadores, pero los depósitos y retiros viejos que lo usaron siguen
          quedando bien registrados.
        </HelpNote>

        {/* Tabs */}
        <TabStrip className="sm:self-start" label="Filtrar métodos de pago">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTabId(t.id)}
              className={cn(
                'shrink-0 whitespace-nowrap px-4 h-11 lg:h-8 text-[11px] uppercase tracking-[0.08em] font-medium',
                'transition-colors duration-150',
                tabId === t.id
                  ? 'bg-[var(--color-bg)] text-[var(--color-fg)] border-b-2 border-b-[var(--color-accent)]'
                  : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]',
              )}
            >
              {t.label}
            </button>
          ))}
        </TabStrip>

        {/* Tabla */}
        <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius)] overflow-x-auto">
          {isLoading ? (
            <LoadingTable />
          ) : isError ? (
            <div className="p-6">
              <EmptyState
                hint="payment_methods"
                label="No se pudo cargar la lista."
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => refetch()}
                  >
                    Reintentar
                  </Button>
                }
              />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                hint="payment_methods"
                label={
                  tabId === 'active'
                    ? 'No hay métodos activos'
                    : 'Sin métodos en este filtro'
                }
                action={
                  tabId === 'active' ? (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => setCreateOpen(true)}
                    >
                      <Plus className="size-3.5" />
                      Crear primer método
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
                  <TH align="right">Creado</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((m, i) => (
                  <TR
                    key={m.id}
                    onClick={() => setSelectedId(m.id)}
                    className="animate-fade-up-staggered cursor-pointer"
                    style={{ animationDelay: `${Math.min(i * 25, 500)}ms` }}
                  >
                    <TD>
                      <span className="text-[12px] font-mono text-[var(--color-fg)]">
                        {m.code}
                      </span>
                    </TD>
                    <TD>
                      <span className="text-[13px] text-[var(--color-fg)]">
                        {m.name}
                      </span>
                    </TD>
                    <TD>
                      <Badge variant={TYPE_VARIANT[m.type]}>
                        {TYPE_LABEL[m.type]}
                      </Badge>
                    </TD>
                    <TD>
                      {m.isActive ? (
                        <Badge variant="success" dot>
                          activo
                        </Badge>
                      ) : (
                        <Badge variant="neutral" dot>
                          archivado
                        </Badge>
                      )}
                    </TD>
                    <TD numeric className="text-[var(--color-fg-subtle)]">
                      {formatDate(m.createdAt)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>
      </PageShell>

      <CreatePaymentMethodModal
        open={createOpen}
        onOpenChange={setCreateOpen}
      />

      <PaymentMethodDrawer
        methodId={selectedId}
        open={!!selectedId}
        onOpenChange={(o) => !o && setSelectedId(null)}
      />
    </>
  );
}

function LoadingTable() {
  return (
    <div className="p-4 flex flex-col gap-2">
      {Array.from({ length: 4 }).map((_, i) => (
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
