/**
 * AchievementUnlockWatcher — Sprint 51.34.
 *
 * Componente headless+UI montado en /play/layout que detecta cuando un
 * achievement se desbloquea en runtime (no al cargar la página por
 * primera vez sino DURANTE una sesión activa) y dispara una celebración
 * en el momento.
 *
 * Pattern: idéntico a WinToastWatcher pero para achievements. Usa
 * useAchievements() y trackea el set de unlocked en useRef. Al detectar
 * un flip false → true, push toast + confetti + sound.
 *
 * Filosofía de UX:
 *   - El usuario puede tener varios achievements desbloqueados ya
 *     cuando entra a la app por primera vez — esos NO disparan toast
 *     (sería spam, los ve en la página dedicada con badge "nuevo").
 *   - Sólo dispara cuando un achievement flips DURANTE la sesión —
 *     ej. después de hacer el primer depósito, ganar la primera
 *     tirada, subir de VIP tier, etc.
 *   - Stack de toasts: max 2 simultaneos, 5s lifetime cada uno.
 *
 * Toast visual:
 *   - Top-right (mismo lugar que WinToastWatcher, pero por debajo si
 *     coinciden — z lower y posición diferente).
 *   - Glass card grande con icon coloreado + "¡Logro desbloqueado!" +
 *     label + description.
 *   - Auto-dismiss 5s + barra de progreso.
 *
 * Side effects al unlock:
 *   - Toast UI.
 *   - confettiBurst() (sutil, no jackpot — no queremos saturar).
 *   - soundClaim() (también sutil).
 */

'use client';

import { Sparkles, Trophy, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useAchievements,
  type AchievementStatus,
} from '@/lib/hooks/use-achievements';
import { cn } from '@/lib/cn';

const TOAST_TTL_MS = 5000;
const MAX_STACK = 2;

type ActiveToast = {
  id: number;
  achievement: AchievementStatus;
};

export function AchievementUnlockWatcher() {
  const { list } = useAchievements();

  // Set de IDs unlocked en la última render. Si vemos algún ID nuevo
  // que NO estaba antes, es un unlock fresh → toast.
  // Inicialmente vacío para evitar disparar en el primer mount con
  // achievements ya unlocked (esos están "seen" o vistos via la página).
  const prevUnlockedRef = useRef<Set<string> | null>(null);
  const [stack, setStack] = useState<ActiveToast[]>([]);

  const pushToast = useCallback((achievement: AchievementStatus) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setStack((prev) => [...prev.slice(-(MAX_STACK - 1)), { id, achievement }]);
    window.setTimeout(() => {
      setStack((prev) => prev.filter((x) => x.id !== id));
    }, TOAST_TTL_MS);
  }, []);

  useEffect(() => {
    const currentUnlocked = new Set(
      list.filter((a) => a.unlocked).map((a) => a.id),
    );
    const prev = prevUnlockedRef.current;
    if (prev === null) {
      // Primer mount — solo registrar baseline, no disparar.
      prevUnlockedRef.current = currentUnlocked;
      return;
    }

    // Buscar achievements en current que no estaban en prev.
    const fresh: AchievementStatus[] = [];
    for (const a of list) {
      if (a.unlocked && !prev.has(a.id)) {
        fresh.push(a);
      }
    }

    prevUnlockedRef.current = currentUnlocked;

    if (fresh.length === 0) return;

    // Sin FX de celebración (decisión del dueño: los toasts de logros
    // molestaban). Se mantiene solo el toast informativo, sin confetti ni
    // sonido. El detalle completo queda en la página de logros.
    // Push toasts (max MAX_STACK — los excedentes no se muestran, igual
    // quedan visibles con badge "nuevo" en la página de logros).
    fresh.slice(0, MAX_STACK).forEach((a) => pushToast(a));
  }, [list, pushToast]);

  if (stack.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className={cn(
        'fixed z-40 pointer-events-none',
        // Top-right, debajo del WinToastWatcher (mismo lado pero más bajo).
        // En mobile, top-center con offset distinto para no chocar.
        'top-[8rem] sm:top-36 right-3 sm:right-6',
        'w-[min(92vw,360px)]',
        'flex flex-col gap-2',
      )}
    >
      {stack.map((toast) => (
        <UnlockToastCard
          key={toast.id}
          achievement={toast.achievement}
          onDismiss={() =>
            setStack((prev) => prev.filter((x) => x.id !== toast.id))
          }
        />
      ))}
    </div>
  );
}

function UnlockToastCard({
  achievement,
  onDismiss,
}: {
  achievement: AchievementStatus;
  onDismiss: () => void;
}) {
  const { icon: Icon, color, label, description } = achievement;
  return (
    <div
      className={cn(
        'pointer-events-auto relative overflow-hidden',
        'surface-glass rounded-[var(--radius-lg)]',
        'animate-toast-slide-in',
      )}
      style={{
        borderColor: `${color}80`,
        boxShadow: `var(--shadow-edge-strong), 0 0 0 1px ${color}50, var(--shadow-lg)`,
      }}
      role="alert"
    >
      {/* Glow detrás del icon */}
      <div
        aria-hidden
        className="absolute -left-6 -top-6 size-32 blur-2xl opacity-50 pointer-events-none"
        style={{
          background: `radial-gradient(circle, ${color}80 0%, transparent 60%)`,
        }}
      />
      {/* Shine sweep */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none overflow-hidden"
      >
        <div className="absolute inset-y-0 -inset-x-full animate-shine bg-gradient-to-r from-transparent via-white/15 to-transparent" />
      </div>

      <div className="relative flex items-start gap-3 p-3.5">
        <div
          className="size-12 rounded-full flex items-center justify-center shrink-0 border"
          style={{
            background: `linear-gradient(135deg, ${color}38, ${color}10)`,
            borderColor: color,
            boxShadow: `inset 0 1px 0 0 rgba(255,255,255,0.15), 0 0 16px ${color}60`,
          }}
        >
          <Icon className="size-5" style={{ color }} />
        </div>
        <div className="flex flex-col min-w-0 flex-1 gap-0.5">
          <div className="flex items-center gap-1.5">
            <Sparkles className="size-3" style={{ color }} />
            <span
              className="text-[10px] uppercase tracking-[0.14em] font-medium"
              style={{ color }}
            >
              ¡Logro desbloqueado!
            </span>
          </div>
          <span className="text-[14px] font-medium tracking-tight text-[var(--color-fg)]">
            {label}
          </span>
          <p className="text-[11px] text-[var(--color-fg-muted)] leading-snug">
            {description}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="size-7 flex items-center justify-center text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg-subtle)] rounded-full transition-colors shrink-0 -mr-1 -mt-1"
          aria-label="Cerrar notificación"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* Progress bar */}
      <div className="relative h-0.5 bg-[var(--color-border)]">
        <div
          className="absolute inset-y-0 left-0 animate-toast-progress origin-left"
          style={{ background: color }}
        />
      </div>
    </div>
  );
}

// Export para fallback de imports (Trophy icon usado en otro lado).
export { Trophy };
