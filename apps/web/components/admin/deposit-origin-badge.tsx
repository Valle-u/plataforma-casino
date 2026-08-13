/**
 * DepositOriginBadge — etiqueta de origen comercial de una solicitud de
 * depósito. Permite ver de un vistazo de dónde viene el jugador:
 *   - "La Casa": red central del admin (jugador directo, o vía un
 *     cajero/distribuidor de la Casa).
 *   - "Socio: <nombre>": cuelga de la red de un socio dependiente.
 *
 * El origen lo calcula el backend a partir de la jerarquía (no se persiste).
 */

'use client';

import { Home, Store } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface DepositOrigin {
  originKind?: 'casa' | 'socio';
  originSocioName?: string | null;
  originSocioUsername?: string | null;
}

export function DepositOriginBadge({
  origin,
  className,
}: {
  origin: DepositOrigin;
  className?: string;
}) {
  const isSocio = origin.originKind === 'socio';
  const socioLabel =
    origin.originSocioName ??
    (origin.originSocioUsername ? `@${origin.originSocioUsername}` : 'Socio');

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 h-6 text-[11px] font-medium border max-w-full',
        isSocio
          ? 'bg-[var(--color-accent-subtle)] border-[var(--color-accent-border)] text-[var(--color-accent-text)]'
          : 'bg-[var(--color-bg-subtle)] border-[var(--color-border)] text-[var(--color-fg-muted)]',
        className,
      )}
      title={isSocio ? `Red del socio: ${socioLabel}` : 'Red central de la Casa'}
    >
      {isSocio ? (
        <Store className="size-3 shrink-0" />
      ) : (
        <Home className="size-3 shrink-0" />
      )}
      <span className="truncate">{isSocio ? socioLabel : 'La Casa'}</span>
    </span>
  );
}
