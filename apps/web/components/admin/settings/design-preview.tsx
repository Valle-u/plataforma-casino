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
        <div className="w-[180px] shrink-0 flex flex-col p-3 border-r" style={{ backgroundColor: 'var(--p-bg-elevated)', borderColor: 'var(--p-border)' }}>
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
        <div className="flex-1 flex flex-col p-4 gap-3 overflow-hidden">
          {/* Header bar */}
          <div className="flex items-center justify-between pb-3 border-b" style={{ borderColor: 'var(--p-border)' }}>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full" style={{ backgroundColor: 'var(--p-bg-subtle)', border: '1px solid var(--p-border)' }}>
              <span className="size-1.5 rounded-full" style={{ backgroundColor: 'var(--p-success)' }} />
              <span className="text-[10px]" style={{ color: 'var(--p-fg-muted)' }}>$ 12,500 fichas</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="px-2 py-1 rounded text-[9px] font-semibold" style={{ backgroundColor: 'var(--p-accent)', color: 'var(--p-accent-fg)' }}>Depositar</div>
              <div className="size-6 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--p-bg-subtle)', border: '1px solid var(--p-border)' }}>
                <span className="text-[9px]" style={{ color: 'var(--p-fg-muted)' }}>3</span>
              </div>
              <div className="size-6 rounded-full" style={{ backgroundColor: 'var(--p-accent-subtle)', border: '1px solid var(--p-accent-border)' }} />
            </div>
          </div>

          {/* Hero banner */}
          <div className="h-24 rounded-[var(--radius)] flex items-end p-3 relative overflow-hidden" style={{ background: `linear-gradient(135deg, ${colors.accentColor || '#ff2ea0'}33, ${colors.accentColor || '#ff2ea0'}08)` }}>
            <div className="absolute top-2 right-3">
              <span className="text-[9px] px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: 'var(--p-accent)', color: 'var(--p-accent-fg)' }}>NEW</span>
            </div>
            {/* Sigue el lado del primer slide, para que la preview no
                contradiga el selector "Lado del texto". */}
            <div className={slides[0]?.align === 'right' ? 'ml-auto text-right' : ''}>
              <span className="text-[9px] font-medium block" style={{ color: 'var(--p-accent-text)' }}>{slides[0]?.kicker || 'Bienvenido'}</span>
              <span className="text-sm font-bold block" style={{ color: 'var(--p-fg)' }}>{colors.heroTitle || 'El Casino del Pueblo'}</span>
              <span className="text-[10px] block mt-0.5" style={{ color: 'var(--p-fg-muted)' }}>{colors.heroSubtitle || 'Viví la experiencia'}</span>
            </div>
          </div>

          {/* Category tiles */}
          <div className="flex gap-2">
            {[
              { label: 'Slots', color: colors.accentColor || '#ff2ea0', count: 1200 },
              { label: 'En vivo', color: colors.purple || '#9b4dff', count: 48 },
              { label: 'Crash', color: colors.cyan || '#00e5ff', count: 12 },
              { label: 'Ruleta', color: colors.gold || '#f0c46a', count: 24 },
            ].map((cat) => (
              <div key={cat.label} className="flex-1 rounded-[var(--radius)] px-2 py-2 text-center" style={{ backgroundColor: `${cat.color}12`, border: `1px solid ${cat.color}30` }}>
                <span className="text-[9px] font-semibold block" style={{ color: cat.color }}>{cat.label}</span>
                <span className="text-[8px]" style={{ color: 'var(--p-fg-subtle)' }}>{cat.count}</span>
              </div>
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

          {/* Stats row */}
          <div className="flex gap-2 mt-auto">
            {[
              { label: 'Total ganado', value: '$ 3,200', color: 'var(--p-success)' },
              { label: 'En juego', value: '$ 500', color: 'var(--p-warning)' },
              { label: 'Disponible', value: '$ 12,500', color: 'var(--p-fg)' },
            ].map((stat) => (
              <div key={stat.label} className="flex-1 rounded-[var(--radius)] px-2.5 py-2" style={{ backgroundColor: 'var(--p-bg-subtle)', border: '1px solid var(--p-border)' }}>
                <div className="text-[8px]" style={{ color: 'var(--p-fg-subtle)' }}>{stat.label}</div>
                <div className="text-[11px] font-semibold mt-0.5" style={{ color: stat.color }}>{stat.value}</div>
              </div>
            ))}
          </div>

          {/* Bottom nav (mobile mock) */}
          <div className="flex items-center justify-around py-2 -mx-4 -mb-4 mt-1 border-t" style={{ borderColor: 'var(--p-border)', backgroundColor: 'var(--p-bg-elevated)' }}>
            {[
              { label: 'Inicio', active: true },
              { label: 'Juegos', active: false },
              { label: 'Depositar', active: false, accent: true },
              { label: 'Bonos', active: false },
              { label: 'Perfil', active: false },
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
