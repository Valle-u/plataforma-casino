/**
 * ActionSheet — bottom sheet iOS-style para menús de acciones en mobile.
 *
 * Usa Radix Dialog. Desliza desde abajo con rounded-t, grabber handle,
 * header opcional y safe-area bottom para la home indicator de iPhone.
 * Cada ítem de acción debe tener tap target >= 44px.
 *
 * Contraste con Drawer: Drawer es un panel lateral (480px desktop /
 * fullscreen mobile); ActionSheet es un menú contextual desde abajo,
 * solo para pantallas táctiles.
 */

'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface ActionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  /** Footer fijo al pie (ej. botón Cancelar) — respeta safe-area bottom. */
  footer?: ReactNode;
  className?: string;
}

export function ActionSheet({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
  footer,
  className,
}: ActionSheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px]" />
        <Dialog.Content
          data-radix-dialog-content=""
          className={cn(
            'fixed left-0 right-0 bottom-0 z-50',
            'max-h-[85dvh] flex flex-col',
            'bg-[var(--color-bg-elevated)]',
            'rounded-t-2xl border-t border-[var(--color-border)]',
            'shadow-[0_-12px_40px_rgba(0,0,0,0.45)]',
            'focus:outline-none',
            // Gateado por data-state (Radix): la animación no se re-dispara en
            // cada re-render mientras está abierto.
            'data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom',
            'data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom',
            'duration-250',
            className,
          )}
        >
          {/* Grabber handle */}
          <div className="flex justify-center pt-2.5 pb-1 shrink-0">
            <div className="h-1 w-9 rounded-full bg-[var(--color-fg-subtle)]/40" />
          </div>

          {title && (
            <div className="px-5 pb-3 pt-1 shrink-0">
              <Dialog.Title className="font-display text-lg tracking-tight leading-none">
                {title}
              </Dialog.Title>
              {subtitle && (
                <Dialog.Description className="text-[12px] text-[var(--color-fg-muted)] font-mono mt-1">
                  {subtitle}
                </Dialog.Description>
              )}
            </div>
          )}

          {/* Body scrollable */}
          <div className="flex-1 overflow-y-auto px-2 pb-4">{children}</div>

          {footer && (
            <div className="border-t border-[var(--color-border)] bg-[var(--color-bg-subtle)]/30 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shrink-0">
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
