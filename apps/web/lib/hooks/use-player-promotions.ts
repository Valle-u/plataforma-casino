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
  /** Zona del casino para el día del giro (etapa 2). Default en wheel-config.ts. */
  timezone?: string;
  /** Tope de fichas total otorgado por día (etapa 2). */
  dailyCapChips?: number | null;
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

export function useActivePromotions(
  type?: PromotionKind,
  opts: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: ['active-promotions', { type }],
    queryFn: () => {
      const q = type ? `?type=${encodeURIComponent(type)}` : '';
      return apiGet<ActiveResponse>(`/tenant/promotions/active${q}`);
    },
    staleTime: 60_000,
    ...(opts.enabled !== undefined ? { enabled: opts.enabled } : {}),
  });
}

// ──────────────────────────────────────────────────────────────────────
// Daily wheel: spin + rewards
// ──────────────────────────────────────────────────────────────────────

/** Datos del sobre abierto que devuelve el spin (docs/27 §8). */
export interface SpinVerificacion {
  serverSeed: string | null;
  serverSeedHash: string | null;
  clientSeed: string | null;
  rng: number | null;
  configHash: string | null;
}

export interface SpinResponse {
  rewardId: string;
  segmentId: string;
  segmentLabel: string | null;
  prize: WheelPrize;
  grantedAt: string;
  /** Presente desde la etapa 5: la semilla revelada y su huella. */
  verificacion?: SpinVerificacion;
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
  /** Estado de entrega (etapa 5): `deliveredAt` + `deliveryError` (ambos null = pendiente). */
  deliveredAt: string | null;
  deliveryError: string | null;
  configHash: string | null;
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
 *
 * ⚠️ Legado: la ruleta usa `dayAnchorInZone` (la etapa 2 calcula el día en
 * la timezone de la config, no en UTC). Este helper queda para el streak,
 * que sí sigue en UTC.
 */
export function todayUtcAnchor(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ──────────────────────────────────────────────────────────────────────
// Día en la zona del casino (ruleta, etapa 2)
// ──────────────────────────────────────────────────────────────────────

/** Espejo de `ZONA_POR_DEFECTO` en apps/api/src/promotions/wheel-config.ts. */
export const CASINO_TIMEZONE_DEFAULT = 'America/Argentina/Buenos_Aires';

const ZONE_FMT_CACHE = new Map<string, Intl.DateTimeFormat>();

function anchorFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = ZONE_FMT_CACHE.get(timeZone);
  if (!fmt) {
    // 'en-CA' → 'YYYY-MM-DD'; el backend usa el mismo truco (daily-wheel.service.ts).
    fmt = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone,
    });
    ZONE_FMT_CACHE.set(timeZone, fmt);
  }
  return fmt;
}

/**
 * 'YYYY-MM-DD' del día actual en la zona del casino. El backend deriva el
 * dayAnchor de el giro con la timezone de la config del wheel; si el front
 * usara UTC, entre las 21:00 y la medianoche UTC mostraría el día corrido.
 */
export function dayAnchorInZone(date = new Date(), timeZone?: string | null): string {
  return anchorFormatter(timeZone || CASINO_TIMEZONE_DEFAULT).format(date);
}

// ──────────────────────────────────────────────────────────────────────
// Daily wheel: el sobre cerrado (verificación, docs/27 §8)
// ──────────────────────────────────────────────────────────────────────

/** Lo que el backend publica ANTES del giro. Nunca la semilla. */
export interface WheelCommitment {
  serverSeedHash: string;
  clientSeed: string;
  dayAnchor: string;
}

export function useWheelCommitment(promotionId: string | null) {
  return useQuery({
    queryKey: ['my-wheel-commitment', promotionId],
    queryFn: () => {
      if (!promotionId) throw new Error('promotionId requerido');
      return apiGet<WheelCommitment>(
        `/tenant/promotions/${promotionId}/commitment`,
      );
    },
    enabled: !!promotionId,
    staleTime: 60_000,
  });
}

// ──────────────────────────────────────────────────────────────────────
// Login streak (Sprint 28)
// ──────────────────────────────────────────────────────────────────────

/**
 * Cada premio del config del streak es genérico — mismo shape que un
 * WheelPrize (kind + amount + opcional bonusDefinitionId / description /
 * label). El backend lo serializa como jsonb arbitrario; acá tipamos
 * lo común. Si emerge un kind nuevo, expandir.
 */
export interface StreakPrize {
  kind: WheelPrizeKind;
  amount?: number;
  bonusDefinitionId?: string;
  description?: string;
  label?: string;
}

export interface StreakConfig {
  prizes: StreakPrize[];
  forgivenessDays?: number;
  onMax?: 'hold' | 'reset' | 'cycle';
  autoClaimOnLogin?: boolean;
}

export interface StreakProgress {
  streak: number;
  lastClaimDay: string; // YYYY-MM-DD
  lastPrize?: StreakPrize;
}

interface MyStreakResponse {
  progress: StreakProgress | null;
}

export function useMyStreak(promotionId: string | null) {
  return useQuery({
    queryKey: ['my-streak', promotionId],
    queryFn: () => {
      if (!promotionId) throw new Error('promotionId requerido');
      return apiGet<MyStreakResponse>(
        `/tenant/promotions/${promotionId}/my-streak`,
      );
    },
    enabled: !!promotionId,
    staleTime: 30_000,
  });
}

export interface ClaimStreakResponse {
  rewardId: string;
  streak: number;
  prize: StreakPrize;
  created: boolean;
  grantedAt: string;
}

export function useClaimStreak(promotionId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => {
      if (!promotionId) throw new Error('promotionId requerido');
      return apiPost<ClaimStreakResponse>(
        `/tenant/promotions/${promotionId}/claim-streak`,
        {},
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-streak', promotionId] });
      qc.invalidateQueries({ queryKey: ['my-wallet'] });
      qc.invalidateQueries({ queryKey: ['my-transactions'] });
      qc.invalidateQueries({ queryKey: ['my-notifications'] });
      qc.invalidateQueries({ queryKey: ['my-notifications-unread-count'] });
    },
  });
}
