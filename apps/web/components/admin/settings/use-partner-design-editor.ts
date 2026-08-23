/**
 * usePartnerDesignEditor — versión de useDesignEditor para SOCIOS INDEPENDIENTES.
 *
 * Mismo form/secciones/preview que el editor del admin, pero:
 *   - Carga: GET /tenant/partner-branding/me (mi diseño). Si no tengo uno,
 *     arranca desde el diseño ACTUAL del tenant (el del admin) como base.
 *   - Guarda: PUT /tenant/partner-branding/me con el config COMPLETO
 *     ({ slides, colors, texts, brand }) — no toca los settings del tenant.
 *
 * Devuelve la misma interfaz `DesignEditorApi`, así que las secciones
 * (SectionMarca / SectionApariencia / SectionHome) y el DesignPreview se
 * reusan sin cambios.
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { apiGet, apiPut, apiUpload, isApiError } from '@/lib/api-client';
import { normalizeStorageUrl } from '@/lib/storage-url';
import { useTenantInfo } from '@/lib/hooks/use-tenant-branding';
import type { AdminAppearance } from '@/lib/admin-appearance';
import {
  DEFAULT_SLIDES,
  DEFAULT_VALUES,
  designFormSchema,
  extractColors,
  type DesignEditorApi,
  type DesignForm,
  type Slide,
} from './use-design-editor';

const PARTNER_ENDPOINT = '/tenant/partner-branding/me';

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/**
 * El editor del socio, además de la interfaz del editor de diseño (jugador),
 * expone el slice de apariencia del PANEL admin del socio, que se guarda en el
 * MISMO config (`partner_branding.config.adminAppearance`) para no pisar los
 * settings del tenant ni competir con los otros guardados.
 */
export interface PartnerDesignEditorApi extends DesignEditorApi {
  /** Apariencia del panel configurada por el socio (null = usa el default). */
  panelAppearance: AdminAppearance | null;
  /** Guarda (o limpia, con null) la apariencia del panel del socio. */
  savePanelAppearance: (next: AdminAppearance | null) => Promise<void>;
}

export function usePartnerDesignEditor(): PartnerDesignEditorApi {
  const qc = useQueryClient();
  const [slides, setSlides] = useState<Slide[]>(DEFAULT_SLIDES);
  const [isSaving, setIsSaving] = useState(false);
  // Apariencia del panel del socio. Ref para que buildConfig (llamado por
  // cualquier guardado) siempre la preserve; state para sembrar la UI.
  const [panelAppearance, setPanelAppearance] = useState<AdminAppearance | null>(null);
  const panelRef = useRef<AdminAppearance | null>(null);

  const mine = useQuery({
    queryKey: ['partner-branding-me'],
    queryFn: () => apiGet<{ config: Record<string, unknown> | null }>(PARTNER_ENDPOINT),
    staleTime: 30_000,
  });
  // Fallback: si el socio no tiene diseño propio, arranca del default del tenant.
  const tenantInfo = useTenantInfo();

  const form = useForm<DesignForm>({
    resolver: zodResolver(designFormSchema),
    defaultValues: DEFAULT_VALUES,
  });

  // Carga inicial: mi config; si no hay, el design del tenant (admin).
  useEffect(() => {
    const source: Record<string, unknown> | null =
      mine.data?.config ??
      (tenantInfo.data?.design as Record<string, unknown> | undefined) ??
      null;
    if (!source || typeof source !== 'object') return;

    const formValues: Partial<DesignForm> = {};
    if (source.colors && typeof source.colors === 'object') {
      const c = source.colors as Record<string, string>;
      for (const key of Object.keys(c) as (keyof DesignForm)[]) {
        if (c[key]) formValues[key] = c[key];
      }
    }
    if (source.texts && typeof source.texts === 'object') {
      const t = source.texts as Record<string, string>;
      if (t.heroTitle) formValues.heroTitle = t.heroTitle;
      if (t.heroSubtitle) formValues.heroSubtitle = t.heroSubtitle;
      if (t.tilesTitle) formValues.tilesTitle = t.tilesTitle;
      if (t.tilesSubtitle) formValues.tilesSubtitle = t.tilesSubtitle;
    }
    if (source.brand && typeof source.brand === 'object') {
      const b = source.brand as Record<string, string>;
      if (b.platformName) formValues.platformName = b.platformName;
      if (b.tagline) formValues.tagline = b.tagline;
      if (b.logoUrl) formValues.logoUrl = normalizeStorageUrl(b.logoUrl);
      if (b.faviconUrl) formValues.faviconUrl = normalizeStorageUrl(b.faviconUrl);
    }
    if (source.slides && Array.isArray(source.slides)) {
      setSlides(
        (source.slides as Slide[]).map((s) => ({
          ...s,
          imageDesktop: normalizeStorageUrl(s.imageDesktop),
          imageMobile: s.imageMobile ? normalizeStorageUrl(s.imageMobile) : s.imageMobile,
        })),
      );
    }
    // Apariencia del panel del socio (solo desde MI config, no del tenant).
    const src = mine.data?.config;
    const sa = src && typeof src === 'object' ? src.adminAppearance : undefined;
    if (sa && typeof sa === 'object') {
      const a = sa as Record<string, unknown>;
      if (typeof a.accent === 'string' && HEX6.test(a.accent) &&
          typeof a.bg === 'string' && HEX6.test(a.bg)) {
        const ap: AdminAppearance = { accent: a.accent, bg: a.bg };
        setPanelAppearance(ap);
        panelRef.current = ap;
      }
    }

    if (Object.keys(formValues).length > 0) {
      form.reset({ ...DEFAULT_VALUES, ...formValues });
    }
  }, [mine.data, tenantInfo.data, form]);

  /** Config COMPLETO a guardar, armado desde el form + slides actuales. */
  const buildConfig = (f: DesignForm): Record<string, unknown> => ({
    slides,
    colors: extractColors(f),
    texts: {
      heroTitle: f.heroTitle,
      heroSubtitle: f.heroSubtitle,
      tilesTitle: f.tilesTitle,
      tilesSubtitle: f.tilesSubtitle,
    },
    brand: {
      platformName: f.platformName,
      tagline: f.tagline,
      logoUrl: f.logoUrl,
      faviconUrl: f.faviconUrl,
    },
    // Preservar la apariencia del panel en TODOS los guardados (o omitirla si
    // el socio la limpió → el backend cae al acento de marca por defecto).
    ...(panelRef.current ? { adminAppearance: panelRef.current } : {}),
  });

  const persist = async (successMsg: string): Promise<void> => {
    setIsSaving(true);
    try {
      await apiPut(PARTNER_ENDPOINT, { config: buildConfig(form.getValues()) });
      await qc.invalidateQueries({ queryKey: ['partner-branding-me'] });
      await qc.invalidateQueries({ queryKey: ['tenant-info'] });
      toast.success(successMsg);
    } catch (err) {
      toast.error('Error al guardar', {
        description: isApiError(err) ? err.message : 'Error de conexión.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const saveAppearance = async (): Promise<void> => {
    const ok = await form.trigger();
    if (!ok) {
      toast.error('Revisá la paleta', { description: 'Hay colores inválidos.' });
      return;
    }
    await persist('Apariencia guardada');
  };

  const saveHome = async (): Promise<void> => {
    const ok = await form.trigger(['heroTitle', 'heroSubtitle', 'tilesTitle', 'tilesSubtitle']);
    if (!ok) {
      toast.error('Revisá los textos', { description: 'Hay campos vacíos o muy largos.' });
      return;
    }
    await persist('Home guardada');
  };

  const saveBrand = async (): Promise<void> => {
    const ok = await form.trigger(['platformName', 'tagline', 'logoUrl', 'faviconUrl']);
    if (!ok) {
      toast.error('Revisá la marca', { description: 'Hay campos inválidos.' });
      return;
    }
    await persist('Marca guardada');
  };

  /**
   * Guarda la apariencia del panel del socio (o la limpia con `null`). Actualiza
   * el ref ANTES de persistir para que buildConfig incluya el valor nuevo.
   */
  const savePanelAppearance = async (next: AdminAppearance | null): Promise<void> => {
    if (next && (!HEX6.test(next.accent) || !HEX6.test(next.bg))) {
      toast.error('Revisá los colores', { description: 'Usá un hex #RRGGBB.' });
      return;
    }
    panelRef.current = next;
    setPanelAppearance(next);
    await persist(next ? 'Apariencia del panel guardada' : 'Panel vuelto al neutro');
  };

  // ── Slides helpers (idénticos al editor del admin) ──
  const moveSlide = (from: number, to: number): void => {
    if (from === to) return;
    const next = [...slides];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    setSlides(next.map((s, i) => ({ ...s, order: i + 1 })));
  };
  const removeSlide = (idx: number): void => {
    setSlides((prev) => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, order: i + 1 })));
  };
  const addSlide = (): void => {
    setSlides([
      ...slides,
      {
        id: `slide-${Date.now()}`,
        imageDesktop: '',
        imageMobile: '',
        title: 'Nuevo banner',
        body: 'Descripción del banner',
        cta: 'Ver más',
        href: '/play/lobby',
        accentColor: '#ff2ea0',
        kicker: 'Nuevo',
        order: slides.length + 1,
      },
    ]);
  };
  const updateSlide = (idx: number, field: keyof Slide, value: string | number): void => {
    setSlides((prev) => prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s)));
  };

  const uploadFile = async (onUrl: (url: string) => void): Promise<void> => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/webp,image/avif,image/jpeg';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const formData = new FormData();
      formData.append('file', file);
      try {
        const data = await apiUpload<{ url: string; storageKey: string; sizeBytes: number }>(
          '/tenant/uploads/hero',
          formData,
        );
        onUrl(normalizeStorageUrl(data.url));
        toast.success('Imagen subida');
      } catch (err) {
        toast.error('Error al subir la imagen', {
          description: err instanceof Error ? err.message : undefined,
        });
      }
    };
    input.click();
  };
  const uploadSlideImage = (idx: number, type: 'imageDesktop' | 'imageMobile'): void => {
    uploadFile((url) => updateSlide(idx, type, url));
  };
  const uploadBrandImage = (field: 'logoUrl' | 'faviconUrl'): void => {
    uploadFile((url) => form.setValue(field, url));
  };

  const c = form.watch();
  const previewVars: CSSProperties = {
    '--p-bg': c.bgColor || DEFAULT_VALUES.bgColor,
    '--p-bg-elevated': c.bgElevated || DEFAULT_VALUES.bgElevated,
    '--p-bg-subtle': c.bgSubtle || DEFAULT_VALUES.bgSubtle,
    '--p-fg': c.fgColor || DEFAULT_VALUES.fgColor,
    '--p-fg-muted': c.fgMuted || DEFAULT_VALUES.fgMuted,
    '--p-fg-subtle': c.fgSubtle || DEFAULT_VALUES.fgSubtle,
    '--p-border': c.borderColor || DEFAULT_VALUES.borderColor,
    '--p-border-strong': c.borderStrong || DEFAULT_VALUES.borderStrong,
    '--p-accent': c.accentColor || DEFAULT_VALUES.accentColor,
    '--p-accent-hover': c.accentHover || DEFAULT_VALUES.accentHover,
    '--p-accent-fg': c.accentFg || DEFAULT_VALUES.accentFg,
    '--p-accent-text': c.accentText || DEFAULT_VALUES.accentText,
    '--p-accent-subtle': c.accentSubtle || DEFAULT_VALUES.accentSubtle,
    '--p-accent-border': c.accentBorder || DEFAULT_VALUES.accentBorder,
    '--p-success': c.success || DEFAULT_VALUES.success,
    '--p-warning': c.warning || DEFAULT_VALUES.warning,
    '--p-magenta': c.magenta || DEFAULT_VALUES.magenta,
    '--p-cyan': c.cyan || DEFAULT_VALUES.cyan,
    '--p-purple': c.purple || DEFAULT_VALUES.purple,
    '--p-gold': c.gold || DEFAULT_VALUES.gold,
  } as CSSProperties;

  return {
    form,
    slides,
    isSaving,
    previewVars,
    addSlide,
    removeSlide,
    moveSlide,
    updateSlide,
    uploadSlideImage,
    uploadBrandImage,
    saveAppearance,
    saveHome,
    saveBrand,
    panelAppearance,
    savePanelAppearance,
  };
}
