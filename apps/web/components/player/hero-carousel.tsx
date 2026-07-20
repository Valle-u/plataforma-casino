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

import { ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react';
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
      if (delta > 0) prev();
      else next();
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
        // Sprint 51.28 rebuild: sacamos la línea izquierda con accent
        // (look "admin panel"). Reemplazamos por glow ambient + indicador
        // numérico top-right + progress bar bottom edge → patron Netflix.
        'relative overflow-hidden card-premium rounded-[var(--radius-xl)]',
        'h-[300px] sm:h-[400px] lg:h-[480px]',
        'group/carousel',
        className,
      )}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocus={() => setIsPaused(true)}
      onBlur={() => setIsPaused(false)}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {slides.map((slide, i) => (
        <Slide key={slide.id} slide={slide} active={i === index} eager={i === 0} />
      ))}

      {/* Sprint 51.28: número del slide top-right (estilo Netflix/Apple).
        * Pill semi-transparente con counter "1 / 6". */}
      {total > 1 && (
        <div
          aria-hidden
          className="absolute top-4 right-4 sm:top-5 sm:right-5 z-20 flex items-center gap-1 px-2.5 h-7 bg-black/40 backdrop-blur-md border border-white/10 rounded-full"
        >
          <span
            className="text-[12px] font-mono tabular-nums tracking-tight"
            style={{ color: currentSlide.accentColor }}
          >
            {String(index + 1).padStart(2, '0')}
          </span>
          <span className="text-[11px] font-mono text-white/40">/</span>
          <span className="text-[11px] font-mono tabular-nums text-white/60">
            {String(total).padStart(2, '0')}
          </span>
        </div>
      )}

      {/* Flechas (desktop hover) — más sutiles, mejor estilo glass */}
      {total > 1 && (
        <>
          <button
            type="button"
            onClick={prev}
            aria-label="Slide anterior"
            className={cn(
              'hidden sm:flex absolute left-4 top-1/2 -translate-y-1/2 z-20',
              'size-10 items-center justify-center rounded-full',
              'bg-black/40 backdrop-blur-md border border-white/10',
              'text-white hover:bg-black/60 hover:border-white/30',
              'opacity-0 group-hover/carousel:opacity-100 transition-all duration-200',
              'hover:scale-110 active:scale-95',
            )}
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={next}
            aria-label="Slide siguiente"
            className={cn(
              'hidden sm:flex absolute right-4 top-1/2 -translate-y-1/2 z-20',
              'size-10 items-center justify-center rounded-full',
              'bg-black/40 backdrop-blur-md border border-white/10',
              'text-white hover:bg-black/60 hover:border-white/30',
              'opacity-0 group-hover/carousel:opacity-100 transition-all duration-200',
              'hover:scale-110 active:scale-95',
            )}
          >
            <ChevronRight className="size-4" />
          </button>
        </>
      )}

      {/* Sprint 51.28: progress bar al pie del carousel. Cada slot del
        * grid representa un slide; el activo se llena con barra de progreso
        * animada que corre durante el intervalo. Click sobre un slot
        * para saltar a ese slide. Mucho más informativo que dots. */}
      {total > 1 && (
        <div
          role="tablist"
          aria-label="Selector de slide"
          className="absolute bottom-0 inset-x-0 z-20 grid gap-1 p-3 sm:p-4"
          style={{ gridTemplateColumns: `repeat(${total}, 1fr)` }}
        >
          {slides.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Ir al slide ${i + 1}: ${s.title}`}
              onClick={() => goTo(i)}
              className="relative h-1 group/dot rounded-full overflow-hidden cursor-pointer"
            >
              {/* Track */}
              <span
                className={cn(
                  'absolute inset-0 rounded-full transition-colors',
                  i === index
                    ? 'bg-white/15'
                    : 'bg-white/15 group-hover/dot:bg-white/25',
                )}
              />
              {/* Fill — solo el activo lo muestra. Si está paused, lleno
                * estático; si está corriendo, anima de 0% → 100% en intervalMs. */}
              {i === index && (
                <span
                  key={`fill-${index}-${isPaused ? 'p' : 'r'}`}
                  className="absolute inset-y-0 left-0 rounded-full origin-left"
                  style={{
                    background: currentSlide.accentColor,
                    boxShadow: `0 0 8px ${currentSlide.accentColor}80`,
                    width: '100%',
                    animation: isPaused
                      ? 'none'
                      : `carousel-progress ${intervalMs}ms linear forwards`,
                  }}
                />
              )}
              {/* Slides ya vistos quedan medio-llenos como hint */}
              {i < index && (
                <span
                  className="absolute inset-y-0 left-0 right-0 rounded-full"
                  style={{ background: 'rgba(255,255,255,0.35)' }}
                />
              )}
            </button>
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
          <source srcSet={`/hero/${slide.image}.png`} type="image/png" />
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

      {/* Sprint 51.28: layout Netflix — content stacked bottom-left con
        * gradient FUERTE desde abajo para legibilidad, no desde la izquierda.
        * Permite que la imagen se vea más completa arriba. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, rgba(10,10,10,0.15) 0%, rgba(10,10,10,0.25) 40%, rgba(10,10,10,0.7) 70%, rgba(10,10,10,0.95) 100%)',
        }}
      />
      {/* Glow del accent — radial grande abajo izquierda donde está el contenido */}
      <div
        aria-hidden
        className="absolute -inset-x-12 -bottom-12 h-64 opacity-60 blur-3xl pointer-events-none"
        style={{
          background: `radial-gradient(ellipse at 25% center, ${slide.glow} 0%, transparent 60%)`,
        }}
      />

      {/* Contenido stacked bottom-left.
        * - Pill kicker con accent color + glow.
        * - Título en Marcellus con text-shadow neón.
        * - Body con mejor legibilidad.
        * - CTA con gradient brand rosa→violeta (Miami Neon). */}
      <div className="relative z-10 h-full flex flex-col justify-end p-5 sm:p-8 lg:p-12">
        {/* Glow accent decorativo detrás del contenido */}
        <div
          aria-hidden
          className="absolute -top-32 -right-32 size-96 rounded-full opacity-[0.08] blur-[100px] pointer-events-none"
          style={{ background: slide.accentColor }}
        />

        <div className="flex flex-col gap-3 sm:gap-4 max-w-[640px] relative">
          {/* Pill kicker — con glow neón */}
          <div
            className="inline-flex items-center gap-1.5 px-3 h-7 self-start rounded-full"
            style={{
              background: `${slide.accentColor}18`,
              border: `1px solid ${slide.accentColor}50`,
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              boxShadow: `0 0 20px -4px ${slide.accentColor}40`,
            }}
          >
            <slide.icon
              className="size-3"
              style={{ color: slide.accentColor }}
            />
            <span
              className="text-[10px] sm:text-[11px] uppercase tracking-[0.18em] font-semibold"
              style={{ color: slide.accentColor }}
            >
              {slide.kicker}
            </span>
          </div>

          {/* Título en Marcellus con text-shadow neón suave */}
          <h2
            className={cn(
              'font-display leading-[1.02] text-[var(--color-fg)]',
              'text-[1.75rem] sm:text-[2.5rem] lg:text-[3.25rem]',
            )}
            style={{
              letterSpacing: '0.02em',
              textShadow: `0 0 60px ${slide.accentColor}20, 0 4px 20px rgba(0,0,0,0.8)`,
            }}
          >
            {slide.title}
          </h2>

          {/* Body subtitle */}
          <p
            className={cn(
              'text-[var(--color-fg-muted)] leading-relaxed line-clamp-2',
              'text-[13px] sm:text-[14px] lg:text-[15px]',
              'max-w-[520px]',
            )}
            style={{ textShadow: '0 2px 12px rgba(0,0,0,0.7)' }}
          >
            {slide.body}
          </p>


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
