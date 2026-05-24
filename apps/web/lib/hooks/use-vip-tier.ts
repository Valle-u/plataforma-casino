/**
 * useVipTier — Sprint 51.30.
 *
 * Calcula el tier VIP del player a partir del volumen apostado (suma
 * de wallet_tx con type "bet") en los últimos 30 días. Cálculo client-
 * side desde `useMyWalletStats(30).byType` — no hay endpoint dedicado
 * todavía.
 *
 * Filosofía:
 *   - 4 tiers progresivos: Bronze → Silver → Gold → Platinum.
 *   - Thresholds en chips. Ajustables sin tocar UI (perks no cambian
 *     según monto, solo el visual rank).
 *   - "Perks" mostradas son ASPIRACIONALES / mock — el backend todavía
 *     no las aplica realmente. Es UX/marketing. Cuando se implementen
 *     real perks (extra spin de rueda, bonus % depósito, fast withdraw,
 *     soporte prioritario), se conectan acá.
 *   - Si stats no cargó, tier = bronze (default seguro).
 *
 * Visualización:
 *   - Ring coloreado alrededor del avatar en header dropdown.
 *   - Card "Tu nivel" en home con progress bar a siguiente tier + lista
 *     de perks.
 */

'use client';

import {
  Award,
  Crown,
  Medal,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { useMyWalletStats } from './use-wallet';

export type VipTierId = 'bronze' | 'silver' | 'gold' | 'platinum';

export interface VipTier {
  id: VipTierId;
  label: string;
  color: string;
  gradient: string;
  icon: LucideIcon;
  /** Umbral mínimo de volumen apostado en chips (sum de bets últimos 30d). */
  thresholdChips: number;
  /** Perks visibles (mock). */
  perks: string[];
}

export const VIP_TIERS: VipTier[] = [
  {
    id: 'bronze',
    label: 'Bronce',
    color: '#CD7F32',
    gradient: 'linear-gradient(135deg, #CD7F32, #8B5A2B)',
    icon: Award,
    thresholdChips: 0,
    perks: ['Acceso a todos los juegos', 'Ruleta diaria', 'Racha de login'],
  },
  {
    id: 'silver',
    label: 'Plata',
    color: '#C0C0C0',
    gradient: 'linear-gradient(135deg, #E5E5E5, #909090)',
    icon: Medal,
    thresholdChips: 10_000,
    perks: ['Todo lo de Bronce', 'Bonus +10% en depósitos', 'Retiros más rápidos'],
  },
  {
    id: 'gold',
    label: 'Oro',
    color: '#FFD700',
    gradient: 'linear-gradient(135deg, #FFE066, #C9A300)',
    icon: Crown,
    thresholdChips: 100_000,
    perks: [
      'Todo lo de Plata',
      'Bonus +20% en depósitos',
      'Spin extra diario en la rueda',
      'Soporte prioritario',
    ],
  },
  {
    id: 'platinum',
    label: 'Platino',
    color: '#E5E4E2',
    gradient:
      'linear-gradient(135deg, #FFFFFF, #B0B0B5 30%, #6E7585 60%, #E5E4E2)',
    icon: Sparkles,
    thresholdChips: 500_000,
    perks: [
      'Todo lo de Oro',
      'Bonus +30% en depósitos',
      'Cashback semanal del 5%',
      'Promociones exclusivas',
      'Account manager dedicado',
    ],
  },
];

/**
 * Calcula tier desde el volume apostado.
 */
function tierForVolume(volume: number): VipTier {
  // Recorrer de mayor a menor y retornar el primero alcanzado.
  for (let i = VIP_TIERS.length - 1; i >= 0; i--) {
    const tier = VIP_TIERS[i]!;
    if (volume >= tier.thresholdChips) return tier;
  }
  return VIP_TIERS[0]!;
}

export interface VipTierStatus {
  tier: VipTier;
  volume: number;
  next: VipTier | null;
  /** 0..1 — progreso al next tier. 1 si ya está en el tier máximo. */
  progressToNext: number;
  /** Cuántas chips faltan para subir. 0 si ya está en el tier máximo. */
  chipsToNext: number;
  loading: boolean;
}

export function useVipTier(): VipTierStatus {
  const stats = useMyWalletStats(30);
  const betEntry = stats.data?.byType.find((b) => b.type === 'bet');
  // sum es signed (negativo para débitos), tomamos absoluto.
  const volume = betEntry ? Math.abs(Number(betEntry.sum)) : 0;

  const tier = tierForVolume(volume);
  const nextIdx = VIP_TIERS.findIndex((t) => t.id === tier.id) + 1;
  const next = nextIdx < VIP_TIERS.length ? VIP_TIERS[nextIdx]! : null;

  let progressToNext = 1;
  let chipsToNext = 0;
  if (next) {
    const range = next.thresholdChips - tier.thresholdChips;
    const reached = volume - tier.thresholdChips;
    progressToNext = Math.max(0, Math.min(1, reached / range));
    chipsToNext = Math.max(0, next.thresholdChips - volume);
  }

  return {
    tier,
    volume,
    next,
    progressToNext,
    chipsToNext,
    loading: stats.isLoading,
  };
}
