/**
 * PanelMark — marca del PRODUCTO panel ("Retícula").
 *
 * Matriz 3×3 de puntos con el central encendido: nueve controles, uno activo.
 * Es la marca del panel de control, NO del cliente: **siempre monocromática**,
 * nunca toma el acento del tenant (ni en el login ni dentro del panel). Por eso
 * los colores son hex fijos y no tokens del design system.
 *
 * DOM puro (sin SVG ni imagen) → no depende de `branding.logoUrl`, así que no
 * hay salto de layout ni flash de logo.
 *
 * Tamaños y proporciones salen del handoff del rediseño del login v2.
 */

import type { CSSProperties } from 'react';

const OUTER = '#3d3d3d';
const CENTER = '#fafafa';

/** radio del contenedor · padding · gap, por tamaño (px). Tabla del handoff. */
const PRESETS: Record<number, { radius: number; padding: number; gap: number }> = {
  52: { radius: 14, padding: 12, gap: 5 },
  46: { radius: 13, padding: 11, gap: 4.5 },
  34: { radius: 10, padding: 8, gap: 3.5 },
  30: { radius: 9, padding: 7, gap: 3 },
  26: { radius: 8, padding: 6, gap: 2.5 },
  24: { radius: 7, padding: 5.5, gap: 2.5 },
  20: { radius: 6, padding: 4.5, gap: 2 },
};

function dims(size: number): { radius: number; padding: number; gap: number } {
  return (
    PRESETS[size] ?? {
      radius: size * 0.27,
      padding: size * 0.23,
      gap: size * 0.096,
    }
  );
}

export function PanelMark({
  size = 52,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const { radius, padding, gap } = dims(size);
  const container: CSSProperties = {
    width: size,
    height: size,
    boxSizing: 'border-box',
    background: '#141414',
    border: '1px solid #2b2b2b',
    borderRadius: radius,
    padding,
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gridTemplateRows: 'repeat(3, 1fr)',
    gap,
    flexShrink: 0,
  };
  return (
    <div aria-hidden className={className} style={container}>
      {Array.from({ length: 9 }).map((_, i) => (
        <span
          key={i}
          style={{ borderRadius: '50%', background: i === 4 ? CENTER : OUTER }}
        />
      ))}
    </div>
  );
}
