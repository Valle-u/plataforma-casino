/**
 * PlatformBackground — Sprint 51.16 (+ 51.19: imagen real de fondo).
 *
 * Fondo decorativo full-screen para `/play/*`. Antes el bg era plano
 * (#0a0a0a) y se sentía clínico/sobrio. Acá hay 4 capas (de atrás
 * hacia adelante):
 *
 *   1. Imagen de fondo (generada con Gemini, ultra-comprimida WebP/AVIF
 *      ~10KB c/u). Variante desktop (16:9) y mobile (9:16) servidas vía
 *      `<picture>` con `media` queries — art direction nativa.
 *   2. 3 orbs (rojo / dorado / rojo oscuro) blurred + low opacity que
 *      "drift" lento por la pantalla con CSS animations (transform).
 *      Solo transforms → GPU composite layer, casi sin costo.
 *   3. Vignette radial oscuro en los bordes para focar la atención en el
 *      centro y dar profundidad.
 *   4. Grain texture sutil (.bg-grain del DS).
 *
 * Reglas:
 *   - `position: fixed`, `inset: 0`, `z-index: -10` — siempre por DEBAJO
 *     del contenido. Nunca interfiere con clicks (pointer-events: none).
 *   - Respeta `prefers-reduced-motion`: los orbs quedan quietos (media
 *     query en globals.css). La imagen siempre estática.
 *   - NO se monta en /admin — el admin terminal pierde el look serio.
 *
 * Implementación: 100% CSS + 1 imagen estática. Sin canvas, sin librerías.
 */

'use client';

export function PlatformBackground() {
  return (
    <div
      aria-hidden
      className="fixed inset-0 -z-10 pointer-events-none overflow-hidden"
    >
      {/* Capa 0: imagen de fondo. <picture> con art direction:
       *   - md+ → desktop.avif/webp (landscape).
       *   - mobile → mobile.avif/webp (portrait, optimizado para vertical).
       *
       * Sprint 51.19.1 fix — antes opacity 60% + sin blend mode, la
       * imagen quedaba prácticamente invisible. Ahora:
       *   - opacity 100% (la imagen ya es ~95% negro por diseño, no hay
       *     riesgo de saturar).
       *   - mix-blend-mode: screen — los píxeles negros desaparecen
       *     visualmente, sólo se suman los brillos (nebulosa roja, bokeh
       *     dorado, partículas, líneas Art Deco). Resultado: la "personality"
       *     de la imagen se ve sin tapar el bg ni los orbs. */}
      <picture>
        <source
          media="(min-width: 768px)"
          srcSet="/bg/desktop.avif"
          type="image/avif"
        />
        <source
          media="(min-width: 768px)"
          srcSet="/bg/desktop.webp"
          type="image/webp"
        />
        <source srcSet="/bg/mobile.avif" type="image/avif" />
        <source srcSet="/bg/mobile.webp" type="image/webp" />
        { }
        <img
          src="/bg/mobile.webp"
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          style={{ mixBlendMode: 'screen' }}
          loading="eager"
          decoding="async"
        />
      </picture>

      {/* Orb 1 — rojo accent, drift top-left → bottom-right lento (28s) */}
      <div
        className="absolute size-[40rem] sm:size-[55rem] rounded-full opacity-25 blur-3xl animate-orb-drift-1"
        style={{
          background:
            'radial-gradient(circle at center, var(--color-accent) 0%, transparent 60%)',
          top: '-15%',
          left: '-15%',
        }}
      />
      {/* Orb 2 — dorado, drift bottom-right → top-left, más lento (36s) */}
      <div
        className="absolute size-[35rem] sm:size-[50rem] rounded-full opacity-15 blur-3xl animate-orb-drift-2"
        style={{
          background:
            'radial-gradient(circle at center, #FFD700 0%, transparent 60%)',
          bottom: '-20%',
          right: '-10%',
        }}
      />
      {/* Orb 3 — rojo apagado, drift horizontal (24s) */}
      <div
        className="absolute size-[30rem] sm:size-[40rem] rounded-full opacity-20 blur-3xl animate-orb-drift-3"
        style={{
          background:
            'radial-gradient(circle at center, #7f1d1d 0%, transparent 60%)',
          top: '40%',
          left: '50%',
        }}
      />

      {/* Vignette — oscurece bordes, foca atención al centro.
       * Sprint 51.19.1: bajado de 0.5 → 0.3 para no matar las esquinas
       * Art Deco de la imagen de fondo. Sigue dando profundidad pero
       * no las tapa. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 40%, rgba(10,10,10,0.3) 100%)',
        }}
      />

      {/* Grain texture (reusa .bg-grain del DS, low opacity inherente al SVG) */}
      <div className="absolute inset-0 bg-grain opacity-70" />
    </div>
  );
}
