/**
 * useDesignEditor — estado compartido de diseño (design.config) para las
 * secciones Marca / Apariencia / Home del jugador del nuevo /settings.
 *
 * Reemplaza el viejo page `(admin)/design` descompuesto en secciones:
 * cada sección edita una porción del mismo `design.config` y guarda solo
 * su slice (merge sobre el JSON existente, no overwrite total).
 *
 * Sync con keys espejo del backend (GET /tenant/info):
 *   - Apariencia → branding.primary_color (color accent de la paleta).
 *   - Marca      → branding.platform_name / logo_url / favicon_url / tagline.
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type CSSProperties } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { apiPatch, apiUpload, isApiError } from '@/lib/api-client';
import { DEFAULT_PLATFORM_NAME } from '@/lib/brand';
import { normalizeStorageUrl } from '@/lib/storage-url';
import { useTenantSettings } from '@/lib/hooks/use-tenant-settings';

export type Slide = {
  id: string;
  imageDesktop: string;
  imageMobile?: string;
  title: string;
  body: string;
  cta: string;
  href: string;
  accentColor: string;
  kicker: string;
  order: number;
};

export const designFormSchema = z.object({
  heroTitle: z.string().min(1).max(40),
  heroSubtitle: z.string().max(80),
  tilesTitle: z.string().min(1).max(30),
  tilesSubtitle: z.string().max(60),
  bgColor: z.string().regex(/^#[0-9A-F]{6}$/i),
  bgElevated: z.string().regex(/^#[0-9A-F]{6}$/i),
  bgSubtle: z.string().regex(/^#[0-9A-F]{6}$/i),
  fgColor: z.string().regex(/^#[0-9A-F]{6}$/i),
  fgMuted: z.string().regex(/^#[0-9A-F]{6}$/i),
  fgSubtle: z.string().regex(/^#[0-9A-F]{6}$/i),
  borderColor: z.string().regex(/^(#[0-9A-F]{6}|rgba?\(.+\))$/i),
  borderStrong: z.string().regex(/^(#[0-9A-F]{6}|rgba?\(.+\))$/i),
  accentColor: z.string().regex(/^#[0-9A-F]{6}$/i),
  accentHover: z.string().regex(/^#[0-9A-F]{6}$/i),
  accentFg: z.string().regex(/^#[0-9A-F]{6}$/i),
  accentText: z.string().regex(/^#[0-9A-F]{6}$/i),
  accentSubtle: z.string().regex(/^(#[0-9A-F]{6}|rgba?\(.+\))$/i),
  accentBorder: z.string().regex(/^(#[0-9A-F]{6}|rgba?\(.+\))$/i),
  success: z.string().regex(/^#[0-9A-F]{6}$/i),
  warning: z.string().regex(/^#[0-9A-F]{6}$/i),
  magenta: z.string().regex(/^#[0-9A-F]{6}$/i),
  cyan: z.string().regex(/^#[0-9A-F]{6}$/i),
  purple: z.string().regex(/^#[0-9A-F]{6}$/i),
  gold: z.string().regex(/^#[0-9A-F]{6}$/i),
  platformName: z.string().min(1).max(60),
  tagline: z.string().max(200),
  logoUrl: z.string().max(500).optional(),
  faviconUrl: z.string().max(500).optional(),
});

export type DesignForm = z.infer<typeof designFormSchema>;

export const DEFAULT_SLIDES: Slide[] = [
  { id: 'slide-1', imageDesktop: '/hero/welcome.webp', imageMobile: '/hero/welcome.webp', title: 'El Casino del Pueblo', body: 'Viví la mejor experiencia. Slots, crash, ruleta y más.', cta: 'Jugar ahora', href: '/play/lobby', accentColor: '#ff2ea0', kicker: 'Bienvenido', order: 1 },
  { id: 'slide-2', imageDesktop: '/hero/slots.webp', imageMobile: '/hero/slots.webp', title: 'Girás y ganás', body: 'Los mejores slots con jackpots progresivos.', cta: 'Ver slots', href: '/play/lobby?category=slots', accentColor: '#00e5ff', kicker: 'Slots', order: 2 },
  { id: 'slide-3', imageDesktop: '/hero/live.webp', imageMobile: '/hero/live.webp', title: 'Acción en tiempo real', body: 'Crupiés en vivo, mesas abiertas, apuestas al instante.', cta: 'Jugar en vivo', href: '/play/lobby?category=live', accentColor: '#9b4dff', kicker: 'En vivo', order: 3 },
  { id: 'slide-4', imageDesktop: '/hero/bonus.webp', imageMobile: '/hero/bonus.webp', title: 'Hasta $200.000 + 200 giros', body: 'Depositá y recibí bonus exclusivos.', cta: 'Reclamar bonus', href: '/play/account?tab=dinero', accentColor: '#f0c46a', kicker: 'Bonus', order: 4 },
];

export const HERO_IMAGES = ['welcome', 'slots', 'live', 'bonus', 'roulette', 'league', 'crash', 'cards'];

export const DESIGN_SETTINGS_KEY = 'design.config';

const DEFAULT_VALUES: DesignForm = {
  bgColor: '#0a0008',
  bgElevated: '#140a1a',
  bgSubtle: '#1e1028',
  fgColor: '#fceeff',
  fgMuted: '#c4a6d4',
  fgSubtle: '#a888b8',
  borderColor: 'rgba(155,77,255,0.14)',
  borderStrong: 'rgba(155,77,255,0.26)',
  accentColor: '#ff2ea0',
  accentHover: '#e0208a',
  accentFg: '#0a0008',
  accentText: '#ff2ea0',
  accentSubtle: 'rgba(255,46,160,0.12)',
  accentBorder: 'rgba(255,46,160,0.4)',
  success: '#39d353',
  warning: '#ff7a18',
  magenta: '#ff3ec9',
  cyan: '#00e5ff',
  purple: '#9b4dff',
  gold: '#f0c46a',
  heroTitle: 'El Casino del Pueblo',
  heroSubtitle: 'Viví la mejor experiencia.',
  tilesTitle: 'Categorías',
  tilesSubtitle: 'Elegí tu tipo de juego favorito',
  platformName: DEFAULT_PLATFORM_NAME,
  tagline: '',
  logoUrl: '',
  faviconUrl: '',
};

export interface DesignEditorApi {
  form: UseFormReturn<DesignForm>;
  slides: Slide[];
  isSaving: boolean;
  previewVars: CSSProperties;
  addSlide: () => void;
  removeSlide: (idx: number) => void;
  moveSlide: (from: number, to: number) => void;
  updateSlide: (idx: number, field: keyof Slide, value: string | number) => void;
  uploadSlideImage: (idx: number, type: 'imageDesktop' | 'imageMobile') => void;
  uploadBrandImage: (field: 'logoUrl' | 'faviconUrl') => void;
  saveAppearance: () => Promise<void>;
  saveHome: () => Promise<void>;
  saveBrand: () => Promise<void>;
}

export function useDesignEditor(): DesignEditorApi {
  const tenantSettings = useTenantSettings();
  const qc = useQueryClient();
  const [slides, setSlides] = useState<Slide[]>(DEFAULT_SLIDES);
  const [isSaving, setIsSaving] = useState(false);

  const form = useForm<DesignForm>({
    resolver: zodResolver(designFormSchema),
    defaultValues: DEFAULT_VALUES,
  });

  // Carga inicial desde design.config + fallback a las keys espejo legacy.
  useEffect(() => {
    if (!tenantSettings.data?.data) return;
    const raw = tenantSettings.data.data.find((s) => s.key === DESIGN_SETTINGS_KEY)?.value;
    if (raw && typeof raw === 'object') {
      const saved = raw as Record<string, unknown>;
      if (saved.slides && Array.isArray(saved.slides)) {
        const normalized = (saved.slides as Slide[]).map((s) => ({
          ...s,
          imageDesktop: normalizeStorageUrl(s.imageDesktop),
          imageMobile: s.imageMobile ? normalizeStorageUrl(s.imageMobile) : s.imageMobile,
        }));
        setSlides(normalized);
      }
      const formValues: Partial<DesignForm> = {};
      if (saved.colors && typeof saved.colors === 'object') {
        const c = saved.colors as Record<string, string>;
        for (const key of Object.keys(c) as (keyof DesignForm)[]) {
          if (c[key]) formValues[key] = c[key];
        }
      }
      if (saved.texts && typeof saved.texts === 'object') {
        const t = saved.texts as Record<string, string>;
        if (t.heroTitle) formValues.heroTitle = t.heroTitle;
        if (t.heroSubtitle) formValues.heroSubtitle = t.heroSubtitle;
        if (t.tilesTitle) formValues.tilesTitle = t.tilesTitle;
        if (t.tilesSubtitle) formValues.tilesSubtitle = t.tilesSubtitle;
      }
      if (saved.brand && typeof saved.brand === 'object') {
        const b = saved.brand as Record<string, string>;
        if (b.platformName) formValues.platformName = b.platformName;
        if (b.tagline) formValues.tagline = b.tagline;
        if (b.logoUrl) formValues.logoUrl = normalizeStorageUrl(b.logoUrl);
        if (b.faviconUrl) formValues.faviconUrl = normalizeStorageUrl(b.faviconUrl);
      }
      const legacy = tenantSettings.data.data;
      const findLegacy = (key: string) => {
        const s = legacy.find((x) => x.key === key)?.value;
        return typeof s === 'string' && s ? normalizeStorageUrl(s) : undefined;
      };
      if (!formValues.faviconUrl) formValues.faviconUrl = findLegacy('branding.favicon_url');
      if (!formValues.logoUrl) formValues.logoUrl = findLegacy('branding.logo_url');
      if (!formValues.platformName) formValues.platformName = findLegacy('branding.platform_name');
      if (!formValues.tagline) formValues.tagline = findLegacy('branding.tagline');
      if (Object.keys(formValues).length > 0) {
        form.reset(formValues, { keepDefaultValues: false });
      }
    }
  }, [tenantSettings.data, form]);

  // JSON actual de design.config para merges por-slice.
  const getDesignConfig = (): Record<string, unknown> => {
    const raw = tenantSettings.data?.data?.find((s) => s.key === DESIGN_SETTINGS_KEY)?.value;
    return raw && typeof raw === 'object'
      ? { ...(raw as Record<string, unknown>) }
      : {};
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['tenant-settings'] });
    qc.invalidateQueries({ queryKey: ['tenant-info'] });
  };

  const run = async (fn: () => Promise<unknown>, successMsg: string): Promise<void> => {
    setIsSaving(true);
    try {
      await fn();
      invalidate();
      toast.success(successMsg);
    } catch (err) {
      const msg = isApiError(err) ? err.message : 'Error de conexión.';
      toast.error('Error al guardar', { description: msg });
    } finally {
      setIsSaving(false);
    }
  };

  // ── Apariencia: paleta + tema, sync accent → branding.primary_color ──
  const saveAppearance = async (): Promise<void> => {
    await form.trigger();
    if (!form.formState.isValid) {
      toast.error('Revisá la paleta', { description: 'Hay colores inválidos.' });
      return;
    }
    const f = form.getValues();
    await run(async () => {
      const colors = extractColors(f);
      await apiPatch(`/tenant/settings/${DESIGN_SETTINGS_KEY}`, {
        value: { ...getDesignConfig(), colors },
      });
      await Promise.allSettled([
        apiPatch('/tenant/settings/branding.primary_color', { value: f.accentColor }),
      ]);
    }, 'Apariencia guardada');
  };

  // ── Home: slides + textos ──
  const saveHome = async (): Promise<void> => {
    await form.trigger(['heroTitle', 'heroSubtitle', 'tilesTitle', 'tilesSubtitle']);
    if (!form.formState.isValid) {
      toast.error('Revisá los textos', { description: 'Hay campos vacíos o muy largos.' });
      return;
    }
    const f = form.getValues();
    await run(async () => {
      await apiPatch(`/tenant/settings/${DESIGN_SETTINGS_KEY}`, {
        value: {
          ...getDesignConfig(),
          slides,
          texts: {
            heroTitle: f.heroTitle,
            heroSubtitle: f.heroSubtitle,
            tilesTitle: f.tilesTitle,
            tilesSubtitle: f.tilesSubtitle,
          },
        },
      });
    }, 'Home guardada');
  };

  // ── Marca: nombre, tagline, logo, favicon + espejos ──
  const saveBrand = async (): Promise<void> => {
    await form.trigger(['platformName', 'tagline', 'logoUrl', 'faviconUrl']);
    if (!form.formState.isValid) {
      toast.error('Revisá la marca', { description: 'Hay campos inválidos.' });
      return;
    }
    const f = form.getValues();
    await run(async () => {
      await apiPatch(`/tenant/settings/${DESIGN_SETTINGS_KEY}`, {
        value: {
          ...getDesignConfig(),
          brand: {
            platformName: f.platformName,
            tagline: f.tagline,
            logoUrl: f.logoUrl,
            faviconUrl: f.faviconUrl,
          },
        },
      });
      await Promise.allSettled([
        apiPatch('/tenant/settings/branding.platform_name', { value: f.platformName }),
        apiPatch('/tenant/settings/branding.logo_url', { value: f.logoUrl || null }),
        f.faviconUrl
          ? apiPatch('/tenant/settings/branding.favicon_url', { value: f.faviconUrl })
          : Promise.resolve(),
        apiPatch('/tenant/settings/branding.tagline', { value: f.tagline }),
      ]);
    }, 'Marca guardada');
  };

  // ── Slides helpers ──
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
        toast.error('Error al subir la imagen', { description: err instanceof Error ? err.message : undefined });
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

  // ── Preview vars ──
  const colors = form.watch();
  const previewVars: CSSProperties = {
    '--p-bg': colors.bgColor || DEFAULT_VALUES.bgColor,
    '--p-bg-elevated': colors.bgElevated || DEFAULT_VALUES.bgElevated,
    '--p-bg-subtle': colors.bgSubtle || DEFAULT_VALUES.bgSubtle,
    '--p-fg': colors.fgColor || DEFAULT_VALUES.fgColor,
    '--p-fg-muted': colors.fgMuted || DEFAULT_VALUES.fgMuted,
    '--p-fg-subtle': colors.fgSubtle || DEFAULT_VALUES.fgSubtle,
    '--p-border': colors.borderColor || DEFAULT_VALUES.borderColor,
    '--p-border-strong': colors.borderStrong || DEFAULT_VALUES.borderStrong,
    '--p-accent': colors.accentColor || DEFAULT_VALUES.accentColor,
    '--p-accent-hover': colors.accentHover || DEFAULT_VALUES.accentHover,
    '--p-accent-fg': colors.accentFg || DEFAULT_VALUES.accentFg,
    '--p-accent-text': colors.accentText || DEFAULT_VALUES.accentText,
    '--p-accent-subtle': colors.accentSubtle || DEFAULT_VALUES.accentSubtle,
    '--p-accent-border': colors.accentBorder || DEFAULT_VALUES.accentBorder,
    '--p-success': colors.success || DEFAULT_VALUES.success,
    '--p-warning': colors.warning || DEFAULT_VALUES.warning,
    '--p-magenta': colors.magenta || DEFAULT_VALUES.magenta,
    '--p-cyan': colors.cyan || DEFAULT_VALUES.cyan,
    '--p-purple': colors.purple || DEFAULT_VALUES.purple,
    '--p-gold': colors.gold || DEFAULT_VALUES.gold,
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
  };
}

function extractColors(f: DesignForm): Record<string, string> {
  return {
    bgColor: f.bgColor,
    bgElevated: f.bgElevated,
    bgSubtle: f.bgSubtle,
    fgColor: f.fgColor,
    fgMuted: f.fgMuted,
    fgSubtle: f.fgSubtle,
    borderColor: f.borderColor,
    borderStrong: f.borderStrong,
    accentColor: f.accentColor,
    accentHover: f.accentHover,
    accentFg: f.accentFg,
    accentText: f.accentText,
    accentSubtle: f.accentSubtle,
    accentBorder: f.accentBorder,
    success: f.success,
    warning: f.warning,
    magenta: f.magenta,
    cyan: f.cyan,
    purple: f.purple,
    gold: f.gold,
  };
}
