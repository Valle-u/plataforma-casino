/**
 * PlatformBackground — Sprint 51.16.
 *
 * Fondo decorativo full-screen para `/play/*`. Antes el bg era plano
 * (#0a0a0a) y se sentía clínico/sobrio. Acá agregamos:
 *
 *   - 3 orbs (rojo / dorado / rojo oscuro) blurred + low opacity que
 *     "drift" lento por la pantalla con CSS animations (transform). Como
 *     son solo transforms, no causan repaint del layout — pasan al
 *     composite layer y son baratos en GPU.
 *   - Grain texture sutil (reuso `.bg-grain` del DS).
 *   - Vignette radial oscuro en los bordes para focar la atención en el
 *     contenido central.
 *
 * Reglas:
 *   - `position: fixed`, `inset: 0`, `z-index: -10` — siempre por DEBAJO
 *     del contenido. Nunca interfiere con clicks (pointer-events: none).
 *   - Respeta `prefers-reduced-motion`: en ese caso, los orbs quedan
 *     quietos (animation: none vía media query en globals.css). El glow
 *     persiste pero estático.
 *   - NO se monta en /admin — el admin terminal pierde el look serio.
 *
 * Implementación: 100% CSS. Sin canvas, sin librerías. Si en el futuro
 * queremos partículas más copadas, swap a un canvas component.
 */

'use client';

export function PlatformBackground() {
  return (
    <div
      aria-hidden
      className="fixed inset-0 -z-10 pointer-events-none overflow-hidden"
    >
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

      {/* Vignette — oscurece bordes, foca atención al centro */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 30%, rgba(10,10,10,0.5) 100%)',
        }}
      />

      {/* Grain texture (reusa .bg-grain del DS, low opacity inherente al SVG) */}
      <div className="absolute inset-0 bg-grain opacity-70" />
    </div>
  );
}
