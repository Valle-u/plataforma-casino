'use client';

/**
 * LobbyHero — hero principal del /play/lobby.
 *
 * Layout desktop (md+): texto a la izquierda sobre fondo dark, El Gaucho Phantom
 * recortado a la derecha con overlay degradado para mantener legibilidad.
 * Layout mobile (<md): banda superior full-width con la imagen del Gaucho y un
 * fade hacia el dark, y todo el texto debajo de esa banda.
 * El jackpot "en vivo" sube solo via setInterval (cleanup en unmount).
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTenantInfo } from '@/lib/hooks/use-tenant-branding';

const JACKPOT_FORMAT = new Intl.NumberFormat('es-AR');
const JACKPOT_SEED = 1843641;

export function LobbyHero() {
  const [jackpot, setJackpot] = useState(JACKPOT_SEED);
  const tenantInfo = useTenantInfo();
  const tagline = tenantInfo.data?.branding?.tagline || 'Tu reino · Tus reglas · Tu juego';

  useEffect(() => {
    const id = setInterval(() => {
      setJackpot((prev) => prev + 6 + Math.floor(Math.random() * 45));
    }, 1100);
    return () => clearInterval(id);
  }, []);

  const jackpotValue = `$${JACKPOT_FORMAT.format(jackpot)}`;

  return (
    <section
      className="relative overflow-hidden rounded-[var(--radius-2xl)] border border-[var(--color-border)] md:min-h-[330px]"
      style={{
        background: 'linear-gradient(120deg, #12061a, #0a0008)',
      }}
    >
      {/* ===== DESKTOP (md+) ===== */}

      {/* Imagen del Gaucho — lado derecho */}
      <img
        src="/brand/gaucho-hero.png"
        alt="El Gaucho Phantom"
        className="pointer-events-none absolute right-0 top-0 hidden h-full w-1/2 object-cover md:block"
        style={{ objectPosition: 'right' }}
      />

      {/* Overlay degradado: dark sólido a la izquierda → transparente a la derecha */}
      <div
        className="pointer-events-none absolute inset-0 hidden md:block"
        style={{
          background:
            'linear-gradient(90deg, #0a0008 28%, rgba(10,0,8,.4) 55%, transparent 100%)',
        }}
      />

      {/* Glow radial cian sutil detrás del contenido */}
      <div
        className="pointer-events-none absolute -left-24 top-1/2 hidden h-[420px] w-[420px] -translate-y-1/2 blur-3xl md:block"
        style={{
          background:
            'radial-gradient(closest-side, color-mix(in srgb, var(--color-accent) 12%, transparent), transparent 70%)',
        }}
      />

      {/* Glows flotantes decorativos */}
      <div
        className="animate-tg-float pointer-events-none absolute right-[36%] top-10 hidden h-24 w-24 rounded-full blur-2xl md:block"
        style={{
          background:
            'radial-gradient(closest-side, color-mix(in srgb, var(--color-accent) 28%, transparent), transparent 70%)',
        }}
      />
      <div
        className="animate-tg-float pointer-events-none absolute right-[18%] bottom-8 hidden h-20 w-20 rounded-full blur-2xl md:block"
        style={{
          background:
            'radial-gradient(closest-side, color-mix(in srgb, var(--color-accent) 20%, transparent), transparent 70%)',
          animationDelay: '1.2s',
        }}
      />

      {/* Contenido desktop — lado izquierdo */}
      <div className="relative z-10 hidden max-w-[58%] flex-col gap-5 p-8 sm:p-10 md:flex">
        <span className="text-[11px] uppercase tracking-[.22em] text-[var(--color-accent-text)]">
          {tagline}
        </span>

        <h1 className="font-display text-[44px] leading-tight text-[var(--color-fg)]">
          Hasta{' '}
          <span className="text-[var(--color-accent-text)]">$200.000</span> + 200
          giros gratis
        </h1>

        <p className="max-w-[420px] text-[14px] text-[var(--color-fg-muted)]">
          El dueño de la noche te da la bienvenida. Depositá y empezá a girar.
        </p>

        {/* Fila de acciones */}
        <div className="mt-2 flex flex-wrap items-center gap-6">
          <Link
            href="/play/lobby"
            className="animate-tg-glow inline-flex h-12 items-center justify-center rounded-[var(--radius)] px-6 font-semibold text-[var(--color-accent-fg)]"
            style={{ background: 'var(--gradient-accent)' }}
          >
            Jugar ahora
          </Link>

          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-[.18em] text-[var(--color-gold)]">
              Jackpot en vivo
            </span>
            <span
              className="font-display text-[26px] leading-none tabular-nums text-[var(--color-gold)]"
              style={{ textShadow: '0 0 18px rgba(240,196,106,.45)' }}
            >
              {jackpotValue}
            </span>
          </div>
        </div>
      </div>

      {/* ===== MOBILE (<md) ===== */}
      <div className="flex flex-col md:hidden">
        {/* Banda superior con la imagen del Gaucho + fade al dark */}
        <div className="relative h-[168px] w-full overflow-hidden">
          <img
            src="/brand/gaucho-hero.png"
            alt="El Gaucho Phantom"
            className="pointer-events-none h-full w-full object-cover"
            style={{ objectPosition: 'center top' }}
          />
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'linear-gradient(180deg, transparent 40%, var(--color-bg-elevated) 100%)',
            }}
          />
        </div>

        {/* Texto debajo de la banda */}
        <div className="relative z-10 flex flex-col gap-4 p-6">
          <span className="text-[11px] uppercase tracking-[.22em] text-[var(--color-accent-text)]">
            {tagline}
          </span>

          <h1 className="font-display text-[27px] leading-tight text-[var(--color-fg)]">
            Hasta{' '}
            <span className="text-[var(--color-accent-text)]">$200.000</span> + 200
            giros gratis
          </h1>

          <p className="text-[14px] text-[var(--color-fg-muted)]">
            El dueño de la noche te da la bienvenida. Depositá y empezá a girar.
          </p>

          {/* Fila de acciones: Jugar (flex-1) + Jackpot a la derecha */}
          <div className="mt-1 flex items-center gap-4">
            <Link
              href="/play/lobby"
              className="animate-tg-glow inline-flex h-12 flex-1 items-center justify-center rounded-[var(--radius)] px-6 font-semibold text-[var(--color-accent-fg)]"
              style={{ background: 'var(--gradient-accent)' }}
            >
              Jugar ahora
            </Link>

            <div className="flex flex-col items-end">
              <span className="text-[10px] uppercase tracking-[.18em] text-[var(--color-gold)]">
                Jackpot en vivo
              </span>
              <span
                className="font-display text-[22px] leading-none tabular-nums text-[var(--color-gold)]"
                style={{ textShadow: '0 0 18px rgba(240,196,106,.45)' }}
              >
                {jackpotValue}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
