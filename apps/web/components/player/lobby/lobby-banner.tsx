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

/** Viñeta lateral de desktop: el copy ocupa la mitad del ancho. */
const STOPS_DESKTOP =
  'rgba(10,0,8,.94) 0%, rgba(10,0,8,.75) 34%, rgba(10,0,8,.15) 62%, rgba(10,0,8,.35) 100%';

/**
 * Viñeta lateral de mobile — deliberadamente MÁS SUAVE y MÁS CORTA que la de
 * desktop: en una pantalla chica la foto es casi todo el banner, y una sombra
 * larga se la tapaba. Arranca en .72 (no .9) y se apaga en el 70% del ancho.
 *
 * Lo que sostiene la legibilidad del texto no es solo esta capa: también el
 * `textShadow` del título y la bajada, y el degradé vertical de mobile.
 */
const STOPS_MOBILE =
  'rgba(10,0,8,.72) 0%, rgba(10,0,8,.42) 34%, rgba(10,0,8,.08) 58%, rgba(10,0,8,0) 70%';

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
      {slides.map((s, i) => {
        // Art direction: la caja del banner es casi cuadrada en mobile
        // (~375x372) y muy apaisada en desktop (~1920x552). Con una sola
        // foto, `object-cover` recortaba la version ancha y en el telefono
        // se veia un pedazo del medio. El editor ya permitia subir una
        // imagen mobile aparte — pero este componente nunca la usaba.
        //
        // Solo se renderiza la segunda <Image> si la mobile es DISTINTA de
        // la de desktop: cuando el tenant deja la misma (el caso por
        // defecto) se sigue bajando una sola.
        const mobile = s.imageMobile && s.imageMobile !== s.image ? s.imageMobile : null;
        return (
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
              className={cn('object-cover', mobile && 'hidden lg:block')}
            />
            {mobile && (
              <Image
                src={mobile}
                alt=""
                fill
                priority={i === 0}
                sizes="100vw"
                className="object-cover lg:hidden"
              />
            )}
          </div>
        );
      })}

      {/* Capa 2 — viñeta LATERAL, ahora en mobile también: antes el teléfono
          solo tenía el degradé vertical y el texto quedaba sobre la parte
          clara de la foto cuando se corría de lado.
          Los stops difieren por breakpoint porque el copy ocupa 50% del ancho
          en desktop y 78% en mobile: con los stops de desktop, en el teléfono
          el final del texto caía sobre la zona ya aclarada.
          Las dos direcciones se renderizan siempre y se crossfadean por
          opacity — alternar el `background` de un solo div daría un corte
          seco, porque los gradients no transicionan. */}
      {(
        [
          { deg: 90, derecha: false, bp: 'hidden lg:block', stops: STOPS_DESKTOP },
          { deg: 270, derecha: true, bp: 'hidden lg:block', stops: STOPS_DESKTOP },
          { deg: 90, derecha: false, bp: 'lg:hidden', stops: STOPS_MOBILE },
          { deg: 270, derecha: true, bp: 'lg:hidden', stops: STOPS_MOBILE },
        ] as const
      ).map((v) => (
        <div
          key={`${v.deg}-${v.bp}`}
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 transition-opacity duration-700 ease-out',
            v.bp,
          )}
          style={{
            opacity: v.derecha === alignRight ? 1 : 0,
            background: `linear-gradient(${v.deg}deg, ${v.stops})`,
          }}
        />
      ))}
      {/* Vertical de mobile — scrim bajo el header + empalme con el fondo.
          No tiene lado, así que convive con el lateral de arriba. */}
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
          'pointer-events-none relative z-20 flex h-full max-w-[78%] flex-col gap-3 px-[18px] pt-[104px] lg:max-w-[50%] lg:gap-[22px] lg:px-11 lg:pt-[126px]',
          // Aplica en TODOS los breakpoints (antes iba solo desde `lg`). Con
          // el copy al 88% del ancho el lado casi no se notaba, así que en
          // mobile se acota a 78%: ahí el izquierda/derecha se lee de verdad.
          // La viñeta mobile es vertical, no tiene lado, así que sirve para
          // los dos.
          alignRight && 'ml-auto items-end text-right',
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

        {/* Indicadores — 4 barras.
            La barra mide 3px de alto: como target táctil es inusable. En vez
            de agrandarla (arruinaría el diseño), se le cuelga un ::after
            invisible que lleva el área de toque a 44x44 sin ocupar layout.
            El `gap-3` da 12px entre barras para que dos áreas contiguas —que
            se extienden 5px por lado— no se pisen. */}
        {total > 1 && (
          <div className="pointer-events-auto mt-auto flex gap-3 pb-6 lg:pb-8">
            {slides.map((s, i) => (
              <button
                key={s.id}
                type="button"
                aria-label={`Ir al slide ${i + 1}`}
                aria-current={i === index}
                onClick={() => setIndex(i)}
                className="relative h-[3px] w-[34px] rounded-[2px] transition-colors after:absolute after:-inset-x-[5px] after:-inset-y-[20.5px] after:content-['']"
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
