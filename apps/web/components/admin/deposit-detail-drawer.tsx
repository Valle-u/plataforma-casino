/**
 * DepositDetailDrawer — drawer con detalle del depósito + acciones.
 *
 * Estado de depósito y acciones disponibles:
 *   - pending / under_review: aprobable + rechazable.
 *   - approved: solo view (la wallet ya se acreditó).
 *   - rejected / expired / cancelled: solo view.
 *
 * Acciones:
 *   - Approve: acredita la wallet del user. Confirma con doble click
 *     (botón cambia a "Confirmar" tras primer click).
 *   - Reject: abre modal con motivo obligatorio.
 */

'use client';

import { Check, Ban, FileText } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmWithReasonModal } from '@/components/ui/confirm-with-reason-modal';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiError } from '@/lib/api-client';
import {
  useApproveDeposit,
  useDepositDetail,
  useRejectDeposit,
  type DepositStatus,
} from '@/lib/hooks/use-deposits';
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
  pending: 'Pendiente',
  under_review: 'En revisión',
  approved: 'Aprobado',
  rejected: 'Rechazado',
  expired: 'Expirado',
  cancelled: 'Cancelado',
};

interface DepositDetailDrawerProps {
  depositId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DepositDetailDrawer({
  depositId,
  open,
  onOpenChange,
}: DepositDetailDrawerProps) {
  const { data, isLoading, isError } = useDepositDetail(depositId);
  const approve = useApproveDeposit(depositId);
  const reject = useRejectDeposit(depositId);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState(false);

  const status = data?.deposit.status;
  const canMutate =
    status === 'pending' || status === 'under_review';

  const handleApprove = async () => {
    try {
      const result = await approve.mutateAsync();
      toast.success('Depósito aprobado', {
        description: `${result.deposit.amountChips} CHIPS acreditadas.`,
      });
      setConfirmApprove(false);
    } catch (err) {
      toast.error('No se pudo aprobar', { description: mapServerError(err) });
    }
  };

  const handleReject = async (reason: string) => {
    try {
      await reject.mutateAsync({ reason });
      toast.success('Depósito rechazado', {
        description: 'El usuario fue notificado.',
      });
      setRejectOpen(false);
    } catch (err) {
      toast.error('No se pudo rechazar', { description: mapServerError(err) });
    }
  };

  return (
    <>
      <Drawer
        open={open}
        onOpenChange={(o) => {
          if (!o) setConfirmApprove(false);
          onOpenChange(o);
        }}
        title={data ? `Depósito · ${data.deposit.amountChips} CHIPS` : 'Cargando…'}
        subtitle={data ? `#${data.deposit.id.slice(0, 13)}…` : depositId?.slice(0, 13)}
        footer={
          canMutate ? (
            <>
              <Button
                variant="secondary"
                size="md"
                onClick={() => setRejectOpen(true)}
                disabled={approve.isPending || reject.isPending}
              >
                <Ban className="size-3.5" />
                Rechazar
              </Button>
              {confirmApprove ? (
                <Button
                  variant="primary"
                  size="md"
                  onClick={handleApprove}
                  disabled={approve.isPending}
                  className="bg-[var(--color-success)] hover:bg-[#166534]"
                >
                  {approve.isPending ? (
                    <>
                      <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                      Aprobando…
                    </>
                  ) : (
                    <>
                      <Check className="size-3.5" />
                      Confirmar aprobación
                    </>
                  )}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => setConfirmApprove(true)}
                  disabled={approve.isPending || reject.isPending}
                >
                  <Check className="size-3.5" />
                  Aprobar
                </Button>
              )}
            </>
          ) : (
            <Button
              variant="secondary"
              size="md"
              onClick={() => onOpenChange(false)}
            >
              Cerrar
            </Button>
          )
        }
      >
        {isLoading && (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-20 w-full bg-[var(--color-bg-subtle)]" />
            <Skeleton className="h-32 w-full bg-[var(--color-bg-subtle)]" />
          </div>
        )}
        {isError && (
          <EmptyState
            hint="deposit_detail"
            label="No se pudo cargar el detalle."
          />
        )}
        {data && (
          <div className="flex flex-col gap-6">
            {/* Status + monto */}
            <section className="flex flex-col gap-4 p-4 bg-[var(--color-bg)] border border-[var(--color-border)]">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)]">
                  Estado
                </span>
                <Badge variant={STATUS_VARIANT[data.deposit.status]} dot>
                  {STATUS_LABEL[data.deposit.status]}
                </Badge>
              </div>
              <div className="flex items-baseline gap-2 pt-3 border-t border-[var(--color-border)]">
                <span className="font-display text-3xl tabular-nums tracking-tight">
                  {data.deposit.amountChips}
                </span>
                <span className="text-xs font-mono text-[var(--color-fg-subtle)] uppercase tracking-[0.14em]">
                  chips
                </span>
              </div>
              <div className="text-[12px] text-[var(--color-fg-muted)]">
                Equivalente:{' '}
                <span className="font-mono text-[var(--color-fg)]">
                  {data.deposit.amountFiat} {data.deposit.currencyFiat}
                </span>
              </div>
              {data.deposit.reason && (
                <div className="pt-3 border-t border-[var(--color-border)]">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] mb-1">
                    Motivo
                  </div>
                  <div className="text-[12px] text-[var(--color-fg)]">
                    {data.deposit.reason}
                  </div>
                </div>
              )}
            </section>

            {/* Detalle */}
            <section className="flex flex-col gap-3">
              <SectionHeader label="Detalle" />
              <DetailRow label="Usuario" value={data.deposit.userId.slice(0, 13) + '…'} mono />
              <DetailRow
                label="Método"
                value={data.deposit.methodCode ?? data.deposit.methodId.slice(0, 13) + '…'}
                mono
              />
              <DetailRow
                label="Ref. externa"
                value={data.deposit.externalRef ?? '—'}
                mono
              />
              <DetailRow
                label="Comprobante"
                valueNode={
                  data.deposit.proofUrl ? (
                    <a
                      href={data.deposit.proofUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[12px] text-[var(--color-accent)] hover:underline flex items-center gap-1"
                    >
                      <FileText className="size-3" />
                      Ver
                    </a>
                  ) : (
                    <span className="text-[12px] text-[var(--color-fg-subtle)]">
                      Sin adjunto
                    </span>
                  )
                }
              />
              <DetailRow label="Creado" value={formatDateTime(data.deposit.createdAt)} mono />
              <DetailRow
                label="Actualizado"
                value={formatDateTime(data.deposit.updatedAt)}
                mono
              />
              {data.deposit.approvedAt && (
                <DetailRow
                  label="Aprobado"
                  value={formatDateTime(data.deposit.approvedAt)}
                  mono
                />
              )}
              {data.deposit.expiresAt && (
                <DetailRow
                  label="Expira"
                  value={formatDateTime(data.deposit.expiresAt)}
                  mono
                />
              )}
            </section>

            {/* Wallet tx linkeada */}
            {data.walletTx && (
              <section className="flex flex-col gap-3">
                <SectionHeader label="Transacción wallet" />
                <DetailRow
                  label="ID"
                  value={data.walletTx.id.slice(0, 13) + '…'}
                  mono
                />
                <DetailRow label="Tipo" value={data.walletTx.type} mono />
                <DetailRow label="Monto" value={data.walletTx.amount} mono />
                <DetailRow
                  label="Balance post"
                  value={data.walletTx.balanceAfter}
                  mono
                />
              </section>
            )}
          </div>
        )}
      </Drawer>

      <ConfirmWithReasonModal
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title="Rechazar depósito"
        description="El usuario será notificado y la operación queda en audit log."
        warning="El rechazo es definitivo. Si el usuario reabre el flow tendrá que crear un depósito nuevo."
        confirmLabel="Rechazar depósito"
        confirmIcon={<Ban className="size-3.5" />}
        reasonPlaceholder="Ej: Comprobante ilegible — reenviá foto clara."
        onConfirm={handleReject}
        isPending={reject.isPending}
      />
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function SectionHeader({ label, icon }: { label: string; icon?: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 pb-2 border-b border-[var(--color-border)]">
      {icon}
      <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium">
        {label}
      </span>
    </div>
  );
}

function DetailRow({
  label,
  value,
  valueNode,
  mono,
}: {
  label: string;
  value?: string;
  valueNode?: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-center gap-3">
      <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)]">
        {label}
      </span>
      {valueNode ?? (
        <span
          className={cn(
            'text-[13px] text-[var(--color-fg)]',
            mono && 'font-mono',
          )}
        >
          {value}
        </span>
      )}
    </div>
  );
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('es-AR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function mapServerError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.status === 404) return 'El depósito ya no existe.';
  if (err.status === 409) return 'El depósito ya fue resuelto.';
  if (err.status === 403) return 'No tenés permiso para esta operación.';
  if (err.status === 400) return err.message || 'Datos inválidos.';
  return err.message || 'Error inesperado.';
}
