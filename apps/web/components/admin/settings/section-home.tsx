/**
 * SectionHome — contenido de la home del jugador: carrusel de banners
 * (slides) + textos del hero y categorías. Guarda el slice `slides` +
 * `texts` de design.config.
 */

'use client';

import { ArrowUpDown, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { DesignEditorApi, Slide } from './use-design-editor';
import { HERO_IMAGES } from './use-design-editor';
import { SaveButton, SectionCard } from './settings-common';

export function SectionHome({ editor }: { editor: DesignEditorApi }) {
  const {
    form,
    slides,
    isSaving,
    addSlide,
    removeSlide,
    moveSlide,
    updateSlide,
    uploadSlideImage,
    saveHome,
  } = editor;
  const { register } = form;
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);

  return (
    <SectionCard
      title="Home del jugador"
      description="Los banners grandes y los textos de la página principal que ve el jugador."
      footer={<SaveButton onClick={saveHome} isSaving={isSaving} label="Guardar home" />}
    >
      {/* Textos */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-2 border-b border-[var(--color-border)]">
        {[
          { key: 'heroTitle' as const, label: 'Título del banner' },
          { key: 'heroSubtitle' as const, label: 'Subtítulo del banner' },
          { key: 'tilesTitle' as const, label: 'Título de categorías' },
          { key: 'tilesSubtitle' as const, label: 'Subtítulo de categorías' },
        ].map(({ key, label }) => (
          <div key={key}>
            <label className="text-[11px] font-medium text-[var(--color-fg-muted)]">
              {label}
            </label>
            <input
              {...register(key)}
              className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm"
            />
          </div>
        ))}
      </div>

      {/* Slides */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-xs font-semibold text-[var(--color-fg)] uppercase tracking-wide">
              Slides del carrusel
            </h3>
            <p className="mt-0.5 text-[11px] leading-snug text-[var(--color-fg-muted)]">
              Subí una imagen por dispositivo: en el celular el banner es casi
              cuadrado y en la computadora bien apaisado, así que la misma foto
              no sirve para los dos. Usá <strong>WebP</strong> — pesa mucho
              menos que JPG o PNG y carga más rápido.
            </p>
          </div>
          <button
            type="button"
            onClick={addSlide}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--color-bg-subtle)]"
          >
            <Plus className="size-3.5" />
            Agregar slide
          </button>
        </div>

        {slides.map((slide, i) => (
          <SlideEditor
            key={slide.id}
            slide={slide}
            index={i}
            dragged={draggedIdx === i}
            onDragStart={() => setDraggedIdx(i)}
            onDrop={() => {
              if (draggedIdx !== null && draggedIdx !== i) moveSlide(draggedIdx, i);
              setDraggedIdx(null);
            }}
            onDragEnd={() => setDraggedIdx(null)}
            onUpdate={(field, value) => updateSlide(i, field, value)}
            onRemove={() => removeSlide(i)}
            onUpload={(type) => uploadSlideImage(i, type)}
          />
        ))}
      </div>
    </SectionCard>
  );
}

function SlideEditor({
  slide,
  index,
  dragged,
  onDragStart,
  onDrop,
  onDragEnd,
  onUpdate,
  onRemove,
  onUpload,
}: {
  slide: Slide;
  index: number;
  dragged: boolean;
  onDragStart: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
  onUpdate: (field: keyof Slide, value: string | number) => void;
  onRemove: () => void;
  onUpload: (type: 'imageDesktop' | 'imageMobile') => void;
}) {
  return (
    <div
      className={`rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-4 ${dragged ? 'opacity-50' : ''}`}
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <div className="flex items-start gap-4">
        <div className="flex flex-col items-center gap-1 pt-1">
          <ArrowUpDown className="size-4 text-[var(--color-fg-subtle)] cursor-grab" />
          <span className="text-[10px] font-mono text-[var(--color-fg-subtle)]">{index + 1}</span>
        </div>
        <div className="flex-1 space-y-3">
          {/* En mobile va apilado: dos columnas dejan ~165px por campo y la
              fila (URL + Subir + miniatura) no entra. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(['imageDesktop', 'imageMobile'] as const).map((type) => (
              <div key={type} className="min-w-0">
                <label className="text-[11px] font-medium text-[var(--color-fg-muted)]">
                  {type === 'imageDesktop' ? 'Desktop' : 'Mobile'}
                </label>
                {/* Medidas derivadas de la caja real del banner: 552px de
                    alto a lo ancho del viewport en desktop, 372px en mobile
                    (LobbyBanner). Como recorta con `object-cover`, lo que
                    importa es la PROPORCIÓN — si no coincide, se come los
                    costados o el alto. */}
                <p className="mt-0.5 text-[10px] leading-snug text-[var(--color-fg-subtle)]">
                  {type === 'imageDesktop'
                    ? 'WebP · 1920×552 px (apaisada, 3.5:1)'
                    : 'WebP · 1080×1080 px (cuadrada, 1:1)'}
                </p>
                <div className="mt-1 flex gap-2">
                  <input
                    value={slide[type] || ''}
                    onChange={(e) => onUpdate(type, e.target.value)}
                    // min-w-0: sin esto el input no baja de su ancho
                    // intrinseco (~246px) por mas `flex-1` que tenga, y
                    // desbordaba la pagina 154px.
                    className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-[11px] font-mono"
                    placeholder="URL o /hero/..."
                  />
                  <button
                    type="button"
                    onClick={() => onUpload(type)}
                    className="shrink-0 rounded border border-[var(--color-border)] px-2 text-[11px] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] transition-colors"
                    title="Subir imagen"
                  >
                    Subir
                  </button>
                  {slide[type] && (
                    <div
                      className="size-8 shrink-0 rounded border border-[var(--color-border)] bg-cover bg-center"
                      style={{ backgroundImage: `url(${slide[type]})` }}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Quick-select images */}
          <div className="flex flex-wrap gap-1.5">
            <span className="text-[10px] text-[var(--color-fg-subtle)] mr-1 self-center">Assets:</span>
            {HERO_IMAGES.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  onUpdate('imageDesktop', `/hero/${name}.webp`);
                  onUpdate('imageMobile', `/hero/${name}.webp`);
                }}
                className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                  slide.imageDesktop === `/hero/${name}.webp`
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-subtle)]'
                    : 'border-[var(--color-border)] hover:border-[var(--color-accent)]'
                }`}
              >
                {name}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              { key: 'kicker' as const, label: 'Etiqueta', placeholder: 'Ej: Nuevo' },
              { key: 'title' as const, label: 'Título', placeholder: 'Ej: Hasta $200.000 + 200 giros' },
              { key: 'body' as const, label: 'Descripción', placeholder: 'Ej: Depositá y empezá a girar', span: 2 },
              { key: 'cta' as const, label: 'Botón', placeholder: 'Ej: Jugar ahora' },
              { key: 'href' as const, label: 'A dónde lleva', placeholder: 'Ej: /play/lobby' },
            ].map(({ key, label, placeholder, span }) => (
              <div key={key} className={span === 2 ? 'col-span-2' : ''}>
                <label className="text-[11px] font-medium text-[var(--color-fg-muted)]">{label}</label>
                <input
                  value={slide[key]}
                  onChange={(e) => onUpdate(key, e.target.value)}
                  placeholder={placeholder}
                  className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm"
                />
              </div>
            ))}
            <div>
              <label className="text-[11px] font-medium text-[var(--color-fg-muted)]">Color del banner</label>
              <input
                type="color"
                value={slide.accentColor}
                onChange={(e) => onUpdate('accentColor', e.target.value)}
                className="mt-1 h-8 w-full rounded border border-[var(--color-border)]"
              />
            </div>
            {/* Lado del texto — se elige según de qué lado tenga aire la foto.
                El degradé que oscurece el fondo acompaña al texto. */}
            <div>
              <label className="text-[11px] font-medium text-[var(--color-fg-muted)]">
                Lado del texto
              </label>
              <div className="mt-1 flex gap-px rounded border border-[var(--color-border)] overflow-hidden">
                {(
                  [
                    { value: 'left', label: 'Izquierda' },
                    { value: 'right', label: 'Derecha' },
                  ] as const
                ).map((opt) => {
                  const current = slide.align === 'right' ? 'right' : 'left';
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => onUpdate('align', opt.value)}
                      aria-pressed={current === opt.value}
                      className={`flex-1 h-8 text-[11px] font-medium transition-colors ${
                        current === opt.value
                          ? 'bg-[var(--color-accent-subtle)] text-[var(--color-fg)]'
                          : 'bg-[var(--color-bg)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
        <button type="button" onClick={onRemove} className="p-1 text-[var(--color-fg-subtle)] hover:text-[var(--color-danger)]">
          <Trash2 className="size-4" />
        </button>
      </div>
    </div>
  );
}
