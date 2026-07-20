/**
 * ImpersonateBanner — Sprint 37.
 *
 * Banner compacto en el top de la pantalla cuando el actor está
 * impersonando a otro user. Se monta en el root layout.
 *
 * Visualmente: barra accent delgada (32px), fixed, con padding-top
 * en el body para que nada quede tapado.
 */

'use client';

import { LogOut, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

export function ImpersonateBanner() {
  const { user, stopImpersonating } = useAuth();
  if (!user?.impersonatedBy) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[60] h-8 bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
      role="alert"
    >
      <div className="max-w-[1600px] mx-auto px-4 h-full flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 min-w-0">
          <ShieldAlert className="size-3 shrink-0" />
          <span className="text-[11px] tracking-tight truncate">
            Impersonando <strong className="font-mono">@{user.username}</strong>
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            void stopImpersonating();
          }}
          className="inline-flex items-center gap-1 px-2 h-5 text-[10px] uppercase tracking-[0.06em] bg-[var(--color-bg)] text-[var(--color-fg)] hover:bg-[var(--color-bg-elevated)] transition-colors shrink-0"
        >
          <LogOut className="size-2.5" />
          Volver
        </button>
      </div>
    </div>
  );
}
