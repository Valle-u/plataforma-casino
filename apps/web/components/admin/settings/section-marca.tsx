/**
 * SectionMarca — nombre de la plataforma, tagline, logo y favicon.
 * Guarda el slice `brand` de design.config + las keys espejo
 * branding.platform_name / logo_url / favicon_url / tagline.
 */

'use client';

import type { DesignEditorApi } from './use-design-editor';
import { SaveButton, SectionCard } from './settings-common';

export function SectionMarca({ editor }: { editor: DesignEditorApi }) {
  const { form, isSaving, uploadBrandImage, saveBrand } = editor;
  const watch = form.watch();
  const { register } = form;

  return (
    <SectionCard
      title="Marca"
      description="Nombre comercial, tagline y logotipos que se muestran al jugador."
      footer={<SaveButton onClick={saveBrand} isSaving={isSaving} label="Guardar marca" />}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-[11px] font-medium text-[var(--color-fg-muted)]">
            Nombre de la plataforma
          </label>
          <input
            {...register('platformName')}
            className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm"
            placeholder="Casino TANGO"
          />
        </div>
        <div>
          <label className="text-[11px] font-medium text-[var(--color-fg-muted)]">
            Tagline
          </label>
          <input
            {...register('tagline')}
            className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm"
            placeholder="El Casino del Pueblo"
            maxLength={200}
          />
          <p className="text-[10px] text-[var(--color-fg-subtle)] mt-1">
            Frase corta bajo el nombre: hero del player, pantalla de login.
          </p>
        </div>
        <div>
          <label className="text-[11px] font-medium text-[var(--color-fg-muted)]">
            URL del logo
          </label>
          <div className="mt-1 flex gap-2">
            <input
              {...register('logoUrl')}
              className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm font-mono"
              placeholder="https://tuservidor.com/logo.webp"
            />
            <button
              type="button"
              onClick={() => uploadBrandImage('logoUrl')}
              className="shrink-0 rounded border border-[var(--color-border)] px-2 text-[11px] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] transition-colors"
            >
              Subir
            </button>
          </div>
        </div>
        <div>
          <label className="text-[11px] font-medium text-[var(--color-fg-muted)]">
            Favicon del jugador
          </label>
          <div className="mt-1 flex gap-2">
            <input
              {...register('faviconUrl')}
              className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm font-mono"
              placeholder="https://tuservidor.com/favicon.ico"
            />
            <button
              type="button"
              onClick={() => uploadBrandImage('faviconUrl')}
              className="shrink-0 rounded border border-[var(--color-border)] px-3 py-2 text-[11px] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] transition-colors"
            >
              Subir
            </button>
          </div>
          <p className="text-[10px] text-[var(--color-fg-subtle)] mt-1">
            Icono de la pestaña del navegador del jugador.
          </p>
        </div>
      </div>

      {/* Logo preview */}
      <div className="flex items-center gap-4 flex-wrap p-3 rounded-[var(--radius)] border border-[var(--color-border)]">
        {watch.logoUrl && (
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-[var(--color-fg-subtle)]">Logo</span>
            <img
              src={watch.logoUrl}
              alt="Logo preview"
              className="h-10 rounded border border-[var(--color-border)] bg-white p-1"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          </div>
        )}
        {watch.faviconUrl && (
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-[var(--color-fg-subtle)]">Favicon</span>
            <img
              src={watch.faviconUrl}
              alt="Favicon preview"
              className="size-8 rounded border border-[var(--color-border)] bg-white p-0.5"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          </div>
        )}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-[var(--color-fg-subtle)]">Nombre</span>
          <span className="text-sm font-medium">{watch.platformName || 'Casino TANGO'}</span>
        </div>
        {watch.tagline && (
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-[var(--color-fg-subtle)]">Tagline</span>
            <span className="text-sm text-[var(--color-fg-muted)]">{watch.tagline}</span>
          </div>
        )}
      </div>

      {/* Browser tab mock */}
      <div>
        <span className="text-[10px] text-[var(--color-fg-subtle)] block mb-2">
          Vista previa en el navegador
        </span>
        <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] overflow-hidden">
          <div className="flex items-center gap-0 px-2 pt-1.5" style={{ backgroundColor: 'var(--color-bg)' }}>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-t-[var(--radius)] text-[11px]" style={{ backgroundColor: 'var(--color-bg-elevated)' }}>
              {watch.faviconUrl ? (
                <img src={watch.faviconUrl} alt="" className="size-3.5 rounded-sm object-contain"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              ) : (
                <span className="size-3.5 rounded-sm flex items-center justify-center text-[8px] font-bold" style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-accent-fg)' }}>
                  {(watch.platformName || 'C')[0]}
                </span>
              )}
              <span className="text-[var(--color-fg)]">{watch.platformName || 'Casino TANGO'}</span>
              <span className="text-[var(--color-fg-subtle)] ml-1">× </span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-t text-[11px] opacity-50" style={{ backgroundColor: 'var(--color-bg-subtle)' }}>
              <span className="text-[var(--color-fg-subtle)]">Google</span>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 border-b" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg-elevated)' }}>
            <div className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] flex-1" style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
              <span style={{ color: 'var(--color-success)' }}>🔒</span>
              <span className="text-[var(--color-fg-muted)]">demo.{(watch.platformName || 'casino').toLowerCase().replace(/\s+/g, '')}.com/play</span>
            </div>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
