/**
 * WithdrawalDetailDrawer — drawer con detalle del retiro + acciones.
 *
 * Acciones según status:
 *   - pending      → Aprobar (doble-click) | Rechazar (con reason)
 *   - approved     → Marcar pagado (ONE-CLICK, Sprint 52) | Marcar fallido (con reason)
 *   - paid/rejected/failed/processing → solo view
 *
 * Diferencia clave con deposits:
 *   - Approve NO mueve saldo (solo cambia status). El hold ya existe
 *     desde la creación del withdrawal.
 *   - mark-paid es la operación que efectivamente debita la wallet del
 *     user (consume el hold).
 *   - reject y mark-failed liberan el hold (le devuelven el saldo al
 *     user).
 */

'use client';

import { Ban, Check, Copy, FileText, Link2, Send, Unlink, X } from 'lucide-react';
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
import { hasPermission, useAuth } from '@/lib/auth-context';
import {
  useApproveWithdrawal,
  useMarkFailedWithdrawal,
  useMarkPaidWithdrawal,
  useRejectWithdrawal,
  useWithdrawalDetail,
  type WithdrawalStatus,
} from '@/lib/hooks/use-withdrawals';
import {
  useMatchBankTransactionWithdrawal,
  useUnmatchBankTransaction,
  useUnmatchedForAmount,
  type BankTransaction,
} from '@/lib/hooks/use-bank-transactions';
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
  pending: 'Pendiente',
  approved: 'Aprobado',
  processing: 'Procesando',
  paid: 'Pagado',
  rejected: 'Rechazado',
  failed: 'Fallido',
};

interface WithdrawalDetailDrawerProps {
  withdrawalId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WithdrawalDetailDrawer({
  withdrawalId,
  open,
  onOpenChange,
}: WithdrawalDetailDrawerProps) {
  const { user: actor } = useAuth();
  const canApprove = hasPermission(actor, 'withdrawals.approve');
  const canReject = hasPermission(actor, 'withdrawals.reject');
  const canProcess = hasPermission(actor, 'withdrawals.process');
  const { data, isLoading, isError } = useWithdrawalDetail(withdrawalId);
  const approve = useApproveWithdrawal(withdrawalId);
  const reject = useRejectWithdrawal(withdrawalId);
  const markPaid = useMarkPaidWithdrawal(withdrawalId);
  const markFailed = useMarkFailedWithdrawal(withdrawalId);

  const [confirmApprove, setConfirmApprove] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [markFailedOpen, setMarkFailedOpen] = useState(false);

  const status = data?.withdrawal.status;
  // Sólo mostramos las acciones si el actor tiene el perm — el backend
  // rechaza igual, pero acá evitamos que el operador pierda tiempo abriendo
  // un modal para chocarse con 403.
  const isApprovable = status === 'pending' && (canApprove || canReject);
  const isPayable = status === 'approved' && canProcess;
  const isAnyPending =
    approve.isPending || reject.isPending || markPaid.isPending || markFailed.isPending;
  // Sprint 51: markPaid requiere outgoing bank_tx asociada.
  const hasOutgoingBankTx = !!data?.withdrawal.bankTransactionId;

  const handleApprove = async () => {
    try {
      await approve.mutateAsync();
      toast.success('Retiro aprobado', {
        description: 'Ahora podés marcar como pagado.',
      });
      setConfirmApprove(false);
    } catch (err) {
      toast.error('No se pudo aprobar', { description: mapServerError(err) });
    }
  };

  const handleReject = async (reason: string) => {
    try {
      await reject.mutateAsync({ reason });
      toast.success('Retiro rechazado', {
        description: 'El hold fue liberado y el usuario notificado.',
      });
      setRejectOpen(false);
    } catch (err) {
      toast.error('No se pudo rechazar', { description: mapServerError(err) });
    }
  };

  /**
   * Sprint 52 (decisión dueño): mark-paid es ONE-CLICK, sin modal. El
   * backend auto-genera la paidExternalRef; la outgoing bank_tx (con su
   * comprobante) ya debe estar matcheada.
   */
  const handleMarkPaid = async () => {
    try {
      await markPaid.mutateAsync();
      toast.success('Retiro marcado como pagado', {
        description: 'El saldo del usuario fue debitado.',
      });
    } catch (err) {
      toast.error('No se pudo marcar como pagado', {
        description: mapServerError(err),
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
    } catch (err) {
      toast.error('No se pudo marcar como fallido', {
        description: mapServerError(err),
      });
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
        title={
          data ? `Retiro · ${data.withdrawal.amountChips} FICHAS` : 'Cargando…'
        }
        subtitle={
          data
            ? `#${data.withdrawal.id.slice(0, 13)}…`
            : withdrawalId?.slice(0, 13)
        }
        footer={
          isApprovable ? (
            <>
              <Button
                variant="secondary"
                size="md"
                onClick={() => setRejectOpen(true)}
                disabled={isAnyPending}
              >
                <Ban className="size-3.5" />
                Rechazar
              </Button>
              {confirmApprove ? (
                <Button
                  variant="primary"
                  size="md"
                  onClick={handleApprove}
                  disabled={isAnyPending}
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
                      Confirmar
                    </>
                  )}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => setConfirmApprove(true)}
                  disabled={isAnyPending}
                >
                  <Check className="size-3.5" />
                  Aprobar
                </Button>
              )}
            </>
          ) : isPayable ? (
            <>
              <Button
                variant="secondary"
                size="md"
                onClick={() => setMarkFailedOpen(true)}
                disabled={isAnyPending}
              >
                <X className="size-3.5" />
                Marcar fallido
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={handleMarkPaid}
                disabled={isAnyPending || !hasOutgoingBankTx}
                className="bg-[var(--color-success)] hover:bg-[#166534]"
                title={
                  !hasOutgoingBankTx
                    ? 'El empleado debe cargar la transferencia saliente y matchearla antes de marcar pagado'
                    : undefined
                }
              >
                <Send className="size-3.5" />
                Marcar pagado
              </Button>
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
            hint="withdrawal_detail"
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
                <Badge variant={STATUS_VARIANT[data.withdrawal.status]} dot>
                  {STATUS_LABEL[data.withdrawal.status]}
                </Badge>
              </div>
              <div className="flex items-baseline gap-2 pt-3 border-t border-[var(--color-border)]">
                <span className="font-display text-3xl tabular-nums tracking-tight">
                  {data.withdrawal.amountChips}
                </span>
                <span className="text-xs font-mono text-[var(--color-fg-subtle)] uppercase tracking-[0.14em]">
                  fichas
                </span>
              </div>
              <div className="text-[12px] text-[var(--color-fg-muted)]">
                Equivalente:{' '}
                <span className="font-mono text-[var(--color-fg)]">
                  {data.withdrawal.amountFiat} {data.withdrawal.currencyFiat}
                </span>
              </div>
              {data.withdrawal.reason && (
                <div className="pt-3 border-t border-[var(--color-border)]">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] mb-1">
                    Motivo
                  </div>
                  <div className="text-[12px] text-[var(--color-fg)]">
                    {data.withdrawal.reason}
                  </div>
                </div>
              )}
            </section>

            {/* Detalle */}
            <section className="flex flex-col gap-3">
              <SectionHeader label="Detalle" />
              <DetailRow
                label="Usuario"
                value={
                  data.withdrawal.userDisplayName ??
                  data.withdrawal.userUsername ??
                  data.withdrawal.userId.slice(0, 13) + '…'
                }
              />
              <DetailRow
                label="@username"
                value={data.withdrawal.userUsername ?? '—'}
                mono
              />
              <DetailRow
                label="Método"
                value={
                  data.withdrawal.methodName ?? data.withdrawal.methodCode ?? '—'
                }
              />
              <DetailRow
                label="Tipo"
                value={methodTypeLabel(data.withdrawal.targetAccount)}
              />
              <DetailRow
                label="Cuenta destino"
                valueNode={
                  <TargetAccountBlock account={data.withdrawal.targetAccount} />
                }
              />
              <DetailRow
                label="ID de hold"
                value={
                  data.withdrawal.holdId
                    ? data.withdrawal.holdId.slice(0, 13) + '…'
                    : '—'
                }
                mono
              />
              <DetailRow
                label="Ref. pago"
                value={data.withdrawal.paidExternalRef ?? '—'}
                mono
              />
              <DetailRow
                label="Creado"
                value={formatDateTime(data.withdrawal.createdAt)}
                mono
              />
              <DetailRow
                label="Actualizado"
                value={formatDateTime(data.withdrawal.updatedAt)}
                mono
              />
              {data.withdrawal.approvedAt && (
                <DetailRow
                  label="Aprobado"
                  value={formatDateTime(data.withdrawal.approvedAt)}
                  mono
                />
              )}
              {data.withdrawal.paidAt && (
                <DetailRow
                  label="Pagado"
                  value={formatDateTime(data.withdrawal.paidAt)}
                  mono
                />
              )}
            </section>

            {/* Sprint 51: Matchear con transferencia bancaria SALIENTE.
                Solo visible cuando el withdrawal está approved y aún sin
                bank_tx asociada — la condición de poder "marcar pagado". */}
            {isPayable && (
              <OutgoingBankTxMatcher
                withdrawalId={data.withdrawal.id}
                amount={data.withdrawal.amountFiat}
                bankTransactionId={data.withdrawal.bankTransactionId ?? null}
              />
            )}

            {/* Wallet tx (cuando ya se procesó) */}
            {data.walletTx && (
              <section className="flex flex-col gap-3">
                <SectionHeader label="Movimiento de fichas" />
                <DetailRow
                  label="Tipo"
                  value={prettifyKey(data.walletTx.type)}
                />
                <DetailRow label="Monto" value={data.walletTx.amount} mono />
                <DetailRow
                  label="Saldo posterior"
                  value={data.walletTx.balanceAfter}
                  mono
                />
                <DetailRow
                  label="Fecha"
                  value={formatDateTime(data.walletTx.createdAt)}
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
        warning="Usá esto si la transferencia bancaria falló (rebote, datos incorrectos, etc.). El usuario podrá reintentar el retiro."
        confirmLabel="Marcar como fallido"
        confirmIcon={<X className="size-3.5" />}
        reasonPlaceholder="Ej: Error del banco intermediario — código E-503."
        onConfirm={handleMarkFailed}
        isPending={markFailed.isPending}
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
    <div className="grid grid-cols-[110px_1fr] items-start gap-3">
      <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] pt-1">
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
 * método legible según la forma de `targetAccount` (el server guarda shape
 * libre: bank_transfer → cbu/alias/beneficiario, crypto → network/address).
 */
function methodTypeLabel(account: Record<string, unknown>): string {
  if (account.cbu || account.alias) return 'Transferencia bancaria';
  if (account.network || account.address) return 'Cripto';
  return 'Otra';
}

/** Devuelve los pares label→valor legibles de la cuenta destino. */
function targetFields(account: Record<string, unknown>): { label: string; value: string }[] {
  const labelMap: Record<string, string> = {
    cbu: 'CBU / CVU',
    alias: 'Alias',
    beneficiario: 'Titular',
    network: 'Red',
    address: 'Address',
  };
  const result: { label: string; value: string }[] = [];
  for (const [key, v] of Object.entries(account)) {
    // Solo primitivos — un objeto anidado se ve en el JSON técnico.
    const text =
      typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
        ? String(v)
        : null;
    if (!text) continue;
    result.push({ label: labelMap[key] ?? prettifyKey(key), value: text });
  }
  return result;
}

function prettifyKey(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Cuenta destino legible: filas label→valor con botón de copiar en cada
 * una. El JSON técnico queda colapsado como fallback.
 */
function TargetAccountBlock({ account }: { account: Record<string, unknown> }) {
  const fields = targetFields(account);
  if (fields.length === 0) {
    return <span className="text-[13px] text-[var(--color-fg-muted)]">—</span>;
  }
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      {fields.map((f) => (
        <div key={f.label} className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
            {f.label}
          </span>
          <CopyValue value={f.value} />
        </div>
      ))}
      <details className="text-[12px] text-[var(--color-fg-muted)] mt-0.5">
        <summary className="cursor-pointer hover:text-[var(--color-fg)] flex items-center gap-1 transition-colors">
          <FileText className="size-3" />
          Ver JSON técnico
        </summary>
        <pre className="mt-2 p-2 bg-[var(--color-bg)] border border-[var(--color-border)] font-mono text-[11px] overflow-x-auto whitespace-pre-wrap break-all">
          {JSON.stringify(account, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* ignore */
        }
      }}
      title="Copiar"
      className={cn(
        'group flex items-center gap-2 w-full px-2 py-1 min-w-0',
        'bg-[var(--color-bg)] border border-[var(--color-border)]',
        'hover:border-[var(--color-accent-border)] transition-colors',
      )}
    >
      <span className="truncate font-mono text-[12px] text-[var(--color-fg)] break-all">
        {value}
      </span>
      {copied ? (
        <Check className="size-3 text-[var(--color-success)] shrink-0" />
      ) : (
        <Copy className="size-3 text-[var(--color-fg-subtle)] group-hover:text-[var(--color-accent-text)] shrink-0" />
      )}
    </button>
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
  if (err.status === 404) return 'El retiro ya no existe.';
  if (err.status === 409) return 'El retiro ya fue resuelto.';
  if (err.status === 403) return 'No tenés permiso para esta operación.';
  if (err.status === 400) {
    if (err.code === 'WITHDRAWAL_REQUIRES_BANK_TX') {
      return 'Necesitás matchear la transferencia bancaria saliente antes de marcar pagado.';
    }
    return err.message || 'Datos inválidos.';
  }
  return err.message || 'Error inesperado.';
}

// ──────────────────────────────────────────────────────────────────────
// Sprint 51: OutgoingBankTxMatcher — selector + match con override
// Mismo patrón que BankTxMatcher (deposits) pero para retiros.
// ──────────────────────────────────────────────────────────────────────

function OutgoingBankTxMatcher({
  withdrawalId,
  amount,
  bankTransactionId,
}: {
  withdrawalId: string;
  amount: string;
  bankTransactionId: string | null;
}) {
  const [includeAll, setIncludeAll] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const { data: candidates, isLoading } = useUnmatchedForAmount(
    amount,
    includeAll,
    'outgoing',
    // Fase B: mientras el drawer está abierto, refetch cada 10s para que la
    // transferencia cargada por el empleado aparezca sola.
    { refetchInterval: 10_000 },
  );
  const match = useMatchBankTransactionWithdrawal();
  const unmatch = useUnmatchBankTransaction();

  if (bankTransactionId) {
    return (
      <section className="flex flex-col gap-3 p-4 bg-[var(--color-success-bg)] border border-[var(--color-success)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link2 className="size-4 text-[var(--color-success)]" />
            <span className="text-[12px] text-[var(--color-fg)] font-medium">
              Transferencia saliente matcheada
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
          Ya podés marcar el retiro como pagado.
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3 p-4 bg-[var(--color-bg)] border border-[var(--color-accent-border)] border-l-2 border-l-[var(--color-accent)]">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-accent-text)] font-medium flex items-center gap-1.5">
            <Link2 className="size-3" />
            Matchear con transferencia saliente
          </span>
          <span className="text-[10px] text-[var(--color-fg-subtle)]">
            Requerido antes de marcar pagado. Buscando monto:{' '}
            <span className="font-mono">{amount}</span>
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
          Sin transferencias salientes{includeAll ? '' : ` por $${amount}`}. Pedile
          al empleado que cargue la transferencia.
        </div>
      ) : candidates.data.length === 1 ? (
        // Fase B: un único candidato → sugerencia destacada, no match
        // silencioso. El cajero lo confirma con un click.
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-muted)] font-medium">
              Coincidencia encontrada
            </span>
            <span className="text-[10px] px-1.5 py-0.5 bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)] border border-[var(--color-accent)] font-medium">
              Sugerida
            </span>
          </div>
          <div className="p-1.5 bg-[var(--color-accent-subtle)] border border-[var(--color-accent)]">
            <OutgoingBankTxCandidate
              key={candidates.data[0]!.id}
              tx={candidates.data[0]!}
              withdrawalAmount={amount}
              overrideReason={overrideReason}
              onOverrideReasonChange={setOverrideReason}
              onMatch={async (override) => {
                try {
                  await match.mutateAsync({
                    bankTxId: candidates.data[0]!.id,
                    withdrawalId,
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
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 max-h-[280px] overflow-y-auto">
          {candidates.data.map((bt) => (
            <OutgoingBankTxCandidate
              key={bt.id}
              tx={bt}
              withdrawalAmount={amount}
              overrideReason={overrideReason}
              onOverrideReasonChange={setOverrideReason}
              onMatch={async (override) => {
                try {
                  await match.mutateAsync({
                    bankTxId: bt.id,
                    withdrawalId,
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

function OutgoingBankTxCandidate({
  tx,
  withdrawalAmount,
  overrideReason,
  onOverrideReasonChange,
  onMatch,
  disabled,
}: {
  tx: BankTransaction;
  withdrawalAmount: string;
  overrideReason: string;
  onOverrideReasonChange: (v: string) => void;
  onMatch: (override: boolean) => void | Promise<void>;
  disabled?: boolean;
}) {
  const amountsMatch = Number(tx.amount) === Number(withdrawalAmount);
  const [showOverride, setShowOverride] = useState(false);

  return (
    <div className="flex flex-col gap-2 p-2.5 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)]">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[12px] text-[var(--color-fg)] truncate">
            {tx.senderName ?? '(sin destinatario)'}
          </span>
          <div className="flex items-center gap-2 text-[10px] text-[var(--color-fg-subtle)]">
            {tx.bankAccount && <span className="font-mono">{tx.bankAccount}</span>}
            {tx.bankAccount && <span>·</span>}
            <span>
              {new Date(tx.receivedAt).toLocaleString('es-AR', {
                dateStyle: 'short',
                timeStyle: 'short',
              })}
            </span>
          </div>
        </div>
        <span
          className={cn(
            'font-mono text-[13px]',
            amountsMatch ? 'text-[var(--color-success)]' : 'text-[var(--color-warning)]',
          )}
        >
          −{tx.amount} {tx.currency}
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
