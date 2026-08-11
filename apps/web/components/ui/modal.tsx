/**
 * Modal — Radix Dialog centrado.
 *
 * Distinto al Drawer (side panel right). Modal es para flows breves
 * y bloqueantes (crear user, confirmar acción crítica). Cierra con
 * Esc / overlay click / ✕ button.
 *
 * Ancho default 480px; props `size` para sm/md/lg.
 *
 * Estilo admin-neutral: panel con sombra profunda en capas, accent
 * top-border, header con bg sutil, y transiciones suaves.
 */

'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_CLASS: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
};

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  className,
}: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          data-radix-dialog-overlay=""
          className="fixed inset-0 z-40 bg-black/70"
        />
        {/* Centrado por FLEXBOX (no por transform). Antes el modal se centraba
            con translate(-50%,-50%); la animación `modal-in` (globals.css) usa
            `transform: scale()`, que pisaba ese translate → el modal perdía el
            centrado y "saltaba"/temblaba en cada re-render al tipear. Con flex,
            `transform` queda LIBRE para la escala y el centrado nunca se mueve.
            pointer-events-none deja pasar el click al overlay; el Content lo
            re-habilita. */}
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none overflow-y-auto">
        <Dialog.Content
          data-radix-modal-content=""
          className={cn(
            'pointer-events-auto relative',
            'w-[calc(100%-2rem)]',
            SIZE_CLASS[size],
            'bg-[var(--color-bg-elevated)]',
            'border border-[var(--color-border-strong)]',
            'border-t-2 border-t-[var(--color-accent)]',
            'shadow-[0_8px_32px_rgba(0,0,0,0.5),0_2px_8px_rgba(0,0,0,0.3)]',
            'flex flex-col max-h-[90vh] supports-[height:1dvh]:max-h-[90dvh]',
            'focus:outline-none',
            className,
          )}
        >
          {/* Header — pt con safe-area para no quedar bajo el notch en
              iOS standalone (viewport-fit: cover). */}
          <div className="flex items-start justify-between gap-4 px-5 pt-[calc(1rem+env(safe-area-inset-top))] pb-4 bg-[var(--color-bg-subtle)]/50 border-b border-[var(--color-border)]">
            <div className="flex flex-col gap-1 min-w-0">
              <Dialog.Title className="font-display text-xl tracking-tight leading-none">
                {title}
              </Dialog.Title>
              {description && (
                <Dialog.Description className="text-[12px] text-[var(--color-fg-muted)] mt-1">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close
              className="size-7 shrink-0 flex items-center justify-center text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg-subtle)] rounded transition-colors"
              aria-label="Cerrar"
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>

          {/* Body scrollable */}
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

          {/* Footer opcional — pb con safe-area (home indicator) y wrap
              para que dos botones no desborden en pantallas angostas. */}
          {footer && (
            <div className="border-t border-[var(--color-border)] bg-[var(--color-bg-subtle)]/30 px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] flex items-center justify-end gap-2 flex-wrap">
              {footer}
            </div>
          )}
        </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
