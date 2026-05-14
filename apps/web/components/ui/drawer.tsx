/**
 * Drawer — side panel desde la derecha. Usa Radix Dialog como base.
 *
 * Pattern: row click → drawer abre con detalle. Esc / overlay click /
 * X button cierra. Ancho fijo 480px desktop, fullscreen mobile.
 *
 * Anti-modal: no bloquea visualmente la lista — overlay con opacity
 * baja para que el contexto se mantenga visible.
 */

'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Footer fijo al pie del drawer (acciones). */
  footer?: ReactNode;
  className?: string;
}

export function Drawer({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
  footer,
  className,
}: DrawerProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          data-radix-dialog-overlay=""
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[1px]"
        />
        <Dialog.Content
          data-radix-dialog-content=""
          className={cn(
            'fixed right-0 top-0 bottom-0 z-50',
            'w-full sm:max-w-[480px]',
            'bg-[var(--color-bg-elevated)]',
            'border-l border-[var(--color-border-strong)]',
            'flex flex-col',
            'focus:outline-none',
            className,
          )}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-[var(--color-border)]">
            <div className="flex flex-col gap-1 min-w-0">
              <Dialog.Title className="font-display text-xl tracking-tight leading-none truncate">
                {title}
              </Dialog.Title>
              {subtitle && (
                <Dialog.Description className="text-[12px] text-[var(--color-fg-muted)] font-mono truncate">
                  {subtitle}
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
