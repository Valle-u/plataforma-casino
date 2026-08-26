'use client';

/**
 * PlayerTopHeader — header superior del shell del jugador (rediseño lobby 4a).
 *
 * En el HOME (/play) es translúcido y flota SOBRE el banner a sangre (sin fondo
 * ni borde, con un scrim sutil para legibilidad). En el resto de las páginas es
 * sólido, como antes. El saldo/depósito se mudaron al bloque de billetera del
 * sidebar; acá solo queda: buscador + campana + avatar (auth) o botones de
 * login/registro (guest). Sin chip de nivel VIP.
 */

import { usePathname } from 'next/navigation';
import { LogIn, UserPlus, Search } from 'lucide-react';
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

      {/* Buscador (decorativo, igual que antes). */}
      <label className="flex h-[38px] min-w-0 max-w-[480px] flex-1 basis-[340px] items-center gap-2 rounded-[11px] border border-white/15 bg-[rgba(10,0,8,.45)] px-3 backdrop-blur-sm transition-colors duration-200 focus-within:border-[var(--color-accent-border)]">
        <Search size={16} className="shrink-0 text-[var(--color-fg-subtle)]" aria-hidden="true" />
        <input
          type="search"
          placeholder="Buscar juegos, proveedores…"
          aria-label="Buscar juegos, proveedores"
          className="min-w-0 flex-1 whitespace-nowrap bg-transparent text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] focus:outline-none"
        />
      </label>

      {/* Cluster derecho. */}
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
