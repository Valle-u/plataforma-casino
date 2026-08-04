/**
 * ReceiptLightbox — viewer fullscreen del comprobante (Sprint 55.x).
 *
 * En desktop el comprobante abre en pestaña nueva (ReceiptQuickPeek /
 * ReceiptSection del drawer). En mobile saltar de app en app (Safari → pestaña
 * nueva) rompe el flow de revisión, así que acá lo mostramos fullscreen con
 * overlay negro + safe areas + botón para abrir en pestaña (zoom real).
 *
 * Solo imágenes. Si el storageKey/URL termina en .pdf lo tratamos como PDF
 * y abrimos externo (no hay viewer inline).
 */
'use client';

import { ExternalLink, FileText, X } from 'lucide-react';
import { cn } from '@/lib/cn';

interface ReceiptLightboxProps {
  url: string | null;
  storageKey: string | null;
  open: boolean;
  onClose: () => void;
}

export function ReceiptLightbox({
  url,
  storageKey,
  open,
  onClose,
}: ReceiptLightboxProps) {
  if (!open || !url) return null;

  const lower = (storageKey ?? url).toLowerCase();
  const isPdf = lower.endsWith('.pdf');

  return (
    <div
      className="fixed inset-0 z-[120] bg-black/95 flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label="Comprobante"
      onClick={onClose}
    >
      {/* Header: título + abrir en pestaña + cerrar */}
      <div className="flex items-center justify-between gap-3 px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-4 shrink-0">
        <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium">
          Comprobante
        </span>
        <div className="flex items-center gap-2">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 px-2.5 h-9 text-[11px] uppercase tracking-[0.08em] font-medium bg-[var(--color-bg-subtle)] text-[var(--color-fg)] border border-[var(--color-border-strong)] hover:border-[var(--color-accent)] transition-colors"
            title="Abrir en pestaña nueva (zoom real)"
          >
            <ExternalLink className="size-3.5" />
            Abrir
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar comprobante"
            className="size-10 flex items-center justify-center text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg-subtle)] rounded transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>
      </div>

      {/* Imagen/PDF */}
      <div className="flex-1 flex items-center justify-center px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] min-h-0">
        {isPdf ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'flex flex-col items-center gap-3 px-8 py-10 text-center',
              'bg-[var(--color-bg-elevated)] border border-dashed border-[var(--color-border-strong)]',
            )}
          >
            <FileText className="size-10 text-[var(--color-fg-muted)]" />
            <span className="text-[13px] text-[var(--color-fg)]">
              Documento PDF — tocá para abrirlo
            </span>
            <span className="text-[11px] text-[var(--color-fg-subtle)]">
              Se abre en una pestaña nueva
            </span>
          </a>
        ) : (
          <img
            src={url}
            alt="Comprobante"
            onClick={(e) => e.stopPropagation()}
            className="max-w-full max-h-full object-contain select-none"
            draggable={false}
          />
        )}
      </div>
    </div>
  );
}
