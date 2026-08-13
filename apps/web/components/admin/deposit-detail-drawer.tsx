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

import {
  Ban,
  Check,
  ExternalLink,
  FileText,
  ImageIcon,
  Link2,
  Unlink,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmWithReasonModal } from '@/components/ui/confirm-with-reason-modal';
import {
  DepositOriginBadge,
  type DepositOrigin,
} from '@/components/admin/deposit-origin-badge';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiError } from '@/lib/api-client';
import { hasPermission, useAuth } from '@/lib/auth-context';
import {
  useApproveDeposit,
  useDepositDetail,
  useRejectDeposit,
  type DepositStatus,
} from '@/lib/hooks/use-deposits';
import {
  bonusAmountLabel,
  bonusDefsScopeFor,
  isDepositEligibleType,
  useActiveBonusDefinitions,
} from '@/lib/hooks/use-bonuses';
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
  /**
   * Origen comercial del jugador (de la fila de la lista). Solo se pasa en la
   * vista central (admin/empleado); si está presente se muestra la etiqueta.
   */
  origin?: DepositOrigin;
}

export function DepositDetailDrawer({
  depositId,
  open,
  onOpenChange,
  origin,
}: DepositDetailDrawerProps) {
  const { user: actor } = useAuth();
  const canApprove = hasPermission(actor, 'deposits.approve');
  const canReject = hasPermission(actor, 'deposits.reject');
  const { data, isLoading, isError } = useDepositDetail(depositId);
  const approve = useApproveDeposit(depositId);
  const reject = useRejectDeposit(depositId);
  // Bonus selector: solo planillas otorgables por el actor (el admin no ve
  // las de ramas independientes — 403 BonusOutOfBranchScopeError).
  const { data: bonusDefsRes } = useActiveBonusDefinitions(
    bonusDefsScopeFor(actor),
  );
  const bonusDefs = bonusDefsRes?.data ?? [];
  // Sprint 59: al aprobar un depósito solo se ofrecen planillas con monto
  // computable (welcome/reload = %, manual/no_deposit = monto fijo).
  const depositBonusDefs = bonusDefs.filter((bd) =>
    isDepositEligibleType(bd.type),
  );
  const [rejectOpen, setRejectOpen] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [selectedBonusDefId, setSelectedBonusDefId] = useState<string>('');

  const status = data?.deposit.status;
  // canMutate: hay estado mutable + al menos uno de los dos perms.
  // Sin perms el drawer se abre en modo read-only.
  const canMutate =
    (status === 'pending' || status === 'under_review') &&
    (canApprove || canReject);
  // Sprint 50: solo se puede aprobar si el deposit tiene bank_tx asociada.
  const hasBankTxMatch = !!data?.deposit.bankTransactionId;

  const handleApprove = async () => {
    try {
      const result = await approve.mutateAsync(
        selectedBonusDefId || undefined,
      );
      toast.success('Depósito aprobado', {
        description: `${result.deposit.amountChips} FICHAS acreditadas.`,
      });
      setConfirmApprove(false);
      setSelectedBonusDefId('');
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

  // Sprint 51.7: atajos de teclado en el drawer.
  //   A → aprobar (doble-tap: primer A pone confirm, segundo confirma).
  //   R → abrir modal de rechazo.
  // Solo se activan cuando el drawer está open + canMutate + no hay
  // input enfocado (para no capturar typing del usuario en el modal
  // de reject reason).
  useEffect(() => {
    if (!open || !canMutate) return;
    const handler = (e: KeyboardEvent): void => {
      // No interferir cuando el user está tipeando.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      // No procesar si hay modificadores (Cmd/Ctrl/Alt) — evita pisar
      // atajos del browser.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'a' && hasBankTxMatch && !approve.isPending) {
        e.preventDefault();
        if (confirmApprove) {
          void handleApprove();
        } else {
          setConfirmApprove(true);
        }
      } else if (key === 'r' && !reject.isPending && !rejectOpen) {
        e.preventDefault();
        setRejectOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
     
  }, [open, canMutate, hasBankTxMatch, confirmApprove, approve.isPending, reject.isPending, rejectOpen]);

  return (
    <>
      <Drawer
        open={open}
        onOpenChange={(o) => {
          if (!o) setConfirmApprove(false);
          onOpenChange(o);
        }}
        title={data ? `Depósito · ${data.deposit.amountChips} FICHAS` : 'Cargando…'}
        subtitle={data ? `#${data.deposit.id.slice(0, 13)}…` : depositId?.slice(0, 13)}
        footer={
          canMutate ? (
            <>
              <Button
                variant="secondary"
                size="md"
                onClick={() => setRejectOpen(true)}
                disabled={approve.isPending || reject.isPending}
                title="Atajo: R"
              >
                <Ban className="size-3.5" />
                Rechazar
                <kbd className="ml-1 text-[9px] font-mono bg-[var(--color-bg-subtle)] px-1 py-px rounded">
                  R
                </kbd>
              </Button>
              {confirmApprove ? (
                <>
                  {depositBonusDefs.length > 0 && (
                    <div className="flex items-center gap-2 mr-2">
                      <Label className="text-[10px] whitespace-nowrap">Bono:</Label>
                      <Select
                        value={selectedBonusDefId}
                        onChange={(e) => setSelectedBonusDefId(e.target.value)}
                        className="w-48 h-8 text-[11px]"
                      >
                        <option value="">Sin bono</option>
                        {depositBonusDefs.map((bd) => (
                          <option key={bd.id} value={bd.id}>
                            {bd.name} ({bonusAmountLabel(bd)})
                          </option>
                        ))}
                      </Select>
                    </div>
                  )}
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
                </>
              ) : (
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => setConfirmApprove(true)}
                  disabled={approve.isPending || reject.isPending || !hasBankTxMatch}
                  title={
                    !hasBankTxMatch
                      ? 'Matcheá una transferencia bancaria antes de aprobar'
                      : 'Atajo: A · doble-tap para confirmar'
                  }
                >
                  <Check className="size-3.5" />
                  Aprobar
                  {hasBankTxMatch && (
                    <kbd className="ml-1 text-[9px] font-mono bg-white/20 px-1 py-px rounded">
                      A
                    </kbd>
                  )}
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
                  fichas
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

            {/* Sprint 51.7.1: Comprobante destacado — el operador necesita
                verlo SÍ o SÍ antes de aprobar, así que es sección propia
                arriba del fold (justo después de monto/status) con preview
                + botón explícito para abrir en pestaña nueva (zoom real). */}
            <ReceiptSection
              url={data.deposit.receiptUrl}
              storageKey={data.deposit.receiptStorageKey ?? null}
            />

            {/* Detalle */}
            <section className="flex flex-col gap-3">
              <SectionHeader label="Detalle" />
              <DetailRow
                label="ID"
                valueNode={
                  <span className="text-[12px] font-mono text-[var(--color-fg-muted)] break-all">
                    {data.deposit.id}
                  </span>
                }
              />
              <DetailRow label="Usuario" value={data.deposit.userId.slice(0, 13) + '…'} mono />
              {origin?.originKind && (
                <div className="flex items-center justify-between gap-3 min-h-6">
                  <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
                    Origen
                  </span>
                  <DepositOriginBadge origin={origin} />
                </div>
              )}
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
 * Sprint 51.7.1: sección de comprobante. Reemplaza al ReceiptViewer
 * inline (que estaba enterrado como otra detail row). Ahora:
 *   - Sección propia con header destacado y fondo accent.
 *   - Si hay imagen: preview grande + botón "Abrir en pestaña" debajo.
 *   - Si es PDF: card con icono + botón "Abrir PDF".
 *   - Si no hay: banner warning (depósito sin comprobante → el operador
 *     debería rechazar pidiendo nuevo).
 *
 * El operador debe poder verificar el comprobante antes de aprobar; esto
 * lo pone arriba del fold del drawer.
 */
function ReceiptSection({
  url,
  storageKey,
}: {
  url: string | null;
  storageKey: string | null;
}) {
  if (!url) {
    return (
      <section className="flex flex-col gap-2 p-4 bg-[var(--color-warning-bg)] border border-[var(--color-warning)]">
        <div className="flex items-center gap-1.5">
          <ImageIcon className="size-3.5 text-[var(--color-warning)]" />
          <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-warning)] font-medium">
            Sin comprobante adjunto
          </span>
        </div>
        <p className="text-[12px] text-[var(--color-fg-muted)]">
          Este depósito fue creado sin adjuntar comprobante. Rechazalo
          pidiéndole al usuario que reenvíe con foto/PDF.
        </p>
      </section>
    );
  }
  // Heurística: si el storageKey o URL termina en .pdf, lo tratamos como PDF.
  const lower = (storageKey ?? url).toLowerCase();
  const isPdf = lower.endsWith('.pdf');

  return (
    <section className="flex flex-col gap-3 p-4 bg-[var(--color-bg)] border border-[var(--color-accent-border)] border-l-2 border-l-[var(--color-accent)]">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {isPdf ? (
            <FileText className="size-3.5 text-[var(--color-accent-text)]" />
          ) : (
            <ImageIcon className="size-3.5 text-[var(--color-accent-text)]" />
          )}
          <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-accent-text)] font-medium">
            Comprobante
          </span>
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-2 h-7 text-[11px] uppercase tracking-[0.06em] font-medium bg-[var(--color-bg-elevated)] text-[var(--color-fg)] border border-[var(--color-border)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent-text)] transition-colors"
          title="Abre el comprobante en una pestaña nueva"
        >
          <ExternalLink className="size-3" />
          Abrir en pestaña
        </a>
      </div>

      {isPdf ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 py-8 bg-[var(--color-bg-elevated)] border border-dashed border-[var(--color-border)] hover:border-[var(--color-accent)] transition-colors"
        >
          <FileText className="size-5 text-[var(--color-fg-muted)]" />
          <span className="text-[12px] text-[var(--color-fg-muted)]">
            Click para abrir PDF
          </span>
        </a>
      ) : (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="block self-start"
          title="Click para ampliar (abre en pestaña nueva)"
        >
          { }
          <img
            src={url}
            alt="Comprobante"
            className="max-w-full max-h-[320px] object-contain bg-[var(--color-bg-elevated)] border border-[var(--color-border)] hover:border-[var(--color-accent)] transition-colors"
          />
        </a>
      )}
    </section>
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
    'incoming',
    // Fase B: mientras el drawer está abierto, refetch cada 10s para que la
    // transferencia cargada por el empleado aparezca sola.
    { refetchInterval: 10_000 },
  );
  const match = useMatchBankTransaction();
  const unmatch = useUnmatchBankTransaction();
  // Sprint 51.7: para el botón Match+Aprobar combinado necesitamos
  // disparar approve después del match. Importamos useApproveDeposit
  // adentro del componente (vive en el mismo árbol React Query).
  const approve = useApproveDeposit(depositId);

  // Sprint 51.7: detectar si hay UN SOLO candidato con monto exacto
  // — es el caso típico (empleado cargó la bank_tx correctamente).
  // En ese caso, ofrecemos botón compuesto "Match + Aprobar".
  const exactSingleMatch = useMemo(() => {
    if (!candidates?.data) return null;
    const exact = candidates.data.filter(
      (bt) => Number(bt.amount) === Number(amount),
    );
    return exact.length === 1 ? exact[0]! : null;
  }, [candidates?.data, amount]);

  const matchAndApprove = async (): Promise<void> => {
    if (!exactSingleMatch) return;
    try {
      await match.mutateAsync({
        bankTxId: exactSingleMatch.id,
        depositId,
        payload: {},
      });
      const res = await approve.mutateAsync(undefined);
      toast.success('Matcheado + aprobado', {
        description: `${res.deposit.amountChips} fichas acreditadas.`,
      });
    } catch (err) {
      toast.error('No se pudo', {
        description: isApiError(err) ? err.message : 'Error de conexión.',
      });
    }
  };

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

      {/* Sprint 51.7: si hay UN solo candidato exacto, ofrecemos
          botón compuesto Match + Aprobar en un solo click. */}
      {exactSingleMatch && !isLoading && (
        <div className="flex flex-col gap-2 p-3 bg-[var(--color-success-bg)] border border-[var(--color-success)] border-l-2 border-l-[var(--color-success)]">
          <div className="flex items-center gap-2">
            <Zap className="size-3.5 text-[var(--color-success)]" />
            <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-success)] font-medium">
              Match único detectado
            </span>
          </div>
          <div className="text-[11px] text-[var(--color-fg-muted)]">
            <span className="font-mono text-[var(--color-fg)]">
              {exactSingleMatch.senderName ?? '(sin remitente)'}
            </span>
            {' · '}
            <span className="font-mono">{exactSingleMatch.bankAccount}</span>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={matchAndApprove}
            disabled={match.isPending || approve.isPending}
            className="bg-[var(--color-success)] hover:bg-[#166534] self-start"
          >
            {match.isPending || approve.isPending ? (
              <>
                <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                Procesando…
              </>
            ) : (
              <>
                <Zap className="size-3" />
                Match + Aprobar
              </>
            )}
          </Button>
        </div>
      )}

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
            {tx.bankName || tx.bankAccount ? (
              <>
                <span className="font-mono">{tx.bankName ?? tx.bankAccount}</span>
                <span>·</span>
              </>
            ) : null}
            {tx.accountHolder && (
              <>
                <span>{tx.accountHolder}</span>
                <span>·</span>
              </>
            )}
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
