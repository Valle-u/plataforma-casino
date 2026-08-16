/**
 * HelpNote — cajita de ayuda "¿Cómo funciona?" estándar del panel.
 *
 * Rediseño 2026-08-16: cada sección explica cómo funciona en lenguaje simple.
 * Colapsable y ABIERTA por defecto; si el operador la plega, queda plegada
 * (se recuerda por `id` en localStorage). Misma forma/color en todas las
 * secciones para mantener la "paz visual".
 */
'use client';

import { ChevronDown, Info } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface HelpNoteProps {
  /** Único por sección — clave de persistencia del estado plegado. */
  id: string;
  /** Título del recuadro. Default: "¿Cómo funciona?". */
  title?: string;
  children: ReactNode;
}

export function HelpNote({ id, title = '¿Cómo funciona?', children }: HelpNoteProps) {
  const storageKey = `help-note.collapsed.${id}`;
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      setCollapsed(localStorage.getItem(storageKey) === '1');
    } catch {
      /* localStorage no disponible — queda abierta */
    }
  }, [storageKey]);

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(storageKey, next ? '1' : '0');
      } catch {
        /* noop */
      }
      return next;
    });
  };

  // Antes de montar renderizamos ABIERTA (igual que el SSR) para no romper la
  // hidratación; tras montar aplicamos el estado guardado.
  const isOpen = !mounted || !collapsed;

  return (
    <div className="border border-[var(--color-border)] bg-[var(--color-bg-subtle)]">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-[var(--color-bg)] transition-colors"
      >
        <Info className="size-4 shrink-0 text-[var(--color-accent-text)]" />
        <span className="flex-1 text-[13px] font-medium text-[var(--color-fg)]">
          {title}
        </span>
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-[var(--color-fg-muted)] transition-transform duration-150',
            !isOpen && '-rotate-90',
          )}
        />
      </button>
      {isOpen && (
        <div className="px-4 pb-3 text-[13px] text-[var(--color-fg-muted)] leading-relaxed">
          {children}
        </div>
      )}
    </div>
  );
}
