'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  useTenantSettings,
  useSetSetting,
} from '@/lib/hooks/use-tenant-settings';
import { useTheme, THEMES } from '@/lib/hooks/use-theme';
import { toast } from 'sonner';
import {
  Image,
  Palette,
  Paintbrush,
  Save,
  Eye,
  Loader2,
  Upload,
  ArrowUpDown,
  Plus,
  Trash2,
  Globe,
} from 'lucide-react';

const slideSchema = z.object({
  id: z.string(),
  imageDesktop: z.string(),
  imageMobile: z.string().optional(),
  title: z.string().min(1).max(60),
  body: z.string().min(1).max(120),
  cta: z.string().min(1).max(30),
  href: z.string().min(1),
  accentColor: z.string().regex(/^#[0-9A-F]{6}$/i),
  kicker: z.string().min(1).max(30),
  order: z.number(),
});

type Slide = z.infer<typeof slideSchema>;

const designFormSchema = z.object({
  heroTitle: z.string().min(1).max(40),
  heroSubtitle: z.string().max(80),
  tilesTitle: z.string().min(1).max(30),
  tilesSubtitle: z.string().max(60),
  bgColor: z.string().regex(/^#[0-9A-F]{6}$/i),
  textColor: z.string().regex(/^#[0-9A-F]{6}$/i),
  accentColor: z.string().regex(/^#[0-9A-F]{6}$/i),
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

const DESIGN_SETTINGS_KEY = 'design.config';

function SaveButton({ onClick, isSaving }: { onClick: () => void; isSaving: boolean }) {
  return (
    <div className="sticky bottom-0 -mx-4 -mb-4 mt-2 border-t border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-4 pb-4 pt-3">
      <button
        onClick={onClick}
        disabled={isSaving}
        className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius)] bg-[var(--gradient-accent)] py-2.5 text-sm font-semibold text-[var(--color-accent-fg)] transition-opacity hover:opacity-90 disabled:opacity-50"
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

  const { theme: activeTheme, setTheme } = useTheme();
  const tenantSettings = useTenantSettings();
  const saveSetting = useSetSetting();
  const isSaving = saveSetting.isPending;

  const {
    register,
    handleSubmit,
    setValue,
    watch,
  } = useForm<DesignForm>({
    resolver: zodResolver(designFormSchema),
    defaultValues: {
      bgColor: '#0a0a0a',
      textColor: '#ffffff',
      accentColor: '#ff2ea0',
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
      if (saved.slides && Array.isArray(saved.slides)) setSlides(saved.slides as Slide[]);
      if (saved.colors && typeof saved.colors === 'object') {
        const c = saved.colors as Record<string, string>;
        if (c.bgColor) setValue('bgColor', c.bgColor);
        if (c.textColor) setValue('textColor', c.textColor);
        if (c.accentColor) setValue('accentColor', c.accentColor);
      }
      if (saved.texts && typeof saved.texts === 'object') {
        const t = saved.texts as Record<string, string>;
        if (t.heroTitle) setValue('heroTitle', t.heroTitle);
        if (t.heroSubtitle) setValue('heroSubtitle', t.heroSubtitle);
        if (t.tilesTitle) setValue('tilesTitle', t.tilesTitle);
        if (t.tilesSubtitle) setValue('tilesSubtitle', t.tilesSubtitle);
      }
      if (saved.brand && typeof saved.brand === 'object') {
        const b = saved.brand as Record<string, string>;
        if (b.platformName) setValue('platformName', b.platformName);
        if (b.logoUrl) setValue('logoUrl', b.logoUrl);
        if (b.faviconUrl) setValue('faviconUrl', b.faviconUrl);
      }
    }
    const logoUrl = tenantSettings.data.data.find((s) => s.key === 'branding.logo_url')?.value as string | undefined;
    if (logoUrl && !watch('logoUrl')) setValue('logoUrl', logoUrl);
    const platformName = tenantSettings.data.data.find((s) => s.key === 'branding.platform_name')?.value as string | undefined;
    if (platformName && !watch('platformName')) setValue('platformName', platformName);
  }, [tenantSettings.data, setValue]);

  const onSubmit = async (form: DesignForm) => {
    const payload = {
      slides,
      colors: { bgColor: form.bgColor, textColor: form.textColor, accentColor: form.accentColor },
      texts: { heroTitle: form.heroTitle, heroSubtitle: form.heroSubtitle, tilesTitle: form.tilesTitle, tilesSubtitle: form.tilesSubtitle },
      brand: { platformName: form.platformName, logoUrl: form.logoUrl, faviconUrl: form.faviconUrl },
    };
    try {
      await saveSetting.mutateAsync({ key: DESIGN_SETTINGS_KEY, value: payload });
      await saveSetting.mutateAsync({ key: 'branding.logo_url', value: form.logoUrl || null });
      await saveSetting.mutateAsync({ key: 'branding.platform_name', value: form.platformName });
      if (form.faviconUrl) {
        await saveSetting.mutateAsync({ key: 'branding.favicon_url', value: form.faviconUrl });
      }
      toast.success('Diseño guardado', { description: 'Todos los cambios aplicados.' });
    } catch {
      toast.error('Error al guardar');
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

  const handleImageUpload = (idx: number, type: 'imageDesktop' | 'imageMobile') => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/webp,image/avif';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      updateSlide(idx, type, URL.createObjectURL(file));
    };
    input.click();
  };

  const colors = watch();
  const previewStyle = {
    '--preview-bg': colors.bgColor || '#0a0a0a',
    '--preview-text': colors.textColor || '#ffffff',
    '--preview-accent': colors.accentColor || '#ff2ea0',
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
              className="inline-flex items-center gap-2 rounded-[var(--radius)] bg-[var(--gradient-accent)] px-5 py-2 text-sm font-semibold text-[var(--color-accent-fg)] transition-opacity hover:opacity-90 disabled:opacity-50">
              {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {isSaving ? 'Guardando…' : 'Guardar todo'}
            </button>
          </div>
        </div>
      </header>

      {showPreview && (
        <div className="mb-8 overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)]" style={previewStyle}>
          <div className="flex flex-col gap-4 p-8" style={{ backgroundColor: 'var(--preview-bg)' }}>
            <span className="text-[10px] uppercase tracking-[.2em] font-semibold" style={{ color: 'var(--preview-accent)' }}>
              {watch('heroTitle')}
            </span>
            <h2 className="font-display text-3xl leading-tight" style={{ color: 'var(--preview-text)' }}>
              {watch('tilesTitle')}
            </h2>
            <p className="text-sm max-w-lg" style={{ color: 'var(--preview-text)', opacity: 0.7 }}>
              {watch('heroSubtitle')}
            </p>
            <div className="flex gap-3 overflow-x-auto pb-2 mt-2">
              {slides.map((s) => (
                <div key={s.id} className="shrink-0 w-[180px] h-[100px] rounded-[var(--radius)] bg-cover bg-center flex items-end p-3"
                  style={{ backgroundImage: `url(${s.imageDesktop})` }}>
                  <span className="text-xs font-medium text-white drop-shadow-md">{s.kicker}</span>
                </div>
              ))}
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
              className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius)] bg-[var(--gradient-accent)] py-2.5 text-sm font-semibold text-[var(--color-accent-fg)] transition-opacity hover:opacity-90 disabled:opacity-50">
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
                      <div className="flex gap-3">
                        {(['imageDesktop', 'imageMobile'] as const).map((type) => (
                          <div key={type} className="flex-1">
                            <label className="text-[11px] font-medium text-[var(--color-fg-muted)]">{type === 'imageDesktop' ? 'Desktop' : 'Mobile'}</label>
                            <div className={`mt-1 h-20 rounded-[var(--radius)] bg-cover bg-center border border-[var(--color-border)] cursor-pointer hover:border-[var(--color-accent)] ${!slide[type] ? 'flex items-center justify-center' : ''}`}
                              style={slide[type] ? { backgroundImage: `url(${slide[type]})` } : {}}
                              onClick={() => handleImageUpload(i, type)}>
                              {!slide[type] && <><Upload className="size-4 mr-1 text-[var(--color-fg-subtle)]" /><span className="text-[11px] text-[var(--color-fg-subtle)]">Subir</span></>}
                            </div>
                          </div>
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
                            <input value={slide[key] as string} onChange={(e) => updateSlide(i, key, e.target.value)}
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
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {[
                  { key: 'bgColor' as const, label: 'Fondo' },
                  { key: 'textColor' as const, label: 'Texto' },
                  { key: 'accentColor' as const, label: 'Accent' },
                ].map(({ key, label }) => (
                  <div key={key}>
                    <label className="text-[11px] font-medium text-[var(--color-fg-muted)]">{label}</label>
                    <div className="mt-1 flex items-center gap-2">
                      <input type="color" {...register(key)} className="size-8 rounded border border-[var(--color-border)]" />
                      <span className="text-[10px] font-mono uppercase text-[var(--color-fg-muted)]">{watch(key)}</span>
                    </div>
                  </div>
                ))}
              </div>
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
                  <input {...register('logoUrl')}
                    className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm font-mono"
                    placeholder="https://tuservidor.com/logo.webp" />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-[var(--color-fg-muted)]">URL del favicon</label>
                  <input {...register('faviconUrl')}
                    className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm font-mono"
                    placeholder="https://tuservidor.com/favicon.ico" />
                </div>
              </div>
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
              <SaveButton onClick={save} isSaving={isSaving} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}