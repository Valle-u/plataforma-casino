/**
 * useVipTier — Sprint 51.30 / 52.3 server-side refactor.
 *
 * Antes: cálculo 100% client-side desde wallet stats con tier hardcoded.
 * Ahora: pega contra el backend (`GET /tenant/vip/me`), que persiste el
 * tier en `user_vip_status`, recomputa lazy si stale (> 1h), aplica
 * perks reales (deposit bonus +%, cashback futuro) y joinea con el
 * catálogo `vip_tiers`.
 *
 * Contrato externo (lo que consumen VipTierCard, VipRing, etc.) NO
 * cambió — sigue exportando `useVipTier()` con la misma forma:
 *   { tier, volume, next, progressToNext, chipsToNext, loading }
 *
 * El catálogo VIP_TIERS local sigue exportándose para compat con código
 * que lo importa por su lado (perks display, icons). El backend devuelve
 * los mismos códigos y labels — el icon es lookup client-side igual que
 * achievements.
 */

'use client';

import {
  Award,
  Crown,
  Medal,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../api-client';

export type VipTierId = 'bronze' | 'silver' | 'gold' | 'platinum';

export interface VipTier {
  id: VipTierId;
  label: string;
  color: string;
  gradient: string;
  icon: LucideIcon;
  /** Umbral mínimo de volumen apostado en chips. */
  thresholdChips: number;
  /** Perks display (texto). Cuando el backend provee perksJson.perks usamos eso. */
  perks: string[];
}

/**
 * Lookup local de display info por code. El backend devuelve threshold +
 * pcts + perks_json, pero icon/gradient están en el cliente porque no
 * son serializables nicely.
 */
const TIER_DISPLAY: Record<
  VipTierId,
  { icon: LucideIcon; gradient: string }
> = {
  bronze: {
    icon: Award,
    gradient: 'linear-gradient(135deg, #CD7F32, #8B5A2B)',
  },
  silver: {
    icon: Medal,
    gradient: 'linear-gradient(135deg, #E5E5E5, #909090)',
  },
  gold: {
    icon: Crown,
    gradient: 'linear-gradient(135deg, #FFE066, #C9A300)',
  },
  platinum: {
    icon: Sparkles,
    gradient:
      'linear-gradient(135deg, #FFFFFF, #B0B0B5 30%, #6E7585 60%, #E5E4E2)',
  },
};

// ──────────────────────────────────────────────────────────────────────
// API types
// ──────────────────────────────────────────────────────────────────────

interface ApiVipTier {
  id: string;
  code: VipTierId;
  label: string;
  color: string;
  thresholdChips: string;
  depositBonusPct: string;
  cashbackPct: string;
  perksJson: { perks?: string[]; [k: string]: unknown };
  sortOrder: number;
  isActive: boolean;
}

interface MyVipStatusResponse {
  tier: ApiVipTier;
  volume30d: string;
  recomputedAt: string;
  nextTier: ApiVipTier | null;
  chipsToNext: string;
  progressToNext: number;
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function apiToTier(t: ApiVipTier): VipTier {
  const display = TIER_DISPLAY[t.code] ?? TIER_DISPLAY.bronze;
  return {
    id: t.code,
    label: t.label,
    color: t.color,
    gradient: display.gradient,
    icon: display.icon,
    thresholdChips: Number(t.thresholdChips),
    perks: Array.isArray(t.perksJson?.perks) ? t.perksJson.perks : [],
  };
}

// ──────────────────────────────────────────────────────────────────────
// Hook
// ──────────────────────────────────────────────────────────────────────

export interface VipTierStatus {
  tier: VipTier;
  volume: number;
  next: VipTier | null;
  /** 0..1 — progreso al next tier. 1 si está en el tier máximo. */
  progressToNext: number;
  /** Cuántas chips faltan para subir. 0 si máximo. */
  chipsToNext: number;
  loading: boolean;
}

/**
 * Fallback bronze tier — usado mientras carga o si el endpoint falla.
 * Evita undefined access en consumers.
 */
const FALLBACK_BRONZE: VipTier = {
  id: 'bronze',
  label: 'Bronce',
  color: '#CD7F32',
  gradient: TIER_DISPLAY.bronze.gradient,
  icon: TIER_DISPLAY.bronze.icon,
  thresholdChips: 0,
  perks: ['Acceso a juegos', 'Ruleta diaria', 'Racha de login'],
};

export function useVipTier(): VipTierStatus {
  const { data, isLoading } = useQuery({
    queryKey: ['my-vip-status'],
    queryFn: () => apiGet<MyVipStatusResponse>('/tenant/vip/me'),
    // Recompute lazy del backend ya cubre staleness. Polling moderado
    // por si el tier sube en background (otro tab, cron futuro).
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    // Mantener valor previo durante refetch (no flash de loading).
    placeholderData: (prev) => prev,
  });

  // Backend stub returns flat { tierCode, tierLabel, ... } without a nested
  // `tier` object. Handle both the real shape and the stub gracefully.
  if (!data || !data.tier) {
    return {
      tier: FALLBACK_BRONZE,
      volume: Number(data?.volume30d ?? 0),
      next: null,
      progressToNext: 0,
      chipsToNext: 0,
      loading: isLoading,
    };
  }

  return {
    tier: apiToTier(data.tier),
    volume: Number(data.volume30d),
    next: data.nextTier ? apiToTier(data.nextTier) : null,
    progressToNext: data.progressToNext,
    chipsToNext: Number(data.chipsToNext),
    loading: false,
  };
}
