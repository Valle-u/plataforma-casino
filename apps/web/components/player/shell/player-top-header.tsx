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
import { useScrolled } from '@/lib/hooks/use-scrolled';
import { cn } from '@/lib/cn';
import { UserMenu } from './user-menu';
import { NotificationsDropdown } from '@/components/player/notifications-dropdown';

export function PlayerTopHeader() {
  const { user, openLoginModal, openRegisterModal } = useAuth();
  const pathname = usePathname();
  const scrolled = useScrolled();

  const isHome = pathname === '/play';
  // Transparente solo arriba de todo del home; en cuanto te movés, sólido.
  // Sin esto, al volverse fijo el header flota SIN fondo sobre el contenido
  // y se ve todo encimado.
  const floating = isHome && !scrolled;

  return (
    <header
      className={cn(
        // `relative` para el scrim. El `sticky` vive en el wrapper de
        // `app/play/layout.tsx`: un sticky solo se pega dentro de su padre, y
        // ese wrapper mide lo mismo que el header.
        //
        // Sin `transition-colors` a propósito — ver el aviso en
        // `use-scrolled.ts`.
        'relative flex h-16 w-full items-center gap-3.5 px-6',
        floating
          ? 'bg-transparent'
          : 'border-b border-[var(--color-border)] bg-[var(--color-bg)]/80 backdrop-blur',
      )}
    >
      {/* Scrim de legibilidad solo mientras flota sobre el banner. */}
      {floating && (
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
