'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTenantSettings } from '@/lib/hooks/use-tenant-settings';
import { useTheme, THEMES } from '@/lib/hooks/use-theme';
import { toast } from 'sonner';
import {
  Image,
  Palette,
  Paintbrush,
  Save,
  Eye,
} from 'lucide-react';

// Esquema principal del diseño
const designFormSchema = z.object({
  heroTitle: z.string().min(1, 'El título de fondo requerido').max(40, 'Máximo 40 caracteres'),
  heroSubtitle: z.string().max(80, 'Máximo 80 caracteres'),
  tilesTitle: z.string().min(1, 'El título de categorías requerido').max(30, 'Máximo 30 caracteres'),
  tilesSubtitle: z.string().max(60, 'Máximo 60 caracteres'),
  ctaPrimaryColor: z.string().regex(/^#[0-9A-F]{6}$/i, 'Hex válido'),
  ctaSecondaryColor: z.string().regex(/^#[0-9A-F]{6}$/i, 'Hex válido'),
  bgColor: z.string().regex(/^#[0-9A-F]{6}$/i, 'Hex válido'),
  textColor: z.string().regex(/^#[0-9A-F]{6}$/i, 'Hex válido'),
  accentTextColor: z.string().regex(/^#[0-9A-F]{6}$/i, 'Hex válido'),
});

type DesignForm = z.infer<typeof designFormSchema>;

export default function DesignPage() {
  const [activeTab, setActiveTab] = useState<'carousel' | 'theme' | 'colors'>('carousel');
  const [showPreview, setShowPreview] = useState(false);
  const { theme: activeTheme, setTheme } = useTheme();
  const tenantSettings = useTenantSettings();

  // Estados del formulario
  const {
    register,
    handleSubmit,
    setValue,
    watch,
  } = useForm<DesignForm>({ resolver: zodResolver(designFormSchema), mode: 'onChange' });

  // Cargar settings del tenant existentes (si los hay)
  useEffect(() => {
    if (tenantSettings.data?.data) {
      const primaryColor = tenantSettings.data.data.find((s) => s.key === 'branding.primaryColor')?.value as string;
      if (primaryColor) {
        setValue('ctaPrimaryColor', primaryColor);
      }
      const bgColor = tenantSettings.data.data.find((s) => s.key === 'bg_color')?.value as string;
      if (bgColor) {
        setValue('bgColor', bgColor);
      }
      const textColor = tenantSettings.data.data.find((s) => s.key === 'text_color')?.value as string;
      if (textColor) {
        setValue('textColor', textColor);
      }
      const accentTextColor = tenantSettings.data.data.find((s) => s.key === 'accent_text_color')?.value as string;
      if (accentTextColor) {
        setValue('accentTextColor', accentTextColor);
      }
    }
  }, [tenantSettings.data, setValue]);

  // Guardar configuración
  const onSubmit = (data: DesignForm) => {
    console.log('Guardando configuración de diseño:', data);
    toast.success('Configuración guardada con éxito');
  };

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-8 lg:px-6">
      {/* Header */}
      <header className="mb-8 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-3xl">Configuración de Diseño</h1>
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="inline-flex items-center gap-2 rounded-[var(--radius)] border border-[var(--color-border)] px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--color-bg-subtle)]"
          >
            <Eye className="size-4" />
            {showPreview ? 'Ocultar preview' : 'Mostrar preview'}
          </button>
        </div>
        <p className="text-[var(--color-fg-muted)]">
          Personaliza los elementos visuales de la página de inicio /play (banners del carrusel, categorías, colores, tipografía). Los cambios aplican inmediatamente a la vista previa.
        </p>
      </header>

      {/* Layout principal */}
      <div className="flex gap-6">
        {/* Panel de configuración */}
        <aside className="hidden w-80 shrink-0 flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-5 lg:flex">
          <div className="flex flex-col gap-2 border-b border-[var(--color-border)] pb-3">
            <button
              onClick={() => setActiveTab('carousel')}
              className={`inline-flex items-center gap-2 rounded-[var(--radius)] px-3 py-2 text-sm font-medium transition-colors ${activeTab === 'carousel' ? 'bg-[var(--color-accent-subtle)] text-[var(--color-fg)]' : 'hover:bg-[var(--color-bg-subtle)] text-[var(--color-fg-muted)]'}`}
            >
              <Image className="size-4" />
              Slides del carrusel
            </button>
            <button
              onClick={() => setActiveTab('theme')}
              className={`inline-flex items-center gap-2 rounded-[var(--radius)] px-3 py-2 text-sm font-medium transition-colors ${activeTab === 'theme' ? 'bg-[var(--color-accent-subtle)] text-[var(--color-fg)]' : 'hover:bg-[var(--color-bg-subtle)] text-[var(--color-fg-muted)]'}`}
            >
              <Palette className="size-4" />
              Tema
            </button>
            <button
              onClick={() => setActiveTab('colors')}
              className={`inline-flex items-center gap-2 rounded-[var(--radius)] px-3 py-2 text-sm font-medium transition-colors ${activeTab === 'colors' ? 'bg-[var(--color-accent-subtle)] text-[var(--color-fg)]' : 'hover:bg-[var(--color-bg-subtle)] text-[var(--color-fg-muted)]'}`}
            >
              <Paintbrush className="size-4" />
              Colores
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {activeTab === 'carousel' && (
              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold">Slides del carrusel</h3>
                <div className="flex flex-col gap-2">
                  <div className="rounded border border-[var(--color-border)] p-3">
                    <p className="text-sm font-medium">Welcome banner</p>
                    <p className="text-[11px] text-[var(--color-fg-muted)]">/hero/welcome.webp</p>
                  </div>
                  <div className="rounded border border-[var(--color-border)] p-3">
                    <p className="text-sm font-medium">Slots banner</p>
                    <p className="text-[11px] text-[var(--color-fg-muted)]">/hero/slots.webp</p>
                  </div>
                  <div className="rounded border border-[var(--color-border)] p-3">
                    <p className="text-sm font-medium">Live banner</p>
                    <p className="text-[11px] text-[var(--color-fg-muted)]">/hero/live.webp</p>
                  </div>
                  <div className="rounded border border-[var(--color-border)] p-3">
                    <p className="text-sm font-medium">Bonus banner</p>
                    <p className="text-[11px] text-[var(--color-fg-muted)]">/hero/bonus.webp</p>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'theme' && (
              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold">Presets del tema</h3>
                {(['tango', 'crimson', 'gold', 'violet', 'emerald'] as const).map((themeId) => (
                  <button
                    key={themeId}
                    onClick={() => setTheme(themeId)}
                    className="inline-flex items-center gap-2 rounded-[var(--radius)] px-3 py-2 text-sm font-medium transition-all hover:scale-105"
                    style={{ backgroundColor: THEMES[themeId].vars.accent + '20' }}
                  >
                    <div className="size-4 rounded-full border border-[var(--color-border)]" style={{ backgroundColor: THEMES[themeId].vars.accent }} />
                    <span className="capitalize">{THEMES[themeId].label}</span>
                    {activeTheme === themeId && <span className="text-[var(--color-accent)]">•</span>}
                  </button>
                ))}

                <div className="mt-4 flex flex-col gap-2">
                  <label className="text-[11px] font-medium text-[var(--color-fg-muted)]">Tint personalizado</label>
                  <input
                    type="color"
                    className="size-8 rounded border border-[var(--color-border)]"
                    onChange={(e) => {
                      const color = e.target.value;
                      setValue('ctaPrimaryColor', color);
                    }}
                    value={watch('ctaPrimaryColor') || '#ff2ea0'}
                  />
                </div>
              </div>
            )}

            {activeTab === 'colors' && (
              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold">Paleta de colores</h3>
                <div className="grid grid-cols-3 gap-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-medium">Fondo</label>
                    <input
                      type="color"
                      {...register('bgColor')}
                      className="size-6 rounded border border-[var(--color-border)]"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-medium">Texto</label>
                    <input
                      type="color"
                      {...register('textColor')}
                      className="size-6 rounded border border-[var(--color-border)]"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-medium">Accent</label>
                    <input
                      type="color"
                      {...register('accentTextColor')}
                      className="size-6 rounded border border-[var(--color-border)]"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-[var(--color-border)] pt-4">
            <button
              onClick={handleSubmit(onSubmit)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius)] bg-[var(--gradient-accent)] px-4 py-2 text-sm font-semibold text-[var(--color-accent-fg)] transition-opacity hover:opacity-90"
            >
              <Save className="size-4" />
              Guardar cambios
            </button>
          </div>
        </aside>

        {/* Área de visualización / preview */}
        <main className="flex-1">
          {showPreview && (
            <div className="mb-6 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-6">
              <h3 className="mb-4 text-lg font-semibold">Vista previa del diseño</h3>
              <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] p-8">
                <div
                  className="relative mx-auto max-w-7xl overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)]"
                  style={{
                    backgroundColor: watch('bgColor') || '#0a0a0a',
                    fontFamily: 'system-ui, sans-serif',
                  }}
                >
                  <div className="mb-6 border-b border-[var(--color-border)] p-4">
                    <h2 className="text-xl font-semibold" style={{ color: watch('accentTextColor') || '#ff2ea0' }}>
                      {watch('heroTitle') || 'El Casino del Pueblo'}
                    </h2>
                  </div>
                  <div className="p-6">
                    <p style={{ color: watch('textColor') || '#ffffff' }}>
                      {watch('heroSubtitle') || 'Viví la experiencia TANGO. Slots, crash, ruleta y más — todo en un solo lugar.'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-6">
            <h2 className="text-2xl font-semibold">Vista previa en vivo</h2>
            <div className="prose max-w-none">
              <p>Edita los elementos abajo para ver los cambios en tiempo real.</p>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}