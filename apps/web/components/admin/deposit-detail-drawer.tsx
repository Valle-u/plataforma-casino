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

import { Check, Ban, FileText, Link2, Unlink } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmWithReasonModal } from '@/components/ui/confirm-with-reason-modal';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiError } from '@/lib/api-client';
import {
  useApproveDeposit,
  useDepositDetail,
  useRejectDeposit,
  type DepositStatus,
} from '@/lib/hooks/use-deposits';
import {
  useMatchBankTransaction,
  useUnmatchBankTransaction,
  useUnmatchedForAmount,
  type BankTransaction,
} from '@/lib/hooks/use-bank-transactions';
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
  // Sprint 50: solo se puede aprobar si el deposit tiene bank_tx asociada.
  const hasBankTxMatch = !!data?.deposit.bankTransactionId;

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
                  disabled={approve.isPending || reject.isPending || !hasBankTxMatch}
                  title={
                    !hasBankTxMatch
                      ? 'Matcheá una transferencia bancaria antes de aprobar'
                      : undefined
                  }
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
                  <ReceiptViewer
                    url={data.deposit.receiptUrl}
                    storageKey={data.deposit.receiptStorageKey ?? null}
                  />
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

            {/* Sprint 50: Matchear con transferencia bancaria */}
            {canMutate && (
              <BankTxMatcher
                depositId={data.deposit.id}
                amount={data.deposit.amountFiat}
                bankTransactionId={data.deposit.bankTransactionId ?? null}
              />
            )}

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

/**
 * Sprint 51.6: visor del comprobante. Si es imagen (heurística por
 * extensión en el URL o falta de `.pdf`), muestra inline + click para
 * abrir en nueva tab. Si es PDF, link de descarga.
 */
function ReceiptViewer({
  url,
  storageKey,
}: {
  url: string | null;
  storageKey: string | null;
}) {
  if (!url) {
    return (
      <span className="text-[12px] text-[var(--color-fg-subtle)] italic">
        Sin adjunto
      </span>
    );
  }
  // Heurística: si el storageKey o URL termina en .pdf, lo tratamos como PDF.
  const lower = (storageKey ?? url).toLowerCase();
  const isPdf = lower.endsWith('.pdf');

  if (isPdf) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[12px] text-[var(--color-accent-text)] hover:underline flex items-center gap-1 self-start"
      >
        <FileText className="size-3" />
        Abrir PDF
      </a>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="block"
      title="Click para ampliar"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt="Comprobante"
        className="max-w-[280px] max-h-[200px] object-contain bg-[var(--color-bg)] border border-[var(--color-border)] hover:border-[var(--color-accent)] transition-colors"
      />
    </a>
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
  if (err.status === 400) {
    if (err.code === 'DEPOSIT_REQUIRES_BANK_TX') {
      return 'Necesitás matchear una transferencia bancaria antes de aprobar.';
    }
    return err.message || 'Datos inválidos.';
  }
  return err.message || 'Error inesperado.';
}

// ──────────────────────────────────────────────────────────────────────
// Sprint 50: BankTxMatcher — selector + match con override
// ──────────────────────────────────────────────────────────────────────

function BankTxMatcher({
  depositId,
  amount,
  bankTransactionId,
}: {
  depositId: string;
  amount: string;
  bankTransactionId: string | null;
}) {
  const [includeAll, setIncludeAll] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const { data: candidates, isLoading } = useUnmatchedForAmount(
    amount,
    includeAll,
  );
  const match = useMatchBankTransaction();
  const unmatch = useUnmatchBankTransaction();

  // Estado matcheado: solo mostramos info + botón desmatchear.
  if (bankTransactionId) {
    return (
      <section className="flex flex-col gap-3 p-4 bg-[var(--color-success-bg)] border border-[var(--color-success)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link2 className="size-4 text-[var(--color-success)]" />
            <span className="text-[12px] text-[var(--color-fg)] font-medium">
              Transferencia bancaria matcheada
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              try {
                await unmatch.mutateAsync(bankTransactionId);
                toast.success('Match revertido');
              } catch (err) {
                toast.error('No se pudo desmatchear', {
                  description: isApiError(err) ? err.message : 'Error de conexión.',
                });
              }
            }}
            disabled={unmatch.isPending}
          >
            <Unlink className="size-3" />
            Desmatchear
          </Button>
        </div>
        <div className="text-[11px] text-[var(--color-fg-muted)] font-mono">
          ID: {bankTransactionId.slice(0, 16)}…
        </div>
        <div className="text-[11px] text-[var(--color-fg-subtle)]">
          Ya podés aprobar el depósito.
        </div>
      </section>
    );
  }

  // Estado sin match: mostramos lista de candidatos.
  return (
    <section className="flex flex-col gap-3 p-4 bg-[var(--color-bg)] border border-[var(--color-accent-border)] border-l-2 border-l-[var(--color-accent)]">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-accent-text)] font-medium flex items-center gap-1.5">
            <Link2 className="size-3" />
            Matchear con transferencia bancaria
          </span>
          <span className="text-[10px] text-[var(--color-fg-subtle)]">
            Requerido antes de aprobar. Buscando monto: <span className="font-mono">{amount}</span>
          </span>
        </div>
        <button
          type="button"
          onClick={() => setIncludeAll((v) => !v)}
          className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
        >
          {includeAll ? 'Solo monto exacto' : 'Ver todas (override)'}
        </button>
      </div>

      {isLoading ? (
        <Skeleton className="h-20" />
      ) : !candidates?.data.length ? (
        <div className="text-[12px] text-[var(--color-fg-muted)] p-3 bg-[var(--color-bg-subtle)] border border-dashed border-[var(--color-border)]">
          Sin transferencias{includeAll ? '' : ` por $${amount}`}. Pedile al empleado que cargue la transferencia entrante.
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 max-h-[280px] overflow-y-auto">
          {candidates.data.map((bt) => (
            <BankTxCandidate
              key={bt.id}
              tx={bt}
              depositAmount={amount}
              overrideReason={overrideReason}
              onOverrideReasonChange={setOverrideReason}
              onMatch={async (override) => {
                try {
                  await match.mutateAsync({
                    bankTxId: bt.id,
                    depositId,
                    payload: override
                      ? { override: true, overrideReason }
                      : {},
                  });
                  toast.success('Matcheado');
                  setOverrideReason('');
                } catch (err) {
                  toast.error('No se pudo matchear', {
                    description: isApiError(err) ? err.message : 'Error',
                  });
                }
              }}
              disabled={match.isPending}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function BankTxCandidate({
  tx,
  depositAmount,
  overrideReason,
  onOverrideReasonChange,
  onMatch,
  disabled,
}: {
  tx: BankTransaction;
  depositAmount: string;
  overrideReason: string;
  onOverrideReasonChange: (v: string) => void;
  onMatch: (override: boolean) => void | Promise<void>;
  disabled?: boolean;
}) {
  const amountsMatch = Number(tx.amount) === Number(depositAmount);
  const [showOverride, setShowOverride] = useState(false);

  return (
    <div className="flex flex-col gap-2 p-2.5 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)]">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[12px] text-[var(--color-fg)] truncate">
            {tx.senderName ?? '(sin remitente)'}
          </span>
          <div className="flex items-center gap-2 text-[10px] text-[var(--color-fg-subtle)]">
            <span className="font-mono">{tx.bankAccount}</span>
            <span>·</span>
            <span>{new Date(tx.receivedAt).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}</span>
          </div>
        </div>
        <span
          className={cn(
            'font-mono text-[13px]',
            amountsMatch ? 'text-[var(--color-success)]' : 'text-[var(--color-warning)]',
          )}
        >
          {tx.amount} {tx.currency}
        </span>
      </div>
      {amountsMatch ? (
        <Button
          variant="primary"
          size="sm"
          onClick={() => onMatch(false)}
          disabled={disabled}
          className="self-end"
        >
          <Link2 className="size-3" />
          Matchear
        </Button>
      ) : showOverride ? (
        <div className="flex flex-col gap-1.5">
          <Label className="text-[10px]">
            Motivo del override (montos no coinciden)
          </Label>
          <Input
            value={overrideReason}
            onChange={(e) => onOverrideReasonChange(e.target.value)}
            placeholder="ej. comisión bancaria descontada"
          />
          <div className="flex justify-end gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => setShowOverride(false)}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => onMatch(true)}
              disabled={disabled || overrideReason.length < 5}
            >
              Matchear con override
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setShowOverride(true)}
          disabled={disabled}
          className="self-end"
        >
          Match con override
        </Button>
      )}
    </div>
  );
}
