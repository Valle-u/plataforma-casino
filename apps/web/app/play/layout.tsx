/**
 * Player layout — protege rutas (redirige a /play/login si no hay sesión)
 * y monta el header del jugador.
 *
 * Diferencias con admin:
 *   - Sin sidebar — nav horizontal en el header (mobile-first).
 *   - Vibe consumer (rojo del DS + dorado sutil para "premium"), NO terminal.
 *   - Layout más aireado, content max-width 1100px.
 *   - Footer simple con links útiles + tenant info.
 *
 * Sesión: comparte el mismo `AuthProvider` que el admin (root layout).
 * Un user con perms de admin puede entrar a /play y navegar — la
 * separación es UX, no de identidad. La idea es que un admin pueda
 * "ver lo que ve el jugador" para soporte.
 */

'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { PlayerHeader } from '@/components/player/player-header';
import { useAuth } from '@/lib/auth-context';

export default function PlayerLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading } = useAuth();

  // El login page tiene su propia UI fullscreen y NO debe redirigir si no
  // hay user (justamente para eso es). El resto de /play/* sí está protegido.
  const isLoginPage = pathname === '/play/login';

  useEffect(() => {
    if (isLoginPage) return;
    if (!loading && !user) router.replace('/play/login');
  }, [user, loading, router, isLoginPage]);

  // El login page se renderiza sin el chrome (header/footer) y sin guard.
  if (isLoginPage) {
    return <>{children}</>;
  }

  // Loading state — evitamos flash de contenido protegido.
  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg)]">
        <div
          className="size-1 bg-[var(--color-accent)] animate-pulse"
          aria-label="Cargando"
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)]">
      <PlayerHeader />
      <main className="flex-1 overflow-auto">{children}</main>
      <PlayerFooter />
    </div>
  );
}

function PlayerFooter() {
  return (
    <footer className="border-t border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
      <div className="max-w-[1100px] mx-auto px-6 py-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-[11px] text-[var(--color-fg-subtle)]">
        <div className="flex items-center gap-4">
          <span className="font-display tracking-tight text-[var(--color-fg-muted)]">
            Plataforma Casino
          </span>
          <span className="uppercase tracking-[0.12em]">
            Juego responsable · +18
          </span>
        </div>
        <div className="flex items-center gap-4">
          <a href="/play" className="hover:text-[var(--color-fg)] transition-colors">
            Inicio
          </a>
          <a
            href="/play/wallet"
            className="hover:text-[var(--color-fg)] transition-colors"
          >
            Wallet
          </a>
          <a
            href="/play/bonuses"
            className="hover:text-[var(--color-fg)] transition-colors"
          >
            Bonos
          </a>
        </div>
      </div>
    </footer>
  );
}
