/**
 * PlayerBottomNav — Sprint 51.11.
 *
 * Bottom navigation bar fija para mobile (< md). Patrón estándar de
 * apps consumer (Instagram, TikTok, casinos online tier-1): 5 íconos
 * grandes con label corto, tap target >= 44px, badge en activo.
 *
 * En desktop (>= md) NO se renderiza — la nav top del PlayerHeader
 * sirve. La separación se hace con `md:hidden`.
 *
 * Items elegidos:
 *   - Inicio (home/dashboard)
 *   - Casino (lobby)
 *   - Ruleta (centro destacado — premio diario, dopamine prime)
 *   - Wallet (saldo + tx)
 *   - Cuenta (settings + notifs + logout)
 *
 * Justificación de los 5: cubren 90% del flow del player típico —
 * jugar, ganar premio diario, ver saldo, gestionar cuenta. El resto
 * (deposits/withdrawals/bonuses/streak) se accede desde el dashboard
 * o submenús — no merecen botón propio en bottom nav (regla "10%-90%
 * de uso").
 *
 * Safe area: usamos `pb-[env(safe-area-inset-bottom)]` para evitar
 * que el home indicator de iOS pise el contenido.
 */

'use client';

import { Coins, Gauge, Home, Sparkles, User } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentType, SVGProps } from 'react';
import { cn } from '@/lib/cn';

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Si true, item central destacado (rueda/promo principal). */
  hero?: boolean;
}

const ITEMS: NavItem[] = [
  { href: '/play', label: 'Inicio', icon: Home },
  { href: '/play/lobby', label: 'Casino', icon: Gauge },
  { href: '/play/wheel', label: 'Ruleta', icon: Sparkles, hero: true },
  { href: '/play/wallet', label: 'Wallet', icon: Coins },
  { href: '/play/settings', label: 'Cuenta', icon: User },
];

export function PlayerBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      // Safe area + sticky bottom + z over content but below modals.
      className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-[var(--color-bg-elevated)] border-t border-[var(--color-border)] backdrop-blur-md"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      aria-label="Navegación principal"
    >
      <div className="flex items-stretch justify-around h-16 max-w-[600px] mx-auto">
        {ITEMS.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== '/play' && pathname.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex-1 flex flex-col items-center justify-center gap-0.5',
                'min-w-[44px] min-h-[44px]', // a11y touch target
                'transition-all duration-150',
                'relative',
                active
                  ? 'text-[var(--color-fg)]'
                  : 'text-[var(--color-fg-subtle)]',
              )}
              aria-current={active ? 'page' : undefined}
            >
              {/* Active indicator: línea accent arriba */}
              {active && (
                <span
                  className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-[var(--color-accent)]"
                  aria-hidden
                />
              )}

              {/* Item hero (centro) — icono más grande + glow */}
              {item.hero ? (
                <div
                  className={cn(
                    'relative flex items-center justify-center size-12 -mt-3 rounded-full',
                    'border-2 transition-all',
                    active
                      ? 'bg-[var(--color-accent)] border-[var(--color-accent)] text-[var(--color-accent-fg)] shadow-lg'
                      : 'bg-[var(--color-bg-elevated)] border-[var(--color-border-strong)] text-[var(--color-fg-muted)]',
                  )}
                  style={
                    active
                      ? { boxShadow: '0 0 20px var(--color-accent-glow)' }
                      : undefined
                  }
                >
                  <Icon className="size-5" />
                </div>
              ) : (
                <Icon
                  className={cn(
                    'size-5 transition-transform',
                    active && 'scale-110',
                  )}
                />
              )}
              <span
                className={cn(
                  'text-[10px] uppercase tracking-[0.06em] font-medium',
                  item.hero && !active && 'opacity-70',
                )}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
