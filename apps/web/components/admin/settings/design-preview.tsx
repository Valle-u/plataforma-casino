/**
 * DesignPreview — preview en vivo de la home del player.
 *
 * Extraído del viejo page `(admin)/design`. Usa el estado compartido del
 * `useDesignEditor` (colores, textos, slides, nombre de la marca) para
 * reaccionar en vivo a los cambios de las secciones Marca / Apariencia /
 * Home del jugador.
 */

'use client';

import type { DesignEditorApi } from './use-design-editor';

export function DesignPreview({ editor }: { editor: DesignEditorApi }) {
  const { form, slides, previewVars } = editor;
  const colors = form.watch();
  // El primer slide manda en el banner: su foto y su lado del texto. Antes la
  // preview pintaba solo un gradiente con el color de acento, así que
  // configurabas banners sin ver la imagen que elegías.
  const heroImg = slides[0]?.imageDesktop || slides[0]?.imageMobile || '';
  const heroRight = slides[0]?.align === 'right';
  return (
    <div
      className="mb-8 overflow-hidden rounded-[var(--radius-xl)] border"
      style={{ ...previewVars, borderColor: 'var(--p-border)', backgroundColor: 'var(--p-bg)' }}
    >
      {/* Label preview */}
      <div className="px-4 pt-3 pb-1 flex items-center gap-2">
        <span className="size-2 rounded-full bg-[var(--p-accent)]" />
        <span className="text-[10px] uppercase tracking-wider font-medium" style={{ color: 'var(--p-fg-muted)' }}>
          Preview en vivo
        </span>
      </div>

      {/* Layout: sidebar + main */}
      <div className="flex h-[520px]">
        {/* Sidebar mock */}
        {/* El sidebar es decorativo y estaba fijo en 180px: dentro de un
            contenedor de 301px (mobile) se comía el 60% y al contenido real
            le quedaban 119px cuando necesita 210 — se veía cortado al medio.
            Se oculta abajo de `sm`, que además es más fiel: el sitio del
            jugador tampoco muestra sidebar en mobile (usa appbar + drawer). */}
        <div className="hidden sm:flex w-[180px] shrink-0 flex-col p-3 border-r" style={{ backgroundColor: 'var(--p-bg-elevated)', borderColor: 'var(--p-border)' }}>
          <div className="h-6 w-20 rounded mb-6" style={{ backgroundColor: `${colors.accentColor || '#ff2ea0'}22` }}>
            <span className="text-[10px] font-bold px-2 leading-6" style={{ color: 'var(--p-accent-text)' }}>{colors.platformName || 'CASINO'}</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {[
              { label: 'Casino', active: true },
              { label: 'Slots', active: false },
              { label: 'En vivo', active: false },
              { label: 'Wallet', active: false },
              { label: 'Depósitos', active: false },
              { label: 'Bonos', active: false },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-2 px-2 py-1.5 rounded text-[11px]" style={{
                backgroundColor: item.active ? 'var(--p-accent-subtle)' : 'transparent',
                color: item.active ? 'var(--p-fg)' : 'var(--p-fg-muted)',
              }}>
                <span className="size-1.5 rounded-full shrink-0" style={{ backgroundColor: item.active ? 'var(--p-accent)' : 'var(--p-fg-subtle)' }} />
                {item.label}
              </div>
            ))}
          </div>
          <div className="mt-auto pt-3 border-t flex flex-col gap-1.5" style={{ borderColor: 'var(--p-border)' }}>
            <div className="flex items-center gap-2">
              <div className="size-7 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ backgroundColor: 'var(--p-accent-subtle)', color: 'var(--p-accent-text)' }}>J</div>
              <div className="flex flex-col">
                <span className="text-[10px] font-medium" style={{ color: 'var(--p-fg)' }}>Jugador</span>
                <span className="text-[9px]" style={{ color: 'var(--p-fg-subtle)' }}>Nivel 5</span>
              </div>
            </div>
            <div className="rounded px-2 py-1.5" style={{ backgroundColor: 'var(--p-bg-subtle)', border: '1px solid var(--p-border)' }}>
              <div className="text-[8px]" style={{ color: 'var(--p-fg-subtle)' }}>Saldo</div>
              <div className="text-[11px] font-semibold" style={{ color: 'var(--p-success)' }}>$ 12,500</div>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Banner A SANGRE — espeja LobbyBanner: la foto del slide ocupa
              todo, el copy va encima con viñeta lateral, y el header del
              jugador flota arriba (en el sitio real el contenido arranca con
              `-mt-14`, detrás del header translúcido). */}
          <div className="relative h-32 shrink-0 overflow-hidden" style={{ backgroundColor: '#150518' }}>
            {heroImg && (
              <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${heroImg})` }} />
            )}
            <div
              className="absolute inset-0"
              style={{
                background: `linear-gradient(${heroRight ? 270 : 90}deg, rgba(10,0,8,.94) 0%, rgba(10,0,8,.75) 34%, rgba(10,0,8,.15) 62%, rgba(10,0,8,.35) 100%)`,
              }}
            />

            {/* Header flotante del jugador */}
            <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-3 py-2">
              <div className="flex items-center gap-1.5">
                <span className="size-3.5 rounded-full" style={{ backgroundColor: 'rgba(255,255,255,.15)' }} />
                <span className="text-[9px] font-bold" style={{ color: 'var(--p-accent-text)' }}>{colors.platformName || 'CASINO'}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="flex items-center gap-1 rounded-[7px] px-1.5 py-0.5" style={{ backgroundColor: 'rgba(10,0,8,.55)', border: '1px solid rgba(255,255,255,.18)' }}>
                  <span className="size-1 rounded-full" style={{ backgroundColor: 'var(--p-accent)' }} />
                  <span className="text-[8px] font-semibold" style={{ color: 'var(--p-fg)' }}>$ 12.500</span>
                </div>
                <span className="size-4 rounded-full" style={{ backgroundColor: 'rgba(10,0,8,.4)', border: '1px solid rgba(255,255,255,.15)' }} />
              </div>
            </div>

            {/* Copy sobre la foto — sigue el lado del primer slide */}
            <div className={`relative z-[5] flex h-full max-w-[62%] flex-col justify-center gap-1 px-3 ${heroRight ? 'ml-auto items-end text-right' : ''}`}>
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.14em]" style={{
                backgroundColor: 'color-mix(in srgb, var(--p-accent) 14%, transparent)',
                border: '1px solid color-mix(in srgb, var(--p-accent) 45%, transparent)',
                color: 'var(--p-accent-text)',
              }}>
                {slides[0]?.kicker || 'Bienvenido'}
              </span>
              <span className="text-[15px] font-bold leading-[0.95] tracking-tight" style={{ color: 'var(--p-fg)', textShadow: '0 2px 14px rgba(10,0,8,.9)' }}>
                {slides[0]?.title || colors.heroTitle || 'El Casino del Pueblo'}
              </span>
              <span className="text-[8px] leading-snug" style={{ color: '#e6d2ee', textShadow: '0 1px 8px rgba(10,0,8,.9)' }}>
                {slides[0]?.body || colors.heroSubtitle || 'Viví la mejor experiencia.'}
              </span>
            </div>

            {/* Indicadores de slide */}
            <div className={`absolute bottom-2 z-[5] flex gap-1 ${heroRight ? 'right-3' : 'left-3'}`}>
              {(slides.length ? slides : [0, 0, 0, 0]).slice(0, 4).map((_, i) => (
                <span key={i} className="h-[2px] w-4 rounded-full" style={{ backgroundColor: i === 0 ? 'var(--p-accent)' : 'rgba(255,255,255,.22)' }} />
              ))}
            </div>
          </div>

          {/* Franja "Ganando ahora" — existe en la home real y faltaba acá. */}
          <div className="flex h-6 shrink-0 items-center overflow-hidden border-y" style={{
            borderColor: 'color-mix(in srgb, var(--p-accent) 18%, transparent)',
            backgroundColor: 'color-mix(in srgb, var(--p-bg) 86%, #000)',
          }}>
            <div className="flex shrink-0 items-center gap-1 border-r px-2" style={{ borderColor: 'var(--p-border)' }}>
              <span className="size-1 rounded-full" style={{ backgroundColor: 'var(--p-success)' }} />
              <span className="text-[7px] font-medium uppercase tracking-[.14em]" style={{ color: 'var(--p-fg-muted)' }}>Ganando ahora</span>
            </div>
            <div className="flex min-w-0 items-center gap-3 px-2">
              {[
                { u: 'rochi.ok', g: 'Neón Royale', m: '$29.807' },
                { u: 'sabri_uy', g: 'Buffalo King', m: '$18.522' },
              ].map((w) => (
                <span key={w.u} className="whitespace-nowrap text-[7px]" style={{ color: 'var(--p-fg-subtle)' }}>
                  {w.u} · {w.g} · <span style={{ color: 'var(--p-success)' }}>{w.m}</span>
                </span>
              ))}
            </div>
          </div>

          {/* Contenido del lobby */}
          <div className="flex flex-1 flex-col gap-3 overflow-hidden p-4">
            {/* Chips de categoría — mismas que el lobby real. */}
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: 'Todos', color: colors.accentColor || '#ff2ea0', active: true },
                { label: 'Slots', color: colors.accentColor || '#ff2ea0' },
                { label: 'En vivo', color: colors.purple || '#9b4dff' },
                { label: 'Crash', color: colors.cyan || '#00e5ff' },
                { label: 'Mesa', color: colors.gold || '#f0c46a' },
                { label: 'Mini', color: 'var(--p-fg-muted)' },
              ].map((cat) => (
                <span key={cat.label} className="rounded-full px-2 py-0.5 text-[8px] font-medium" style={{
                  backgroundColor: cat.active ? 'var(--p-accent)' : `${cat.color}14`,
                  border: `1px solid ${cat.active ? 'var(--p-accent)' : `${cat.color}30`}`,
                  color: cat.active ? 'var(--p-accent-fg)' : cat.color,
                }}>
                  {cat.label}
                </span>
              ))}
            </div>

          {/* Section title */}
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold" style={{ color: 'var(--p-fg)' }}>{colors.tilesTitle || 'Categorías'}</span>
            <span className="text-[9px]" style={{ color: 'var(--p-accent-text)' }}>Ver todo →</span>
          </div>

          {/* Game cards grid */}
          <div className="grid grid-cols-4 gap-2">
            {[
              { name: 'Gates of Olympus', provider: 'Pragmatic', tag: 'Popular' },
              { name: 'Sweet Bonanza', provider: 'Pragmatic', tag: 'Nuevo' },
              { name: 'Aviator', provider: 'Spribe', tag: 'Crash' },
              { name: 'Crazy Time', provider: 'Evolution', tag: 'Live' },
            ].map((game, i) => (
              <div key={i} className="aspect-[3/4] rounded-[var(--radius)] flex flex-col justify-end relative overflow-hidden" style={{
                backgroundColor: 'var(--p-bg-elevated)',
                border: '1px solid var(--p-border)',
              }}>
                <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, transparent 40%, ${colors.accentColor || '#ff2ea0'}15 100%)` }} />
                <span className="absolute top-1.5 left-1.5 text-[7px] px-1 py-0.5 rounded font-medium" style={{
                  backgroundColor: i === 0 ? 'var(--p-accent)' : i === 1 ? 'var(--p-success)' : i === 2 ? `${colors.cyan || '#00e5ff'}20` : `${colors.purple || '#9b4dff'}20`,
                  color: i === 0 ? 'var(--p-accent-fg)' : i === 1 ? '#000' : i === 2 ? (colors.cyan || '#00e5ff') : (colors.purple || '#9b4dff'),
                }}>{game.tag}</span>
                <div className="relative p-1.5">
                  <div className="h-1.5 w-3/4 rounded-full mb-0.5" style={{ backgroundColor: 'var(--p-fg)' }} />
                  <div className="h-1 w-1/2 rounded-full" style={{ backgroundColor: 'var(--p-fg-subtle)' }} />
                </div>
              </div>
            ))}
          </div>

          </div>

          {/* Bottom nav — labels reales de PlayerBottomNav. Antes decía
              "Inicio / Juegos / Depositar / Bonos / Perfil", que no existe. */}
          <div className="flex shrink-0 items-center justify-around border-t py-2" style={{ borderColor: 'var(--p-border)', backgroundColor: 'var(--p-bg-elevated)' }}>
            {[
              { label: 'Juegos', active: false },
              { label: 'Mi cuenta', active: false },
              { label: 'Casino', active: true },
              { label: 'Depositar', active: false, accent: true },
              { label: 'Retirar', active: false },
            ].map((tab) => (
              <div key={tab.label} className="flex flex-col items-center gap-0.5">
                <span className="size-3 rounded-full" style={{
                  backgroundColor: tab.accent ? 'var(--p-accent)' : tab.active ? 'var(--p-accent)' : 'var(--p-fg-subtle)',
                }} />
                <span className="text-[7px]" style={{
                  color: tab.active || tab.accent ? 'var(--p-accent-text)' : 'var(--p-fg-subtle)',
                }}>{tab.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
