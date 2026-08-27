'use client';

/**
 * LobbyBanner — banner "a sangre" del home del jugador (rediseño 4a).
 *
 * Reemplaza al HeroCarousel con tarjeta: ahora es un bloque full-bleed que
 * arranca al tope del área de contenido (detrás del header translúcido). El
 * copy va SOBRE la foto (viñeta lateral en desktop, vertical en mobile), sin
 * CTA. Autorota los slides; el bloque entero es clickeable al `href` del slide,
 * salvo los indicadores (que saltan de slide sin navegar).
 *
 * Cero back nuevo: consume el mismo array `slides` que armaba el HeroCarousel
 * (design.slides / fallback), con su art, kicker, título y bajada.
 */

import Link from 'next/link';
import Image from 'next/image';
import { Crown } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { HeroSlide } from '@/components/player/hero-carousel';
import { cn } from '@/lib/cn';

const INTERVAL_MS = 6000;

export function LobbyBanner({ slides }: { slides: HeroSlide[] }) {
  const [index, setIndex] = useState(0);
  const total = slides.length;

  useEffect(() => {
    if (total <= 1) return;
    const paused = { current: document.hidden };
    const onVis = () => (paused.current = document.hidden);
    document.addEventListener('visibilitychange', onVis);
    const id = window.setInterval(() => {
      if (!paused.current) setIndex((i) => (i + 1) % total);
    }, INTERVAL_MS);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [total]);

  if (total === 0) return null;
  const active = slides[Math.min(index, total - 1)]!;
  // Lado del copy, por slide (default izquierda = como venía). La viñeta
  // tiene que acompañar: si el texto va a la derecha sobre el degradé que
  // aclara ese lado, queda ilegible.
  const alignRight = active.align === 'right';

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Promociones destacadas"
      className="relative h-[372px] w-full overflow-hidden lg:h-[552px]"
      style={{ background: '#150518' }}
    >
      {/* Capa 1 — art del slide a sangre (crossfade). Vía next/image: se sirve
          redimensionado al viewport + WebP/AVIF (los banners de tenant venían
          a tamaño completo, varios MB). `priority` en el primero mejora el LCP;
          el resto quedan lazy. La opacity del wrapper hace el crossfade. */}
      {slides.map((s, i) => (
        <div
          key={s.id}
          aria-hidden
          className={cn(
            'absolute inset-0 transition-opacity duration-700 ease-out',
            i === index ? 'opacity-100' : 'opacity-0',
          )}
        >
          <Image
            src={s.image}
            alt=""
            fill
            priority={i === 0}
            sizes="100vw"
            className="object-cover"
          />
        </div>
      ))}

      {/* Capa 2 — viñeta lateral (desktop) / vertical (mobile). Las dos
          direcciones se renderizan siempre y se crossfadean por opacity: si
          alternáramos el `background` de un solo div, el cambio de lado entre
          slides sería un corte seco (los gradients no transicionan). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 hidden transition-opacity duration-700 ease-out lg:block"
        style={{
          opacity: alignRight ? 0 : 1,
          background:
            'linear-gradient(90deg, rgba(10,0,8,.94) 0%, rgba(10,0,8,.75) 34%, rgba(10,0,8,.15) 62%, rgba(10,0,8,.35) 100%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 hidden transition-opacity duration-700 ease-out lg:block"
        style={{
          opacity: alignRight ? 1 : 0,
          background:
            'linear-gradient(270deg, rgba(10,0,8,.94) 0%, rgba(10,0,8,.75) 34%, rgba(10,0,8,.15) 62%, rgba(10,0,8,.35) 100%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 lg:hidden"
        style={{
          background:
            'linear-gradient(180deg, rgba(10,0,8,.6) 0%, rgba(10,0,8,.12) 30%, rgba(10,0,8,.82) 74%, #0a0008 100%)',
        }}
      />
      {/* Capa 3 — fundido inferior para empalmar con el negro de la página. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[230px]"
        style={{
          background:
            'linear-gradient(180deg, transparent 0%, rgba(10,0,8,.72) 55%, rgba(10,0,8,.96) 100%)',
        }}
      />

      {/* Link que cubre todo el banner (debajo del copy). */}
      {active.href && (
        <Link
          href={active.href}
          aria-label={active.title}
          className="absolute inset-0 z-10"
        />
      )}

      {/* Copy — sobre la foto, sin caja. pointer-events-none para que el click
          pase al Link; los indicadores reactivan pointer-events. */}
      <div
        className={cn(
          'pointer-events-none relative z-20 flex h-full max-w-[88%] flex-col gap-3 px-[18px] pt-[104px] lg:max-w-[50%] lg:gap-[22px] lg:px-11 lg:pt-[126px]',
          // Solo desde `lg`: en mobile el copy ocupa el 88% del ancho, así que
          // moverlo de lado no cambia nada visible y encima empeora la lectura.
          // Ahí se queda como estaba, y la viñeta mobile es vertical (no tiene
          // lado). El selector es, en los hechos, una decisión de desktop.
          alignRight && 'lg:ml-auto lg:items-end lg:text-right',
        )}
      >
        <div className="flex items-center gap-3">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5"
            style={{
              background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)',
              border: '1px solid color-mix(in srgb, var(--color-accent) 45%, transparent)',
            }}
          >
            <Crown className="size-[13px] text-[var(--color-accent-text)]" />
            <span className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-[var(--color-accent-text)]">
              {active.kicker}
            </span>
          </span>
          {total > 1 && (
            <span className="font-mono text-[11px] tabular-nums text-[var(--color-fg-muted)]">
              {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
            </span>
          )}
        </div>

        <h2
          className="font-display font-bold text-[var(--color-fg)]"
          style={{
            fontSize: 'clamp(44px, 6vw, 82px)',
            lineHeight: 0.88,
            letterSpacing: '-0.04em',
            textShadow: '0 4px 40px rgba(10,0,8,.9)',
          }}
        >
          {active.title}
        </h2>

        {active.body && (
          <p
            className="max-w-[460px] text-[13px] leading-relaxed text-[#e6d2ee] lg:text-[16.5px]"
            style={{ textShadow: '0 2px 18px rgba(10,0,8,.9)' }}
          >
            {active.body}
          </p>
        )}

        {/* Indicadores — 4 barras. */}
        {total > 1 && (
          <div className="pointer-events-auto mt-auto flex gap-2 pb-6 lg:pb-8">
            {slides.map((s, i) => (
              <button
                key={s.id}
                type="button"
                aria-label={`Ir al slide ${i + 1}`}
                aria-current={i === index}
                onClick={() => setIndex(i)}
                className="h-[3px] w-[34px] rounded-[2px] transition-colors"
                style={{
                  background:
                    i === index ? 'var(--color-accent)' : 'rgba(255,255,255,.22)',
                }}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
