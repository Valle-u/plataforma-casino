/**
 * HeroCarousel — carrusel animado al tope del lobby (Sprint 51.14).
 *
 * Reemplaza el `DynamicHero` estático: ahora rota slides con imágenes
 * grandes (assets en `/public/hero/*.{avif,webp}`) y aplica Ken Burns
 * (zoom + pan lento) sobre cada slide para que la pantalla siempre
 * tenga movimiento sin gastar CPU (solo transform GPU-acelerado).
 *
 * Featureset:
 *   - Autoplay (default 6s/slide), pause on hover + on focus + tab oculto.
 *   - Crossfade entre slides (opacity 700ms).
 *   - Ken Burns: scale 1 → 1.08 + pan diagonal sutil durante toda la
 *     duración del slide (key+animation reset al cambiar).
 *   - Swipe horizontal mobile (umbral 60px).
 *   - Indicadores pill abajo + flechas chevron en desktop (hover).
 *   - Color accent por slide → border-left, glow del CTA, kicker color.
 *   - Imagen lazy excepto la primera (eager) para LCP rápido.
 *   - `<picture>` con AVIF + WebP fallback — pesa ~30-90KB por slide.
 *
 * Composición de slides:
 *   El padre arma el array `slides` (en lobby/page.tsx usa el hook
 *   `useHeroSlides`). Acá solo se renderiza.
 */

'use client';

import { ArrowRight, ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

export type HeroSlide = {
  /** Slug del asset en /public/hero/{slug}.{avif,webp}. */
  image: string;
  /** Destino del CTA. Si es `null`, el slide no es link (sólo decorativo). */
  href: string | null;
  icon: LucideIcon;
  /** Color hex (`#FFD700`) o CSS var (`var(--color-accent)`). */
  accentColor: string;
  /** rgba para el radial glow detrás del icon. */
  glow: string;
  kicker: string;
  title: string;
  body: string;
  cta: string;
  /**
   * Identidad estable del slide — se usa como `key` y para que el efecto
   * sepa cuándo cambió. Distinto de `title` porque el title puede repetirse
   * entre tenants en marketing copy.
   */
  id: string;
};

export type HeroCarouselProps = {
  slides: HeroSlide[];
  /** Milisegundos entre slides. Default 6000. */
  intervalMs?: number;
  className?: string;
};

const TRANSITION_MS = 700;

export function HeroCarousel({
  slides,
  intervalMs = 6000,
  className,
}: HeroCarouselProps) {
  const [index, setIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const touchStartX = useRef<number | null>(null);

  const total = slides.length;
  const goTo = useCallback(
    (next: number) => {
      if (total === 0) return;
      const normalized = ((next % total) + total) % total;
      setIndex(normalized);
    },
    [total],
  );
  const next = useCallback(() => goTo(index + 1), [goTo, index]);
  const prev = useCallback(() => goTo(index - 1), [goTo, index]);

  // ── Autoplay ────────────────────────────────────────────────────
  useEffect(() => {
    if (total <= 1 || isPaused) return;
    const handle = window.setInterval(() => {
      setIndex((i) => (i + 1) % total);
    }, intervalMs);
    return () => window.clearInterval(handle);
  }, [total, intervalMs, isPaused]);

  // Pausar cuando la pestaña queda oculta — no rotar invisible.
  useEffect(() => {
    const onVisibility = () => {
      setIsPaused(document.hidden);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // ── Touch swipe (mobile) ────────────────────────────────────────
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
    setIsPaused(true);
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartX.current;
    if (start == null) return;
    const end = e.changedTouches[0]?.clientX ?? start;
    const delta = end - start;
    if (Math.abs(delta) > 60) {
      delta > 0 ? prev() : next();
    }
    touchStartX.current = null;
    // Reanudar después de un toque, con pequeño delay para no rotar inmediato
    window.setTimeout(() => setIsPaused(false), 1500);
  };

  if (total === 0) return null;

  const currentSlide = slides[index]!;

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Promociones destacadas"
      className={cn(
        'relative overflow-hidden border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)]',
        'h-[220px] sm:h-[300px] lg:h-[360px]',
        'group/carousel',
        className,
      )}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocus={() => setIsPaused(true)}
      onBlur={() => setIsPaused(false)}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      style={{ borderLeftColor: currentSlide.accentColor, borderLeftWidth: '3px' }}
    >
      {slides.map((slide, i) => (
        <Slide key={slide.id} slide={slide} active={i === index} eager={i === 0} />
      ))}

      {/* Flechas (desktop hover) */}
      {total > 1 && (
        <>
          <button
            type="button"
            onClick={prev}
            aria-label="Slide anterior"
            className={cn(
              'hidden sm:flex absolute left-3 top-1/2 -translate-y-1/2 z-20',
              'size-9 items-center justify-center',
              'bg-[var(--color-bg)]/70 backdrop-blur-sm border border-[var(--color-border)]',
              'text-[var(--color-fg)] hover:bg-[var(--color-bg)] hover:border-[var(--color-border-strong)]',
              'opacity-0 group-hover/carousel:opacity-100 transition-opacity duration-200',
            )}
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={next}
            aria-label="Slide siguiente"
            className={cn(
              'hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 z-20',
              'size-9 items-center justify-center',
              'bg-[var(--color-bg)]/70 backdrop-blur-sm border border-[var(--color-border)]',
              'text-[var(--color-fg)] hover:bg-[var(--color-bg)] hover:border-[var(--color-border-strong)]',
              'opacity-0 group-hover/carousel:opacity-100 transition-opacity duration-200',
            )}
          >
            <ChevronRight className="size-4" />
          </button>
        </>
      )}

      {/* Indicadores pill */}
      {total > 1 && (
        <div
          role="tablist"
          aria-label="Selector de slide"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5"
        >
          {slides.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Ir al slide ${i + 1}: ${s.title}`}
              onClick={() => goTo(i)}
              className={cn(
                'h-1.5 transition-all duration-300',
                i === index
                  ? 'w-6 bg-[var(--color-fg)]'
                  : 'w-1.5 bg-[var(--color-fg)]/40 hover:bg-[var(--color-fg)]/70',
              )}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Slide individual
// ──────────────────────────────────────────────────────────────────────

function Slide({
  slide,
  active,
  eager,
}: {
  slide: HeroSlide;
  active: boolean;
  eager: boolean;
}) {
  const content = (
    <>
      {/* Imagen de fondo con Ken Burns (zoom+pan lento) */}
      <div
        aria-hidden
        className={cn(
          'absolute inset-0 overflow-hidden',
          // El active vuelve a aplicar la animación (key resetea via React)
          active && 'animate-ken-burns',
        )}
      >
        <picture>
          <source srcSet={`/hero/${slide.image}.avif`} type="image/avif" />
          <source srcSet={`/hero/${slide.image}.webp`} type="image/webp" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/hero/${slide.image}.webp`}
            alt=""
            loading={eager ? 'eager' : 'lazy'}
            decoding={eager ? 'sync' : 'async'}
            fetchPriority={eager ? 'high' : 'low'}
            className="w-full h-full object-cover"
          />
        </picture>
      </div>

      {/* Gradient overlay — oscurece la mitad izquierda para legibilidad */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to right, rgba(10,10,10,0.92) 0%, rgba(10,10,10,0.78) 30%, rgba(10,10,10,0.35) 65%, rgba(10,10,10,0.15) 100%)',
        }}
      />
      {/* Glow del accent — radial sutil arriba a la izquierda */}
      <div
        aria-hidden
        className="absolute -inset-x-12 -top-12 h-48 opacity-50 blur-3xl pointer-events-none"
        style={{
          background: `radial-gradient(ellipse at center, ${slide.glow} 0%, transparent 65%)`,
        }}
      />

      {/* Contenido */}
      <div className="relative z-10 h-full flex items-center px-5 sm:px-8 lg:px-12">
        <div className="flex items-center gap-4 sm:gap-6 max-w-[600px]">
          <div
            className="hidden sm:flex items-center justify-center size-16 lg:size-20 rounded-full shrink-0"
            style={{
              background: `linear-gradient(135deg, ${slide.accentColor}30, ${slide.accentColor}10)`,
              border: `1px solid ${slide.accentColor}`,
              boxShadow: `0 0 24px ${slide.glow}`,
            }}
          >
            <slide.icon
              className="size-7 lg:size-9"
              style={{ color: slide.accentColor }}
            />
          </div>
          <div className="flex flex-col gap-1.5 min-w-0">
            <span
              className="text-[10px] sm:text-[11px] uppercase tracking-[0.14em] font-medium"
              style={{ color: slide.accentColor }}
            >
              {slide.kicker}
            </span>
            <h2 className="font-display text-xl sm:text-3xl lg:text-4xl leading-tight tracking-tight text-[var(--color-fg)] drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">
              {slide.title}
            </h2>
            <p className="text-[12px] sm:text-[13px] lg:text-sm text-[var(--color-fg-muted)] mt-1 line-clamp-2">
              {slide.body}
            </p>
            <div className="mt-3 sm:mt-4">
              <span
                className="inline-flex items-center gap-2 px-4 h-9 sm:h-10 text-[12px] sm:text-[13px] font-medium tracking-tight"
                style={{
                  background: slide.accentColor,
                  color: '#fff',
                  boxShadow: `0 4px 20px ${slide.glow}`,
                }}
              >
                {slide.cta}
                <ArrowRight className="size-3.5" />
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );

  // Wrapper interactivo si es link, div pasivo si no.
  const wrapperClass = cn(
    'absolute inset-0 transition-opacity ease-out',
    active ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none',
  );
  const wrapperStyle = { transitionDuration: `${TRANSITION_MS}ms` };

  if (slide.href) {
    return (
      <Link
        href={slide.href}
        aria-hidden={!active}
        tabIndex={active ? 0 : -1}
        className={wrapperClass}
        style={wrapperStyle}
      >
        {content}
      </Link>
    );
  }
  return (
    <div aria-hidden={!active} className={wrapperClass} style={wrapperStyle}>
      {content}
    </div>
  );
}
