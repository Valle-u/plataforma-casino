'use client';

/**
 * PlayerSidebar — columna izquierda del shell del jugador (Neón Milonga).
 *
 * Ancho fijo 248px, sticky al top, alto full viewport, flex column.
 * Wordmark TANGO arriba (Link a /play), navegación en 4 grupos en el medio y
 * tarjeta VIP Black dorada anclada al fondo (mt-auto, Link a /play/bonuses).
 * Marca el item activo con usePathname(): Casino se ilumina cuando la ruta es
 * exactamente '/play'; el resto cuando coincide o es subruta.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavItem {
  label: string;
  href: string;
  /** Color del dot + glow del item. */
  color: string;
  /** Casino usa match exacto; el resto match exacto o subruta. */
  exact?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    label: 'Explorar',
    items: [
      { label: 'Casino', href: '/play', color: 'var(--color-accent)', exact: true },
      { label: 'Juegos', href: '/play/lobby', color: 'var(--color-cyan)' },
    ],
  },
  {
    label: 'Mi dinero',
    items: [
      { label: 'Movimientos', href: '/play/wallet', color: 'var(--color-success)' },
      { label: 'Depósitos', href: '/play/deposits', color: 'var(--color-accent)' },
      { label: 'Retiros', href: '/play/withdrawals', color: 'var(--color-magenta)' },
    ],
  },
  // Recompensas deshabilitadas temporalmente (fase simplificación MVP).
  // Solo bonos quedan operativos — accesibles desde la wallet.
  {
    label: 'Tu cuenta',
    items: [
      { label: 'Notificaciones', href: '/play/notifications', color: 'var(--color-magenta)' },
      { label: 'Mi cuenta', href: '/play/settings', color: 'var(--color-fg-muted)' },
    ],
  },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + '/');
}

export function PlayerSidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 flex h-screen w-[248px] shrink-0 flex-col gap-6 overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-5">
      {/* 1) Wordmark */}
      <Link href="/play" className="block px-1">
        <div
          className="text-[26px] font-bold leading-none text-[var(--color-fg)]"
          style={{ letterSpacing: '.05em' }}
        >
          TA
          <span
            className="text-[var(--color-accent)]"
            style={{ textShadow: '0 0 16px rgba(46,155,255,.7)' }}
          >
            N
          </span>
          GO
        </div>
        <div className="mt-2 border-t border-b border-[var(--color-border)] py-1.5">
          <span
            className="block text-[9px] uppercase text-[var(--color-fg-muted)]"
            style={{ letterSpacing: '.4em' }}
          >
            Casino
          </span>
        </div>
      </Link>

      {/* 2) Grupos de navegación */}
      {GROUPS.map((group) => (
        <nav key={group.label} className="flex flex-col gap-1">
          <span className="mb-2 px-2 text-[10px] uppercase tracking-[.18em] text-[var(--color-fg-subtle)]">
            {group.label}
          </span>
          {group.items.map((item) => (
            <NavRow key={item.href + item.label} item={item} active={isActive(pathname, item)} />
          ))}
        </nav>
      ))}

      {/* 3) Tarjeta VIP — link a wallet para ver bonus_balance */}
      <div className="mt-auto">
        <VipCard />
      </div>
    </aside>
  );
}

function NavRow({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      className={[
        'group flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-[14px] transition-colors duration-200',
        active
          ? 'bg-[rgba(46,155,255,.12)] text-[var(--color-fg)] ring-1 ring-inset ring-[var(--color-accent-border)]'
          : 'text-[var(--color-fg-muted)] hover:bg-[rgba(120,170,255,.07)] hover:text-[var(--color-fg)]',
      ].join(' ')}
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{
          background: item.color,
          boxShadow: `0 0 8px ${item.color}`,
        }}
      />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function VipCard() {
  return (
    <Link
      href="/play/wallet"
      className="block rounded-[var(--radius-lg)] p-[1.5px]"
      style={{ background: 'var(--gradient-gold-metal)' }}
    >
      <div
        className="relative overflow-hidden rounded-[calc(var(--radius-lg)-1px)] p-3.5"
        style={{ background: 'linear-gradient(160deg,#171206,#0b0a06)' }}
      >
        {/* Banda de brillo diagonal */}
        <div className="pointer-events-none absolute inset-y-0 left-0 h-full w-1/3 animate-tg-shine bg-gradient-to-r from-transparent via-white/20 to-transparent" />

        <div className="relative">
          <span
            className="inline-block rounded-[var(--radius-sm)] px-2 py-0.5 text-[9px] font-medium uppercase tracking-[.18em] text-[var(--color-gold)]"
            style={{ background: 'rgba(240,196,106,.12)' }}
          >
            Mi balance
          </span>

          <h3
            className="font-display mt-2 text-[16px] leading-tight"
            style={{ color: '#ffe9b8' }}
          >
            Ver wallet
          </h3>

          <p className="mt-1.5 text-[11px] leading-snug text-[var(--color-fg-muted)]">
            Balance real, bonos y movimientos.
          </p>

          <span
            className="mt-3 block w-full rounded-[var(--radius-sm)] py-2 text-center text-[13px] font-medium"
            style={{ background: 'var(--gradient-gold)', color: '#1a1206' }}
          >
            Abrir wallet
          </span>
        </div>
      </div>
    </Link>
  );
}
