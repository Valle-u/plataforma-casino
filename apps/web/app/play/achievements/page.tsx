/**
 * /play/achievements — Logros.
 *
 * Pantalla "Logros" del handoff. El chrome lo provee play/layout.tsx.
 *
 * Composición:
 *   - Header + barra "Progreso total" (X / Y).
 *   - Secciones por categoría (Diarios / Semanales / De nivel / VIP) con
 *     conteo, cada una con grid de cards.
 *   - Cards en 2 estados (los reales del backend):
 *     - Desbloqueado: card cálida (oro/naranja) + icono del logro + badge.
 *     - Bloqueado: card atenuada + diamante + badge.
 *
 * Función PRESERVADA:
 *   - useAchievements() (GET /tenant/achievements/me): list + counts.
 *   - markAllSeen al montar (consume el badge "nuevo").
 *
 * Nota: el backend no expone progreso parcial (solo unlocked/locked), así
 * que el estado "en progreso" del prototipo no se representa — se mapea a
 * Bloqueado hasta que el logro se desbloquea.
 */

'use client';

import { Check, Diamond, Lock, Trophy } from 'lucide-react';
import { useEffect } from 'react';
import {
  useAchievements,
  type AchievementCategory,
  type AchievementStatus,
} from '@/lib/hooks/use-achievements';
import { cn } from '@/lib/cn';

const CATEGORY_LABEL: Record<AchievementCategory, string> = {
  daily: 'Diarios',
  weekly: 'Semanales',
  milestone: 'De nivel',
  vip: 'VIP',
};

const CATEGORY_ORDER: AchievementCategory[] = [
  'daily',
  'weekly',
  'milestone',
  'vip',
];

export default function AchievementsPage() {
  const { list, unlockedCount, totalCount, newCount, markAllSeen } =
    useAchievements();

  useEffect(() => {
    if (newCount > 0) {
      const t = window.setTimeout(() => markAllSeen(), 1200);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [newCount, markAllSeen]);

  const progress = totalCount > 0 ? unlockedCount / totalCount : 0;
  const grouped = CATEGORY_ORDER.reduce<
    Array<[AchievementCategory, AchievementStatus[]]>
  >((acc, cat) => {
    const items = list.filter((a) => a.category === cat);
    if (items.length > 0) acc.push([cat, items]);
    return acc;
  }, []);

  return (
    <div className="flex flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      {/* Header */}
      <header className="flex flex-col gap-1">
        <span className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent-text)]">
          <Trophy className="size-3" />
          Recompensas · Logros
        </span>
        <h1 className="font-display text-[34px] leading-none">Logros</h1>
      </header>

      {/* Progreso total */}
      <section className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--color-fg-muted)]">
            Progreso total
          </span>
          <span className="tabular-nums">
            <span className="font-display text-[22px] text-[var(--color-fg)]">
              {unlockedCount}
            </span>
            <span className="text-[14px] text-[var(--color-fg-subtle)]">
              {' '}/ {totalCount}
            </span>
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[var(--color-bg-subtle)]">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${Math.max(2, progress * 100)}%`,
              background: 'var(--gradient-accent)',
              boxShadow: '0 0 12px var(--color-accent-glow)',
            }}
          />
        </div>
      </section>

      {/* Categorías */}
      <div className="flex flex-col gap-8">
        {grouped.map(([cat, items]) => (
          <CategorySection key={cat} category={cat} items={items} />
        ))}
      </div>
    </div>
  );
}

function CategorySection({
  category,
  items,
}: {
  category: AchievementCategory;
  items: AchievementStatus[];
}) {
  const unlocked = items.filter((i) => i.unlocked).length;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--color-fg-subtle)]">
          {CATEGORY_LABEL[category]}
        </h2>
        <span className="text-[11px] tabular-nums text-[var(--color-fg-subtle)]">
          · {unlocked} / {items.length}
        </span>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((a) => (
          <AchievementCard key={a.id} achievement={a} />
        ))}
      </ul>
    </section>
  );
}

function AchievementCard({ achievement }: { achievement: AchievementStatus }) {
  const { unlocked, isNew, icon: Icon, label, description, rewardChips } =
    achievement;

  return (
    <li
      className={cn(
        'relative flex flex-col items-center gap-3 overflow-hidden rounded-[var(--radius-lg)] border p-4 text-center transition-transform',
        unlocked
          ? 'border-[color:color-mix(in_srgb,var(--color-warning)_40%,transparent)] hover:-translate-y-1'
          : 'border-[var(--color-border)] opacity-65',
        isNew &&
          'shadow-[0_0_24px_-4px_color-mix(in_srgb,var(--color-warning)_70%,transparent)]',
      )}
      style={
        unlocked
          ? {
              backgroundImage:
                'radial-gradient(120% 100% at 50% 0%, color-mix(in srgb, var(--color-warning) 16%, transparent) 0%, transparent 60%), var(--color-bg-elevated)',
            }
          : { background: 'var(--color-bg-elevated)' }
      }
    >
      {/* Icono */}
      <span
        className="relative grid size-14 place-items-center rounded-full"
        style={
          unlocked
            ? {
                background:
                  'color-mix(in srgb, var(--color-warning) 24%, transparent)',
                color: 'var(--color-warning)',
                boxShadow: '0 0 16px -3px var(--color-warning)',
              }
            : {
                background: 'var(--color-bg-subtle)',
                color: 'var(--color-fg-subtle)',
              }
        }
      >
        {unlocked ? <Icon className="size-6" /> : <Diamond className="size-5" />}
        {unlocked && (
          <span
            className="absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-full border-2 border-[var(--color-bg-elevated)]"
            style={{ background: 'var(--color-warning)', color: '#1a1206' }}
          >
            <Check className="size-2.5" />
          </span>
        )}
      </span>

      {/* Texto */}
      <div className="flex min-w-0 flex-col gap-0.5">
        <span
          className={cn(
            'text-[13px] font-medium',
            unlocked ? 'text-[var(--color-fg)]' : 'text-[var(--color-fg-muted)]',
          )}
        >
          {label}
        </span>
        <p className="line-clamp-2 text-[11px] leading-tight text-[var(--color-fg-subtle)]">
          {description}
        </p>
      </div>

      {/* Badge de estado */}
      <span
        className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em]"
        style={
          unlocked
            ? {
                color: 'var(--color-warning)',
                background:
                  'color-mix(in srgb, var(--color-warning) 16%, transparent)',
              }
            : {
                color: 'var(--color-fg-subtle)',
                background: 'var(--color-bg-subtle)',
              }
        }
      >
        {unlocked ? (
          <>
            <Check className="size-2.5" aria-hidden />
            Desbloqueado
          </>
        ) : (
          <>
            <Lock className="size-2.5" aria-hidden />
            Bloqueado
          </>
        )}
      </span>

      {/* Recompensa (si desbloqueado y tiene reward) */}
      {unlocked && Number(rewardChips) > 0 && (
        <span className="text-[10px] font-medium text-[var(--color-warning)]">
          +{Number(rewardChips).toLocaleString('es-AR')} fichas
        </span>
      )}
    </li>
  );
}
