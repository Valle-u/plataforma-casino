/**
 * /play/withdrawals — mis retiros.
 *
 * Lista cronológica con status badge. El monto en chips queda en HOLD
 * desde que se crea (status='pending') — el balance disponible refleja
 * eso. Cuando el operador marca como paid, el hold se consume; si
 * rechaza, el hold se libera y el balance vuelve.
 */

'use client';

import { ArrowUpToLine, Plus, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { NewWithdrawalModal } from '@/components/player/new-withdrawal-modal';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import {
  useMyWithdrawals,
  type WithdrawalStatus,
} from '@/lib/hooks/use-withdrawals';
import { cn } from '@/lib/cn';

const STATUS_VARIANT: Record<WithdrawalStatus, BadgeVariant> = {
  pending: 'warning',
  approved: 'info',
  processing: 'info',
  paid: 'success',
  rejected: 'danger',
  failed: 'danger',
};

const STATUS_LABEL: Record<WithdrawalStatus, string> = {
  pending: 'pendiente',
  approved: 'aprobado',
  processing: 'procesando',
  paid: 'pagado',
  rejected: 'rechazado',
  failed: 'fallido',
};

export default function PlayWithdrawalsPage() {
  const [newOpen, setNewOpen] = useState(false);
  const { data, isLoading, isError, refetch, isFetching } = useMyWithdrawals(
    50,
    0,
  );

  const rows = data?.data ?? [];

  return (
    <>
      <div className="max-w-[1100px] mx-auto px-6 py-10 flex flex-col gap-8">
        {/* Header */}
        <header className="flex items-end justify-between gap-6 pb-2">
          <div className="flex flex-col gap-2">
            <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
              <ArrowUpToLine className="size-3" />
              Tus retiros
            </span>
            <h1 className="font-display text-[2.5rem] leading-none tracking-tight">
              Mis retiros
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
            <Button variant="primary" size="md" onClick={() => setNewOpen(true)}>
              <Plus className="size-3.5" />
              Solicitar retiro
            </Button>
          </div>
        </header>

        {/* Banner explicativo */}
        <div className="px-4 py-3 border border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[12px] text-[var(--color-fg-muted)]">
          <span className="text-[var(--color-fg)] font-medium">¿Cómo funciona?</span>
          {' '}Cuando solicitás un retiro, las chips quedan en hold (descontadas
          del balance disponible). El operador valida tus datos, paga por
          fuera y marca como pagado. Si rechaza, el hold se libera.
        </div>

        {/* Lista */}
        <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
          {isLoading ? (
            <LoadingTable />
          ) : isError ? (
            <div className="p-6">
              <EmptyState
                hint="my_withdrawals"
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
                hint="my_withdrawals"
                label="Todavía no solicitaste ningún retiro"
                action={
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setNewOpen(true)}
                  >
                    <Plus className="size-3.5" />
                    Solicitar el primero
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
                  <TH align="right">Chips</TH>
                  <TH align="right">Fiat esperado</TH>
                  <TH>Estado</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((w, i) => (
                  <TR
                    key={w.id}
                    className="animate-fade-up-staggered"
                    style={{ animationDelay: `${Math.min(i * 25, 500)}ms` }}
                  >
                    <TD numeric className="text-[var(--color-fg-subtle)]">
                      {formatDate(w.createdAt)}
                    </TD>
                    <TD>
                      <span className="text-[12px] text-[var(--color-fg)]">
                        {w.methodName ?? w.methodCode ?? '—'}
                      </span>
                    </TD>
                    <TD numeric>
                      <span className="font-mono text-[12px] text-[var(--color-fg)]">
                        {Number(w.amountChips).toLocaleString('es-AR')}
                      </span>
                    </TD>
                    <TD numeric>
                      <span className="font-mono text-[12px] text-[var(--color-fg-muted)]">
                        {Number(w.amountFiat).toLocaleString('es-AR')}{' '}
                        <span className="text-[10px] text-[var(--color-fg-subtle)]">
                          {w.currencyFiat}
                        </span>
                      </span>
                    </TD>
                    <TD>
                      <Badge variant={STATUS_VARIANT[w.status]} dot>
                        {STATUS_LABEL[w.status]}
                      </Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>
      </div>

      <NewWithdrawalModal open={newOpen} onOpenChange={setNewOpen} />
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
