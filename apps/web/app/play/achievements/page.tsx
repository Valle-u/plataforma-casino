/**
 * /play/achievements — Sprint 51.32.
 *
 * Página dedicada para los logros del player. Catálogo agrupado por
 * categoría, locked en gris + unlocked colorido con glow. Counter total
 * arriba. Al montar la página, todos los unlocked actuales se marcan
 * como "seen" (pierden el badge "nuevo").
 */

'use client';

import { Check, Lock, Sparkles, Trophy } from 'lucide-react';
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
  milestone: 'Hitos',
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

  // Al montar, marcar todos los unlocked como vistos (reset del badge "new").
  useEffect(() => {
    if (newCount > 0) {
      // Pequeño delay para que el user los vea brillar antes de "consumirse".
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
    <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col gap-6 sm:gap-8">
      {/* Header con progreso global */}
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] sm:text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
            <Trophy className="size-3" />
            Recompensas
          </span>
          {newCount > 0 && (
            <span className="inline-flex items-center gap-1 px-1.5 h-4 bg-[#FFD700] text-black text-[9px] font-mono font-bold tabular-nums tracking-tight rounded-sm animate-pulse">
              {newCount} nuevos
            </span>
          )}
        </div>
        <h1 className="font-display text-2xl sm:text-[2.5rem] leading-tight sm:leading-none tracking-tight">
          Logros
        </h1>
        <p className="text-sm text-[var(--color-fg-muted)]">
          Desbloqueá insignias jugando, ganando y subiendo de nivel.
        </p>
      </header>

      {/* Progress bar global */}
      <section className="card-premium rounded-[var(--radius-lg)] p-5 flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[12px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-medium">
            Progreso total
          </span>
          <span className="font-mono tabular-nums text-[var(--color-fg)]">
            <span className="text-[20px] font-display tracking-tight">
              {unlockedCount}
            </span>
            <span className="text-[14px] text-[var(--color-fg-subtle)]">
              {' '}
              / {totalCount}
            </span>
          </span>
        </div>
        <div className="h-2 bg-[var(--color-bg-subtle)] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${Math.max(2, progress * 100)}%`,
              background:
                'linear-gradient(to right, var(--color-accent), #FFD700)',
              boxShadow: '0 0 12px var(--color-accent-glow)',
            }}
          />
        </div>
      </section>

      {/* Grupos por categoría */}
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
        <h2 className="text-[10px] sm:text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-medium">
          {CATEGORY_LABEL[category]}
        </h2>
        <span className="text-[10px] font-mono text-[var(--color-fg-subtle)]">
          · {unlocked} / {items.length}
        </span>
      </div>
      <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {items.map((a, i) => (
          <AchievementCard
            key={a.id}
            achievement={a}
            delay={Math.min(i * 40, 400)}
          />
        ))}
      </ul>
    </section>
  );
}

function AchievementCard({
  achievement,
  delay,
}: {
  achievement: AchievementStatus;
  delay: number;
}) {
  const { unlocked, isNew, icon: Icon, color, label, description } = achievement;
  return (
    <li
      className={cn(
        'relative overflow-hidden',
        'card-premium rounded-[var(--radius-lg)]',
        'p-4 flex flex-col items-center text-center gap-2',
        'transition-all duration-300',
        'animate-fade-up-staggered',
        unlocked && 'hover:-translate-y-1',
        !unlocked && 'opacity-55 grayscale-[60%]',
        isNew && 'shadow-[var(--shadow-edge),0_0_0_1px_#FFD700,0_0_24px_-4px_rgba(255,215,0,0.55)]',
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Glow detrás cuando unlocked + new */}
      {isNew && (
        <div
          aria-hidden
          className="absolute -inset-x-12 -top-12 h-32 opacity-50 blur-3xl pointer-events-none"
          style={{
            background: `radial-gradient(ellipse at center, ${color}80 0%, transparent 60%)`,
          }}
        />
      )}

      {/* Badge "NUEVO" arriba derecha */}
      {isNew && (
        <span className="absolute top-2 right-2 inline-flex items-center gap-1 px-1.5 h-4 bg-[#FFD700] text-black text-[8px] font-mono font-bold tracking-tight rounded-sm">
          <Sparkles className="size-2" />
          NUEVO
        </span>
      )}

      {/* Icon */}
      <div
        className={cn(
          'relative size-14 sm:size-16 rounded-full flex items-center justify-center shrink-0',
          'border',
        )}
        style={{
          background: unlocked
            ? `linear-gradient(135deg, ${color}38, ${color}10)`
            : 'var(--color-bg-subtle)',
          borderColor: unlocked ? color : 'var(--color-border)',
          boxShadow: unlocked
            ? `inset 0 1px 0 0 rgba(255,255,255,0.1), 0 0 16px ${color}40`
            : undefined,
        }}
      >
        {unlocked ? (
          <Icon className="size-6 sm:size-7" style={{ color }} />
        ) : (
          <Lock className="size-5 text-[var(--color-fg-disabled)]" />
        )}
        {unlocked && (
          <span
            className="absolute -bottom-1 -right-1 size-5 rounded-full bg-[var(--color-bg-elevated)] border-2 border-[var(--color-bg)] flex items-center justify-center"
            style={{ borderColor: color }}
          >
            <Check className="size-2.5" style={{ color }} />
          </span>
        )}
      </div>

      {/* Label + description */}
      <div className="relative flex flex-col gap-0.5 min-w-0">
        <span
          className={cn(
            'text-[12px] font-medium tracking-tight',
            unlocked ? 'text-[var(--color-fg)]' : 'text-[var(--color-fg-muted)]',
          )}
        >
          {label}
        </span>
        <p className="text-[10px] text-[var(--color-fg-subtle)] leading-tight line-clamp-2">
          {description}
        </p>
      </div>
    </li>
  );
}
