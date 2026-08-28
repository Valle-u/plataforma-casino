'use client';

/**
 * PlayerTopHeader — header superior del shell del jugador (rediseño lobby 4a).
 *
 * En el HOME (/play) es translúcido y flota SOBRE el banner a sangre (sin fondo
 * ni borde, con un scrim sutil para legibilidad). En el resto de las páginas es
 * sólido, como antes. El saldo/depósito se mudaron al bloque de billetera del
 * sidebar; acá solo queda: campana + avatar (auth) o botones de login/registro
 * (guest). Sin chip de nivel VIP.
 *
 * El buscador global vivía acá y se quitó por decisión del dueño (2026-08-27):
 * no lo quiere en el header, aunque estuviera funcionando. Buscar juegos sigue
 * disponible desde el buscador propio del lobby (`/play/lobby`), que además es
 * el que recibía el término por `?q=`.
 */

import { usePathname } from 'next/navigation';
import { LogIn, UserPlus } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';
import { UserMenu } from './user-menu';
import { NotificationsDropdown } from '@/components/player/notifications-dropdown';

export function PlayerTopHeader() {
  const { user, openLoginModal, openRegisterModal } = useAuth();
  const pathname = usePathname();
  const isHome = pathname === '/play';

  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex h-16 w-full items-center gap-3.5 px-6',
        isHome
          ? 'bg-transparent'
          : 'border-b border-[var(--color-border)] bg-[var(--color-bg)]/80 backdrop-blur',
      )}
    >
      {/* Scrim de legibilidad solo en el home (sobre el banner claro). */}
      {isHome && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              'linear-gradient(180deg, rgba(10,0,8,.55) 0%, rgba(10,0,8,.18) 60%, transparent 100%)',
          }}
        />
      )}

      {/* Cluster derecho — único contenido del header desde que se quitó el
          buscador. El `ml-auto` lo mantiene alineado a la derecha. */}
      {user ? (
        <div className="ml-auto flex items-center gap-2">
          <NotificationsDropdown active={pathname === '/play/notifications'} pathname={pathname} />
          <UserMenu />
        </div>
      ) : (
        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => openLoginModal()}
            className="inline-flex h-9 items-center gap-2 rounded-[var(--radius)] border border-white/15 px-4 text-[13px] font-medium text-[var(--color-fg)] backdrop-blur-sm transition-colors hover:border-[var(--color-accent-border)]"
          >
            <LogIn className="size-4" />
            Iniciar sesión
          </button>
          <button
            type="button"
            onClick={() => openRegisterModal()}
            className="inline-flex h-9 items-center gap-2 rounded-[var(--radius)] px-4 text-[13px] font-semibold text-[var(--color-accent-fg)]"
            style={{ background: 'var(--gradient-accent)' }}
          >
            <UserPlus className="size-4" />
            Registrarse
          </button>
        </div>
      )}
    </header>
  );
}
