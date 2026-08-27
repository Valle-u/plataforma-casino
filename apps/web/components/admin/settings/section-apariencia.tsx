/**
 * SectionApariencia — apariencia del sitio del jugador, modelo simple.
 *
 * El operador elige 2 cosas — color de marca + fondo — y el motor
 * `derivePalette` genera las 20 variantes (hover, texto sobre accent,
 * bordes, capas de fondo) automáticamente, consistentes y con contraste.
 * Así es fácil de modificar y no hay campos rgba que se rompan.
 *
 * Guarda el slice `colors` de design.config + sincroniza el accent con
 * branding.primary_color. El panel admin queda sobrio; estos colores
 * aplican al sitio del jugador (preview en vivo abajo).
 */

'use client';

import { useTheme, THEMES, type ThemeId } from '@/lib/hooks/use-theme';
import { derivePalette } from '@/lib/palette';
import type { DesignEditorApi } from './use-design-editor';
import { DesignPreview } from './design-preview';
import { SaveButton, SectionCard } from './settings-common';

/** Fondos base sugeridos (el operador puede elegir otro con el picker). */
const BG_PRESETS: Array<{ label: string; value: string }> = [
  { label: 'Negro', value: '#0b0b0b' },
  { label: 'Negro violáceo', value: '#0a0008' },
  { label: 'Azul noche', value: '#080b16' },
  { label: 'Verde bosque', value: '#07110c' },
  { label: 'Vino', value: '#120609' },
  { label: 'Claro', value: '#f4f4f7' },
];

export function SectionApariencia({ editor }: { editor: DesignEditorApi }) {
  const { form, isSaving, saveAppearance } = editor;
  const { register, watch, getValues, setValue } = form;
  const { theme: activeTheme, setTheme } = useTheme();

  const accent = watch('accentColor');
  const bg = watch('bgColor');

  /** Deriva las 20 variantes desde marca + fondo y las vuelca al form. */
  const applyDerived = (nextAccent: string, nextBg: string) => {
    const cur = getValues();
    const derived = derivePalette({
      accent: nextAccent,
      bg: nextBg,
      semantic: {
        success: cur.success,
        warning: cur.warning,
        magenta: cur.magenta,
        cyan: cur.cyan,
        purple: cur.purple,
        gold: cur.gold,
      },
    });
    for (const [key, value] of Object.entries(derived)) {
      setValue(key as keyof typeof derived, value, { shouldDirty: true });
    }
  };

  const pickTheme = (tid: ThemeId) => {
    setTheme(tid);
    applyDerived(THEMES[tid].vars.accent, getValues().bgColor);
  };

  return (
    <SectionCard
      title="Apariencia"
      description="Elegí el color de marca y el fondo; el resto de la paleta se genera solo. Aplica al sitio del jugador (el panel admin queda sobrio). Mirá el resultado en el preview de abajo."
      footer={
        <SaveButton
          onClick={saveAppearance}
          isSaving={isSaving}
          label="Guardar apariencia"
        />
      }
    >
      {/* Los dos controles clave */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Knob
          label="Color de marca"
          desc="Botones, links y detalles destacados."
          value={accent}
          onChange={(v) => applyDerived(v, getValues().bgColor)}
        />
        <Knob
          label="Fondo"
          desc="Define claro/oscuro y el tono general."
          value={bg}
          onChange={(v) => applyDerived(getValues().accentColor, v)}
          presets={BG_PRESETS}
        />
      </div>

      {/* Puntos de partida por color de marca */}
      <div>
        <h3 className="text-[11px] font-semibold text-[var(--color-fg)] uppercase tracking-wide">
          Puntos de partida
        </h3>
        <p className="text-[10px] text-[var(--color-fg-subtle)] mb-2">
          Colores de marca pre-armados. Al elegir uno se aplica como color
          principal y se re-deriva la paleta.
        </p>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {(Object.keys(THEMES) as ThemeId[]).map((tid) => (
            <button
              key={tid}
              type="button"
              onClick={() => pickTheme(tid)}
              className={`flex flex-col items-center gap-1.5 rounded-[var(--radius-sm)] border p-2.5 transition-all ${
                activeTheme === tid
                  ? 'border-[var(--color-accent)] ring-1 ring-[var(--color-accent)]'
                  : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)]'
              }`}
            >
              <span
                className="size-6 rounded-full border-2"
                style={{
                  backgroundColor: THEMES[tid].vars.accent,
                  borderColor: THEMES[tid].vars.accentBorder,
                }}
              />
              <span className="text-[10px] font-medium">{THEMES[tid].label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Hidden inputs: mantienen los 20 tokens en el form (para guardar +
          para el play layout). No se editan a mano; se derivan. */}
      <input type="hidden" {...register('accentColor')} />
      <input type="hidden" {...register('bgColor')} />

      {/* Preview en vivo del sitio del jugador */}
      <div>
        <h3 className="text-[11px] font-semibold text-[var(--color-fg)] uppercase tracking-wide mb-2">
          Preview del sitio del jugador
        </h3>
        <DesignPreview editor={editor} />
      </div>
    </SectionCard>
  );
}

function Knob({
  label,
  desc,
  value,
  onChange,
  presets,
}: {
  label: string;
  desc: string;
  value: string;
  onChange: (v: string) => void;
  presets?: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
      <div className="flex items-center gap-3">
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value ?? '') ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="size-11 lg:size-10 rounded-[var(--radius-sm)] border border-[var(--color-border)] cursor-pointer shrink-0"
          aria-label={label}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-semibold text-[var(--color-fg)]">
              {label}
            </span>
            <span className="text-[10px] font-mono text-[var(--color-fg-subtle)]">
              {value}
            </span>
          </div>
          <span className="text-[10px] text-[var(--color-fg-muted)] block leading-snug">
            {desc}
          </span>
        </div>
      </div>
      {presets && (
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => onChange(p.value)}
              title={p.label}
              className="flex items-center gap-1.5 h-6 pl-1 pr-2 rounded-full border border-[var(--color-border)] hover:border-[var(--color-border-strong)] transition-colors"
            >
              <span
                className="size-3.5 rounded-full border border-[var(--color-border)]"
                style={{ backgroundColor: p.value }}
              />
              <span className="text-[10px] text-[var(--color-fg-muted)]">
                {p.label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
