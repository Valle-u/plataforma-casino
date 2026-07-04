/**
 * StockAlertBanner — banner de salud del bankroll.
 *
 * Consume `GET /tenant/house/stock-alert-status` y renderiza uno de:
 *   - `ok`       → verde discreto ("Stock saludable")
 *   - `low`      → amarillo ("Stock bajo, considerá reponer con inject-capital")
 *   - `critical` → rojo ("Stock crítico, reponé YA")
 *
 * CTA "Inyectar capital" abre `InjectCapitalModal`. Se muestra sólo si el
 * caller lo permite (`showInjectCta`) y el nivel no es `ok` — en `ok` el
 * banner es informativo y no interpela.
 *
 * Props:
 *   - `operatorUserId` — para socios indep (mira su propia wallet, no la Casa).
 *   - `showInjectCta`  — default true. `false` para las variantes donde el
 *      admin no puede inyectar (ej. widget del socio dependiente).
 *   - `compact`        — default false. Modo compacto para el dashboard.
 */

'use client';

import { AlertTriangle, CheckCircle2, Plus, ShieldAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { InjectCapitalModal } from '@/components/admin/inject-capital-modal';
import {
  useHouseStockAlert,
  type StockAlertLevel,
} from '@/lib/hooks/use-house';
import { cn } from '@/lib/cn';

function fmt(x: string | null | undefined): string {
  if (x === null || x === undefined) return '—';
  const n = Number(x);
  if (!Number.isFinite(n)) return String(x);
  return n.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

interface Preset {
  label: string;
  hint: (thresholdLow: string, thresholdCritical: string) => string;
  Icon: typeof CheckCircle2;
  /** Clase para el borde-l-2 (color del acento). */
  accentClass: string;
  /** Color del label. */
  labelClass: string;
  /** Color del ícono. */
  iconClass: string;
}

const PRESETS: Record<StockAlertLevel, Preset> = {
  ok: {
    label: 'Stock saludable',
    hint: (low) =>
      `Balance por encima del umbral seguro (${fmt(low)} fichas). Todo OK.`,
    Icon: CheckCircle2,
    accentClass: 'border-l-[var(--color-success)]',
    labelClass: 'text-[var(--color-success)]',
    iconClass: 'text-[var(--color-success)]',
  },
  low: {
    label: 'Stock bajo',
    hint: (low) =>
      `Balance por debajo del umbral seguro (${fmt(low)}). Considerá reponer con un aporte de capital antes de quedar corto.`,
    Icon: AlertTriangle,
    accentClass: 'border-l-[var(--color-warning)]',
    labelClass: 'text-[var(--color-warning)]',
    iconClass: 'text-[var(--color-warning)]',
  },
  critical: {
    label: 'Stock crítico',
    hint: (_low, crit) =>
      `Balance por debajo del umbral crítico (${fmt(crit)}). Reponé YA — un retiro más grande o una racha ganadora puede dejar la caja en 0 y bloquear pagos.`,
    Icon: ShieldAlert,
    accentClass: 'border-l-[var(--color-danger)]',
    labelClass: 'text-[var(--color-danger)]',
    iconClass: 'text-[var(--color-danger)]',
  },
};

export interface StockAlertBannerProps {
  /** Si viene, apunta al bankroll del socio indep. Default: la Casa. */
  operatorUserId?: string | null;
  /** Ocultar CTA "Inyectar capital" (ej: cuando el actor no tiene permiso). */
  showInjectCta?: boolean;
  /** Layout compacto para dashboard. Default: false. */
  compact?: boolean;
  /** Content adicional que sale a la derecha (ej: label de "Casa" vs "Sub-red"). */
  trailing?: ReactNode;
}

export function StockAlertBanner({
  operatorUserId,
  showInjectCta = true,
  compact = false,
  trailing,
}: StockAlertBannerProps) {
  const query = useHouseStockAlert(operatorUserId);
  const [injectOpen, setInjectOpen] = useState(false);

  if (query.isLoading) {
    return <Skeleton className={cn(compact ? 'h-14' : 'h-20', 'w-full')} />;
  }
  if (query.isError || !query.data) {
    // Silencioso: si el endpoint devuelve 404 (Casa no provisionada) o falla,
    // el resto de la página igual sirve. No queremos un banner rojo mentiroso.
    return null;
  }

  const { level, balance, thresholdLow, thresholdCritical } = query.data;
  const preset = PRESETS[level];
  const Icon = preset.Icon;

  return (
    <>
      <div
        className={cn(
          'bg-[var(--color-bg-elevated)] border border-[var(--color-border)]',
          'border-l-2',
          preset.accentClass,
          'flex items-start gap-3',
          compact ? 'px-3 py-2.5' : 'px-4 py-3',
        )}
        role={level === 'critical' ? 'alert' : 'status'}
        aria-live={level === 'critical' ? 'assertive' : 'polite'}
      >
        <Icon
          className={cn(
            'size-4 mt-0.5 shrink-0',
            preset.iconClass,
          )}
          aria-hidden
        />
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={cn(
                'text-[11px] uppercase tracking-[0.14em] font-medium',
                preset.labelClass,
              )}
            >
              {preset.label}
            </span>
            <span className="text-[11px] text-[var(--color-fg-subtle)] font-mono">
              · {fmt(balance)} fichas
            </span>
            {trailing}
          </div>
          {!compact && (
            <span className="text-[12px] text-[var(--color-fg-muted)] leading-snug">
              {preset.hint(thresholdLow, thresholdCritical)}
            </span>
          )}
        </div>
        {showInjectCta && level !== 'ok' && (
          <Button
            variant={level === 'critical' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setInjectOpen(true)}
            title="Aportar capital respaldado por una transferencia bancaria entrante"
          >
            <Plus className="size-3" />
            Inyectar capital
          </Button>
        )}
      </div>
      {/* El modal sólo aplica a la Casa (el endpoint es admin-only). Para
       * variantes de socio indep pasar showInjectCta=false. */}
      {showInjectCta && (
        <InjectCapitalModal open={injectOpen} onOpenChange={setInjectOpen} />
      )}
    </>
  );
}
