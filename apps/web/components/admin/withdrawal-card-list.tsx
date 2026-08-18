/**
 * WithdrawalCardList — review de retiros mobile-first (Fase 2).
 *
 * Reemplaza a la tabla densa en viewports < lg. Cada retiro es una tarjeta
 * apilada con:
 *   - Monto grande (fichas + equivalente fiat).
 *   - Estado + estado del match con bank_tx saliente.
 *   - Acciones full-width (tap targets >= 44px):
 *       · Cola (pending):      Rechazar + Aprobar (doble-click confirm).
 *       · Por pagar (approved): "Pago completo" (atajo Fase 2: bank_tx +
 *         match + paid en uno) o "Marcar pagado" si la transferencia ya
 *         está matcheada; más "Marcar fallido".
 *
 * Desktop NO cambia: la tabla sigue en <lg>.
 */
'use client';

import { Ban, Check, ChevronRight, Link2, Send, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { PayInFullModal } from '@/components/admin/pay-in-full-modal';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmWithReasonModal } from '@/components/ui/confirm-with-reason-modal';
import { hasPermission, useAuth } from '@/lib/auth-context';
import { isApiError } from '@/lib/api-client';
import {
  useApproveWithdrawal,
  useMarkFailedWithdrawal,
  useMarkPaidWithdrawal,
  useRejectWithdrawal,
  type WithdrawalRow,
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

interface WithdrawalCardListProps {
  rows: WithdrawalRow[];
  /** Tab activa: define qué acciones se muestran. */
  tabId: string;
  onOpenDetail: (id: string) => void;
}

export function WithdrawalCardList({
  rows,
  tabId,
  onOpenDetail,
}: WithdrawalCardListProps) {
  const { user: actor } = useAuth();
  const canApprove =
    hasPermission(actor, 'withdrawals.approve') ||
    hasPermission(actor, 'withdrawals.reject');
  const canProcess = hasPermission(actor, 'withdrawals.process');
  // Pago completo: endpoint compuesto que exige los 3 permisos atómicos.
  const canPayInFull =
    canProcess &&
    hasPermission(actor, 'bank_tx.upload') &&
    hasPermission(actor, 'bank_tx.match');

  const [resolved, setResolved] = useState(0);
  const showActions = (tabId === 'queue' && canApprove) || (tabId === 'topay' && canProcess);

  return (
    <div className="flex flex-col gap-3">
      {resolved > 0 && showActions && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-[var(--radius-sm)] text-[12px] text-[var(--color-fg-muted)] bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
          <Check className="size-3.5 text-[var(--color-success)]" />
          <span>
            Resolviste{' '}
            <span className="font-mono text-[var(--color-fg)]">{resolved}</span>{' '}
            {resolved === 1 ? 'retiro' : 'retiros'} en esta sesión
          </span>
        </div>
      )}

      {rows.map((w) => (
        <WithdrawalCard
          key={w.id}
          withdrawal={w}
          tabId={tabId}
          canApprove={canApprove}
          canProcess={canProcess}
          canPayInFull={canPayInFull}
          onOpenDetail={() => onOpenDetail(w.id)}
          onResolved={() => setResolved((n) => n + 1)}
        />
      ))}
    </div>
  );
}

function WithdrawalCard({
  withdrawal,
  tabId,
  canApprove,
  canProcess,
  canPayInFull,
  onOpenDetail,
  onResolved,
}: {
  withdrawal: WithdrawalRow;
  tabId: string;
  canApprove: boolean;
  canProcess: boolean;
  canPayInFull: boolean;
  onOpenDetail: () => void;
  onResolved: () => void;
}) {
  const approve = useApproveWithdrawal(withdrawal.id);
  const reject = useRejectWithdrawal(withdrawal.id);
  const markPaid = useMarkPaidWithdrawal(withdrawal.id);
  const markFailed = useMarkFailedWithdrawal(withdrawal.id);

  const [confirmApprove, setConfirmApprove] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [markFailedOpen, setMarkFailedOpen] = useState(false);
  const [payInFullOpen, setPayInFullOpen] = useState(false);

  const isPending =
    approve.isPending ||
    reject.isPending ||
    markPaid.isPending ||
    markFailed.isPending;

  const isQueue = tabId === 'queue' && withdrawal.status === 'pending' && canApprove;
  const isTopay =
    tabId === 'topay' &&
    (withdrawal.status === 'approved' || withdrawal.status === 'processing') &&
    canProcess;
  // Fase 2: si la transferencia saliente ya está matcheada, el atajo
  // compuesto no aplica — hay que usar mark-paid con la bank_tx existente.
  const hasOutgoingBankTx = !!withdrawal.bankTransactionId;
  const canPayThis =
    isTopay && !hasOutgoingBankTx && canPayInFull;
  const canMarkPaidThis = isTopay && hasOutgoingBankTx;
  const showActions = isQueue || isTopay;

  const handleApprove = async () => {
    try {
      await approve.mutateAsync();
      toast.success('Retiro aprobado', {
        description: 'Ahora podés marcarlo como pagado.',
      });
      setConfirmApprove(false);
      onResolved();
    } catch (err) {
      toast.error('No se pudo aprobar', { description: mapQuickError(err) });
    }
  };

  const handleReject = async (reason: string) => {
    try {
      await reject.mutateAsync({ reason });
      toast.success('Retiro rechazado', {
        description: 'El hold fue liberado y el usuario notificado.',
      });
      setRejectOpen(false);
      onResolved();
    } catch (err) {
      toast.error('No se pudo rechazar', { description: mapQuickError(err) });
    }
  };

  /**
   * Sprint 52 (decisión dueño): mark-paid es ONE-CLICK, sin modal ni
   * referencia manual. La outgoing bank_tx (con su comprobante) ya debe
   * estar matcheada; el backend auto-genera la paidExternalRef.
   */
  const handleMarkPaid = async () => {
    try {
      await markPaid.mutateAsync();
      toast.success('Retiro marcado como pagado', {
        description: 'El saldo del usuario fue debitado.',
      });
      onResolved();
    } catch (err) {
      toast.error('No se pudo marcar como pagado', {
        description: mapQuickError(err),
      });
    }
  };

  const handleMarkFailed = async (reason: string) => {
    try {
      await markFailed.mutateAsync({ reason });
      toast.success('Retiro marcado como fallido', {
        description: 'El hold fue liberado y el usuario notificado.',
      });
      setMarkFailedOpen(false);
      onResolved();
    } catch (err) {
      toast.error('No se pudo marcar como fallido', {
        description: mapQuickError(err),
      });
    }
  };

  return (
    <article className="flex flex-col gap-3 p-4 rounded-[var(--radius)] bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
      {/* Status + tiempo */}
      <div className="flex items-center justify-between gap-2">
        <Badge variant={STATUS_VARIANT[withdrawal.status]} dot>
          {STATUS_LABEL[withdrawal.status]}
        </Badge>
        <span className="text-[10px] text-[var(--color-fg-subtle)] font-mono tabular-nums">
          {formatDateTime(withdrawal.createdAt)}
        </span>
      </div>

      {/* Monto */}
      <div className="flex flex-col gap-0.5">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-3xl tracking-tight tabular-nums">
            {withdrawal.amountChips}
          </span>
          <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
            fichas
          </span>
        </div>
        <span className="text-[12px] text-[var(--color-fg-muted)]">
          {withdrawal.amountFiat} {withdrawal.currencyFiat}
        </span>
      </div>

      {/* Usuario + método */}
      <div className="flex items-center justify-between gap-3 text-[12px]">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[var(--color-fg)] truncate">
            {withdrawal.userDisplayName ?? withdrawal.userUsername ?? '—'}
          </span>
          <span className="text-[10px] text-[var(--color-fg-subtle)] font-mono truncate">
            {withdrawal.userUsername
              ? `@${withdrawal.userUsername}`
              : withdrawal.userId.slice(0, 13) + '…'}
          </span>
        </div>
        <span className="font-mono text-[11px] text-[var(--color-fg-muted)] shrink-0">
          {withdrawal.methodCode ?? withdrawal.methodId.slice(0, 8)}
        </span>
      </div>

      {/* Estado del match (Sprint 51 / Fase 2) */}
      <span
        className={cn(
          'inline-flex items-center gap-1.5 px-2 h-7 self-start text-[10px] uppercase tracking-[0.08em] font-medium border',
          hasOutgoingBankTx
            ? 'text-[var(--color-success)] bg-[var(--color-success-bg)] border-[var(--color-success)]'
            : 'text-[var(--color-fg-subtle)] bg-[var(--color-bg-subtle)] border-[var(--color-border)]',
        )}
      >
        <Link2 className="size-3" />
        {hasOutgoingBankTx ? 'Transferencia matcheada' : 'Sin transferencia'}
      </span>

      {/* Acciones */}
      {showActions ? (
        <div className="flex flex-col gap-2">
          {isQueue ? (
            <>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => setRejectOpen(true)}
                  disabled={isPending}
                  className="flex-1 h-12 text-[13px]"
                >
                  Rechazar
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  onClick={handleApprove}
                  disabled={isPending}
                  className={cn(
                    'flex-1 h-12 text-[13px]',
                    confirmApprove &&
                      'bg-[var(--color-success)] hover:brightness-110',
                  )}
                >
                  {approve.isPending ? (
                    <>
                      <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                      Aprobando…
                    </>
                  ) : confirmApprove ? (
                    'Confirmar aprobación'
                  ) : (
                    'Aprobar'
                  )}
                </Button>
              </div>
              <button
                type="button"
                onClick={onOpenDetail}
                className="flex items-center justify-center gap-1 h-10 text-[11px] uppercase tracking-[0.1em] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] transition-colors"
              >
                Ver detalle
                <ChevronRight className="size-3.5" />
              </button>
            </>
          ) : (
            <>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => setMarkFailedOpen(true)}
                  disabled={isPending}
                  className="flex-1 h-12 text-[13px]"
                >
                  <X className="size-3.5" />
                  Marcar fallido
                </Button>
                {canPayThis ? (
                  <Button
                    variant="primary"
                    size="md"
                    onClick={() => setPayInFullOpen(true)}
                    disabled={isPending}
                    className="flex-1 h-12 text-[13px] bg-[var(--color-success)] hover:brightness-110 border-[var(--color-success)]"
                  >
                    <Send className="size-3.5" />
                    Pago completo
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="md"
                    onClick={handleMarkPaid}
                    disabled={isPending || !canMarkPaidThis}
                    className={cn(
                      'flex-1 h-12 text-[13px]',
                      canMarkPaidThis &&
                        'bg-[var(--color-success)] hover:brightness-110 border-[var(--color-success)]',
                    )}
                    title={
                      isTopay && !hasOutgoingBankTx && !canPayInFull
                        ? 'Necesitás cargar y matchear la transferencia saliente (permisos bank_tx.upload + bank_tx.match) o usar el pago completo'
                        : undefined
                    }
                  >
                    <Check className="size-3.5" />
                    Marcar pagado
                  </Button>
                )}
              </div>
              <button
                type="button"
                onClick={onOpenDetail}
                className="flex items-center justify-center gap-1 h-10 text-[11px] uppercase tracking-[0.1em] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] transition-colors"
              >
                Ver detalle
                <ChevronRight className="size-3.5" />
              </button>
            </>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={onOpenDetail}
          className="flex items-center justify-center gap-1 h-10 text-[11px] uppercase tracking-[0.1em] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] transition-colors"
        >
          Ver detalle
          <ChevronRight className="size-3.5" />
        </button>
      )}

      {/* Modals */}
      <ConfirmWithReasonModal
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title="Rechazar retiro"
        description="El hold se libera, el saldo vuelve al usuario y queda audit log."
        warning="El usuario recibirá una notificación con el motivo del rechazo."
        confirmLabel="Rechazar retiro"
        confirmIcon={<Ban className="size-3.5" />}
        reasonPlaceholder="Ej: CBU no coincide con el titular del depósito."
        onConfirm={handleReject}
        isPending={reject.isPending}
      />
      <ConfirmWithReasonModal
        open={markFailedOpen}
        onOpenChange={setMarkFailedOpen}
        title="Marcar retiro como fallido"
        description="Se libera el hold y se notifica al usuario que el pago no pudo procesarse."
        warning="Usá esto si la transferencia bancaria falló (rebote, datos incorrectos, etc.)."
        confirmLabel="Marcar como fallido"
        confirmIcon={<X className="size-3.5" />}
        reasonPlaceholder="Ej: Error del banco intermediario — código E-503."
        onConfirm={handleMarkFailed}
        isPending={markFailed.isPending}
      />
      <PayInFullModal
        withdrawal={withdrawal}
        open={payInFullOpen}
        onOpenChange={setPayInFullOpen}
        onSuccess={onResolved}
      />
    </article>
  );
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function mapQuickError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.status === 403) return 'No tenés permiso para esta operación.';
  if (err.status === 409) return 'El retiro ya fue resuelto por otro operador.';
  if (err.status === 400) {
    if (err.code === 'WITHDRAWAL_REQUIRES_BANK_TX')
      return 'Necesitás matchear la transferencia saliente antes de marcar pagado.';
    return err.message || 'Datos inválidos.';
  }
  return err.message || 'Error inesperado.';
}
