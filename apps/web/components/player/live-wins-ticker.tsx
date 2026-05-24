/**
 * LiveWinsTicker — Sprint 51.27.
 *
 * Feed flotante "estilo casino premium" que muestra ganadores recientes
 * para generar social proof + FOMO. Pattern clásico de Stake, Roobet,
 * Sweet Bonanza in-game feeds, etc.
 *
 * Posición: top-left (debajo del header, opuesto al WinToastWatcher que
 * vive arriba-derecha). Mini-cards horizontales que slide in desde la
 * izquierda, lifetime 5s, máximo 2 visibles a la vez.
 *
 * ⚠️ DATA: por ahora mock generator client-side. Cuando exista el
 * endpoint `GET /tenant/wallet/recent-public-wins` (o WS feed), swap
 * el generador por el hook real. La lógica de UI no cambia.
 *
 * Mock:
 *   - Username: lista pre-definida con handles realistas en es-AR.
 *   - Game: random del catálogo activo (useActiveGames).
 *   - Monto: weighted random (mayoría 100-2K, ocasional 5K-50K, raro 100K+).
 *   - Intervalo: 12-25s entre apariciones (random).
 *
 * Privacidad: nunca expone datos reales del player — el feed es siempre
 * "social proof" agregado, sin identificar al user logueado. Si después
 * usamos data real del backend, asegurarnos que envíe nicknames públicos
 * (no usernames reales del tenant).
 *
 * Toggle: el user puede apagar el feed entero — botón "settings" en el
 * card del stack. Preferencia en localStorage. Default ON.
 */

'use client';

import { Sparkles, Trophy, X, Zap } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useActiveGames, type PlayerGame } from '@/lib/hooks/use-games';
import { cn } from '@/lib/cn';

const STORAGE_KEY = 'casino:live-wins-ticker:enabled';
const TOAST_TTL_MS = 5000;
const MIN_INTERVAL_MS = 12_000;
const MAX_INTERVAL_MS = 25_000;
const MAX_STACK = 2;

// Pool de usernames anonimizados para el mock. Nombres del estilo
// que se ve en plataformas reales — mezcla de iniciales + números, etc.
const FAKE_USERNAMES = [
  'leo***',
  'mar1234',
  'rocio_p',
  'fede.t',
  'sofi***',
  'jdaniel',
  'tincho_m',
  'cami.99',
  'ag*****',
  'pao_2k',
  'kev_22',
  'nico***',
  'mati.r',
  'jul_ok',
  'rom88',
  'lu***',
  'fran.k',
  'maxi_g',
  'ari***',
  'val.18',
];

type WinEvent = {
  id: number;
  username: string;
  gameName: string;
  amount: number;
  variant: 'normal' | 'big' | 'jackpot';
};

export function LiveWinsTicker() {
  const games = useActiveGames();
  const playableGames = (games.data?.data ?? []).filter((g) =>
    g.code.startsWith('mock_'),
  );

  const [enabled, setEnabled] = useState<boolean>(true);
  const [stack, setStack] = useState<WinEvent[]>([]);
  const timerRef = useRef<number | null>(null);

  // Cargar preferencia inicial (solo client).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === '0') setEnabled(false);
    } catch {
      /* ignore — localStorage puede fallar en private mode */
    }
  }, []);

  const persistEnabled = useCallback((next: boolean) => {
    setEnabled(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (!next) setStack([]); // limpiar inmediato al apagar
  }, []);

  // Push de un win nuevo al stack + auto-dismiss después de TOAST_TTL_MS.
  const pushWin = useCallback((event: WinEvent) => {
    setStack((prev) => [...prev.slice(-(MAX_STACK - 1)), event]);
    window.setTimeout(() => {
      setStack((prev) => prev.filter((x) => x.id !== event.id));
    }, TOAST_TTL_MS);
  }, []);

  // Scheduler del mock generator. Random interval, respeta visibility
  // (tab oculto → pausa, ahorra batería + evita spam al volver al tab).
  useEffect(() => {
    if (!enabled || playableGames.length === 0) return;

    let cancelled = false;
    const schedule = () => {
      const next =
        MIN_INTERVAL_MS +
        Math.random() * (MAX_INTERVAL_MS - MIN_INTERVAL_MS);
      timerRef.current = window.setTimeout(() => {
        if (cancelled) return;
        if (!document.hidden) {
          pushWin(mockWin(playableGames));
        }
        schedule();
      }, next);
    };
    schedule();

    return () => {
      cancelled = true;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [enabled, playableGames, pushWin]);

  if (!enabled || stack.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className={cn(
        'fixed z-40 pointer-events-none',
        // Top-left, debajo del header (h-16 desktop, h-14 mobile).
        'top-[3.75rem] sm:top-20 left-3 sm:left-6',
        'w-[min(86vw,320px)]',
        'flex flex-col gap-2',
      )}
    >
      {stack.map((event) => (
        <LiveWinCard
          key={event.id}
          event={event}
          onDismiss={() =>
            setStack((prev) => prev.filter((x) => x.id !== event.id))
          }
          onMute={() => persistEnabled(false)}
        />
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Card individual
// ──────────────────────────────────────────────────────────────────────

const VARIANT_META: Record<
  WinEvent['variant'],
  { Icon: typeof Trophy; color: string; label: string }
> = {
  normal: { Icon: Sparkles, color: '#22c55e', label: 'Ganó' },
  big: { Icon: Trophy, color: '#FFD700', label: 'GANÓ' },
  jackpot: { Icon: Zap, color: '#FFD700', label: '¡JACKPOT!' },
};

function LiveWinCard({
  event,
  onDismiss,
  onMute,
}: {
  event: WinEvent;
  onDismiss: () => void;
  onMute: () => void;
}) {
  const meta = VARIANT_META[event.variant];
  const Icon = meta.Icon;
  const isHighlight = event.variant !== 'normal';

  return (
    <div
      className={cn(
        'pointer-events-auto relative overflow-hidden',
        'card-premium rounded-[var(--radius-lg)]',
        'animate-ticker-slide-in',
      )}
      style={
        isHighlight
          ? {
              borderColor: `${meta.color}80`,
              boxShadow: `var(--shadow-edge), 0 0 0 1px ${meta.color}50, var(--shadow)`,
            }
          : undefined
      }
      role="status"
    >
      {/* Shine sweep en variants big/jackpot */}
      {isHighlight && (
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none overflow-hidden"
        >
          <div className="absolute inset-y-0 -inset-x-full animate-shine bg-gradient-to-r from-transparent via-white/12 to-transparent" />
        </div>
      )}

      <div className="relative flex items-center gap-2.5 p-2.5 sm:p-3">
        <div
          className="size-8 rounded-full flex items-center justify-center shrink-0"
          style={{
            background: `linear-gradient(135deg, ${meta.color}28, ${meta.color}08)`,
            border: `1px solid ${meta.color}60`,
          }}
        >
          <Icon className="size-3.5" style={{ color: meta.color }} />
        </div>
        <div className="flex flex-col min-w-0 flex-1 leading-tight">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-[0.1em] font-mono">
            <span className="text-[var(--color-fg-muted)] truncate">
              {event.username}
            </span>
            <span
              className="font-medium shrink-0"
              style={{ color: meta.color }}
            >
              {meta.label}
            </span>
          </div>
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span
              className={cn(
                'font-mono tabular-nums tracking-tight',
                isHighlight ? 'text-[14px] sm:text-[15px]' : 'text-[13px]',
              )}
              style={{
                color: isHighlight ? meta.color : 'var(--color-fg)',
                fontWeight: isHighlight ? 600 : 500,
              }}
            >
              {formatChips(event.amount)}
            </span>
            <span className="text-[10px] uppercase tracking-[0.08em] font-mono text-[var(--color-fg-subtle)]">
              en {event.gameName}
            </span>
          </div>
        </div>
        {/* Acciones: dismiss + mute permanente */}
        <div className="flex flex-col gap-0.5 shrink-0">
          <button
            type="button"
            onClick={onDismiss}
            className="size-5 flex items-center justify-center text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] transition-colors rounded-sm hover:bg-[var(--color-bg-subtle)]"
            aria-label="Descartar"
            title="Descartar"
          >
            <X className="size-3" />
          </button>
          <button
            type="button"
            onClick={onMute}
            className="size-5 flex items-center justify-center text-[var(--color-fg-disabled)] hover:text-[var(--color-fg-muted)] transition-colors rounded-sm hover:bg-[var(--color-bg-subtle)]"
            aria-label="Apagar feed de ganadores"
            title="Apagar feed (lo podés reactivar desde /play/settings)"
          >
            <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 3l18 18M5 12a7 7 0 0 1 11.5-5.36M19 12v.5a7 7 0 0 1-7.5 7" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Mock generator (será reemplazado por hook real cuando esté el endpoint)
// ──────────────────────────────────────────────────────────────────────

function mockWin(games: PlayerGame[]): WinEvent {
  const game = games[Math.floor(Math.random() * games.length)]!;
  const username = FAKE_USERNAMES[Math.floor(Math.random() * FAKE_USERNAMES.length)]!;
  const { amount, variant } = mockAmount();
  return {
    id: Date.now() + Math.floor(Math.random() * 1000),
    username,
    gameName: game.name,
    amount,
    variant,
  };
}

/**
 * Distribución de montos weighted para que el feed sea CREÍBLE:
 *   - 70% wins chicos (100–2.000)
 *   - 25% wins medios (2.000–10.000) → variant "big"
 *   - 5% wins grandes (15.000–80.000) → variant "jackpot"
 *
 * Si se siente "muy" mostrador con montos grandes, bajar el 5% a 2-3%.
 */
function mockAmount(): { amount: number; variant: WinEvent['variant'] } {
  const r = Math.random();
  if (r < 0.7) {
    return {
      amount: Math.floor(100 + Math.random() * 1900),
      variant: 'normal',
    };
  }
  if (r < 0.95) {
    return {
      amount: Math.floor(2000 + Math.random() * 8000),
      variant: 'big',
    };
  }
  return {
    amount: Math.floor(15_000 + Math.random() * 65_000),
    variant: 'jackpot',
  };
}

function formatChips(n: number): string {
  if (n < 10_000) {
    return n.toLocaleString('es-AR', { maximumFractionDigits: 0 });
  }
  if (n < 1_000_000) {
    return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return (n / 1_000_000).toFixed(2).replace(/\.0+$/, '') + 'M';
}
