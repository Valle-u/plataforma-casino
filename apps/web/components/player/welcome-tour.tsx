/**
 * WelcomeTour — Sprint 51.35.
 *
 * Onboarding light-touch: modal centrado con 5 slides que se muestra
 * UNA VEZ en el primer acceso del player. Cubre lo esencial sin obligar
 * a leer mucho — cada slide es chico, visual, navegable manual o
 * automático con prev/next + skip siempre disponible.
 *
 * Detección "primera vez":
 *   - localStorage `casino:onboarding:done` ("1" = done).
 *   - Si key no existe → mostrar al mount.
 *   - Al completar (último slide → "Empezar") o skip, set key.
 *
 * Filosofía:
 *   - NO bloquear excesivamente. Skip prominent, ESC cierra.
 *   - Lenguaje conversacional, no instruccional.
 *   - Cada slide tiene un visual asociado (icon + accent color +
 *     gradient bg) para que se sienta dinámico, no slideshow plano.
 *   - Última slide tiene CTA explícito que lleva al lobby + cierra.
 *
 * Implementación: modal centered, surface-glass, transition entre slides
 * con animate-fade-up (key forces remount).
 */

'use client';

import {
  ArrowRight,
  Check,
  Coins,
  Sparkles,
  Trophy,
  Wallet as WalletIcon,
  X,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { confettiBurst } from '@/lib/confetti';
import { cn } from '@/lib/cn';

const STORAGE_KEY = 'casino:onboarding:done';

interface Slide {
  icon: LucideIcon;
  color: string;
  glow: string;
  kicker: string;
  title: string;
  body: string;
}

const SLIDES: Slide[] = [
  {
    icon: Sparkles,
    color: 'var(--color-accent)',
    glow: 'var(--color-accent-glow)',
    kicker: 'Bienvenido',
    title: 'Tu casino, tu ritmo',
    body: 'Te recibimos con un dashboard pensado para que veas todo lo que importa al primer vistazo: tu saldo, misiones y premios.',
  },
  {
    icon: Coins,
    color: '#FFD700',
    glow: 'rgba(255,215,0,0.35)',
    kicker: 'Misiones diarias',
    title: 'Premios todos los días',
    body: 'Cada día tenés una rueda gratis para girar y una racha de login con premios que crecen. Reclamalos antes de que reseteen.',
  },
  {
    icon: Trophy,
    color: '#FFD700',
    glow: 'rgba(255,215,0,0.35)',
    kicker: 'Liga semanal',
    title: 'Competí y subí al podio',
    body: 'Por cada apuesta sumás puntos en la liga activa. Top 10 se llevan premios extra. Mirá el podio en vivo desde tu home.',
  },
  {
    icon: WalletIcon,
    color: '#22c55e',
    glow: 'rgba(34,197,94,0.35)',
    kicker: 'Wallet seguro',
    title: 'Cargá y retirá cuando quieras',
    body: 'Tu cajero acredita en minutos. Configurá tus límites desde "Mi cuenta" para jugar siempre con responsabilidad.',
  },
  {
    icon: Check,
    color: 'var(--color-accent)',
    glow: 'var(--color-accent-glow)',
    kicker: 'Listo',
    title: '¡A jugar!',
    body: 'Eso es todo. Cuando quieras volver a ver este tour, está en "Mi cuenta". Disfrutá la plataforma.',
  },
];

export function WelcomeTour() {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  // Detectar primera vez al montar (client-only)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const done = window.localStorage.getItem(STORAGE_KEY);
      if (done !== '1') {
        // Pequeño delay para que la primera página termine de animar
        // antes de robar atención con el modal.
        const t = window.setTimeout(() => setOpen(true), 700);
        return () => window.clearTimeout(t);
      }
    } catch {
      /* ignore */
    }
    return undefined;
  }, []);

  // ESC cierra
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleClose = () => {
    setOpen(false);
    try {
      window.localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* ignore */
    }
  };

  const next = () => {
    const newIdx = Math.min(SLIDES.length - 1, index + 1);
    setIndex(newIdx);
    // Sprint 51.36: confetti al llegar a la última slide — pequeña
    // celebración por completar el tour.
    if (newIdx === SLIDES.length - 1) {
      const reduce =
        typeof window !== 'undefined' &&
        window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!reduce) confettiBurst();
    }
  };
  const prev = () => setIndex((i) => Math.max(0, i - 1));

  if (!open) return null;

  const slide = SLIDES[index]!;
  const Icon = slide.icon;
  const isLast = index === SLIDES.length - 1;
  const isFirst = index === 0;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-up"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-label="Tour de bienvenida"
    >
      <div
        className={cn(
          'w-full max-w-md flex flex-col',
          'surface-glass rounded-[var(--radius-xl)] overflow-hidden',
          'shadow-[var(--shadow-lg)]',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close X */}
        <div className="relative flex items-start justify-end px-3 pt-3">
          <button
            type="button"
            onClick={handleClose}
            aria-label="Saltar tour"
            className="size-8 flex items-center justify-center text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg-subtle)] rounded-full transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Slide content (key forces re-mount = animation reset) */}
        <div
          key={index}
          className="relative flex flex-col items-center text-center px-6 pb-6 gap-4 animate-fade-up"
        >
          {/* Glow background detrás del icon */}
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-48 opacity-50 blur-3xl pointer-events-none"
            style={{
              background: `radial-gradient(ellipse at center, ${slide.glow} 0%, transparent 60%)`,
            }}
          />

          {/* Icon big */}
          <div
            className="relative size-20 rounded-full flex items-center justify-center border-2"
            style={{
              background: `linear-gradient(135deg, ${slide.color}38, ${slide.color}10)`,
              borderColor: slide.color,
              boxShadow: `inset 0 1px 0 0 rgba(255,255,255,0.18), 0 0 32px ${slide.glow}`,
            }}
          >
            <Icon className="size-9" style={{ color: slide.color }} />
          </div>

          <div className="relative flex flex-col gap-2 max-w-[340px]">
            <span
              className="text-[10px] uppercase tracking-[0.16em] font-medium"
              style={{ color: slide.color }}
            >
              {slide.kicker}
            </span>
            <h2 className="font-display text-2xl sm:text-[1.75rem] leading-tight tracking-tight text-[var(--color-fg)]">
              {slide.title}
            </h2>
            <p className="text-[13px] text-[var(--color-fg-muted)] leading-relaxed">
              {slide.body}
            </p>
          </div>
        </div>

        {/* Progress indicators + nav */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-[var(--color-border)]">
          {/* Dots */}
          <div className="flex items-center gap-1.5">
            {SLIDES.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Ir al paso ${i + 1}`}
                aria-current={i === index}
                className={cn(
                  'h-1.5 rounded-full transition-all duration-200',
                  i === index
                    ? 'w-6'
                    : 'w-1.5 hover:w-3',
                )}
                style={{
                  background:
                    i === index
                      ? slide.color
                      : i < index
                        ? `${slide.color}80`
                        : 'var(--color-border-strong)',
                }}
              />
            ))}
          </div>

          {/* Buttons */}
          <div className="flex items-center gap-2">
            {!isFirst && !isLast && (
              <button
                type="button"
                onClick={prev}
                className="text-[12px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] transition-colors px-2 h-8"
              >
                Atrás
              </button>
            )}
            {isLast ? (
              <Button variant="premium" size="lg" asChild>
                <Link href="/play/lobby" onClick={handleClose}>
                  Empezar a jugar
                  <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            ) : (
              <Button variant="premium" size="lg" onClick={next}>
                Siguiente
                <ArrowRight className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Helper para resetear el tour desde /play/settings ("Ver tour de nuevo"). */
export function resetWelcomeTour(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.location.reload();
  } catch {
    /* ignore */
  }
}
