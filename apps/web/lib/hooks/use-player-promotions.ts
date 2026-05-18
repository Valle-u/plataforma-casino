/**
 * Hooks player-facing del subsistema de promotions (Sprint 27).
 *
 * Endpoints player (sin permission, solo TenantJwtGuard):
 *   - GET    /tenant/promotions/active?type=daily_wheel
 *   - POST   /tenant/promotions/:id/spin
 *   - GET    /tenant/promotions/:id/my-rewards?limit=&offset=
 *   - POST   /tenant/promotions/:id/claim-streak     (Sprint futuro)
 *   - GET    /tenant/promotions/:id/my-streak        (Sprint futuro)
 *
 * El listing player NO incluye config completo del wheel — es el mismo
 * shape de `Promotion` que el admin (el config jsonb está, pero el
 * player no necesita probabilidades para renderizar; solo segments +
 * labels + prize kind para mostrar la rueda visualmente).
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../api-client';

export type PromotionKind =
  | 'lottery_tickets'
  | 'lottery_ranking'
  | 'missions'
  | 'daily_wheel'
  | 'login_streak'
  | 'level_chests';

export type PromotionStatus =
  | 'draft'
  | 'scheduled'
  | 'active'
  | 'closed'
  | 'cancelled';

export type WheelPrizeKind = 'chips' | 'try_again' | 'bonus' | 'free_spins';

export interface WheelPrize {
  kind: WheelPrizeKind;
  amount?: number;
  /** Para kind='bonus': id de la bonus_definition a otorgar. */
  bonusDefinitionId?: string;
  /** Texto adicional opcional para el reveal modal. */
  description?: string;
}

export interface WheelSegment {
  id: string;
  label?: string;
  probability: number;
  prize: WheelPrize;
}

export interface WheelConfig {
  segments: WheelSegment[];
}

export interface PlayerPromotion {
  id: string;
  code: string;
  name: string;
  type: PromotionKind;
  status: PromotionStatus;
  config: WheelConfig | Record<string, unknown>;
  prizes: Record<string, unknown>;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
}

interface ActiveResponse {
  data: PlayerPromotion[];
}

export function useActivePromotions(type?: PromotionKind) {
  return useQuery({
    queryKey: ['active-promotions', { type }],
    queryFn: () => {
      const q = type ? `?type=${encodeURIComponent(type)}` : '';
      return apiGet<ActiveResponse>(`/tenant/promotions/active${q}`);
    },
    staleTime: 60_000,
  });
}

// ──────────────────────────────────────────────────────────────────────
// Daily wheel: spin + rewards
// ──────────────────────────────────────────────────────────────────────

export interface SpinResponse {
  rewardId: string;
  segmentId: string;
  segmentLabel: string | null;
  prize: WheelPrize;
  grantedAt: string;
}

export function useSpinWheel(promotionId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => {
      if (!promotionId) throw new Error('promotionId requerido');
      return apiPost<SpinResponse>(
        `/tenant/promotions/${promotionId}/spin`,
        {},
      );
    },
    onSuccess: () => {
      // Refresh rewards + balance (el premio chips ya entró al wallet).
      qc.invalidateQueries({ queryKey: ['my-wheel-rewards', promotionId] });
      qc.invalidateQueries({ queryKey: ['my-wallet'] });
      qc.invalidateQueries({ queryKey: ['my-transactions'] });
      qc.invalidateQueries({ queryKey: ['my-notifications'] });
      qc.invalidateQueries({ queryKey: ['my-notifications-unread-count'] });
    },
  });
}

export interface WheelReward {
  id: string;
  promotionId: string;
  userId: string;
  segmentId: string | null;
  prize: WheelPrize;
  metadata: Record<string, unknown> & { dayAnchor?: string };
  grantedAt: string;
  createdAt: string;
}

interface MyRewardsResponse {
  data: WheelReward[];
}

export function useMyWheelRewards(
  promotionId: string | null,
  opts: { limit?: number; offset?: number } = {},
) {
  return useQuery({
    queryKey: ['my-wheel-rewards', promotionId, opts],
    queryFn: () => {
      if (!promotionId) throw new Error('promotionId requerido');
      const params = new URLSearchParams();
      if (opts.limit !== undefined) params.set('limit', String(opts.limit));
      if (opts.offset !== undefined) params.set('offset', String(opts.offset));
      const q = params.toString() ? `?${params.toString()}` : '';
      return apiGet<MyRewardsResponse>(
        `/tenant/promotions/${promotionId}/my-rewards${q}`,
      );
    },
    enabled: !!promotionId,
    staleTime: 30_000,
  });
}

/**
 * Helper UTC: devuelve 'YYYY-MM-DD' del día actual. Matchea el dayAnchor
 * que el backend usa para idempotencia (mismo formato).
 */
export function todayUtcAnchor(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
