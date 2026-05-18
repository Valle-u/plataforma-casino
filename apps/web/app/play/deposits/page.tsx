/**
 * /play/deposits — mis depósitos.
 *
 * Lista cronológica de las solicitudes del jugador, con status badge y
 * botón "Solicitar depósito" que abre el modal.
 *
 * Status flow del backend:
 *   pending → under_review → approved (acredita) | rejected | expired | cancelled
 *
 * El jugador NO puede modificar/cancelar después de crear (MVP). En sprint
 * futuro: botón "Cancelar mi solicitud" si status === 'pending'.
 */

'use client';

import { ArrowDownToLine, Plus, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { NewDepositModal } from '@/components/player/new-deposit-modal';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { useMyDeposits, type DepositStatus } from '@/lib/hooks/use-deposits';
import { cn } from '@/lib/cn';

const STATUS_VARIANT: Record<DepositStatus, BadgeVariant> = {
  pending: 'warning',
  under_review: 'info',
  approved: 'success',
  rejected: 'danger',
  expired: 'neutral',
  cancelled: 'neutral',
};

const STATUS_LABEL: Record<DepositStatus, string> = {
  pending: 'pendiente',
  under_review: 'en revisión',
  approved: 'aprobado',
  rejected: 'rechazado',
  expired: 'expirado',
  cancelled: 'cancelado',
};

export default function PlayDepositsPage() {
  const [newOpen, setNewOpen] = useState(false);
  const { data, isLoading, isError, refetch, isFetching } = useMyDeposits(50, 0);

  const rows = data?.data ?? [];

  return (
    <>
      <div className="max-w-[1100px] mx-auto px-6 py-10 flex flex-col gap-8">
        {/* Header */}
        <header className="flex items-end justify-between gap-6 pb-2">
          <div className="flex flex-col gap-2">
            <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
              <ArrowDownToLine className="size-3" />
              Tus depósitos
            </span>
            <h1 className="font-display text-[2.5rem] leading-none tracking-tight">
              Mis depósitos
            </h1>
            <p className="text-sm text-[var(--color-fg-muted)] mt-1">
              {data ? `${rows.length} solicitud(es)` : 'Cargando…'}
            </p>
          </div>
          <div className="flex items-center gap-2">
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
              onClick={() => setNewOpen(true)}
            >
              <Plus className="size-3.5" />
              Solicitar depósito
            </Button>
          </div>
        </header>

        {/* Banner explicativo */}
        <div className="px-4 py-3 border border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[12px] text-[var(--color-fg-muted)]">
          <span className="text-[var(--color-fg)] font-medium">¿Cómo funciona?</span>
          {' '}Transferí primero por el método elegido, después cargá la solicitud
          acá. El cajero revisa el comprobante y acredita las chips. Suele
          tardar pocos minutos en horario operativo.
        </div>

        {/* Lista */}
        <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
          {isLoading ? (
            <LoadingTable />
          ) : isError ? (
            <div className="p-6">
              <EmptyState
                hint="my_deposits"
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
                hint="my_deposits"
                label="Todavía no hiciste ningún depósito"
                action={
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setNewOpen(true)}
                  >
                    <Plus className="size-3.5" />
                    Hacer el primero
                  </Button>
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Fecha</TH>
                  <TH>Método</TH>
                  <TH align="right">Fiat</TH>
                  <TH align="right">Chips</TH>
                  <TH>Estado</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((d, i) => (
                  <TR
                    key={d.id}
                    className="animate-fade-up-staggered"
                    style={{ animationDelay: `${Math.min(i * 25, 500)}ms` }}
                  >
                    <TD numeric className="text-[var(--color-fg-subtle)]">
                      {formatDate(d.createdAt)}
                    </TD>
                    <TD>
                      <span className="text-[12px] text-[var(--color-fg)]">
                        {d.methodName ?? d.methodCode ?? '—'}
                      </span>
                    </TD>
                    <TD numeric>
                      <span className="font-mono text-[12px] text-[var(--color-fg)]">
                        {Number(d.amountFiat).toLocaleString('es-AR')}{' '}
                        <span className="text-[10px] text-[var(--color-fg-subtle)]">
                          {d.currencyFiat}
                        </span>
                      </span>
                    </TD>
                    <TD numeric>
                      <span className="font-mono text-[12px] text-[var(--color-fg)]">
                        {Number(d.amountChips).toLocaleString('es-AR')}
                      </span>
                    </TD>
                    <TD>
                      <Badge variant={STATUS_VARIANT[d.status]} dot>
                        {STATUS_LABEL[d.status]}
                      </Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>
      </div>

      <NewDepositModal open={newOpen} onOpenChange={setNewOpen} />
    </>
  );
}

function LoadingTable() {
  return (
    <div className="p-4 flex flex-col gap-2">
      {Array.from({ length: 5 }).map((_, i) => (
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
