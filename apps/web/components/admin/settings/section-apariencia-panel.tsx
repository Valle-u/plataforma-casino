/**
 * SectionAparienciaPanel — apariencia del panel de control (admin).
 *
 * El operador elige 2 cosas — color de acento + fondo — y el motor
 * `deriveAdminVars` genera el resto de la paleta del panel (capas de
 * fondo, texto, bordes, variantes de acento). A diferencia de la
 * apariencia del jugador, acá NO hace falta preview: la sección vive
 * DENTRO del panel, así que al tocar un color el panel entero se
 * recolorea en vivo.
 *
 * Guarda en el setting `admin.appearance` (independiente de la marca del
 * jugador). Los colores semánticos (verde=entra, rojo=sale, ámbar,
 * azul=info) quedan fijos: un color = una acción.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RotateCcw } from 'lucide-react';
import { apiDelete, apiPatch, isApiError } from '@/lib/api-client';
import { adminAccentVars } from '@/lib/admin-accent';
import {
  ADMIN_ACCENT_PRESETS,
  ADMIN_APPEARANCE_KEY,
  ADMIN_BG_PRESETS,
  DEFAULT_ADMIN_APPEARANCE,
  cacheAdminAppearance,
  deriveAdminVars,
  injectAdminVars,
  type AdminAppearance,
} from '@/lib/admin-appearance';
import { useTenantInfo } from '@/lib/hooks/use-tenant-branding';
import { SaveButton, SectionCard } from './settings-common';

const HEX6 = /^#[0-9a-fA-F]{6}$/;

export function SectionAparienciaPanel() {
  const tenantInfo = useTenantInfo();
  const qc = useQueryClient();

  const persisted = tenantInfo.data?.adminAppearance ?? null;
  const primaryColor = tenantInfo.data?.branding?.primaryColor ?? null;

  const [accent, setAccent] = useState(DEFAULT_ADMIN_APPEARANCE.accent);
  const [bg, setBg] = useState(DEFAULT_ADMIN_APPEARANCE.bg);
  const [isSaving, setIsSaving] = useState(false);

  // Sincronizar desde el server una sola vez (no pisar ediciones en curso).
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !tenantInfo.isSuccess) return;
    seeded.current = true;
    if (persisted) {
      setAccent(persisted.accent);
      setBg(persisted.bg);
    }
  }, [tenantInfo.isSuccess, persisted]);

  // Vista previa en vivo: recolorea el panel entero mientras se edita.
  useEffect(() => {
    if (!HEX6.test(accent) || !HEX6.test(bg)) return;
    injectAdminVars(deriveAdminVars({ accent, bg }));
  }, [accent, bg]);

  // Al salir de la sección sin guardar, restauramos lo persistido (o el
  // acento de marca) para que el borrador no quede pegado en el panel.
  const restoreRef = useRef<() => void>(() => {});
  restoreRef.current = () => {
    if (persisted) injectAdminVars(deriveAdminVars(persisted));
    else injectAdminVars(primaryColor ? adminAccentVars(primaryColor) : null);
  };
  useEffect(() => () => restoreRef.current(), []);

  const current: AdminAppearance = { accent, bg };
  const baseline = persisted ?? DEFAULT_ADMIN_APPEARANCE;
  const isDirty =
    accent.toLowerCase() !== baseline.accent.toLowerCase() ||
    bg.toLowerCase() !== baseline.bg.toLowerCase();
  const valid = HEX6.test(accent) && HEX6.test(bg);

  const save = async () => {
    if (!valid) {
      toast.error('Revisá los colores', { description: 'Usá un hex #RRGGBB.' });
      return;
    }
    setIsSaving(true);
    try {
      await apiPatch(`/tenant/settings/${ADMIN_APPEARANCE_KEY}`, {
        value: current,
      });
      cacheAdminAppearance(current);
      await qc.invalidateQueries({ queryKey: ['tenant-info'] });
      await qc.invalidateQueries({ queryKey: ['tenant-settings'] });
      toast.success('Apariencia del panel guardada');
    } catch (err) {
      const msg = isApiError(err) ? err.message : 'Error de conexión.';
      toast.error('Error al guardar', { description: msg });
    } finally {
      setIsSaving(false);
    }
  };

  const resetToNeutral = async () => {
    setIsSaving(true);
    try {
      await apiDelete(`/tenant/settings/${ADMIN_APPEARANCE_KEY}`);
      cacheAdminAppearance(null);
      setAccent(DEFAULT_ADMIN_APPEARANCE.accent);
      setBg(DEFAULT_ADMIN_APPEARANCE.bg);
      // Restaurar de inmediato: base neutra + acento de marca si existe.
      injectAdminVars(primaryColor ? adminAccentVars(primaryColor) : null);
      await qc.invalidateQueries({ queryKey: ['tenant-info'] });
      await qc.invalidateQueries({ queryKey: ['tenant-settings'] });
      toast.success('Panel vuelto al neutro');
    } catch (err) {
      const msg = isApiError(err) ? err.message : 'Error de conexión.';
      toast.error('No se pudo restablecer', { description: msg });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SectionCard
      title="Apariencia del panel"
      description="Elegí el color de acento y el fondo del panel de control. El resto (texto, bordes, capas) se genera solo. Es independiente de la apariencia del jugador y lo ven todos los del panel. Los colores de acción (verde=entra, rojo=sale, ámbar=atención, azul=info) no se tocan."
      footer={
        <SaveButton
          onClick={() => void save()}
          isSaving={isSaving}
          disabled={!isDirty || !valid}
          label="Guardar apariencia del panel"
        />
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Knob
          label="Acento"
          desc="Botones, ítem activo del menú, foco."
          value={accent}
          onChange={setAccent}
          presets={ADMIN_ACCENT_PRESETS}
        />
        <Knob
          label="Fondo"
          desc="Define claro/oscuro y el tono del panel."
          value={bg}
          onChange={setBg}
          presets={ADMIN_BG_PRESETS}
        />
      </div>

      <p className="text-[11px] text-[var(--color-fg-subtle)] leading-snug">
        Tip: el panel de arriba y el menú de la izquierda ya muestran el
        resultado en vivo mientras elegís. Recién se aplica para el resto del
        equipo cuando tocás <strong>Guardar</strong>.
      </p>

      <div>
        <button
          type="button"
          onClick={() => void resetToNeutral()}
          disabled={isSaving || (!persisted && !isDirty)}
          className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <RotateCcw className="size-3.5" />
          Volver al panel neutro (negro + acento de marca)
        </button>
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
          value={HEX6.test(value) ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="size-10 rounded-[var(--radius-sm)] border border-[var(--color-border)] cursor-pointer shrink-0"
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
