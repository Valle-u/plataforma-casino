/**
 * Sparkline — SVG mini-chart sin deps (Sprint 51.31).
 *
 * Pinta una línea/area curve a partir de una serie de números, normalizada
 * al rect del SVG. Diseñada para mostrar tendencias compactas (balance
 * del player últimos N días, volumen apostado, etc.) — no para análisis
 * detallado.
 *
 * Features:
 *   - Line + optional filled area gradient debajo.
 *   - Color: 1 sólido o auto (verde si último > primero, rojo si menor).
 *   - End-dot opcional para resaltar el valor más reciente.
 *   - Fully responsive (viewBox + preserveAspectRatio).
 *   - Edge-case safe: 0 points → no render. 1 point → línea horizontal.
 *
 * No usa ningún chart lib. SVG path construido a mano con cubic bezier
 * smoothing simple (Catmull-Rom approximation) para que se vea suave
 * y no scratchy. Cero deps, ~3KB en gz.
 */

'use client';

import { useId } from 'react';
import { cn } from '@/lib/cn';

interface SparklineProps {
  /** Serie de puntos a graficar, en orden cronológico (más viejo → más nuevo). */
  data: number[];
  /** Color de línea. Si "auto" (default), verde subida / rojo bajada. */
  color?: string;
  /** Render del area fill debajo de la línea (gradient color → transparente). */
  area?: boolean;
  /** Mostrar dot en el último punto. */
  endDot?: boolean;
  /** Stroke width del path. */
  strokeWidth?: number;
  /** Width/height del SVG (responsive con CSS). Default 100/30. */
  width?: number;
  height?: number;
  className?: string;
  ariaLabel?: string;
}

const PADDING = 2; // px para que el dot/stroke no se corte en los bordes

export function Sparkline({
  data,
  color = 'auto',
  area = true,
  endDot = true,
  strokeWidth = 1.5,
  width = 100,
  height = 30,
  className,
  ariaLabel,
}: SparklineProps) {
  if (data.length === 0) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const h = height - PADDING * 2;
  const w = width - PADDING * 2;

  const points = data.map((v, i) => {
    const x = PADDING + (data.length === 1 ? w / 2 : (i / (data.length - 1)) * w);
    const y = PADDING + h - ((v - min) / range) * h;
    return { x, y };
  });

  // Suavizado: para cada par de puntos, control points a medio camino.
  // Cubic bezier C cx1,cy1 cx2,cy2 x,y → curve "natural".
  const pathLine = points.reduce((acc, p, i) => {
    if (i === 0) return `M ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
    const prev = points[i - 1]!;
    const cx1 = prev.x + (p.x - prev.x) / 2;
    const cy1 = prev.y;
    const cx2 = prev.x + (p.x - prev.x) / 2;
    const cy2 = p.y;
    return `${acc} C ${cx1.toFixed(2)} ${cy1.toFixed(2)}, ${cx2.toFixed(2)} ${cy2.toFixed(2)}, ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  }, '');

  // Path para el area = line + ir al bottom-right + bottom-left → cerrar.
  const last = points[points.length - 1]!;
  const first = points[0]!;
  const pathArea =
    pathLine +
    ` L ${last.x.toFixed(2)} ${(height - PADDING).toFixed(2)} L ${first.x.toFixed(2)} ${(height - PADDING).toFixed(2)} Z`;

  // Resolución de color
  let resolvedColor = color;
  if (color === 'auto') {
    const f = data[0]!;
    const l = data[data.length - 1]!;
    resolvedColor = l >= f ? '#22c55e' : '#f87171';
  }

  const gradientId = useId();

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn('block', className)}
      role="img"
      aria-label={ariaLabel ?? 'Mini gráfico de tendencia'}
    >
      {area && (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={resolvedColor} stopOpacity="0.35" />
              <stop
                offset="100%"
                stopColor={resolvedColor}
                stopOpacity="0"
              />
            </linearGradient>
          </defs>
          <path d={pathArea} fill={`url(#${gradientId})`} />
        </>
      )}
      <path
        d={pathLine}
        fill="none"
        stroke={resolvedColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {endDot && (
        <>
          {/* Glow detrás del dot */}
          <circle
            cx={last.x}
            cy={last.y}
            r={strokeWidth * 2.2}
            fill={resolvedColor}
            opacity={0.25}
          />
          <circle
            cx={last.x}
            cy={last.y}
            r={strokeWidth * 1.1}
            fill={resolvedColor}
          />
        </>
      )}
    </svg>
  );
}
