/**
 * useAchievements — Sprint 51.32.
 *
 * Sistema de logros (achievements / badges) calculado client-side desde
 * lo que ya sabemos del player (wallet, stats, streak, ligas, bonos, VIP).
 *
 * Filosofía:
 *   - Sin backend nuevo. Los predicates leen de hooks existentes.
 *   - Estado persistido en localStorage: cuáles ya el player vio
 *     "desbloqueados" — para mostrar badge "nuevo" cuando se desbloquea
 *     uno entre sesiones (UI dopamine moment).
 *   - Catálogo definido como const → cuando exista un backend de
 *     achievements (con recompensas reales por desbloqueo), agregamos
 *     un campo `rewardOnUnlock` y disparamos la mutation.
 *
 * Categorías:
 *   - daily: misiones que reset diario (ruleta, racha, etc.)
 *   - weekly: liga, volumen semanal.
 *   - milestone: logros lifetime (primera apuesta, primer depo, etc.)
 *   - vip: tiers vip.
 *
 * Cómo se renderiza:
 *   - Página dedicada /play/achievements con grid de cards.
 *   - Locked: grayscale, icon sutil, "🔒 Bloqueado".
 *   - Unlocked: colorido + glow + check check icon.
 */

'use client';

import {
  Award,
  Coins,
  Crown,
  Dice5,
  Flame,
  Gift,
  Medal,
  RefreshCw,
  Sparkles,
  Star,
  Target,
  Trophy,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth-context';
import { useMyBonuses } from './use-bonuses';
import { useLeagues, useLeagueStandings } from './use-leagues';
import { useMyStreak, useActivePromotions } from './use-player-promotions';
import { useVipTier, type VipTierId } from './use-vip-tier';
import { useMyTransactions, useMyWalletStats } from './use-wallet';

export type AchievementCategory = 'daily' | 'weekly' | 'milestone' | 'vip';

export interface AchievementDef {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  color: string;
  category: AchievementCategory;
}

export interface AchievementStatus extends AchievementDef {
  unlocked: boolean;
  /** True solo al primer render donde detectamos el unlock — disparar UI dopamine. */
  isNew: boolean;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  // Milestones
  {
    id: 'first_bet',
    label: 'Primera tirada',
    description: 'Hiciste tu primera apuesta. ¡Bienvenido al juego!',
    icon: Dice5,
    color: '#f87171',
    category: 'milestone',
  },
  {
    id: 'first_win',
    label: 'Primera victoria',
    description: 'Ganaste tu primer premio. Empezamos bien.',
    icon: Trophy,
    color: '#FFD700',
    category: 'milestone',
  },
  {
    id: 'first_deposit',
    label: 'Primer depósito',
    description: 'Cargaste fichas por primera vez.',
    icon: Coins,
    color: '#22c55e',
    category: 'milestone',
  },
  {
    id: 'first_bonus',
    label: 'Primer bonus',
    description: 'Tenés tu primer bonus en cuenta.',
    icon: Gift,
    color: '#FFD700',
    category: 'milestone',
  },
  // Volume
  {
    id: 'volume_1k',
    label: 'Apostador casual',
    description: 'Apostaste 1.000 chips en total.',
    icon: Target,
    color: '#4F9BFF',
    category: 'milestone',
  },
  {
    id: 'volume_10k',
    label: 'Apostador serio',
    description: 'Apostaste 10.000 chips. El ritmo está ahí.',
    icon: Target,
    color: '#FFD700',
    category: 'milestone',
  },
  {
    id: 'volume_100k',
    label: 'High roller',
    description: 'Cruzaste los 100.000 apostados. Top tier.',
    icon: Star,
    color: '#FFD700',
    category: 'milestone',
  },
  // Daily / weekly
  {
    id: 'wheel_spin_today',
    label: 'Girá la rueda',
    description: 'Giraste la ruleta diaria hoy.',
    icon: Sparkles,
    color: '#FFD700',
    category: 'daily',
  },
  {
    id: 'streak_3',
    label: 'En fuego',
    description: 'Conseguiste 3 días seguidos de racha.',
    icon: Flame,
    color: '#FF6B35',
    category: 'daily',
  },
  {
    id: 'streak_7',
    label: 'Semana completa',
    description: 'Reclamaste 7 días seguidos. Compromiso top.',
    icon: Flame,
    color: '#FF6B35',
    category: 'weekly',
  },
  {
    id: 'league_top_10',
    label: 'Top 10 de la liga',
    description: 'Llegaste al top 10 de la liga activa.',
    icon: Medal,
    color: '#C0C0C0',
    category: 'weekly',
  },
  {
    id: 'league_top_3',
    label: 'Podio',
    description: 'Subiste al podio de la liga.',
    icon: Trophy,
    color: '#FFD700',
    category: 'weekly',
  },
  // VIP
  {
    id: 'vip_silver',
    label: 'VIP Plata',
    description: 'Alcanzaste el nivel Plata.',
    icon: Award,
    color: '#C0C0C0',
    category: 'vip',
  },
  {
    id: 'vip_gold',
    label: 'VIP Oro',
    description: 'Alcanzaste el nivel Oro.',
    icon: Crown,
    color: '#FFD700',
    category: 'vip',
  },
  {
    id: 'vip_platinum',
    label: 'VIP Platino',
    description: 'Llegaste al tier más alto. Leyenda.',
    icon: Zap,
    color: '#E5E4E2',
    category: 'vip',
  },
  // Operational
  {
    id: 'refresh_5x',
    label: 'Atento al detalle',
    description: 'Refrescaste tu wallet más de 5 veces. Buen ojo.',
    icon: RefreshCw,
    color: '#4F9BFF',
    category: 'milestone',
  },
];

const STORAGE_KEY = 'casino:achievements:seen';

function readSeen(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch {
    return new Set();
  }
}

function writeSeen(seen: Set<string>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen]));
  } catch {
    /* ignore */
  }
}

/**
 * Hook principal — devuelve catálogo + estado unlocked + isNew flag.
 *
 * El "isNew" se calcula comparando con el storage de "seen" — al primer
 * render donde se desbloquea uno, queda isNew=true. La página dedicada
 * llama `markAllSeen()` cuando se monta para resetear.
 */
export function useAchievements(): {
  list: AchievementStatus[];
  unlockedCount: number;
  totalCount: number;
  newCount: number;
  markAllSeen: () => void;
} {
  const { user } = useAuth();
  const stats30 = useMyWalletStats(30);
  const txs = useMyTransactions(50, 0);
  const myBonuses = useMyBonuses({ statuses: ['active', 'pending', 'cleared'], limit: 5 });
  const wheelPromos = useActivePromotions('daily_wheel');
  const streakPromos = useActivePromotions('login_streak');
  const wheel = wheelPromos.data?.data[0];
  const streak = streakPromos.data?.data[0];
  const streakInfo = useMyStreak(streak?.id ?? null);
  const activeLeagues = useLeagues({ status: 'active', limit: 1 });
  const league = activeLeagues.data?.data[0];
  const standings = useLeagueStandings(league?.id ?? null, 25);
  const vip = useVipTier();

  const [seen, setSeen] = useState<Set<string>>(() => readSeen());

  // Compute unlock status for each achievement.
  const list = useMemo<AchievementStatus[]>(() => {
    const byType = stats30.data?.byType ?? [];
    const betSum = Math.abs(
      Number(byType.find((b) => b.type === 'bet')?.sum ?? '0'),
    );
    const hasAnyBet = txs.data?.data.some((t) => t.type === 'bet') ?? false;
    const hasAnyWin =
      txs.data?.data.some((t) => t.type === 'win' || t.type === 'jackpot_win') ??
      false;
    const hasAnyDeposit =
      txs.data?.data.some((t) => t.type === 'deposit') ?? false;
    const hasAnyBonus = (myBonuses.data?.total ?? 0) > 0;
    const wheelSpunToday =
      wheel != null &&
      (vip.loading ? false : true) && // placeholder; el real check requiere todaysSpins, lo simplificamos
      (txs.data?.data.some(
        (t) => t.type === 'promo_reward' || t.type === 'bonus_grant',
      ) ?? false);
    const currentStreakDay = streakInfo.data?.progress?.streak ?? 0;

    const myUserId = user?.id;
    const myPosition = myUserId
      ? standings.data?.top.find((r) => r.userId === myUserId)?.position ??
        standings.data?.around?.find((r) => r.userId === myUserId)?.position ??
        null
      : null;

    const vipTierRank = (id: VipTierId): number =>
      id === 'bronze' ? 0 : id === 'silver' ? 1 : id === 'gold' ? 2 : 3;
    const myVipRank = vipTierRank(vip.tier.id);

    const unlockMap: Record<string, boolean> = {
      first_bet: hasAnyBet,
      first_win: hasAnyWin,
      first_deposit: hasAnyDeposit,
      first_bonus: hasAnyBonus,
      volume_1k: betSum >= 1_000,
      volume_10k: betSum >= 10_000,
      volume_100k: betSum >= 100_000,
      wheel_spin_today: wheelSpunToday,
      streak_3: currentStreakDay >= 3,
      streak_7: currentStreakDay >= 7,
      league_top_10: myPosition !== null && myPosition <= 10,
      league_top_3: myPosition !== null && myPosition <= 3,
      vip_silver: myVipRank >= 1,
      vip_gold: myVipRank >= 2,
      vip_platinum: myVipRank >= 3,
      // refresh_5x: no tenemos counter persistente todavía, dejamos en false
      // hasta que sumemos tracking.
      refresh_5x: false,
    };

    return ACHIEVEMENTS.map((def) => {
      const unlocked = unlockMap[def.id] ?? false;
      const isNew = unlocked && !seen.has(def.id);
      return { ...def, unlocked, isNew };
    });
  }, [
    stats30.data,
    txs.data,
    myBonuses.data,
    wheel,
    streakInfo.data,
    standings.data,
    user?.id,
    vip.tier.id,
    vip.loading,
    seen,
  ]);

  const unlockedCount = list.filter((a) => a.unlocked).length;
  const newCount = list.filter((a) => a.isNew).length;

  const markAllSeen = () => {
    const next = new Set(seen);
    for (const a of list) {
      if (a.unlocked) next.add(a.id);
    }
    setSeen(next);
    writeSeen(next);
  };

  // Si hay storage event externo (otro tab), refrescar.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const reload = () => setSeen(readSeen());
    window.addEventListener('storage', reload);
    return () => window.removeEventListener('storage', reload);
  }, []);

  return {
    list,
    unlockedCount,
    totalCount: list.length,
    newCount,
    markAllSeen,
  };
}
