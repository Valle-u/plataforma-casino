/**
 * DepositCardList — revisión de depósitos mobile-first (Sprint 55.x).
 *
 * Reemplaza a la tabla densa en viewports < lg. Cada depósito pendiente es
 * una tarjeta apilada con:
 *   - Monto grande (fichas + equivalente fiat).
 *   - Thumbnail del comprobante → tap abre ReceiptLightbox fullscreen.
 *   - Chip de estado del match con bank_tx.
 *   - Acciones full-width (tap targets >= 44px): Rechazar + Matchear/Aprobar.
 *
 * Flujo "modo cola": aprobar/rechazar no saca al operador del listado —
 * el card resuelto desaparece (invalidación de React Query) y el siguiente
 * queda al toque. El contador de la sesión da sensación de progreso.
 *
 * Desktop NO cambia: la tabla sigue en <lg>.
 */
'use client';

import {
  ChevronRight,
  ImageOff,
  Link2,
  Paperclip,
  Zap,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { DepositOriginBadge } from '@/components/admin/deposit-origin-badge';
import { MatchBankTxModal } from '@/components/admin/match-bank-tx-modal';
import { ReceiptLightbox } from '@/components/admin/receipt-lightbox';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmWithReasonModal } from '@/components/ui/confirm-with-reason-modal';
import { Select } from '@/components/ui/select';
import { isApiError } from '@/lib/api-client';
import {
  useApproveDeposit,
  useRejectDeposit,
  type DepositRow,
  type DepositStatus,
} from '@/lib/hooks/use-deposits';
import type { BonusDefinition } from '@/lib/hooks/use-bonuses';
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

interface DepositCardListProps {
  rows: DepositRow[];
  bonusDefs: BonusDefinition[];
  canApprove: boolean;
  /** Acciones de resolución (aprobación/rechazo) — solo en la cola. */
  showActions: boolean;
  /** Muestra la etiqueta de origen ("La Casa" / "Socio: X") — vista central. */
  showOrigin?: boolean;
  onOpenDetail: (id: string) => void;
}

export function DepositCardList({
  rows,
  bonusDefs,
  canApprove,
  showActions,
  showOrigin = false,
  onOpenDetail,
}: DepositCardListProps) {
  // Contador de la sesión — "resolviste N" para feedback de progreso.
  const [resolved, setResolved] = useState(0);
  const [lightbox, setLightbox] = useState<{
    url: string;
    storageKey: string | null;
  } | null>(null);

  const actions = canApprove && showActions;

  return (
    <div className="flex flex-col gap-3">
      {resolved > 0 && actions && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-[var(--radius-sm)] text-[12px] text-[var(--color-fg-muted)] bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
          <Zap className="size-3.5 text-[var(--color-success)]" />
          <span>
            Resolviste <span className="font-mono text-[var(--color-fg)]">{resolved}</span>{' '}
            {resolved === 1 ? 'depósito' : 'depósitos'} en esta sesión
          </span>
        </div>
      )}

      {rows.map((d) => (
        <DepositCard
          key={d.id}
          deposit={d}
          bonusDefs={bonusDefs}
          actions={actions}
          showOrigin={showOrigin}
          onOpenDetail={() => onOpenDetail(d.id)}
          onOpenLightbox={(url, storageKey) => setLightbox({ url, storageKey })}
          onResolved={() => setResolved((n) => n + 1)}
        />
      ))}

      <ReceiptLightbox
        url={lightbox?.url ?? null}
        storageKey={lightbox?.storageKey ?? null}
        open={!!lightbox}
        onClose={() => setLightbox(null)}
      />
    </div>
  );
}

function DepositCard({
  deposit,
  bonusDefs,
  actions,
  showOrigin,
  onOpenDetail,
  onOpenLightbox,
  onResolved,
}: {
  deposit: DepositRow;
  bonusDefs: BonusDefinition[];
  actions: boolean;
  showOrigin: boolean;
  onOpenDetail: () => void;
  onOpenLightbox: (url: string, storageKey: string | null) => void;
  onResolved: () => void;
}) {
  const approve = useApproveDeposit(deposit.id);
  const reject = useRejectDeposit(deposit.id);

  const hasMatch = !!deposit.bankTransactionId;
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [selectedBonusId, setSelectedBonusId] = useState('');
  const [matchOpen, setMatchOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  const isPending = approve.isPending || reject.isPending;
  const isReceiptImage = useMemo(() => {
    if (!deposit.receiptUrl) return false;
    const lower = (deposit.receiptStorageKey ?? deposit.receiptUrl).toLowerCase();
    return !lower.endsWith('.pdf');
  }, [deposit.receiptUrl, deposit.receiptStorageKey]);

  const handleApprove = async () => {
    if (!hasMatch) return;
    if (!confirmApprove) {
      setConfirmApprove(true);
      return;
    }
    try {
      const res = await approve.mutateAsync(selectedBonusId || undefined);
      toast.success('Depósito aprobado', {
        description: `${res.deposit.amountChips} fichas acreditadas.`,
      });
      setConfirmApprove(false);
      setSelectedBonusId('');
      onResolved();
    } catch (err) {
      toast.error('No se pudo aprobar', { description: mapQuickError(err) });
    }
  };

  const handleReject = async (reason: string) => {
    try {
      await reject.mutateAsync({ reason });
      toast.success('Depósito rechazado');
      setRejectOpen(false);
      onResolved();
    } catch (err) {
      toast.error('No se pudo rechazar', { description: mapQuickError(err) });
    }
  };

  return (
    <article
      className="flex flex-col gap-3 p-4 rounded-[var(--radius)] bg-[var(--color-bg-elevated)] border border-[var(--color-border)]"
    >
      {/* Status + tiempo */}
      <div className="flex items-center justify-between gap-2">
        <Badge variant={STATUS_VARIANT[deposit.status]} dot>
          {STATUS_LABEL[deposit.status]}
        </Badge>
        <span className="text-[10px] text-[var(--color-fg-subtle)] font-mono tabular-nums">
          {formatDateTime(deposit.createdAt)}
        </span>
      </div>

      {/* Monto */}
      <div className="flex flex-col gap-0.5">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-3xl tracking-tight tabular-nums">
            {deposit.amountChips}
          </span>
          <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
            fichas
          </span>
        </div>
      </div>

      {/* Origen */}
      {showOrigin && deposit.originKind && (
        <DepositOriginBadge origin={deposit} />
      )}

      {/* Usuario + método */}
      <div className="flex items-center justify-between gap-3 text-[12px]">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[var(--color-fg)] truncate">
            {deposit.userDisplayName ?? deposit.userUsername ?? '—'}
          </span>
          <span className="text-[10px] text-[var(--color-fg-subtle)] font-mono truncate">
            {deposit.userUsername ? `@${deposit.userUsername}` : deposit.userId.slice(0, 13) + '…'}
          </span>
        </div>
        <span className="font-mono text-[11px] text-[var(--color-fg-muted)] shrink-0">
          {deposit.methodCode ?? deposit.methodId.slice(0, 8)}
        </span>
      </div>

      {/* Comprobante + estado del match */}
      <div className="flex items-center gap-2">
        {deposit.receiptUrl ? (
          isReceiptImage ? (
            <button
              type="button"
              onClick={() => onOpenLightbox(deposit.receiptUrl!, deposit.receiptStorageKey)}
              className="relative h-20 w-28 shrink-0 overflow-hidden rounded-[var(--radius-sm)] bg-[var(--color-bg-subtle)] border border-[var(--color-border)] hover:border-[var(--color-accent)] transition-colors"
              aria-label="Ver comprobante"
            >
              <img
                src={deposit.receiptUrl}
                alt="Comprobante"
                className="h-full w-full object-cover"
                loading="lazy"
              />
              <span className="absolute inset-0 flex items-end justify-center bg-gradient-to-t from-black/60 to-transparent pb-1">
                <Paperclip className="size-3 text-white" />
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onOpenLightbox(deposit.receiptUrl!, deposit.receiptStorageKey)}
              className="h-10 px-3 flex items-center gap-2 rounded-[var(--radius-sm)] text-[11px] uppercase tracking-[0.08em] font-medium bg-[var(--color-bg-subtle)] text-[var(--color-fg-muted)] border border-[var(--color-border)] hover:border-[var(--color-accent)] transition-colors"
            >
              <Paperclip className="size-3.5" />
              Comprobante PDF
            </button>
          )
        ) : (
          <span className="inline-flex items-center gap-1.5 px-2 h-7 text-[10px] uppercase tracking-[0.08em] text-[var(--color-warning)] bg-[var(--color-warning-bg)] border border-[var(--color-warning)]">
            <ImageOff className="size-3" />
            Sin comprobante
          </span>
        )}

        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-2 h-7 text-[10px] uppercase tracking-[0.08em] font-medium border',
            hasMatch
              ? 'text-[var(--color-success)] bg-[var(--color-success-bg)] border-[var(--color-success)]'
              : 'text-[var(--color-fg-subtle)] bg-[var(--color-bg-subtle)] border-[var(--color-border)]',
          )}
        >
          <Link2 className="size-3" />
          {hasMatch ? 'Tx matcheada' : 'Sin match'}
        </span>
      </div>

      {/* Acciones */}
      {actions ? (
        <div className="flex flex-col gap-2">
          {confirmApprove && hasMatch && bonusDefs.length > 0 && (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
                Bono (opcional)
              </label>
              <Select
                value={selectedBonusId}
                onChange={(e) => setSelectedBonusId(e.target.value)}
                className="h-10 text-[14px]"
              >
                <option value="">Sin bono</option>
                {bonusDefs.map((bd) => {
                  const rawPct = bd.config.matchPct as number | undefined;
                  return (
                    <option key={bd.id} value={bd.id}>
                      {bd.name} ({rawPct ?? '?'}%)
                    </option>
                  );
                })}
              </Select>
            </div>
          )}

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
            {hasMatch ? (
              <Button
                variant="primary"
                size="md"
                onClick={handleApprove}
                disabled={isPending}
                className={cn(
                  'flex-1 h-12 text-[13px]',
                  confirmApprove && 'bg-[var(--color-success)] hover:bg-[#166534]',
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
            ) : (
              <Button
                variant="primary"
                size="md"
                onClick={() => setMatchOpen(true)}
                className="flex-1 h-12 text-[13px] bg-[var(--color-info-bg)] text-[var(--color-info)] border border-[var(--color-info)] hover:bg-[var(--color-info)] hover:text-black"
              >
                <Link2 className="size-3.5" />
                Matchear
              </Button>
            )}
          </div>

          {/* Footer del card: detalle */}
          <button
            type="button"
            onClick={onOpenDetail}
            className="flex items-center justify-center gap-1 h-10 text-[11px] uppercase tracking-[0.1em] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] transition-colors"
          >
            Ver detalle
            <ChevronRight className="size-3.5" />
          </button>
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
      <MatchBankTxModal
        deposit={deposit}
        open={matchOpen}
        onOpenChange={setMatchOpen}
      />
      <ConfirmWithReasonModal
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title="Rechazar depósito"
        description="El usuario será notificado y la operación queda en audit log."
        warning="El rechazo es definitivo. Si el usuario reabre el flow tendrá que crear un depósito nuevo."
        confirmLabel="Rechazar depósito"
        reasonPlaceholder="Ej: Comprobante ilegible — reenviá foto clara."
        onConfirm={handleReject}
        isPending={reject.isPending}
      />
    </article>
  );
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    // Sin coma entre fecha y hora → copia limpia a Excel.
    return d
      .toLocaleString('es-AR', {
        timeZone: 'America/Argentina/Buenos_Aires',
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
      .replace(',', '');
  } catch {
    return iso;
  }
}

function mapQuickError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.status === 400 && err.code === 'DEPOSIT_REQUIRES_BANK_TX') {
    return 'El deposit perdió el match — abrí el detalle y re-asignalo.';
  }
  if (err.status === 409) return 'Ya fue resuelto por otro operador.';
  return err.message || 'Error inesperado.';
}
