'use client';

/**
 * PlayerMobileAppBar — barra superior mobile del jugador.
 *
 * Una sola fila: menú · billetera (los dos saldos + depositar) · campana. En el
 * HOME (/play) es translúcida y flota sobre el banner a sangre; en el resto es
 * sólida. Guest: menú · entrar/registrarse.
 *
 * **Sin logo** (2026-08-31). Ocupaba ~90px de los 375 de un teléfono para
 * repetir algo que el jugador ya sabe: en qué casino está. Ese ancho ahora lo
 * usa la plata, que es lo que se mira. La marca sigue en el sidebar mobile, y
 * volver al inicio sigue estando en el bottom nav ("Casino"), así que no se
 * pierde ni la identidad ni la salida.
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
 * El saldo sale de `useMyWallet` (dato existente); cero back nuevo.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowDownToLine, Bell, LogIn, Menu, UserPlus } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useMyWallet } from '@/lib/hooks/use-wallet';
import { useMyUnreadCount } from '@/lib/hooks/use-my-notifications';
import { cn } from '@/lib/cn';

/**
 * A partir de cuántos píxeles de scroll el header deja de ser transparente.
 *
 * En el home el header flota sobre el banner a sangre, sin fondo. Eso servía
 * cuando el header se iba con el scroll: nunca llegaba a taparse con nada. Al
 * volverse fijo, el contenido le empieza a pasar por debajo y los chips de
 * categoría se veían cortados atrás del botón de menú.
 *
 * 12px y no "el alto del banner" a propósito: atar el umbral al banner lo
 * acopla a otro componente y se rompe en silencio justo cuando no hay banner
 * (un tenant sin slides: `LobbyBanner` devuelve null). Con un umbral chico el
 * header se vuelve sólido apenas te movés, que es exactamente cuando hace
 * falta, y el efecto flotante se conserva donde importa: al llegar a la página.
 */
const SCROLL_PARA_FONDO_PX = 12;

const arsFmt = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const pesos = (n: number | null) => (n == null ? '—' : `$ ${arsFmt.format(n)}`);

interface PlayerMobileAppBarProps {
  onOpenSidebar?: () => void;
}

export function PlayerMobileAppBar({ onOpenSidebar }: PlayerMobileAppBarProps) {
  const { user, openLoginModal, openRegisterModal } = useAuth();
  const wallet = useMyWallet();
  const unread = useMyUnreadCount();
  const pathname = usePathname();
  const isHome = pathname === '/play';

  // Solo cambia dos veces (al pasar el umbral y al volver), así que el
  // listener no genera re-renders por cada píxel.
  const [scrolleado, setScrolleado] = useState(false);
  useEffect(() => {
    const alScrollear = () =>
      setScrolleado(window.scrollY > SCROLL_PARA_FONDO_PX);
    alScrollear();
    window.addEventListener('scroll', alScrollear, { passive: true });
    return () => window.removeEventListener('scroll', alScrollear);
  }, []);

  // Transparente solo arriba de todo del home; en cuanto te movés, sólido.
  const flotante = isHome && !scrolleado;

  // `relative` para que el scrim se posicione contra el header. El `sticky` NO
  // va acá: vive en el wrapper de `app/play/layout.tsx`, porque un sticky solo
  // se pega dentro de su padre y ese wrapper mide lo mismo que el header.
  const headerClass = cn(
    // Sin transición a propósito: Chrome no sabe interpolar de `transparent`
    // al `color-mix()` que Tailwind genera para `bg-[var(--color-bg)]/85`, y se
    // queda clavado en transparente — el header quedaba SIN fondo sobre el
    // contenido. El corte seco además se lee mejor: es un cambio de estado, no
    // una animación.
    'relative flex h-14 w-full items-center gap-2 px-3',
    flotante
      ? 'bg-transparent'
      : 'border-b border-[var(--color-border)] bg-[var(--color-bg)]/85 backdrop-blur',
  );

  const scrim = flotante ? (
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

  // ── Guest mode ──
  //
  // Sin el logo entran las etiquetas completas de los botones. Antes se
  // escondían por debajo de 420px y quedaban dos íconos sueltos: para alguien
  // que entra por primera vez, un ícono de puerta no dice "entrar".
  if (!user) {
    return (
      <header className={headerClass}>
        {scrim}
        {hamburger}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => openLoginModal()}
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-[var(--radius)] border border-white/15 px-3.5 text-[13px] font-medium text-[var(--color-fg)] backdrop-blur-sm"
          >
            <LogIn className="size-4" />
            Entrar
          </button>
          <button
            type="button"
            onClick={() => openRegisterModal()}
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-[var(--radius)] px-3.5 text-[13px] font-semibold text-[var(--color-accent-fg)]"
            style={{ background: 'var(--gradient-accent)' }}
          >
            <UserPlus className="size-4" />
            Registrarse
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

      <div className="ml-auto flex min-w-0 items-center gap-2">
        {/* Billetera: los dos saldos y depositar, pegados en una sola pieza.
            Se mantiene el pill que ya existía — es la forma con la que el
            jugador tiene asociada "mi plata" — pero ahora con dos renglones. */}
        <div className="flex h-11 min-w-0 items-center overflow-hidden rounded-[14px] border border-white/18 bg-[rgba(10,0,8,.55)] backdrop-blur-sm">
          <span className="flex min-w-0 flex-col justify-center gap-[3px] py-1 pl-2.5 pr-2.5">
            <span className="flex items-center gap-1.5">
              {/* El puntito late porque el saldo se refresca solo cada 20s. */}
              <span
                aria-hidden
                className="size-1.5 shrink-0 rounded-full bg-[var(--color-accent)] animate-tg-live"
              />
              <span className="sr-only">Saldo disponible:</span>
              <span className="truncate text-[14.5px] font-semibold leading-none tabular-nums text-[var(--color-fg)]">
                {pesos(available)}
              </span>
            </span>
            {/* Alineado con el número de arriba (el ancho del punto + su gap). */}
            <span className="flex items-center gap-1 pl-3 leading-none">
              <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)]">
                Bono
              </span>
              <span className="sr-only">jugable:</span>
              <span className="truncate text-[11.5px] font-medium tabular-nums text-[var(--color-accent-text)]">
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
