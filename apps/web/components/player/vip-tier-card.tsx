/**
 * VipTierCard — Sprint 51.30.
 *
 * Card en el home que muestra el tier VIP actual del player + progress
 * al siguiente + perks. Refuerza retención mostrando "lo que ganás si
 * apostás más".
 *
 * DATA: client-side desde useVipTier (lee useMyWalletStats(30) y
 * calcula tier por umbrales). Cuando exista un endpoint real, se
 * conecta acá sin cambiar UI.
 *
 * Diseño:
 *   - Card-premium con background tinted por el color del tier.
 *   - Header: icon tier en círculo + label tier + volumen apostado 30d.
 *   - Progress bar al siguiente tier con "+X chips para subir".
 *   - Lista de perks del tier actual.
 *   - Si está en Platinum (tier max), no muestra progress — muestra
 *     "Estás en el tier más alto".
 */

'use client';

import { Check } from 'lucide-react';
import { useVipTier } from '@/lib/hooks/use-vip-tier';
import { cn } from '@/lib/cn';

export function VipTierCard() {
  const { tier, volume, next, progressToNext, chipsToNext, loading } =
    useVipTier();

  if (loading) return null;

  const Icon = tier.icon;

  return (
    <section
      className="animate-fade-up"
      style={{ animationDelay: '180ms', animationFillMode: 'both' }}
    >
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[10px] sm:text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-medium flex items-center gap-1.5">
          <Icon className="size-3" style={{ color: tier.color }} />
          Tu nivel
        </h2>
        <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] font-mono">
          Últimos 30d
        </span>
      </div>

      <div className="relative overflow-hidden card-premium rounded-[var(--radius-lg)]">
        {/* Glow tinted por el tier */}
        <div
          aria-hidden
          className="absolute -inset-x-12 -top-12 h-48 opacity-30 blur-3xl pointer-events-none"
          style={{
            background: `radial-gradient(ellipse at center, ${tier.color}60 0%, transparent 65%)`,
          }}
        />

        <div className="relative p-5 sm:p-6 flex flex-col gap-5">
          {/* Header: tier badge + volumen */}
          <div className="flex items-center gap-4">
            <div
              className="size-14 sm:size-16 rounded-full flex items-center justify-center shrink-0"
              style={{
                background: tier.gradient,
                boxShadow: `inset 0 1px 0 0 rgba(255,255,255,0.3), 0 0 24px ${tier.color}40`,
              }}
            >
              <Icon
                className="size-7 sm:size-8 drop-shadow-[0_2px_4px_rgba(0,0,0,0.4)]"
                style={{ color: 'rgba(0,0,0,0.7)' }}
              />
            </div>
            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
              <span
                className="text-[11px] uppercase tracking-[0.14em] font-medium"
                style={{ color: tier.color }}
              >
                Nivel {tier.label}
              </span>
              <div className="flex items-baseline gap-2">
                <span className="font-display text-2xl sm:text-3xl tracking-tight text-[var(--color-fg)] tabular-nums">
                  {formatChipsShort(volume)}
                </span>
                <span className="text-[10px] uppercase tracking-[0.1em] font-mono text-[var(--color-fg-subtle)]">
                  apostadas
                </span>
              </div>
            </div>
          </div>

          {/* Progress al siguiente tier */}
          {next ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[var(--color-fg-muted)]">
                  Próximo: <span className="font-medium" style={{ color: next.color }}>{next.label}</span>
                </span>
                <span className="font-mono tabular-nums text-[var(--color-fg)]">
                  {formatChipsShort(chipsToNext)}{' '}
                  <span className="text-[var(--color-fg-subtle)]">
                    para subir
                  </span>
                </span>
              </div>
              <div className="relative h-2 bg-[var(--color-bg-subtle)] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(100, Math.max(2, progressToNext * 100))}%`,
                    background: tier.gradient,
                    boxShadow: `0 0 8px ${tier.color}80`,
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[12px] text-[var(--color-fg-muted)]">
              <Check className="size-3.5" style={{ color: tier.color }} />
              Estás en el tier más alto. ¡Bien jugado!
            </div>
          )}

          {/* Perks list */}
          <div className="flex flex-col gap-1.5 pt-3 border-t border-[var(--color-border)]">
            <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-medium mb-1">
              Beneficios actuales
            </span>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
              {tier.perks.map((perk) => (
                <li
                  key={perk}
                  className="flex items-start gap-2 text-[12px] text-[var(--color-fg-muted)]"
                >
                  <Check
                    className="size-3 shrink-0 mt-0.5"
                    style={{ color: tier.color }}
                  />
                  <span>{perk}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Ring component que envuelve el avatar — sprint 51.30 helper exportable.
 * Usado por AvatarDropdown del header para mostrar el tier sutil alrededor
 * del avatar circular.
 */
export function VipRing({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { tier, loading } = useVipTier();
  if (loading) return <>{children}</>;
  // Bronze no muestra ring (es el default, sería ruido visual).
  if (tier.id === 'bronze') return <>{children}</>;

  return (
    <span
      className={cn('relative inline-flex p-0.5 rounded-full', className)}
      style={{
        background: tier.gradient,
        boxShadow: `0 0 8px ${tier.color}80`,
      }}
      title={`Nivel ${tier.label}`}
    >
      {children}
    </span>
  );
}

function formatChipsShort(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) {
    return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return (n / 1_000_000).toFixed(2).replace(/\.0+$/, '') + 'M';
}
