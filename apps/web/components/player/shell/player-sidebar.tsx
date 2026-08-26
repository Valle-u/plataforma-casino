'use client';

/**
 * PlayerSidebar — columna izquierda del shell del jugador (rediseño lobby 4a).
 *
 * Arriba: wordmark + bloque de billetera (auth) o tarjeta de registro (guest).
 * Nav agrupado: JUGAR (Casino, Todos los juegos, categorías con conteo) y
 * MI DINERO (Depósitos, Retiros, Mi cuenta — solo auth). Sin tarjeta VIP.
 *
 * Cero back nuevo: el saldo/bono salen de `useMyWallet` y los conteos de
 * `useGameFacets` (los mismos datos que ya consume el lobby).
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CreditCard,
  Gamepad2,
  Home,
  Landmark,
  LogIn,
  UserPlus,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { BrandWordmark } from '@/components/brand/brand-wordmark';
import { useAuth } from '@/lib/auth-context';
import { useMyWallet } from '@/lib/hooks/use-wallet';
import { useGameFacets, type GameCategory } from '@/lib/hooks/use-games';
import { useTenantInfo } from '@/lib/hooks/use-tenant-branding';
import { cn } from '@/lib/cn';

const arsFmt = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// Color del punto de cada categoría (espejo de CategoriesRow).
const CATEGORY_COLOR: Record<GameCategory, string> = {
  slots: 'var(--color-accent)',
  live: '#e0567b',
  crash: 'var(--color-success)',
  table: '#5b8def',
  mini: '#f0a020',
};
const CATEGORY_LABEL: Record<GameCategory, string> = {
  slots: 'Slots',
  live: 'En vivo',
  crash: 'Crash',
  table: 'Mesa',
  mini: 'Mini',
};
const CATEGORY_ORDER: GameCategory[] = ['slots', 'live', 'crash', 'table', 'mini'];

interface IconItem {
  kind: 'icon';
  label: string;
  href: string;
  icon: LucideIcon;
  exact?: boolean;
  count?: number;
}
interface DotItem {
  kind: 'dot';
  label: string;
  href: string;
  color: string;
  count: number;
}
type NavItem = IconItem | DotItem;

function itemActive(pathname: string, item: NavItem): boolean {
  if (item.kind === 'icon' && item.exact) return pathname === item.href;
  const base = item.href.split('?')[0]!;
  return pathname === base || pathname.startsWith(base + '/');
}

export function PlayerSidebar() {
  const pathname = usePathname();
  const { user, openLoginModal, openRegisterModal } = useAuth();
  const wallet = useMyWallet();
  const facets = useGameFacets();
  const tenantInfo = useTenantInfo();
  const branding = tenantInfo.data?.branding;
  const designBrand = tenantInfo.data?.design?.brand as { logoUrl?: string } | undefined;
  const logoUrl = branding?.logoUrl || designBrand?.logoUrl;

  const total = facets.data?.total ?? 0;
  const countByCat = new Map<GameCategory, number>();
  for (const c of facets.data?.categories ?? []) {
    if (c.count > 0) countByCat.set(c.category, c.count);
  }

  // Grupo JUGAR: Casino + Todos los juegos + categorías con juegos.
  const playItems: NavItem[] = [
    { kind: 'icon', label: 'Casino', href: '/play', icon: Home, exact: true },
    {
      kind: 'icon',
      label: 'Todos los juegos',
      href: '/play/lobby',
      icon: Gamepad2,
      count: total || undefined,
    },
    ...CATEGORY_ORDER.filter((c) => countByCat.has(c)).map<NavItem>((c) => ({
      kind: 'dot',
      label: CATEGORY_LABEL[c],
      href: `/play/lobby?category=${c}`,
      color: CATEGORY_COLOR[c],
      count: countByCat.get(c)!,
    })),
  ];

  const moneyItems: NavItem[] = [
    { kind: 'icon', label: 'Depósitos', href: '/play/deposits', icon: CreditCard },
    { kind: 'icon', label: 'Retiros', href: '/play/withdrawals', icon: Landmark },
    { kind: 'icon', label: 'Mi cuenta', href: '/play/account', icon: UserRound },
  ];

  const available =
    wallet.data?.balance == null
      ? null
      : Math.max(
          0,
          Number(wallet.data.balance) - Number(wallet.data.lockedBalance ?? '0'),
        );
  const bonus =
    wallet.data?.bonusBalance == null ? null : Number(wallet.data.bonusBalance);

  return (
    <aside className="sticky top-0 flex h-screen w-[248px] shrink-0 flex-col overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
      {/* Wordmark */}
      <div className="px-5 pt-5 pb-4">
        <Link href="/play" className="block">
          <BrandWordmark size="sm" src={logoUrl} />
        </Link>
      </div>

      {/* Billetera (auth) o CTA de registro (guest) */}
      <div className="px-3">
        {user ? (
          <div className="flex flex-col gap-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-bg)] p-3.5">
            <div className="flex flex-col gap-1">
              <span className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-[var(--color-fg-subtle)]">
                Saldo disponible
              </span>
              <span className="font-display text-[25px] font-bold leading-none tabular-nums text-[var(--color-fg)]">
                {available == null ? '—' : `$ ${arsFmt.format(available)}`}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-[var(--color-border)] pt-2.5">
              <span className="text-[11px] text-[var(--color-fg-muted)]">Bono jugable</span>
              <span className="text-[12px] font-medium tabular-nums text-[var(--color-accent-text)]">
                {bonus == null ? '—' : `$ ${arsFmt.format(bonus)}`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/play/deposits?new=1"
                className="flex h-[34px] flex-1 items-center justify-center gap-1.5 rounded-[var(--radius)] text-[13px] font-semibold text-[var(--color-accent-fg)]"
                style={{ background: 'var(--gradient-accent)' }}
              >
                <ArrowDownToLine className="size-4" />
                Depositar
              </Link>
              <Link
                href="/play/withdrawals?new=1"
                aria-label="Retirar"
                title="Retirar"
                className="grid size-[34px] shrink-0 place-items-center rounded-[var(--radius)] border border-[var(--color-border)] text-[var(--color-fg-muted)] transition-colors hover:border-[var(--color-accent-border)] hover:text-[var(--color-fg)]"
              >
                <ArrowUpFromLine className="size-4" />
              </Link>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-bg)] p-3.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-[13px] font-semibold text-[var(--color-fg)]">
                Sumate al juego
              </span>
              <span className="text-[11px] leading-snug text-[var(--color-fg-muted)]">
                Registrate y llevate tu bono de bienvenida.
              </span>
            </div>
            <button
              type="button"
              onClick={() => openRegisterModal()}
              className="flex h-[34px] items-center justify-center gap-1.5 rounded-[var(--radius)] text-[13px] font-semibold text-[var(--color-accent-fg)]"
              style={{ background: 'var(--gradient-accent)' }}
            >
              <UserPlus className="size-4" />
              Registrarse
            </button>
            <button
              type="button"
              onClick={() => openLoginModal()}
              className="flex h-[34px] items-center justify-center gap-1.5 rounded-[var(--radius)] border border-[var(--color-border)] text-[13px] font-medium text-[var(--color-fg)] transition-colors hover:border-[var(--color-accent-border)]"
            >
              <LogIn className="size-4" />
              Iniciar sesión
            </button>
          </div>
        )}
      </div>

      {/* Navegación agrupada */}
      <nav className="mt-4 flex flex-1 flex-col gap-4 px-3 pb-5">
        <NavGroup label="Jugar" items={playItems} pathname={pathname} />
        {user && <NavGroup label="Mi dinero" items={moneyItems} pathname={pathname} />}
      </nav>
    </aside>
  );
}

function NavGroup({
  label,
  items,
  pathname,
}: {
  label: string;
  items: NavItem[];
  pathname: string;
}) {
  return (
    <div>
      <span className="mb-1.5 block px-2 text-[9px] font-semibold uppercase tracking-[.2em] text-[var(--color-fg-subtle)]">
        {label}
      </span>
      <div className="flex flex-col gap-0.5">
        {items.map((item) => {
          const active = itemActive(pathname, item);
          return (
            <Link
              key={item.href + item.label}
              href={item.href}
              className={cn(
                'group relative flex items-center gap-2.5 rounded-[var(--radius)] px-2.5 py-2',
                'text-[13px] transition-all duration-150',
                active
                  ? 'text-[var(--color-fg)]'
                  : 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]',
              )}
              style={
                active
                  ? {
                      background: 'color-mix(in srgb, var(--color-accent) 9%, transparent)',
                      boxShadow: 'inset 3px 0 0 0 var(--color-accent)',
                    }
                  : undefined
              }
            >
              {item.kind === 'dot' ? (
                <span
                  className="size-[6px] shrink-0 rounded-full"
                  style={{
                    background: item.color,
                    boxShadow: active ? `0 0 8px ${item.color}` : `0 0 4px ${item.color}66`,
                  }}
                />
              ) : (
                <item.icon
                  size={15}
                  className="shrink-0"
                  style={{
                    color: active ? 'var(--color-accent)' : undefined,
                    filter: active ? 'drop-shadow(0 0 4px var(--color-accent))' : undefined,
                  }}
                />
              )}
              <span className="flex-1 truncate">{item.label}</span>
              {item.count != null && (
                <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-[var(--color-fg-subtle)]">
                  {item.count.toLocaleString('es-AR')}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
