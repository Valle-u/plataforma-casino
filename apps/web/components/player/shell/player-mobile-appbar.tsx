'use client';

/**
 * PlayerMobileAppBar — barra superior mobile del jugador.
 *
 * Una sola fila: menú · logo · billetera (los dos saldos + depositar) ·
 * campana. En el HOME (/play) es translúcida y flota sobre el banner a sangre;
 * en cuanto scrolleás pasa a sólida (ver `useScrolled`). Guest: menú · logo ·
 * entrar/registrarse.
 *
 * **Los dos saldos.** Antes se veía uno solo y el bono quedaba escondido en el
 * sidebar de desktop, que en celular no existe: un jugador con bono no tenía
 * forma de enterarse sin abrir el menú. Se muestran los dos, con las mismas
 * etiquetas que el sidebar (`Saldo disponible` / `Bono jugable`) para que no
 * parezcan cosas distintas según la pantalla.
 *
 * El saldo grande es `balance − lockedBalance`: lo que se puede jugar. Los
 * retiros en hold no son jugables (LEYES E6). El bono va aparte porque es plata
 * con condiciones, no saldo real.
 *
 * Nota sobre LEYES R8: la wallet de bonos es exclusiva de `usuario_final`. Si
 * un operador entra a /play va a ver "Bono $ 0,00". No se filtra por rol a
 * propósito: atar la línea a un string de rol agrega una forma de fallar
 * (que el bono deje de verse para jugadores reales) peor que el cero raro.
 *
 * **El logo encoge, no se recorta.** Con el menú, los dos saldos, depositar y
 * la campana, en 375px no entra un wordmark de 130px. En vez de cortarlo o
 * sacarlo, es el único elemento elástico de la fila: todo lo demás es
 * `shrink-0` y él se achica hasta donde haga falta. Con saldos normales se ve
 * entero; solo con cifras muy largas se reduce. Los números no se achican nunca
 * — la plata es lo que el jugador vino a mirar.
 *
 * El saldo sale de `useMyWallet` (dato existente); cero back nuevo.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowDownToLine, Bell, LogIn, Menu, UserPlus } from 'lucide-react';
import { BrandWordmark } from '@/components/brand/brand-wordmark';
import { useAuth } from '@/lib/auth-context';
import { useMyWallet } from '@/lib/hooks/use-wallet';
import { useMyUnreadCount } from '@/lib/hooks/use-my-notifications';
import { useScrolled } from '@/lib/hooks/use-scrolled';
import { useTenantInfo } from '@/lib/hooks/use-tenant-branding';
import { cn } from '@/lib/cn';

const arsFmt = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const pesos = (n: number | null) => (n == null ? '—' : `$ ${arsFmt.format(n)}`);

/** Ancho máximo del logo en la barra. El wordmark `sm` mide 130 y no entra. */
const LOGO_MAX_W_PX = 112;

interface PlayerMobileAppBarProps {
  onOpenSidebar?: () => void;
}

export function PlayerMobileAppBar({ onOpenSidebar }: PlayerMobileAppBarProps) {
  const { user, openLoginModal, openRegisterModal } = useAuth();
  const wallet = useMyWallet();
  const unread = useMyUnreadCount();
  const tenantInfo = useTenantInfo();
  const pathname = usePathname();
  const scrolled = useScrolled();

  const isHome = pathname === '/play';
  // Transparente solo arriba de todo del home; en cuanto te movés, sólido.
  const floating = isHome && !scrolled;

  const branding = tenantInfo.data?.branding;
  const designBrand = tenantInfo.data?.design?.brand as { logoUrl?: string } | undefined;
  const logoUrl = branding?.logoUrl || designBrand?.logoUrl;

  // `relative` para que el scrim se posicione contra el header. El `sticky` NO
  // va acá: vive en el wrapper de `app/play/layout.tsx`, porque un sticky solo
  // se pega dentro de su padre y ese wrapper mide lo mismo que el header.
  //
  // Sin `transition-colors` a propósito — ver el aviso en `use-scrolled.ts`.
  const headerClass = cn(
    'relative flex h-14 w-full items-center gap-2 px-3',
    floating
      ? 'bg-transparent'
      : 'border-b border-[var(--color-border)] bg-[var(--color-bg)]/85 backdrop-blur',
  );

  const scrim = floating ? (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10"
      style={{
        background:
          'linear-gradient(180deg, rgba(10,0,8,.6) 0%, rgba(10,0,8,.2) 60%, transparent 100%)',
      }}
    />
  ) : null;

  const hamburger = (
    <button
      type="button"
      onClick={onOpenSidebar}
      className="grid size-11 shrink-0 place-items-center rounded-full border border-white/15 bg-[rgba(10,0,8,.4)] text-[var(--color-fg-muted)] backdrop-blur-sm"
      aria-label="Abrir menú"
    >
      <Menu className="size-4" />
    </button>
  );

  // El `max-w` sobre la <img> le gana al `width` en línea que pone
  // BrandWordmark, así que la imagen se ESCALA en vez de recortarse.
  const logo = (
    <Link
      href="/play"
      className="block min-w-0 shrink [&_img]:h-auto [&_img]:max-w-full"
      style={{ maxWidth: LOGO_MAX_W_PX }}
    >
      <BrandWordmark size="sm" showCasino={false} src={logoUrl} />
    </Link>
  );

  // ── Guest mode ──
  if (!user) {
    return (
      <header className={headerClass}>
        {scrim}
        {hamburger}
        {logo}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => openLoginModal()}
            aria-label="Iniciar sesión"
            className="inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-[var(--radius)] border border-white/15 px-3 text-[12px] font-medium text-[var(--color-fg)] backdrop-blur-sm"
          >
            <LogIn className="size-3.5" />
            <span>Entrar</span>
          </button>
          <button
            type="button"
            onClick={() => openRegisterModal()}
            aria-label="Registrarse"
            className="inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-[var(--radius)] px-3 text-[12px] font-semibold text-[var(--color-accent-fg)]"
            style={{ background: 'var(--gradient-accent)' }}
          >
            <UserPlus className="size-3.5" />
            <span>Registrarse</span>
          </button>
        </div>
      </header>
    );
  }

  // ── Authenticated mode ──
  const available =
    wallet.data?.balance == null
      ? null
      : Math.max(
          0,
          Number(wallet.data.balance) - Number(wallet.data.lockedBalance ?? '0'),
        );
  const bonus =
    wallet.data?.bonusBalance == null ? null : Number(wallet.data.bonusBalance);
  const unreadCount = unread.data?.count ?? 0;

  return (
    <header className={headerClass}>
      {scrim}
      {hamburger}
      {logo}

      {/* `shrink-0`: lo que cede espacio es el logo, nunca la plata. */}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {/* Billetera: los dos saldos y depositar, pegados en una sola pieza.
            Se mantiene el pill que ya existía — es la forma con la que el
            jugador tiene asociada "mi plata" — pero ahora con dos renglones. */}
        <div className="flex h-11 items-center overflow-hidden rounded-[14px] border border-white/18 bg-[rgba(10,0,8,.55)] backdrop-blur-sm">
          <span className="flex flex-col justify-center gap-[3px] py-1 pl-2.5 pr-2.5">
            <span className="flex items-center gap-1.5">
              {/* El puntito late porque el saldo se refresca solo cada 20s. */}
              <span
                aria-hidden
                className="size-1.5 shrink-0 rounded-full bg-[var(--color-accent)] animate-tg-live"
              />
              <span className="sr-only">Saldo disponible:</span>
              <span className="text-[14.5px] font-semibold leading-none tabular-nums text-[var(--color-fg)]">
                {pesos(available)}
              </span>
            </span>
            {/* Alineado con el número de arriba (el ancho del punto + su gap). */}
            <span className="flex items-center gap-1 pl-3 leading-none">
              <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)]">
                Bono
              </span>
              <span className="sr-only">jugable:</span>
              <span className="text-[11.5px] font-medium tabular-nums text-[var(--color-accent-text)]">
                {pesos(bonus)}
              </span>
            </span>
          </span>
          <Link
            href="/play/deposits?new=1"
            aria-label="Depositar"
            className="grid size-11 shrink-0 place-items-center text-[var(--color-accent-fg)]"
            style={{ background: 'var(--gradient-accent)' }}
          >
            <ArrowDownToLine className="size-4" />
          </Link>
        </div>

        {/* Campana con badge de no leídas. */}
        <Link
          href="/play/notifications"
          aria-label="Notificaciones"
          className="relative grid size-11 shrink-0 place-items-center rounded-full border border-white/15 bg-[rgba(10,0,8,.4)] text-[var(--color-fg-muted)] backdrop-blur-sm"
        >
          <Bell className="size-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-[var(--color-accent)] px-1 text-[9px] font-bold leading-none text-[var(--color-accent-fg)]">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Link>
      </div>
    </header>
  );
}
