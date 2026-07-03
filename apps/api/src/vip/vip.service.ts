/**
 * VipService — Sprint 52.3.
 *
 * Maneja el tier VIP del player + aplica los perks que tienen lógica
 * server-side (deposit bonus, cashback). Otros perks (support priority,
 * fast withdrawals) son flags en perksJson — los subsystems que los
 * implementen leen esa data.
 *
 * Recompute strategy: lazy on read. Si user_vip_status.recomputedAt es
 * vieja (> 1h), getMyStatus dispara un recompute antes de devolver.
 * Para cron diario global, agregar un job que llame recomputeAllActiveUsers
 * (fuera de scope de este sprint).
 *
 * Atomicity: applyDepositBonus se invoca DENTRO de la TX del deposit.approve
 * — recibe el `tx` como param, ejecuta el mint como savepoint, todo
 * rollbackea si el approve falla.
 */

import { Injectable, Logger } from '@nestjs/common';
import { and, eq, gte, sql } from 'drizzle-orm';
import {
  userVipStatus,
  vipTiers,
  walletTransactions,
  type VipTier,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { WalletService } from '../wallet/wallet.service';
import {
  IdempotencyConflictError,
  InsufficientBalanceError,
} from '../wallet/wallet.errors';

const RECOMPUTE_TTL_MS = 60 * 60 * 1000; // 1h

export interface VipStatusView {
  tier: VipTier;
  volume30d: string;
  recomputedAt: Date;
  /** Próximo tier (null si está en el máximo). */
  nextTier: VipTier | null;
  /** Chips que faltan para alcanzar el próximo. 0 si está en el máximo. */
  chipsToNext: string;
  /** 0..1 — progreso al próximo. 1 si máximo. */
  progressToNext: number;
}

@Injectable()
export class VipService {
  private readonly logger = new Logger(VipService.name);

  constructor(private readonly walletService: WalletService) {}

  /** Lista catálogo activo ordenado por threshold ascendente. */
  async listTiers(db: TenantDb): Promise<VipTier[]> {
    return db
      .select()
      .from(vipTiers)
      .where(eq(vipTiers.isActive, true))
      .orderBy(vipTiers.sortOrder, vipTiers.thresholdChips);
  }

  /**
   * Devuelve el status del user. Si está stale (> 1h), recomputa primero.
   * Si no existe, crea fila inicial con bronze.
   */
  async getMyStatus(db: TenantDb, userId: string): Promise<VipStatusView> {
    const [existing] = await db
      .select()
      .from(userVipStatus)
      .where(eq(userVipStatus.userId, userId))
      .limit(1);

    const isStale =
      !existing ||
      Date.now() - existing.recomputedAt.getTime() > RECOMPUTE_TTL_MS;

    let status: typeof existing;
    if (isStale) {
      status = await this.recomputeUserTier(db, userId);
    } else {
      status = existing;
    }

    const tiers = await this.listTiers(db);
    const tier =
      tiers.find((t) => t.code === status.currentTierCode) ?? tiers[0]!;
    const myIdx = tiers.findIndex((t) => t.code === tier.code);
    const nextTier = myIdx >= 0 && myIdx < tiers.length - 1 ? tiers[myIdx + 1]! : null;

    let progressToNext = 1;
    let chipsToNext = '0';
    if (nextTier) {
      const currentThreshold = Number(tier.thresholdChips);
      const nextThreshold = Number(nextTier.thresholdChips);
      const range = nextThreshold - currentThreshold;
      const reached = Number(status.volume30d) - currentThreshold;
      progressToNext = Math.max(0, Math.min(1, reached / range));
      chipsToNext = Math.max(0, nextThreshold - Number(status.volume30d)).toFixed(2);
    }

    return {
      tier,
      volume30d: status.volume30d,
      recomputedAt: status.recomputedAt,
      nextTier,
      chipsToNext,
      progressToNext,
    };
  }

  /**
   * Recomputa volume30d + tier para el user. Upserts user_vip_status.
   * Devuelve la fila resultante.
   *
   * Si el tier cambió respecto al anterior, devolvemos un side-effect
   * para que el caller registre audit/notif. Por ahora sólo logueamos
   * y dejamos el achievement check (existe vip_silver/gold/platinum en
   * achievement catalog) para detectar el upgrade y notificar.
   */
  async recomputeUserTier(
    db: TenantDb,
    userId: string,
  ): Promise<typeof userVipStatus.$inferSelect> {
    const wallet = await this.walletService.getOrCreateWalletForUser(db, userId);

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [agg] = await db
      .select({
        vol: sql<string>`coalesce(sum(case when ${walletTransactions.type} = 'bet' then ${walletTransactions.amount} else 0 end), 0)::text`,
      })
      .from(walletTransactions)
      .where(
        and(
          eq(walletTransactions.walletId, wallet.id),
          gte(walletTransactions.createdAt, thirtyDaysAgo),
        ),
      );

    const volume = Number(agg?.vol ?? '0');
    const tiers = await this.listTiers(db);
    const tier = tierForVolume(tiers, volume);
    const now = new Date();

    // Upsert (insert ... on conflict ... do update). Postgres syntax.
    const [upserted] = await db
      .insert(userVipStatus)
      .values({
        userId,
        currentTierCode: tier.code,
        volume30d: agg?.vol ?? '0',
        recomputedAt: now,
      })
      .onConflictDoUpdate({
        target: userVipStatus.userId,
        set: {
          currentTierCode: tier.code,
          volume30d: agg?.vol ?? '0',
          recomputedAt: now,
        },
      })
      .returning();

    return upserted!;
  }

  /**
   * Aplica el bonus % del tier del user al recibir un deposit aprobado.
   * Idempotency key derivada del depositId → si se llama dos veces para
   * el mismo deposit (retry), el segundo mint atrapa unique conflict y
   * skipea.
   *
   * Devuelve el wallet_tx_id si hubo bonus, null si tier sin bonus o si
   * el calculo dio 0.
   *
   * IMPORTANTE: llamar DESPUÉS del wallet credit del deposit, dentro de
   * la misma TX. Si el bonus falla por razones no-idempotencia y no es
   * fail-soft, rollbackea todo (atomicidad).
   *
   * F2: fondeo por TRANSFER desde el issuer (Casa o socio indep dueño de
   * la rama del player). Antes era MINT puro; ahora respeta la invariante
   * "1 ficha = 1 peso, todo respaldado". Sides:
   *   - Issuer: tx `transfer_out`, source='vip_deposit_bonus'.
   *   - Player: tx `bonus_grant`,  source='vip_deposit_bonus'.
   *
   * Fail-soft (F2): si el issuer no tiene saldo para cubrir el bonus, NO
   * abortamos el deposit base — el bonus es un gift, no debe bloquear al
   * player. Log warn + devolvemos null. La única forma de rollbackear el
   * deposit es un error DISTINTO a saldo del issuer (e.g. DB down).
   */
  async applyDepositBonus(
    db: TenantDb,
    params: {
      userId: string;
      depositAmount: string;
      depositId: string;
      approverUserId: string;
      /** F2: issuer resuelto por HouseService (userId dueño del wallet fondeador). */
      issuerUserId: string;
      /** F2: metadata del issuer para logging del fail-soft. */
      issuerContext: { walletId: string; isCasa: boolean };
    },
  ): Promise<string | null> {
    const status = await this.getMyStatus(db, params.userId);
    const pct = Number(status.tier.depositBonusPct);
    if (pct <= 0) return null;

    const depositAmount = Number(params.depositAmount);
    const bonusAmount = (depositAmount * pct) / 100;
    if (bonusAmount <= 0) return null;
    const bonusAmountStr = bonusAmount.toFixed(2);

    try {
      const pair = await this.walletService.executeTransferPair(db, {
        actorUserId: params.approverUserId,
        sourceUserId: params.issuerUserId,
        targetUserId: params.userId,
        amount: bonusAmountStr,
        sourceType: 'transfer_out',
        targetType: 'bonus_grant',
        source: 'vip_deposit_bonus',
        referenceId: params.depositId,
        idempotencyKey: `vip_deposit_bonus:${params.depositId}`,
        reason: `VIP ${status.tier.label}: +${pct}% bonus en depósito`,
      });
      this.logger.log(
        `VIP bonus +${pct}% = ${bonusAmountStr} chips transferred from issuer ${params.issuerUserId} ` +
          `(${params.issuerContext.isCasa ? 'Casa' : 'socio indep'}) a user ${params.userId} ` +
          `(tier ${status.tier.code}, deposit ${params.depositId})`,
      );
      return pair.targetTx.id;
    } catch (err) {
      // Fail-soft: issuer sin saldo → log warn, saltar bonus, NO abortar
      // el deposit base. El bonus es un gift, no un derecho del player.
      if (err instanceof InsufficientBalanceError) {
        this.logger.warn(
          `VIP bonus SKIPPED por saldo insuficiente del issuer ${params.issuerUserId} ` +
            `(${params.issuerContext.isCasa ? 'Casa' : 'socio indep'}, wallet=${params.issuerContext.walletId}): ` +
            `disponible=${err.available}, requerido=${bonusAmountStr}, deposit=${params.depositId}. ` +
            `El deposit base sigue aprobado.`,
        );
        return null;
      }
      // Idempotency conflict = ya se procesó este bonus. No es error.
      if (err instanceof IdempotencyConflictError) {
        this.logger.debug(
          `VIP bonus skipped (already applied) para deposit ${params.depositId}`,
        );
        return null;
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('idempotency') || msg.includes('IDEMPOTENCY')) {
        this.logger.debug(
          `VIP bonus skipped (already applied) para deposit ${params.depositId}`,
        );
        return null;
      }
      // Otros errores no los swallow — el approve debe rollbackear.
      throw err;
    }
  }
}

/**
 * Resuelve qué tier le toca al user dado su volumen, recorriendo el
 * catálogo de mayor a menor threshold.
 */
function tierForVolume(tiers: VipTier[], volume: number): VipTier {
  // Asume tiers ordenados por threshold ASC. Recorremos al revés.
  const sortedDesc = [...tiers].sort(
    (a, b) => Number(b.thresholdChips) - Number(a.thresholdChips),
  );
  for (const tier of sortedDesc) {
    if (volume >= Number(tier.thresholdChips)) return tier;
  }
  return tiers[0]!; // bronze fallback
}
