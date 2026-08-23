/**
 * SectionAparienciaPanelSocio — apariencia del PANEL admin del SOCIO independiente.
 *
 * Igual que `SectionAparienciaPanel` (del tenant) — acento + fondo, con vista
 * previa en vivo del panel — pero guarda en el config del socio
 * (`partner_branding.config.adminAppearance`) vía el editor del socio, NO en
 * los settings del tenant. Su red (los del panel que cuelgan del socio) ve
 * este panel; si no lo configura, el panel adopta su acento de marca por
 * defecto (resuelto en `/tenant/info`).
 *
 * Los colores de acción (verde=entra, rojo=sale, ámbar, azul) quedan fijos.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import {
  ADMIN_ACCENT_PRESETS,
  ADMIN_BG_PRESETS,
  DEFAULT_ADMIN_APPEARANCE,
  deriveAdminVars,
  injectAdminVars,
} from '@/lib/admin-appearance';
import { useTenantInfo } from '@/lib/hooks/use-tenant-branding';
import { SaveButton, SectionCard } from './settings-common';
import { Knob } from './section-apariencia-panel';
import type { PartnerDesignEditorApi } from './use-partner-design-editor';

const HEX6 = /^#[0-9a-fA-F]{6}$/;

export function SectionAparienciaPanelSocio({
  editor,
}: {
  editor: PartnerDesignEditorApi;
}) {
  const tenantInfo = useTenantInfo();
  // Apariencia EFECTIVA que el panel ya muestra (explícita del socio o el
  // auto-acento de marca). Sirve para sembrar los sliders y para restaurar al
  // salir sin guardar.
  const effective = tenantInfo.data?.adminAppearance ?? null;

  const [accent, setAccent] = useState(
    effective?.accent ?? DEFAULT_ADMIN_APPEARANCE.accent,
  );
  const [bg, setBg] = useState(effective?.bg ?? DEFAULT_ADMIN_APPEARANCE.bg);

  // Sembrar una vez desde lo efectivo (cuando llega del server).
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !effective) return;
    seeded.current = true;
    setAccent(effective.accent);
    setBg(effective.bg);
  }, [effective]);

  // Vista previa en vivo: recolorea el panel entero mientras se edita.
  useEffect(() => {
    if (!HEX6.test(accent) || !HEX6.test(bg)) return;
    injectAdminVars(deriveAdminVars({ accent, bg }));
  }, [accent, bg]);

  // Al salir sin guardar, restaurar lo efectivo para no dejar el borrador pegado.
  const restoreRef = useRef<() => void>(() => {});
  restoreRef.current = () => {
    if (effective) injectAdminVars(deriveAdminVars(effective));
    else injectAdminVars(null);
  };
  useEffect(() => () => restoreRef.current(), []);

  const valid = HEX6.test(accent) && HEX6.test(bg);
  const baseline = effective ?? DEFAULT_ADMIN_APPEARANCE;
  const isDirty =
    accent.toLowerCase() !== baseline.accent.toLowerCase() ||
    bg.toLowerCase() !== baseline.bg.toLowerCase();
  const hasExplicit = editor.panelAppearance !== null;

  return (
    <SectionCard
      title="Apariencia del panel"
      description="Elegí el color de acento y el fondo del panel de control que ve tu red (cajeros, sub-socios). El resto (texto, bordes, capas) se genera solo. Si no tocás nada, el panel adopta tu color de marca. Los colores de acción (verde=entra, rojo=sale, ámbar=atención, azul=info) no se tocan."
      footer={
        <SaveButton
          onClick={() => void editor.savePanelAppearance({ accent, bg })}
          isSaving={editor.isSaving}
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
        resultado en vivo mientras elegís. Recién se aplica para tu red cuando
        tocás <strong>Guardar</strong>.
      </p>

      {hasExplicit && (
        <div>
          <button
            type="button"
            onClick={() => void editor.savePanelAppearance(null)}
            disabled={editor.isSaving}
            className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <RotateCcw className="size-3.5" />
            Usar mi color de marca (panel automático)
          </button>
        </div>
      )}
    </SectionCard>
  );
}
