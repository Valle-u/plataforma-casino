/**
 * WheelIcon — la rueda como ícono de nav (7 gajos estilizados). Sigue la firma
 * de los íconos lucide (`size` + `className` + `style`) para poder cargarlo en
 * el mismo `NavItem` que los demás del sidebar.
 */

'use client';

import type { CSSProperties } from 'react';

interface WheelIconProps {
  size?: number | string;
  className?: string;
  style?: CSSProperties;
}

export function WheelIcon({
  size = 16,
  className,
  style,
}: WheelIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden
    >
      <circle cx="12" cy="12" r="9.2" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M12 2.8v3.6" />
      <path d="M12 17.6v3.6" />
      <path d="M2.8 12h3.6" />
      <path d="M17.6 12h3.6" />
      <path d="M5.2 5.2l2.5 2.5" />
      <path d="M16.3 16.3l2.5 2.5" />
      <path d="M18.8 5.2l-2.5 2.5" />
      <path d="M7.7 16.3l-2.5 2.5" />
    </svg>
  );
}