/**
 * SectionApariencia — tema + paleta completa de colores del player.
 * Guarda el slice `colors` de design.config y sincroniza el color accent
 * con branding.primary_color (el backend lo aplica como --color-accent).
 */

'use client';

import { useTheme, THEMES, type ThemeId } from '@/lib/hooks/use-theme';
import type { DesignEditorApi } from './use-design-editor';
import { SaveButton, SectionCard } from './settings-common';

const COLOR_GROUPS: Array<{
  group: string;
  desc: string;
  keys: Array<{ key: 'bgColor' | 'bgElevated' | 'bgSubtle' | 'fgColor' | 'fgMuted' | 'fgSubtle' | 'borderColor' | 'borderStrong' | 'accentColor' | 'accentHover' | 'accentFg' | 'accentText' | 'accentSubtle' | 'accentBorder' | 'success' | 'warning' | 'magenta' | 'cyan' | 'purple' | 'gold'; label: string; desc: string }>;
}> = [
  {
    group: 'Fondos',
    desc: 'Capas de profundidad de la página',
    keys: [
      { key: 'bgColor', label: 'Fondo principal', desc: 'Color base de toda la página' },
      { key: 'bgElevated', label: 'Paneles y tarjetas', desc: 'Sidebars, modals, cards elevados' },
      { key: 'bgSubtle', label: 'Inputs y badges', desc: 'Campos de texto, pills, chips' },
    ],
  },
  {
    group: 'Texto',
    desc: 'Jerarquía de lectura',
    keys: [
      { key: 'fgColor', label: 'Texto principal', desc: 'Títulos, cuerpo, contenido primario' },
      { key: 'fgMuted', label: 'Texto secundario', desc: 'Subtítulos, descripciones, labels' },
      { key: 'fgSubtle', label: 'Texto sutil', desc: 'Placeholders, hints, timestamps' },
    ],
  },
  {
    group: 'Bordes',
    desc: 'Separadores y contornos',
    keys: [
      { key: 'borderColor', label: 'Bordes sutiles', desc: 'Separadores entre secciones' },
      { key: 'borderStrong', label: 'Bordes fuertes', desc: 'Contornos de inputs focus, cards activas' },
    ],
  },
  {
    group: 'Accent',
    desc: 'Identidad visual de la marca (se sincroniza a --color-accent del player)',
    keys: [
      { key: 'accentColor', label: 'Color principal', desc: 'Botones CTA, links, highlights' },
      { key: 'accentHover', label: 'Hover de botones', desc: 'Estado hover del accent principal' },
      { key: 'accentFg', label: 'Texto sobre accent', desc: 'Color del texto dentro de botones' },
      { key: 'accentText', label: 'Texto accent', desc: 'Links, texto destacado en contenido' },
      { key: 'accentSubtle', label: 'Fondo accent sutil', desc: 'Badges, tags, highlights de fondo' },
      { key: 'accentBorder', label: 'Borde accent', desc: 'Bordes de tags, badges, items activos' },
    ],
  },
  {
    group: 'Semántico',
    desc: 'Estados funcionales y acentos extra',
    keys: [
      { key: 'success', label: 'Éxito / Saldo', desc: 'Ganancias, confirmaciones, saldo positivo' },
      { key: 'warning', label: 'Advertencia', desc: 'Alertas, estados en juego' },
      { key: 'magenta', label: 'Magenta', desc: 'Acento decorativo, niveles VIP' },
      { key: 'cyan', label: 'Cyan', desc: 'Crash games, acento tech' },
      { key: 'purple', label: 'Púrpura', desc: 'Live casino, acento premium' },
      { key: 'gold', label: 'Dorado', desc: 'Bonos, recompensas, logros' },
    ],
  },
];

export function SectionApariencia({ editor }: { editor: DesignEditorApi }) {
  const { form, isSaving, saveAppearance } = editor;
  const { register, watch } = form;
  const { theme: activeTheme, setTheme } = useTheme();

  const pickTheme = (tid: ThemeId) => {
    setTheme(tid);
    form.setValue('accentColor', THEMES[tid].vars.accent);
  };

  return (
    <SectionCard
      title="Apariencia"
      description="Los colores y el estilo que ve el jugador. El panel admin queda igual."
      footer={
        <SaveButton
          onClick={saveAppearance}
          isSaving={isSaving}
          label="Guardar apariencia"
        />
      }
    >
      {/* Tema */}
      <div>
        <h3 className="text-xs font-semibold text-[var(--color-fg)] uppercase tracking-wide">
          Tema base
        </h3>
        <p className="text-[10px] text-[var(--color-fg-subtle)] mb-2">
          Empezá desde un color de marca. Al elegir uno, se aplica como color principal de la paleta.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {(Object.keys(THEMES) as ThemeId[]).map((tid) => (
            <button
              key={tid}
              type="button"
              onClick={() => pickTheme(tid)}
              className={`flex flex-col items-center gap-2 rounded-[var(--radius)] border p-4 transition-all ${
                activeTheme === tid
                  ? 'border-[var(--color-accent)] ring-1 ring-[var(--color-accent)]'
                  : 'border-[var(--color-border)] hover:border-[var(--color-accent-border)]'
              }`}
            >
              <div
                className="size-8 rounded-full border-2"
                style={{ backgroundColor: THEMES[tid].vars.accent, borderColor: THEMES[tid].vars.accentBorder }}
              />
              <span className="text-xs font-medium">{THEMES[tid].label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Paleta */}
      <div className="pt-1">
        <h3 className="text-xs font-semibold text-[var(--color-fg)] uppercase tracking-wide">
          Paleta de colores
        </h3>
        <div className="mt-3 flex flex-col gap-4">
          {COLOR_GROUPS.map(({ group, desc, keys }) => (
            <div key={group}>
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-[11px] font-semibold text-[var(--color-fg)]">{group}</span>
                <span className="text-[10px] text-[var(--color-fg-subtle)]">{desc}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {keys.map(({ key, label, desc: colorDesc }) => (
                  <div key={key} className="flex items-center gap-3 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2">
                    <input type="color" {...register(key)} className="size-8 rounded border border-[var(--color-border)] cursor-pointer shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium text-[var(--color-fg)]">{label}</span>
                        <span className="text-[9px] font-mono text-[var(--color-fg-subtle)]">{watch(key)}</span>
                      </div>
                      <span className="text-[10px] text-[var(--color-fg-muted)] block">{colorDesc}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </SectionCard>
  );
}
