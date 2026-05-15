/**
 * Modal — Radix Dialog centrado.
 *
 * Distinto al Drawer (side panel right). Modal es para flows breves
 * y bloqueantes (crear user, confirmar acción crítica). Cierra con
 * Esc / overlay click / ✕ button.
 *
 * Ancho default 480px; props `size` para sm/md/lg.
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
          className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px]"
        />
        <Dialog.Content
          data-radix-modal-content=""
          className={cn(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'w-[calc(100%-2rem)]',
            SIZE_CLASS[size],
            'bg-[var(--color-bg-elevated)]',
            'border border-[var(--color-border-strong)]',
            'flex flex-col max-h-[90vh]',
            'focus:outline-none',
            className,
          )}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-[var(--color-border)]">
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
              className="size-7 shrink-0 flex items-center justify-center text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg-subtle)] transition-colors"
              aria-label="Cerrar"
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>

          {/* Body scrollable */}
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

          {/* Footer opcional */}
          {footer && (
            <div className="border-t border-[var(--color-border)] px-5 py-3 flex items-center justify-end gap-2">
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
