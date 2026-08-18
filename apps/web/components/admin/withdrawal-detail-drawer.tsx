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

import {
  ArrowUpFromLine,
  Ban,
  Check,
  Copy,
  ExternalLink,
  FileText,
  Link2,
  Send,
  Unlink,
  X,
} from 'lucide-react';
import Link from 'next/link';
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
          data
            ? `Retiro de ${data.withdrawal.userDisplayName || data.withdrawal.userUsername || 'jugador'}`
            : 'Cargando…'
        }
        header={
          data ? (
            <div className="flex items-start gap-3">
              <div className="size-10 shrink-0 rounded-[var(--radius-sm)] bg-[var(--color-danger-bg)] text-[var(--color-danger)] flex items-center justify-center">
                <ArrowUpFromLine className="size-5" />
              </div>
              <div className="flex flex-col gap-1.5 min-w-0">
                <span className="font-display text-lg leading-tight tracking-tight truncate">
                  Retiro de{' '}
                  {data.withdrawal.userDisplayName ||
                    data.withdrawal.userUsername ||
                    'jugador'}
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={STATUS_VARIANT[data.withdrawal.status]} dot>
                    {STATUS_LABEL[data.withdrawal.status]}
                  </Badge>
                  {data.withdrawal.status === 'approved' &&
                    !data.withdrawal.bankTransactionId && (
                      <Badge variant="warning">Sin transferir</Badge>
                    )}
                  {(data.withdrawal.methodName || data.withdrawal.methodCode) && (
                    <Badge variant="neutral">
                      {data.withdrawal.methodName ?? data.withdrawal.methodCode}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          ) : undefined
        }
        footer={
          isApprovable ? (
            <>
              <Button
                variant="danger-outline"
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
                  className="bg-[var(--color-success)] hover:brightness-110"
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
                variant="danger-outline"
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
                className="bg-[var(--color-success)] hover:brightness-110"
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
          <div className="flex flex-col gap-4">
            {/* Monto */}
            <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] p-4 flex items-end justify-between gap-4">
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-semibold">
                  Tenés que transferirle
                </span>
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-4xl leading-none tabular-nums tracking-tight">
                    {data.withdrawal.amountFiat}
                  </span>
                  <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
                    {data.withdrawal.currencyFiat}
                  </span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-semibold">
                  Fichas retenidas
                </span>
                <span className="font-mono text-sm text-[var(--color-fg-muted)]">
                  {data.withdrawal.amountChips}
                </span>
              </div>
            </div>

            {data.withdrawal.reason && (
              <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
                <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] mb-1">
                  Motivo
                </div>
                <div className="text-[12px] text-[var(--color-fg)]">
                  {data.withdrawal.reason}
                </div>
              </div>
            )}

            {/* Cuenta destino */}
            <section className="flex flex-col gap-2.5">
              <SectionHeader label="Cuenta destino" />
              <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
                <TargetAccountBlock account={data.withdrawal.targetAccount} />
              </div>
            </section>

            {/* Matchear con transferencia bancaria SALIENTE (approved sin bank_tx). */}
            {isPayable && (
              <OutgoingBankTxMatcher
                withdrawalId={data.withdrawal.id}
                amount={data.withdrawal.amountFiat}
                bankTransactionId={data.withdrawal.bankTransactionId ?? null}
              />
            )}

            {/* Detalle — nombres arriba, identificadores al final (copiables). */}
            <section className="flex flex-col gap-2.5">
              <SectionHeader label="Detalle" />
              <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] overflow-hidden flex flex-col">
                <DetailRow
                  label="Jugador"
                  value={
                    data.withdrawal.userDisplayName
                      ? `${data.withdrawal.userDisplayName} · @${data.withdrawal.userUsername ?? '?'}`
                      : data.withdrawal.userUsername
                        ? `@${data.withdrawal.userUsername}`
                        : '—'
                  }
                  href={`/users/${data.withdrawal.userId}`}
                />
                <DetailRow
                  label="Método"
                  value={data.withdrawal.methodName ?? data.withdrawal.methodCode ?? '—'}
                />
                <DetailRow
                  label="Ref. del pago"
                  value={data.withdrawal.paidExternalRef ?? '—'}
                />
                <DetailRow
                  label="Creado"
                  value={formatDateTime(data.withdrawal.createdAt)}
                />
                {data.withdrawal.approvedAt && (
                  <DetailRow
                    label="Aprobado"
                    value={formatDateTime(data.withdrawal.approvedAt)}
                  />
                )}
                {data.withdrawal.paidAt && (
                  <DetailRow
                    label="Pagado"
                    value={formatDateTime(data.withdrawal.paidAt)}
                  />
                )}
                <DetailRow label="ID del retiro" value={data.withdrawal.id} copy />
                {data.withdrawal.holdId && (
                  <DetailRow
                    label="ID de la retención"
                    value={data.withdrawal.holdId}
                    copy
                  />
                )}
              </div>
            </section>

            {/* Movimiento de fichas */}
            {data.walletTx && (
              <section className="flex flex-col gap-2.5">
                <SectionHeader label="Movimiento de fichas" />
                <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] overflow-hidden flex flex-col">
                  <DetailRow label="Tipo" value={prettifyKey(data.walletTx.type)} />
                  <DetailRow label="Monto" value={data.walletTx.amount} />
                  <DetailRow
                    label="Saldo después"
                    value={data.walletTx.balanceAfter}
                  />
                  <DetailRow
                    label="Fecha"
                    value={formatDateTime(data.walletTx.createdAt)}
                  />
                </div>
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
  href,
  copy,
  tone,
}: {
  label: string;
  value?: string;
  valueNode?: ReactNode;
  href?: string;
  copy?: boolean;
  tone?: 'default' | 'warning';
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--color-border)] last:border-b-0">
      <span className="w-[130px] shrink-0 text-[11px] text-[var(--color-fg-subtle)]">
        {label}
      </span>
      <div className="flex-1 min-w-0">
        {valueNode ?? (
          <span
            className={cn(
              'block font-mono text-[12.5px] truncate',
              tone === 'warning'
                ? 'text-[var(--color-warning)]'
                : 'text-[var(--color-fg)]',
            )}
            title={value}
          >
            {value}
          </span>
        )}
      </div>
      {copy && value && <CopyButton value={value} />}
      {href && (
        <Link
          href={href}
          className="shrink-0 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] transition-colors"
          title="Ver perfil"
        >
          <ExternalLink className="size-3.5" />
        </Link>
      )}
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        toast.success('Copiado');
      }}
      className="shrink-0 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] transition-colors"
      title="Copiar"
    >
      <Copy className="size-3.5" />
    </button>
  );
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
        <pre className="mt-2 p-2 rounded-[var(--radius-sm)] bg-[var(--color-bg)] border border-[var(--color-border)] font-mono text-[11px] overflow-x-auto whitespace-pre-wrap break-all">
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
        'group flex items-center gap-2 w-full px-2 py-1 min-w-0 rounded-[var(--radius-sm)]',
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
      timeZone: 'America/Argentina/Buenos_Aires',
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
    <section className="flex flex-col gap-3 p-4 rounded-[var(--radius-sm)] bg-[var(--color-info-bg)] border border-[var(--color-info)]/30">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-info)] font-medium flex items-center gap-1.5">
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
        <div className="text-[12px] text-[var(--color-fg-muted)] p-3 rounded-[var(--radius-sm)] bg-[var(--color-bg-subtle)] border border-dashed border-[var(--color-border)]">
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
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-info-bg)] text-[var(--color-info)] border border-[var(--color-info)]/40 font-medium">
              Sugerida
            </span>
          </div>
          <div className="p-1.5 rounded-[var(--radius-sm)] bg-[var(--color-info-bg)] border border-[var(--color-info)]/30">
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
    <div className="flex flex-col gap-2 p-2.5 rounded-[var(--radius-sm)] bg-[var(--color-bg-elevated)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)]">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[12px] text-[var(--color-fg)] truncate">
            {tx.senderName ?? '(sin destinatario)'}
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
            <span>
              {new Date(tx.receivedAt).toLocaleString('es-AR', {
                timeZone: 'America/Argentina/Buenos_Aires',
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
