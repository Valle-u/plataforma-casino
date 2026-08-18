/**
 * Drawer — side panel desde la derecha. Usa Radix Dialog como base.
 *
 * Pattern: row click → drawer abre con detalle. Esc / overlay click /
 * X button cierra. Ancho fijo 480px desktop, fullscreen mobile.
 *
 * Anti-modal: no bloquea visualmente la lista — overlay con opacity
 * baja para que el contexto se mantenga visible.
 *
 * Estilo admin-neutral: accent left-border, gradiente sutil desde
 * el borde izquierdo, header con bg diferenciado, sombra layered.
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
  /**
   * Encabezado enriquecido (ícono + nombre + chips). Si se pasa, reemplaza
   * al bloque título/subtítulo; `title` se conserva para accesibilidad
   * (Radix exige un Dialog.Title). Ver handoff "Drawers detalle".
   */
  header?: ReactNode;
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
  header,
  children,
  footer,
  className,
}: DrawerProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          data-radix-dialog-overlay=""
          className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px]"
        />
        <Dialog.Content
          data-radix-dialog-content=""
          className={cn(
            'fixed right-0 top-0 bottom-0 z-50',
            'w-full sm:max-w-[480px]',
            'bg-[var(--color-bg-elevated)]',
            'border-l border-[var(--color-border-strong)]',
            'sm:rounded-l-[var(--radius-lg)] overflow-hidden',
            'shadow-[-8px_0_32px_rgba(0,0,0,0.4),-2px_0_8px_rgba(0,0,0,0.2)]',
            'flex flex-col',
            'focus:outline-none',
            'animate-in slide-in-from-right duration-250',
            className,
          )}
        >
          {/* Header — pt con safe-area para no quedar bajo el notch en
              iOS standalone (viewport-fit: cover). */}
          <div className="flex items-start justify-between gap-4 px-5 pb-4 pt-[calc(1rem+env(safe-area-inset-top))] bg-[var(--color-bg-subtle)]/50 border-b border-[var(--color-border)]">
            {header ? (
              <>
                <Dialog.Title className="sr-only">{title}</Dialog.Title>
                <div className="flex-1 min-w-0">{header}</div>
              </>
            ) : (
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
            )}
            <Dialog.Close
              className="size-8 shrink-0 flex items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-bg-subtle)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg-hover)] transition-colors"
              aria-label="Cerrar"
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>

          {/* Body scrollable */}
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

          {/* Footer opcional — pb con safe-area para la home indicator. */}
          {footer && (
            <div className="border-t border-[var(--color-border)] bg-[var(--color-bg-subtle)]/30 px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] flex items-center justify-end gap-2">
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
