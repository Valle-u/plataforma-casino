'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import {
  useTenantSettings,
} from '@/lib/hooks/use-tenant-settings';
import { useTheme, THEMES } from '@/lib/hooks/use-theme';
import { apiPatch, apiUpload, isApiError } from '@/lib/api-client';
import { normalizeStorageUrl } from '@/lib/storage-url';
import { toast } from 'sonner';
import {
  Image,
  Palette,
  Paintbrush,
  Save,
  Eye,
  Loader2,
  ArrowUpDown,
  Plus,
  Trash2,
  Globe,
} from 'lucide-react';

type Slide = {
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

const designFormSchema = z.object({
  heroTitle: z.string().min(1).max(40),
  heroSubtitle: z.string().max(80),
  tilesTitle: z.string().min(1).max(30),
  tilesSubtitle: z.string().max(60),
  // Paleta completa de colores
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
  // Branding
  platformName: z.string().min(1).max(60),
  logoUrl: z.string().max(500).optional(),
  faviconUrl: z.string().max(500).optional(),
});

type DesignForm = z.infer<typeof designFormSchema>;

const DEFAULT_SLIDES: Slide[] = [
  { id: 'slide-1', imageDesktop: '/hero/welcome.webp', imageMobile: '/hero/welcome.webp', title: 'El Casino del Pueblo', body: 'Viví la experiencia TANGO. Slots, crash, ruleta y más.', cta: 'Jugar ahora', href: '/play/lobby', accentColor: '#ff2ea0', kicker: 'Bienvenido', order: 1 },
  { id: 'slide-2', imageDesktop: '/hero/slots.webp', imageMobile: '/hero/slots.webp', title: 'Girás y ganás', body: 'Los mejores slots con jackpots progresivos.', cta: 'Ver slots', href: '/play/lobby?category=slots', accentColor: '#00e5ff', kicker: 'Slots', order: 2 },
  { id: 'slide-3', imageDesktop: '/hero/live.webp', imageMobile: '/hero/live.webp', title: 'Acción en tiempo real', body: 'Crupiés en vivo, mesas abiertas, apuestas al instante.', cta: 'Jugar en vivo', href: '/play/lobby?category=live', accentColor: '#9b4dff', kicker: 'En vivo', order: 3 },
  { id: 'slide-4', imageDesktop: '/hero/bonus.webp', imageMobile: '/hero/bonus.webp', title: 'Hasta $200.000 + 200 giros', body: 'Depositá y recibí bonus exclusivos.', cta: 'Reclamar bonus', href: '/play/wallet', accentColor: '#f0c46a', kicker: 'Bonus', order: 4 },
];

const HERO_IMAGES = ['welcome', 'slots', 'live', 'bonus', 'roulette', 'league', 'crash', 'cards'];

const DESIGN_SETTINGS_KEY = 'design.config';

function SaveButton({ onClick, isSaving }: { onClick: () => void; isSaving: boolean }) {
  return (
    <div className="sticky bottom-0 -mx-4 -mb-4 mt-2 border-t border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-4 pb-4 pt-3">
      <button
        onClick={onClick}
        disabled={isSaving}
        className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius)] bg-white py-2.5 text-sm font-semibold text-black shadow-sm transition-all duration-150 hover:brightness-110 hover:shadow-md active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100 disabled:active:scale-100"
      >
        {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
        {isSaving ? 'Guardando…' : 'Guardar cambios'}
      </button>
    </div>
  );
}

export default function DesignPage() {
  const [activeTab, setActiveTab] = useState<'carousel' | 'texts' | 'brand' | 'theme' | 'colors'>('carousel');
  const [showPreview, setShowPreview] = useState(false);
  const [slides, setSlides] = useState<Slide[]>(DEFAULT_SLIDES);
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const { theme: activeTheme, setTheme } = useTheme();
  const tenantSettings = useTenantSettings();
  const qc = useQueryClient();

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
  } = useForm<DesignForm>({
    resolver: zodResolver(designFormSchema),
    defaultValues: {
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
      heroSubtitle: 'Viví la experiencia TANGO.',
      tilesTitle: 'Categorías',
      tilesSubtitle: 'Elegí tu tipo de juego favorito',
      platformName: 'Casino TANGO',
      logoUrl: '',
      faviconUrl: '',
    },
  });

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
        if (b.logoUrl) formValues.logoUrl = normalizeStorageUrl(b.logoUrl);
        if (b.faviconUrl) formValues.faviconUrl = normalizeStorageUrl(b.faviconUrl);
      }
      // Sprint 55.9: fallback a los settings legacy que el save espeja.
      // Si el valor quedó huérfano en branding.favicon_url / logo_url
      // (configurado con una versión vieja del page), lo recuperamos.
      const legacy = tenantSettings.data.data;
      const findLegacy = (key: string) => {
        const s = legacy.find((x) => x.key === key)?.value;
        return typeof s === 'string' && s ? normalizeStorageUrl(s) : undefined;
      };
      if (!formValues.faviconUrl) formValues.faviconUrl = findLegacy('branding.favicon_url');
      if (!formValues.logoUrl) formValues.logoUrl = findLegacy('branding.logo_url');
      if (Object.keys(formValues).length > 0) {
        reset(formValues, { keepDefaultValues: false });
      }
    }
  }, [tenantSettings.data, reset]);

  // Guardar todo como JSON en UNA sola llamada directa
  const onSubmit = async (form: DesignForm) => {
    setIsSaving(true);
    try {
      const payload = {
        slides,
        colors: {
          bgColor: form.bgColor,
          bgElevated: form.bgElevated,
          bgSubtle: form.bgSubtle,
          fgColor: form.fgColor,
          fgMuted: form.fgMuted,
          fgSubtle: form.fgSubtle,
          borderColor: form.borderColor,
          borderStrong: form.borderStrong,
          accentColor: form.accentColor,
          accentHover: form.accentHover,
          accentFg: form.accentFg,
          accentText: form.accentText,
          accentSubtle: form.accentSubtle,
          accentBorder: form.accentBorder,
          success: form.success,
          warning: form.warning,
          magenta: form.magenta,
          cyan: form.cyan,
          purple: form.purple,
          gold: form.gold,
        },
        texts: { heroTitle: form.heroTitle, heroSubtitle: form.heroSubtitle, tilesTitle: form.tilesTitle, tilesSubtitle: form.tilesSubtitle },
        brand: { platformName: form.platformName, logoUrl: form.logoUrl, faviconUrl: form.faviconUrl },
      };
      await apiPatch(`/tenant/settings/${DESIGN_SETTINGS_KEY}`, { value: payload });
      // También guardar settings individuales para que el backend los exponga via GET /tenant/info
      await Promise.allSettled([
        apiPatch('/tenant/settings/branding.logo_url', { value: form.logoUrl || null }),
        apiPatch('/tenant/settings/branding.platform_name', { value: form.platformName }),
        form.faviconUrl ? apiPatch('/tenant/settings/branding.favicon_url', { value: form.faviconUrl }) : Promise.resolve(),
      ]);
      qc.invalidateQueries({ queryKey: ['tenant-settings'] });
      qc.invalidateQueries({ queryKey: ['tenant-info'] });
      toast.success('Diseño guardado', { description: 'Todos los cambios aplicados.' });
    } catch (err) {
      const msg = isApiError(err) ? err.message : 'Error de conexión.';
      toast.error('Error al guardar', { description: msg });
    } finally {
      setIsSaving(false);
    }
  };

  const save = handleSubmit(onSubmit);

  const moveSlide = (from: number, to: number) => {
    if (from === to) return;
    const next = [...slides];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    setSlides(next.map((s, i) => ({ ...s, order: i + 1 })));
  };

  const removeSlide = (idx: number) => {
    setSlides((prev) => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, order: i + 1 })));
  };

  const addSlide = () => {
    setSlides([...slides, {
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
    }]);
  };

  const updateSlide = (idx: number, field: keyof Slide, value: string | number) => {
    setSlides((prev) => prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s)));
  };

  const handleImageUpload = async (idx: number, type: 'imageDesktop' | 'imageMobile') => {
    uploadFile((url) => updateSlide(idx, type, url));
  };

  const uploadFile = async (onUrl: (url: string) => void) => {
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

  const colors = watch();
  const previewVars = {
    '--p-bg': colors.bgColor || '#0a0008',
    '--p-bg-elevated': colors.bgElevated || '#140a1a',
    '--p-bg-subtle': colors.bgSubtle || '#1e1028',
    '--p-fg': colors.fgColor || '#fceeff',
    '--p-fg-muted': colors.fgMuted || '#c4a6d4',
    '--p-fg-subtle': colors.fgSubtle || '#a888b8',
    '--p-border': colors.borderColor || 'rgba(155,77,255,0.14)',
    '--p-border-strong': colors.borderStrong || 'rgba(155,77,255,0.26)',
    '--p-accent': colors.accentColor || '#ff2ea0',
    '--p-accent-hover': colors.accentHover || '#e0208a',
    '--p-accent-fg': colors.accentFg || '#0a0008',
    '--p-accent-text': colors.accentText || '#ff2ea0',
    '--p-accent-subtle': colors.accentSubtle || 'rgba(255,46,160,0.12)',
    '--p-accent-border': colors.accentBorder || 'rgba(255,46,160,0.4)',
    '--p-success': colors.success || '#39d353',
    '--p-warning': colors.warning || '#ff7a18',
    '--p-magenta': colors.magenta || '#ff3ec9',
    '--p-cyan': colors.cyan || '#00e5ff',
    '--p-purple': colors.purple || '#9b4dff',
    '--p-gold': colors.gold || '#f0c46a',
  } as React.CSSProperties;

  const tabs = [
    { id: 'carousel' as const, icon: Image, label: 'Carrusel' },
    { id: 'texts' as const, icon: Paintbrush, label: 'Textos' },
    { id: 'brand' as const, icon: Globe, label: 'Marca' },
    { id: 'theme' as const, icon: Palette, label: 'Tema' },
    { id: 'colors' as const, icon: Paintbrush, label: 'Colores' },
  ];

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 lg:px-6">
      <header className="mb-8 flex flex-col gap-2">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="font-display text-3xl">Configuración de Diseño</h1>
            <p className="text-sm text-[var(--color-fg-muted)] mt-1">
              Personalizá la home del player: banners, colores y textos.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowPreview(!showPreview)}
              className="inline-flex items-center gap-2 rounded-[var(--radius)] border border-[var(--color-border)] px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--color-bg-subtle)]">
              <Eye className="size-4" />
              {showPreview ? 'Ocultar preview' : 'Preview'}
            </button>
            <button onClick={save} disabled={isSaving}
              className="inline-flex items-center gap-2 rounded-[var(--radius)] bg-white px-5 py-2 text-sm font-semibold text-black shadow-sm transition-all duration-150 hover:brightness-110 hover:shadow-md active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100 disabled:active:scale-100">
              {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {isSaving ? 'Guardando…' : 'Guardar todo'}
            </button>
          </div>
        </div>
      </header>

      {showPreview && (
        <div className="mb-8 overflow-hidden rounded-[var(--radius-xl)] border" style={{ ...previewVars, borderColor: 'var(--p-border)', backgroundColor: 'var(--p-bg)' }}>
          {/* Label preview */}
          <div className="px-4 pt-3 pb-1 flex items-center gap-2">
            <span className="size-2 rounded-full bg-[var(--p-accent)]" />
            <span className="text-[10px] uppercase tracking-wider font-medium" style={{ color: 'var(--p-fg-muted)' }}>Preview en vivo</span>
          </div>

          {/* Layout: sidebar + main */}
          <div className="flex h-[520px]">
            {/* Sidebar mock */}
            <div className="w-[180px] shrink-0 flex flex-col p-3 border-r" style={{ backgroundColor: 'var(--p-bg-elevated)', borderColor: 'var(--p-border)' }}>
              <div className="h-6 w-20 rounded mb-6" style={{ backgroundColor: `${colors.accentColor || '#ff2ea0'}22` }}>
                <span className="text-[10px] font-bold px-2 leading-6" style={{ color: 'var(--p-accent-text)' }}>{watch('platformName') || 'CASINO'}</span>
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
              {/* Player card in sidebar */}
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
                <div className="rounded-md border border-white/10 bg-black/30 px-2.5 py-1.5 backdrop-blur-sm">
                  <span className="text-[9px] font-medium block" style={{ color: 'var(--p-accent-text)' }}>{slides[0]?.kicker || 'Bienvenido'}</span>
                  <span className="text-sm font-bold block" style={{ color: 'var(--p-fg)' }}>{watch('heroTitle') || 'El Casino del Pueblo'}</span>
                  <span className="text-[10px] block mt-0.5" style={{ color: 'var(--p-fg-muted)' }}>{watch('heroSubtitle') || 'Viví la experiencia'}</span>
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
                <span className="text-[11px] font-semibold" style={{ color: 'var(--p-fg)' }}>{watch('tilesTitle') || 'Categorías'}</span>
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
                    {/* Gradient overlay simulating game image */}
                    <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, transparent 40%, ${colors.accentColor || '#ff2ea0'}15 100%)` }} />
                    {/* Tag */}
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
      )}

      <div className="flex gap-6 flex-col lg:flex-row">
        <aside className="lg:w-72 shrink-0 flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-4">
          <nav className="flex flex-col gap-1">
            {tabs.map((tab) => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2.5 rounded-[var(--radius)] px-3 py-2 text-sm font-medium transition-colors text-left ${
                  activeTab === tab.id ? 'bg-[var(--color-accent-subtle)] text-[var(--color-fg)]' : 'text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)]'
                }`}>
                <tab.icon className="size-4" />
                {tab.label}
              </button>
            ))}
          </nav>
          <div className="mt-auto border-t border-[var(--color-border)] pt-4">
            <button onClick={save} disabled={isSaving}
              className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius)] bg-white py-2.5 text-sm font-semibold text-black shadow-sm transition-all duration-150 hover:brightness-110 hover:shadow-md active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100 disabled:active:scale-100">
              {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {isSaving ? 'Guardando…' : 'Guardar todo'}
            </button>
          </div>
        </aside>

        <div className="flex-1 min-w-0">
          {activeTab === 'carousel' && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Slides del carrusel</h2>
                <button onClick={addSlide}
                  className="inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--color-bg-subtle)]">
                  <Plus className="size-3.5" />
                  Agregar slide
                </button>
              </div>
              {slides.map((slide, i) => (
                <div key={slide.id}
                  className={`rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-4 ${draggedIdx === i ? 'opacity-50' : ''}`}
                  draggable onDragStart={() => setDraggedIdx(i)} onDragOver={(e) => e.preventDefault()}
                  onDrop={() => { if (draggedIdx !== null && draggedIdx !== i) moveSlide(draggedIdx, i); setDraggedIdx(null); }}
                  onDragEnd={() => setDraggedIdx(null)}>
                  <div className="flex items-start gap-4">
                    <div className="flex flex-col items-center gap-1 pt-1">
                      <ArrowUpDown className="size-4 text-[var(--color-fg-subtle)] cursor-grab" />
                      <span className="text-[10px] font-mono text-[var(--color-fg-subtle)]">{i + 1}</span>
                    </div>
                    <div className="flex-1 space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        {(['imageDesktop', 'imageMobile'] as const).map((type) => (
                          <div key={type}>
                            <label className="text-[11px] font-medium text-[var(--color-fg-muted)]">{type === 'imageDesktop' ? 'Desktop' : 'Mobile'}</label>
                            <div className="mt-1 flex gap-2">
                              <input
                                value={slide[type] || ''}
                                onChange={(e) => updateSlide(i, type, e.target.value)}
                                className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-[11px] font-mono"
                                placeholder="URL o /hero/..."
                              />
                              <button
                                type="button"
                                onClick={() => handleImageUpload(i, type)}
                                className="shrink-0 rounded border border-[var(--color-border)] px-2 text-[11px] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] transition-colors"
                                title="Subir imagen"
                              >
                                Subir
                              </button>
                              {slide[type] && (
                                <div className="size-8 shrink-0 rounded border border-[var(--color-border)] bg-cover bg-center"
                                  style={{ backgroundImage: `url(${slide[type]})` }} />
                              )}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Quick-select images */}
                      <div className="flex flex-wrap gap-1.5">
                        <span className="text-[10px] text-[var(--color-fg-subtle)] mr-1 self-center">Assets:</span>
                        {HERO_IMAGES.map((name) => (
                          <button key={name}
                            onClick={() => { updateSlide(i, 'imageDesktop', `/hero/${name}.webp`); updateSlide(i, 'imageMobile', `/hero/${name}.webp`); }}
                            className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${slide.imageDesktop === `/hero/${name}.webp` ? 'border-[var(--color-accent)] bg-[var(--color-accent-subtle)]' : 'border-[var(--color-border)] hover:border-[var(--color-accent)]'}`}>
                            {name}
                          </button>
                        ))}
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        {[
                          { key: 'kicker' as const, label: 'Kicker' },
                          { key: 'title' as const, label: 'Title' },
                          { key: 'body' as const, label: 'Body', span: 2 },
                          { key: 'cta' as const, label: 'CTA' },
                          { key: 'href' as const, label: 'Enlace' },
                        ].map(({ key, label, span }) => (
                          <div key={key} className={span === 2 ? 'col-span-2' : ''}>
                            <label className="text-[11px] font-medium text-[var(--color-fg-muted)]">{label}</label>
                            <input value={slide[key]} onChange={(e) => updateSlide(i, key, e.target.value)}
                              className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm" />
                          </div>
                        ))}
                        <div>
                          <label className="text-[11px] font-medium text-[var(--color-fg-muted)]">Color accent</label>
                          <input type="color" value={slide.accentColor} onChange={(e) => updateSlide(i, 'accentColor', e.target.value)}
                            className="mt-1 h-8 w-full rounded border border-[var(--color-border)]" />
                        </div>
                      </div>
                    </div>
                    <button onClick={() => removeSlide(i)} className="p-1 text-[var(--color-fg-subtle)] hover:text-[var(--color-danger)]">
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
              ))}
              <SaveButton onClick={save} isSaving={isSaving} />
            </div>
          )}

          {activeTab === 'texts' && (
            <div className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-5">
              <h2 className="text-lg font-semibold">Textos de la home</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  { key: 'heroTitle' as const, label: 'Hero título' },
                  { key: 'heroSubtitle' as const, label: 'Hero subtítulo' },
                  { key: 'tilesTitle' as const, label: 'Título categorías' },
                  { key: 'tilesSubtitle' as const, label: 'Subtítulo categorías' },
                ].map(({ key, label }) => (
                  <div key={key}>
                    <label className="text-[11px] font-medium text-[var(--color-fg-muted)]">{label}</label>
                    <input {...register(key)} className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm" />
                  </div>
                ))}
              </div>
              <SaveButton onClick={save} isSaving={isSaving} />
            </div>
          )}

          {activeTab === 'theme' && (
            <div className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-5">
              <h2 className="text-lg font-semibold">Tema</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {(['tango', 'crimson', 'gold', 'violet', 'emerald'] as const).map((tid) => (
                  <button key={tid} onClick={() => { setTheme(tid); setValue('accentColor', THEMES[tid].vars.accent); }}
                    className={`flex flex-col items-center gap-2 rounded-[var(--radius)] border p-4 transition-all ${
                      activeTheme === tid ? 'border-[var(--color-accent)] ring-1 ring-[var(--color-accent)]' : 'border-[var(--color-border)] hover:border-[var(--color-accent-border)]'
                    }`}>
                    <div className="size-8 rounded-full border-2" style={{ backgroundColor: THEMES[tid].vars.accent, borderColor: THEMES[tid].vars.accentBorder }} />
                    <span className="text-xs font-medium">{THEMES[tid].label}</span>
                  </button>
                ))}
              </div>
              <SaveButton onClick={save} isSaving={isSaving} />
            </div>
          )}

          {activeTab === 'colors' && (
            <div className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-5">
              <h2 className="text-lg font-semibold">Paleta de colores</h2>
              <p className="text-[11px] text-[var(--color-fg-muted)]">Modificá los colores de la interfaz del jugador. El panel admin queda igual.</p>

              {[
                {
                  group: 'Fondos',
                  desc: 'Capas de profundidad de la página',
                  keys: [
                    { key: 'bgColor' as const, label: 'Fondo principal', desc: 'Color base de toda la página' },
                    { key: 'bgElevated' as const, label: 'Paneles y tarjetas', desc: 'Sidebars, modals, cards elevados' },
                    { key: 'bgSubtle' as const, label: 'Inputs y badges', desc: 'Campos de texto, pills, chips' },
                  ],
                },
                {
                  group: 'Texto',
                  desc: 'Jerarquía de lectura',
                  keys: [
                    { key: 'fgColor' as const, label: 'Texto principal', desc: 'Títulos, cuerpo, contenido primario' },
                    { key: 'fgMuted' as const, label: 'Texto secundario', desc: 'Subtítulos, descripciones, labels' },
                    { key: 'fgSubtle' as const, label: 'Texto sutil', desc: 'Placeholders, hints, timestamps' },
                  ],
                },
                {
                  group: 'Bordes',
                  desc: 'Separadores y contornos',
                  keys: [
                    { key: 'borderColor' as const, label: 'Bordes sutiles', desc: 'Separadores entre secciones' },
                    { key: 'borderStrong' as const, label: 'Bordes fuertes', desc: 'Contornos de inputs focus, cards activas' },
                  ],
                },
                {
                  group: 'Accent',
                  desc: 'Identidad visual de la marca',
                  keys: [
                    { key: 'accentColor' as const, label: 'Color principal', desc: 'Botones CTA, links, highlights' },
                    { key: 'accentHover' as const, label: 'Hover de botones', desc: 'Estado hover del accent principal' },
                    { key: 'accentFg' as const, label: 'Texto sobre accent', desc: 'Color del texto dentro de botones' },
                    { key: 'accentText' as const, label: 'Texto accent', desc: 'Links, texto destacado en contenido' },
                    { key: 'accentSubtle' as const, label: 'Fondo accent sutil', desc: 'Badges, tags, highlights de fondo' },
                    { key: 'accentBorder' as const, label: 'Borde accent', desc: 'Bordes de tags, badges, items activos' },
                  ],
                },
                {
                  group: 'Semántico',
                  desc: 'Estados funcionales y acentos extra',
                  keys: [
                    { key: 'success' as const, label: 'Éxito / Saldo', desc: 'Ganancias, confirmaciones, saldo positivo' },
                    { key: 'warning' as const, label: 'Advertencia', desc: 'Alertas, estados en juego' },
                    { key: 'magenta' as const, label: 'Magenta', desc: 'Acento decorativo, niveles VIP' },
                    { key: 'cyan' as const, label: 'Cyan', desc: 'Crash games, acento tech' },
                    { key: 'purple' as const, label: 'Púrpura', desc: 'Live casino, acento premium' },
                    { key: 'gold' as const, label: 'Dorado', desc: 'Bonos, recompensas, logros' },
                  ],
                },
              ].map(({ group, desc, keys }) => (
                <div key={group}>
                  <div className="flex items-baseline gap-2 mb-2">
                    <h3 className="text-xs font-semibold text-[var(--color-fg)] uppercase tracking-wide">{group}</h3>
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
              <SaveButton onClick={save} isSaving={isSaving} />
            </div>
          )}

          {activeTab === 'brand' && (
            <div className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-5">
              <h2 className="text-lg font-semibold">Marca</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-[11px] font-medium text-[var(--color-fg-muted)]">Nombre de la plataforma</label>
                  <input {...register('platformName')}
                    className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm"
                    placeholder="Casino TANGO" />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-[var(--color-fg-muted)]">URL del logo</label>
                  <div className="mt-1 flex gap-2">
                    <input {...register('logoUrl')}
                      className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm font-mono"
                      placeholder="https://tuservidor.com/logo.webp" />
                    <button type="button" onClick={() => uploadFile((url) => setValue('logoUrl', url))}
                      className="shrink-0 rounded border border-[var(--color-border)] px-2 text-[11px] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] transition-colors">
                      Subir
                    </button>
                  </div>
                </div>
                <div className="md:col-span-2">
                  <label className="text-[11px] font-medium text-[var(--color-fg-muted)]">Favicon del jugador</label>
                  <p className="text-[10px] text-[var(--color-fg-subtle)] mb-1.5">Icono que aparece en la pestaña del navegador del jugador</p>
                  <div className="flex gap-2">
                    <input {...register('faviconUrl')}
                      className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm font-mono"
                      placeholder="https://tuservidor.com/favicon.ico" />
                    <button type="button" onClick={() => uploadFile((url) => setValue('faviconUrl', url))}
                      className="shrink-0 rounded border border-[var(--color-border)] px-3 py-2 text-[11px] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] transition-colors">
                      Subir
                    </button>
                  </div>
                </div>
              </div>

              {/* Logo preview */}
              <div className="flex items-center gap-4 flex-wrap p-3 rounded-[var(--radius)] border border-[var(--color-border)]">
                {watch('logoUrl') && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-[var(--color-fg-subtle)]">Logo</span>
                    <img src={watch('logoUrl')} alt="Logo preview" className="h-10 rounded border border-[var(--color-border)] bg-white p-1"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  </div>
                )}
                {watch('faviconUrl') && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-[var(--color-fg-subtle)]">Favicon</span>
                    <img src={watch('faviconUrl')} alt="Favicon preview" className="size-8 rounded border border-[var(--color-border)] bg-white p-0.5"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  </div>
                )}
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] text-[var(--color-fg-subtle)]">Nombre</span>
                  <span className="text-sm font-medium">{watch('platformName') || 'Casino TANGO'}</span>
                </div>
              </div>

              {/* Browser tab mock */}
              <div>
                <span className="text-[10px] text-[var(--color-fg-subtle)] block mb-2">Vista previa en el navegador</span>
                <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] overflow-hidden">
                  {/* Tab bar */}
                  <div className="flex items-center gap-0 px-2 pt-1.5" style={{ backgroundColor: 'var(--p-bg, #0a0008)' }}>
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-t-[var(--radius)] text-[11px]" style={{ backgroundColor: 'var(--color-bg-elevated)' }}>
                      {watch('faviconUrl') ? (
                        <img src={watch('faviconUrl')} alt="" className="size-3.5 rounded-sm object-contain"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      ) : (
                        <span className="size-3.5 rounded-sm flex items-center justify-center text-[8px] font-bold" style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-accent-fg)' }}>
                          {(watch('platformName') || 'C')[0]}
                        </span>
                      )}
                      <span className="text-[var(--color-fg)]">{watch('platformName') || 'Casino TANGO'}</span>
                      <span className="text-[var(--color-fg-subtle)] ml-1">× </span>
                    </div>
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-t text-[11px] opacity-50" style={{ backgroundColor: 'var(--color-bg-subtle)' }}>
                      <span className="text-[var(--color-fg-subtle)]">Google</span>
                    </div>
                  </div>
                  {/* Address bar */}
                  <div className="flex items-center gap-2 px-3 py-1.5 border-b" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg-elevated)' }}>
                    <div className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] flex-1" style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                      <span style={{ color: 'var(--color-success)' }}>🔒</span>
                      <span className="text-[var(--color-fg-muted)]">demo.{(watch('platformName') || 'casino').toLowerCase().replace(/\s+/g, '')}.com/play</span>
                    </div>
                  </div>
                </div>
              </div>

              <SaveButton onClick={save} isSaving={isSaving} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}