/**
 * ImpersonateBanner — Sprint 37.
 *
 * Banner sticky en el top de la pantalla cuando el actor está
 * impersonando a otro user. Se monta en el root layout (siempre visible
 * mientras la flag `user.impersonatedBy` esté seteada).
 *
 * Click en "Volver" → `stopImpersonating()` del AuthContext restaura el
 * token original guardado en sessionStorage al iniciar la impersonate
 * + navega a `/dashboard`.
 *
 * Visualmente: barra accent gruesa arriba, sin tapar nada, fixed.
 */

'use client';

import { LogOut, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

export function ImpersonateBanner() {
  const { user, stopImpersonating } = useAuth();
  if (!user?.impersonatedBy) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[60] bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
      role="alert"
    >
      <div className="max-w-[1600px] mx-auto px-4 py-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <ShieldAlert className="size-4 shrink-0" />
          <span className="text-[12px] tracking-tight truncate">
            Estás impersonando a{' '}
            <strong className="font-mono">@{user.username}</strong>. Cada
            acción queda auditada.
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            void stopImpersonating();
          }}
          className="inline-flex items-center gap-1.5 px-2.5 h-7 text-[11px] uppercase tracking-[0.08em] bg-[var(--color-bg)] text-[var(--color-fg)] hover:bg-[var(--color-bg-elevated)] transition-colors shrink-0"
        >
          <LogOut className="size-3" />
          Volver
        </button>
      </div>
    </div>
  );
}
