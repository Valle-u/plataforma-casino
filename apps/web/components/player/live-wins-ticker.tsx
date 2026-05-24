/**
 * LiveWinsTicker — Sprint 51.27 / 52.1 real-data update.
 *
 * Feed flotante "estilo casino premium" con ganadores recientes para
 * generar social proof + FOMO.
 *
 * Posición: top-left (debajo del header, opuesto al WinToastWatcher).
 * Mini-cards horizontales que slide in desde la izquierda, lifetime 5s,
 * máximo 2 visibles a la vez.
 *
 * ✅ Sprint 52.1: usa data real del backend (`useRecentPublicWins`).
 * Endpoint `GET /tenant/games/recent-wins` devuelve usernames ya
 * anonimizados ("leo***") + game name real + win amount.
 *
 * Lógica del scheduler:
 *   - Pollea el endpoint cada 15s (configurado en useRecentPublicWins).
 *   - Trackea cuáles wins ya mostramos en useRef. Sólo mostramos los
 *     NUEVOS (no vistos en ciclos anteriores).
 *   - Si el endpoint devuelve N nuevos, los muestra de a 1 con jitter
 *     de 3-8s entre cada uno para no spammeo simultáneo.
 *
 * Privacidad: el backend ya hace la anonimización — el componente sólo
 * confía en lo que recibe.
 *
 * Toggle: el user puede apagar el feed entero — botón "settings" en el
 * card del stack. Preferencia en localStorage. Default ON.
 */

'use client';

import { Sparkles, Trophy, X, Zap } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useRecentPublicWins,
  type RecentPublicWin,
} from '@/lib/hooks/use-games';
import { cn } from '@/lib/cn';

const STORAGE_KEY = 'casino:live-wins-ticker:enabled';
const TOAST_TTL_MS = 5000;
const MIN_REVEAL_DELAY_MS = 3_000; // jitter mínimo entre wins consecutivos
const MAX_REVEAL_DELAY_MS = 8_000;
const MAX_STACK = 2;
const JACKPOT_THRESHOLD = 15_000;
const BIG_THRESHOLD = 2_000;

type WinEvent = {
  // ID único del toast (no es el ID del round backend porque ese también
  // está, pero acá generamos uno por mount-de-toast para que el dismiss
  // funcione si el mismo round se reusa por algún motivo).
  toastId: number;
  // ID del round del backend — sirve como deduplicación.
  roundId: string;
  username: string;
  gameName: string;
  amount: number;
  variant: 'normal' | 'big' | 'jackpot';
};

function classifyAmount(n: number): WinEvent['variant'] {
  if (n >= JACKPOT_THRESHOLD) return 'jackpot';
  if (n >= BIG_THRESHOLD) return 'big';
  return 'normal';
}

export function LiveWinsTicker() {
  const winsQuery = useRecentPublicWins(15);
  const wins = winsQuery.data?.data ?? [];

  const [enabled, setEnabled] = useState<boolean>(true);
  const [stack, setStack] = useState<WinEvent[]>([]);
  // Set de roundIds ya mostrados (alive en la sesión actual). Evita
  // repetir el mismo win cuando el polling devuelve el mismo dataset.
  const seenRoundsRef = useRef<Set<string>>(new Set());
  // Cola de wins pendientes de mostrar — se sirven con jitter entre c/u.
  const queueRef = useRef<RecentPublicWin[]>([]);
  const revealTimerRef = useRef<number | null>(null);
  // Skip flag para el primer fetch: no queremos mostrar los wins viejos
  // que ya estaban antes de que entráramos a la app.
  const baselineSetRef = useRef<boolean>(false);

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
    if (!next) {
      setStack([]);
      queueRef.current = [];
    }
  }, []);

  // Push de un win nuevo al stack + auto-dismiss después de TOAST_TTL_MS.
  const pushWin = useCallback((win: RecentPublicWin) => {
    const amount = Number(win.amount);
    const event: WinEvent = {
      toastId: Date.now() + Math.random(),
      roundId: win.id,
      username: win.username,
      gameName: win.gameName,
      amount,
      variant: classifyAmount(amount),
    };
    setStack((prev) => [...prev.slice(-(MAX_STACK - 1)), event]);
    window.setTimeout(() => {
      setStack((prev) => prev.filter((x) => x.toastId !== event.toastId));
    }, TOAST_TTL_MS);
  }, []);

  /**
   * Worker recursivo que toma de la cola y muestra con jitter. Se
   * cancela cuando el componente desmonta o cuando enabled=false.
   */
  const drainQueue = useCallback(() => {
    if (queueRef.current.length === 0) {
      revealTimerRef.current = null;
      return;
    }
    if (document.hidden) {
      // Tab oculto — no spammeo, pero re-intento en 5s.
      revealTimerRef.current = window.setTimeout(drainQueue, 5_000);
      return;
    }
    const next = queueRef.current.shift()!;
    pushWin(next);
    const delay =
      MIN_REVEAL_DELAY_MS +
      Math.random() * (MAX_REVEAL_DELAY_MS - MIN_REVEAL_DELAY_MS);
    revealTimerRef.current = window.setTimeout(drainQueue, delay);
  }, [pushWin]);

  /**
   * Cuando llega data nueva del polling, detectamos qué wins son fresh
   * (no estaban en seenRoundsRef) y los agregamos a la cola.
   *
   * El primer fetch sólo registra baseline (los wins ya existían antes
   * de que el user entre, no son novedad para él).
   */
  useEffect(() => {
    if (!enabled || wins.length === 0) return;

    if (!baselineSetRef.current) {
      // Primer carga real: registrar baseline sin mostrar nada.
      for (const w of wins) seenRoundsRef.current.add(w.id);
      baselineSetRef.current = true;
      return;
    }

    // Buscar wins nuevos (no vistos en ciclos previos). El endpoint
    // devuelve ordenado DESC por settledAt; los wins más nuevos son los
    // primeros. Los recorremos en reverse para encolar más viejo primero
    // (orden temporal correcto).
    const freshNewestFirst: RecentPublicWin[] = [];
    for (const w of wins) {
      if (!seenRoundsRef.current.has(w.id)) {
        freshNewestFirst.push(w);
        seenRoundsRef.current.add(w.id);
      }
    }
    if (freshNewestFirst.length === 0) return;

    // Encolar en orden temporal (más viejo primero).
    queueRef.current.push(...freshNewestFirst.reverse());

    // Disparar drain si no está corriendo.
    if (revealTimerRef.current === null) {
      drainQueue();
    }
  }, [wins, enabled, drainQueue]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (revealTimerRef.current !== null) {
        window.clearTimeout(revealTimerRef.current);
        revealTimerRef.current = null;
      }
    };
  }, []);

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
          key={event.toastId}
          event={event}
          onDismiss={() =>
            setStack((prev) => prev.filter((x) => x.toastId !== event.toastId))
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
// Helpers
// ──────────────────────────────────────────────────────────────────────

function formatChips(n: number): string {
  if (n < 10_000) {
    return n.toLocaleString('es-AR', { maximumFractionDigits: 0 });
  }
  if (n < 1_000_000) {
    return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return (n / 1_000_000).toFixed(2).replace(/\.0+$/, '') + 'M';
}
