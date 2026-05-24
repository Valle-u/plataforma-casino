/**
 * useAchievements — Sprint 51.32 / 52.2 server-side refactor.
 *
 * Antes: catálogo hardcoded client-side + predicates calculados desde
 * múltiples hooks. Ahora: el backend tiene el catálogo en DB, evalúa
 * los predicates server-side y otorga recompensas reales (mint de chips
 * al wallet).
 *
 * Contrato externo (lo que consumen page.tsx + AchievementUnlockWatcher)
 * NO cambió — sigue exportando `useAchievements()` con la misma forma.
 *
 * Endpoints consumidos:
 *   - GET  /tenant/achievements/definitions
 *   - GET  /tenant/achievements/me
 *   - POST /tenant/achievements/me/check
 *
 * "isNew" sigue siendo client-side via localStorage — el backend no
 * trackea qué unlocks ya fueron "vistos", esa es lógica de UI puramente.
 */

'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  Award,
  Bell,
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
import { apiGet, apiPost } from '../api-client';

// ──────────────────────────────────────────────────────────────────────
// Tipos (compat con el UI existente)
// ──────────────────────────────────────────────────────────────────────

export type AchievementCategory = 'daily' | 'weekly' | 'milestone' | 'vip';

export interface AchievementStatus {
  /** code estable del backend, sirve también como React key. */
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  color: string;
  category: AchievementCategory;
  /** Para que UI sepa cuánto se gana al desbloquear (display). */
  rewardChips: string;
  unlocked: boolean;
  /** True solo en este render si recién detectamos el unlock — UI dopamine. */
  isNew: boolean;
  /** Si fue unlocked con reward, este es el wallet_tx donde se acreditó. */
  rewardWalletTxId: string | null;
  unlockedAt: string | null;
}

// ──────────────────────────────────────────────────────────────────────
// API types
// ──────────────────────────────────────────────────────────────────────

interface DefinitionsResponse {
  data: Array<{
    id: string;
    code: string;
    label: string;
    description: string;
    iconName: string;
    color: string;
    category: AchievementCategory;
    rewardChips: string;
    sortOrder: number;
    isActive: boolean;
  }>;
}

interface MyAchievementsResponse {
  data: Array<{
    def: DefinitionsResponse['data'][number];
    unlockedAt: string | null;
    rewardWalletTxId: string | null;
  }>;
}

interface CheckResponse {
  data: Array<{
    code: string;
    unlockedAt: string;
    rewardChips: string;
    rewardWalletTxId: string | null;
  }>;
}

// ──────────────────────────────────────────────────────────────────────
// Icon lookup — el backend nos da `iconName` string (e.g. "Trophy")
// porque no puede serializar componentes React. Mapeamos a Lucide acá.
// Si llega un name no mapeado, fallback a Trophy.
// ──────────────────────────────────────────────────────────────────────

const ICONS: Record<string, LucideIcon> = {
  Award,
  Bell,
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
};

function iconFor(name: string): LucideIcon {
  return ICONS[name] ?? Trophy;
}

// ──────────────────────────────────────────────────────────────────────
// localStorage de "vistos"
// ──────────────────────────────────────────────────────────────────────

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

// ──────────────────────────────────────────────────────────────────────
// Hooks
// ──────────────────────────────────────────────────────────────────────

/**
 * Listado completo: catálogo + estado del user. Hace 1 fetch al endpoint
 * combinado /me que devuelve def + unlockedAt. Más eficiente que pedir
 * definitions + unlocks por separado.
 */
function useMyAchievements() {
  return useQuery({
    queryKey: ['my-achievements'],
    queryFn: () => apiGet<MyAchievementsResponse>('/tenant/achievements/me'),
    staleTime: 30_000,
    // Background polling — para detectar unlocks otorgados server-side
    // (e.g. por un cron futuro) sin que el user tenga que recargar.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

/**
 * Mutación: dispara check + grant. Devuelve los unlocks nuevos.
 * Al finalizar, invalida 'my-achievements' + 'my-wallet' (por si hubo
 * reward chips → balance cambió).
 *
 * Llamarse desde puntos de "novedad probable":
 *   - Después de wheel/streak claim.
 *   - Después de deposit approve notif.
 *   - On mount de /play una vez por sesión.
 *   - Al detectar incremento del balance vía polling.
 */
export function useCheckAchievements() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiPost<CheckResponse>('/tenant/achievements/me/check', {}),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['my-achievements'] });
      // Si hubo reward (chips), invalidar wallet también.
      if (res.data.some((u) => Number(u.rewardChips) > 0)) {
        qc.invalidateQueries({ queryKey: ['my-wallet'] });
        qc.invalidateQueries({ queryKey: ['my-transactions'] });
      }
    },
  });
}

/**
 * useAchievements — API pública del hook. Compat con el UI existente
 * desde Sprint 51.32:
 *
 *   const { list, unlockedCount, totalCount, newCount, markAllSeen } =
 *     useAchievements();
 */
export function useAchievements(): {
  list: AchievementStatus[];
  unlockedCount: number;
  totalCount: number;
  newCount: number;
  markAllSeen: () => void;
  isLoading: boolean;
} {
  const { data, isLoading } = useMyAchievements();
  const [seen, setSeen] = useState<Set<string>>(() => readSeen());

  // Multi-tab sync: si otro tab marca seen, reflejarlo.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const reload = () => setSeen(readSeen());
    window.addEventListener('storage', reload);
    return () => window.removeEventListener('storage', reload);
  }, []);

  const list = useMemo<AchievementStatus[]>(() => {
    if (!data?.data) return [];
    return data.data.map((row) => {
      const unlocked = row.unlockedAt !== null;
      const isNew = unlocked && !seen.has(row.def.code);
      return {
        id: row.def.code,
        label: row.def.label,
        description: row.def.description,
        icon: iconFor(row.def.iconName),
        color: row.def.color,
        category: row.def.category,
        rewardChips: row.def.rewardChips,
        unlocked,
        isNew,
        rewardWalletTxId: row.rewardWalletTxId,
        unlockedAt: row.unlockedAt,
      };
    });
  }, [data, seen]);

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

  return {
    list,
    unlockedCount,
    totalCount: list.length,
    newCount,
    markAllSeen,
    isLoading,
  };
}
