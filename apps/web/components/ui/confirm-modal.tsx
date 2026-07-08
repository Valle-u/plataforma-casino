/**
 * ConfirmModal — modal genérico de confirmación SIN reason input.
 *
 * Para acciones que no exigen motivo escrito (e.g. "correr scan",
 * "confirmar duplicado", "marcar como leído"). El backend graba audit
 * con el actorUserId pero no necesita texto del usuario.
 *
 * Diferencias con `ConfirmWithReasonModal`:
 *   - NO usa react-hook-form ni Zod (no hay form).
 *   - Banner warning configurable + variant del botón configurable.
 *   - Footer con Cancelar + Confirmar — el confirm dispara `onConfirm`
 *     async y muestra spinner durante isPending.
 */

'use client';

import { ShieldAlert } from 'lucide-react';
import { type ReactNode } from 'react';
import { Button, type ButtonProps } from './button';
import { Modal } from './modal';

interface ConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** Banner amarillo/rojo opcional. Si no pasás nada, no se muestra. */
  warning?: string;
  /** Texto del CTA principal. */
  confirmLabel?: string;
  /** Icono opcional para el botón confirm. */
  confirmIcon?: ReactNode;
  /** Variant del botón confirm. Default 'primary'. Para destructive: 'danger'. */
  confirmVariant?: ButtonProps['variant'];
  /** Texto del botón cancelar. */
  cancelLabel?: string;
  onConfirm: () => Promise<void> | void;
  isPending?: boolean;
  /** Contenido extra (listas de efectos, detalles) bajo el banner warning. */
  children?: ReactNode;
}

export function ConfirmModal({
  open,
  onOpenChange,
  title,
  description,
  warning,
  confirmLabel = 'Confirmar',
  confirmIcon,
  confirmVariant = 'primary',
  cancelLabel = 'Cancelar',
  onConfirm,
  isPending,
  children,
}: ConfirmModalProps) {
  const handleConfirm = async () => {
    await onConfirm();
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="md"
      footer={
        <>
          <Button
            variant="secondary"
            size="md"
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={confirmVariant}
            size="md"
            type="button"
            onClick={handleConfirm}
            disabled={isPending}
          >
            {isPending ? (
              <>
                <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                Procesando…
              </>
            ) : (
              <>
                {confirmIcon}
                {confirmLabel}
              </>
            )}
          </Button>
        </>
      }
    >
      {warning && (
        <div className="flex items-start gap-3 px-3 py-2.5 border border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)] border-l-2 border-l-[var(--color-accent)]">
          <ShieldAlert className="size-4 text-[var(--color-accent-text)] mt-0.5 shrink-0" />
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-accent-text)] font-medium">
              Atención
            </span>
            <span className="text-[12px] text-[var(--color-fg)]">{warning}</span>
          </div>
        </div>
      )}
      {children}
    </Modal>
  );
}
