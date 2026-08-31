'use client';

/**
 * LobbyBanner — banner "a sangre" del home del jugador (rediseño 4a).
 *
 * Reemplaza al HeroCarousel con tarjeta: ahora es un bloque full-bleed que
 * arranca al tope del área de contenido (detrás del header translúcido). El
 * copy va SOBRE la foto (viñeta lateral en desktop, vertical en mobile), sin
 * CTA. Autorota los slides y el bloque entero es clickeable al `href` del
 * slide.
 *
 * Cómo se pasa de un slide a otro:
 *   - **Mobile: arrastrando.** Antes las únicas manijas eran los indicadores,
 *     cuatro barras de 3px en un rincón: para ver la segunda promo había que
 *     acertarle a eso o esperar seis segundos a que rotara sola.
 *   - **Desktop: con las flechas** de abajo. El arrastre también funciona con
 *     el mouse, pero nadie lo va a descubrir sin un control a la vista.
 *   - Los indicadores siguen estando, ahora como referencia de dónde estás.
 *
 * Las tres vías pasan por `goTo`, que además frena la rotación automática un
 * rato: mover el banner y que se te vaya solo a los segundos es peor que no
 * poder moverlo.
 *
 * Cero back nuevo: consume el mismo array `slides` que armaba el HeroCarousel
 * (design.slides / fallback), con su art, kicker, título y bajada.
 */

import Link from 'next/link';
import Image from 'next/image';
import { ChevronLeft, ChevronRight, Crown } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { HeroSlide } from '@/components/player/hero-carousel';
import { cn } from '@/lib/cn';

const INTERVAL_MS = 6000;

/**
 * Cuánto hay que arrastrar para que cuente como cambio de slide.
 *
 * 44px: lo bastante para no dispararse con el temblor de un dedo apoyado, lo
 * bastante poco para no exigir un gesto largo. Por debajo, el gesto se trata
 * como un toque y el banner navega a su link, que es lo que el jugador quiso.
 */
const SWIPE_THRESHOLD_PX = 44;

/**
 * Cuánto se frena la rotación automática después de que el jugador se movió
 * por su cuenta.
 *
 * Sin esto el carrusel le saca el slide a los segundos de haberlo elegido:
 * uno arrastra para ver una promo y la promo se va sola. Diez segundos
 * alcanzan para leerla sin dejar el banner congelado para siempre.
 */
const PAUSE_AFTER_INTERACTION_MS = 10_000;

/** Viñeta lateral de desktop: el copy ocupa la mitad del ancho. */
const STOPS_DESKTOP =
  'rgba(10,0,8,.94) 0%, rgba(10,0,8,.75) 34%, rgba(10,0,8,.15) 62%, rgba(10,0,8,.35) 100%';

/**
 * Viñeta lateral de mobile — deliberadamente MÁS SUAVE y MÁS CORTA que la de
 * desktop: en una pantalla chica la foto es casi todo el banner, y una sombra
 * larga se la tapaba. Arranca en .5 (contra .94 de desktop) y se apaga en el
 * 70% del ancho.
 *
 * Lo que sostiene la legibilidad del texto no es solo esta capa: también el
 * `textShadow` del título y la bajada, y el degradé vertical de mobile. Si
 * sobre alguna foto muy clara el texto costara leerse, el margen para subir
 * está acá.
 */
const STOPS_MOBILE =
  'rgba(10,0,8,.5) 0%, rgba(10,0,8,.28) 34%, rgba(10,0,8,.05) 58%, rgba(10,0,8,0) 70%';

export function LobbyBanner({ slides }: { slides: HeroSlide[] }) {
  const [index, setIndex] = useState(0);
  const total = slides.length;

  /** Hasta cuándo NO autorotar, porque el jugador acaba de moverse solo. */
  const pausedUntil = useRef(0);

  /** Único camino para cambiar de slide a mano: envuelve el índice y pausa. */
  const goTo = useCallback(
    (next: number) => {
      if (total === 0) return;
      pausedUntil.current = Date.now() + PAUSE_AFTER_INTERACTION_MS;
      setIndex(((next % total) + total) % total);
    },
    [total],
  );

  useEffect(() => {
    if (total <= 1) return;
    const hidden = { current: document.hidden };
    const onVis = () => (hidden.current = document.hidden);
    document.addEventListener('visibilitychange', onVis);
    const id = window.setInterval(() => {
      // Ni con la pestaña de fondo, ni pisándole el slide al jugador.
      if (hidden.current || Date.now() < pausedUntil.current) return;
      setIndex((i) => (i + 1) % total);
    }, INTERVAL_MS);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [total]);

  // ── Arrastre ────────────────────────────────────────────────────────
  //
  // El banner entero es un link, así que arrastrar NO tiene que navegar. Se
  // mide cuánto se movió el dedo entre que apoya y suelta; si pasó el umbral,
  // se marca el click que el navegador dispara igual al soltar para comérselo.
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const swallowClick = useRef(false);

  function onPointerDown(e: ReactPointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Se limpia acá y no al soltar: si el slide anterior no tenía href no hubo
    // link que consumiera la marca, y quedaba viva para comerse el toque
    // siguiente. Cada gesto arranca de cero.
    swallowClick.current = false;
    dragStart.current = { x: e.clientX, y: e.clientY };
  }

  function onPointerUp(e: ReactPointerEvent) {
    const start = dragStart.current;
    dragStart.current = null;
    if (!start || total <= 1) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    // Sólo horizontal: si predomina el eje vertical el jugador estaba
    // scrolleando la página, y el banner no tiene por qué reaccionar.
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dx) <= Math.abs(dy)) return;
    swallowClick.current = true;
    goTo(dx < 0 ? index + 1 : index - 1);
  }

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
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (dragStart.current = null)}
      className="relative h-[372px] w-full overflow-hidden lg:h-[552px]"
      // `pan-y`: el navegador se queda con el scroll vertical de la página y
      // nos deja el horizontal, que es el que mueve el banner. Sin esto, un
      // arrastre de costado puede terminar en `pointercancel` a mitad de gesto.
      style={{ background: '#150518', touchAction: 'pan-y' }}
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
          // Sin esto, arrastrar con el mouse en desktop levanta el fantasma de
          // arrastrar-un-link del navegador en lugar de pasar de slide.
          draggable={false}
          onClick={(e) => {
            // Soltar después de arrastrar dispara un click igual. Si el gesto
            // fue un swipe se lo come acá: el jugador quiso cambiar de slide,
            // no entrar a la promo.
            if (swallowClick.current) e.preventDefault();
          }}
          className="absolute inset-0 z-10"
        />
      )}

      {/* Flechas — sólo desktop: en mobile se pasa arrastrando y dos botones
          más sobre la foto serían ruido en una pantalla chica.
          Van abajo y del lado OPUESTO al copy. Centradas a los costados, que
          es lo habitual, la de la izquierda cae justo sobre el título. */}
      {total > 1 && (
        <div
          className={cn(
            'absolute bottom-8 z-30 hidden gap-2 lg:flex',
            alignRight ? 'left-11' : 'right-11',
          )}
        >
          <BannerArrow hacia="anterior" onClick={() => goTo(index - 1)} />
          <BannerArrow hacia="siguiente" onClick={() => goTo(index + 1)} />
        </div>
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
                onClick={() => goTo(i)}
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

/**
 * Flecha de navegación del banner.
 *
 * Vidrio esmerilado en vez de un botón sólido: el banner es una foto a sangre
 * y un círculo opaco encima se lee como un parche pegado. Con `backdrop-blur`
 * la flecha se apoya sobre la imagen sin taparla, y el borde tenue le da
 * contorno también sobre las fotos claras.
 *
 * 44px es el mínimo táctil, y acá además importa para el mouse: el jugador
 * grande no apunta fino.
 */
function BannerArrow({
  hacia,
  onClick,
}: {
  hacia: 'anterior' | 'siguiente';
  onClick: () => void;
}) {
  const Icono = hacia === 'anterior' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Ver la promoción ${hacia}`}
      className={cn(
        'inline-flex size-11 items-center justify-center rounded-full',
        'border border-white/15 bg-black/35 text-white/70 backdrop-blur-sm',
        'transition-colors duration-200',
        'hover:border-[var(--color-accent-border)] hover:bg-black/60 hover:text-[var(--color-fg)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]',
      )}
    >
      <Icono aria-hidden className="size-5" />
    </button>
  );
}
