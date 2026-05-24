/**
 * AchievementsService — Sprint 52.2.
 *
 * Sistema de achievements server-side: catálogo en `achievement_definitions`,
 * unlocks por user en `user_achievements`, recompensas en chips minteadas
 * al wallet del user via WalletService (mint directo — el "funder" es el
 * sistema, no un user específico, por eso usamos mint en vez de bonus_funding).
 *
 * Flow del check:
 *   1. checkAndGrant(db, userId) llama a evaluateUserProgress(db, userId).
 *   2. Obtenemos counters/flags del user (bets, wins, volume 30d, streak,
 *      league position, vip tier, etc.) en pocas queries agregadas.
 *   3. Para cada definition active, evaluamos el predicate matching su
 *      `code`. Si pasa Y el user todavía no lo tiene → grant.
 *   4. Grant insert user_achievements + (si rewardChips > 0) mint chips +
 *      link el wallet_tx_id.
 *   5. Devolvemos la lista de unlocks nuevos para que el caller decida
 *     qué hacer (e.g. el controller los devuelve al client para UI).
 *
 * Idempotencia: UNIQUE constraint en (user_id, code) garantiza que un
 * segundo check no duplica. Si dos requests concurrentes intentan grantear
 * el mismo achievement, una gana y la otra atrapa unique violation.
 *
 * Errores fail-soft:
 *   - Si el mint del reward falla (e.g. el sistema no puede mintear por
 *     algún motivo edge), el user_achievement se inserta IGUAL con
 *     reward_wallet_tx_id=NULL — el achievement queda otorgado pero el
 *     reward queda pendiente para reconciliación manual. Loggeamos warning.
 */

import { Injectable, Logger } from '@nestjs/common';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import {
  achievementDefinitions,
  leagueStandings,
  leagues,
  promotionParticipants,
  promotions,
  userAchievements,
  userBonuses,
  walletTransactions,
  type AchievementDefinition,
} from '@casino/db';
import { randomUUID } from 'node:crypto';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { WalletService } from '../wallet/wallet.service';

export interface AchievementUnlockEvent {
  code: string;
  unlockedAt: Date;
  rewardChips: string;
  rewardWalletTxId: string | null;
}

interface UserProgressSnapshot {
  hasAnyBet: boolean;
  hasAnyWin: boolean;
  hasAnyDeposit: boolean;
  activeBonusCount: number;
  betVolumeAllTime: number;
  spunWheelToday: boolean;
  currentStreakDay: number;
  leaguePosition: number | null;
  vipTier: 'bronze' | 'silver' | 'gold' | 'platinum';
}

@Injectable()
export class AchievementsService {
  private readonly logger = new Logger(AchievementsService.name);

  constructor(private readonly walletService: WalletService) {}

  /** Devuelve catálogo entero de definitions activas, ordenado por categoría + sort_order. */
  async listDefinitions(db: TenantDb): Promise<AchievementDefinition[]> {
    return db
      .select()
      .from(achievementDefinitions)
      .where(eq(achievementDefinitions.isActive, true))
      .orderBy(achievementDefinitions.category, achievementDefinitions.sortOrder);
  }

  /**
   * Lista los unlocks del user combinados con la def. Items locked tienen
   * `unlockedAt = null`. Devuelve TODOS los achievements del catálogo
   * (locked + unlocked) en un solo viaje.
   */
  async listForUser(
    db: TenantDb,
    userId: string,
  ): Promise<
    Array<{
      def: AchievementDefinition;
      unlockedAt: Date | null;
      rewardWalletTxId: string | null;
    }>
  > {
    const defs = await this.listDefinitions(db);
    const unlocks = await db
      .select({
        code: userAchievements.achievementCode,
        unlockedAt: userAchievements.unlockedAt,
        rewardWalletTxId: userAchievements.rewardWalletTxId,
      })
      .from(userAchievements)
      .where(eq(userAchievements.userId, userId));

    const unlockByCode = new Map(unlocks.map((u) => [u.code, u]));
    return defs.map((def) => {
      const unlock = unlockByCode.get(def.code);
      return {
        def,
        unlockedAt: unlock?.unlockedAt ?? null,
        rewardWalletTxId: unlock?.rewardWalletTxId ?? null,
      };
    });
  }

  /**
   * Corre check + grant + reward para `userId`. Devuelve los unlocks
   * NUEVOS que se acaban de otorgar (vacío si no había ninguno).
   *
   * Llamar desde:
   *   - Hooks de eventos (deposit.approved, game.win, streak.claim, etc.).
   *   - Endpoint manual POST /tenant/achievements/me/check.
   *   - Cron diario (futuro).
   */
  async checkAndGrant(
    db: TenantDb,
    userId: string,
  ): Promise<AchievementUnlockEvent[]> {
    const [progress, defs, alreadyUnlocked] = await Promise.all([
      this.evaluateUserProgress(db, userId),
      this.listDefinitions(db),
      this.getUnlockedCodes(db, userId),
    ]);

    const newlyUnlocked: AchievementUnlockEvent[] = [];
    for (const def of defs) {
      if (alreadyUnlocked.has(def.code)) continue;
      if (!this.evaluatePredicate(def.code, progress)) continue;

      try {
        const unlock = await this.grantAchievement(db, userId, def);
        newlyUnlocked.push(unlock);
      } catch (err) {
        // Race condition: otro request hizo el unlock entre nuestro
        // listUnlockedCodes y el insert. UNIQUE violation atrapada y
        // skipeada — el achievement está otorgado, no es un error.
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('user_achievements_user_code_unique')) {
          this.logger.debug(
            `Race condition grant ${def.code} user ${userId} — ya estaba`,
          );
          continue;
        }
        throw err;
      }
    }

    return newlyUnlocked;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Predicates
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Hardcoded predicate dispatcher por `code`. Si en el futuro queremos
   * predicates configurables desde DB (e.g. JSON con un mini-DSL), ése
   * sería un sprint dedicado.
   */
  private evaluatePredicate(code: string, p: UserProgressSnapshot): boolean {
    switch (code) {
      case 'first_bet':
        return p.hasAnyBet;
      case 'first_win':
        return p.hasAnyWin;
      case 'first_deposit':
        return p.hasAnyDeposit;
      case 'first_bonus':
        return p.activeBonusCount > 0;
      case 'volume_1k':
        return p.betVolumeAllTime >= 1_000;
      case 'volume_10k':
        return p.betVolumeAllTime >= 10_000;
      case 'volume_100k':
        return p.betVolumeAllTime >= 100_000;
      case 'wheel_spin_today':
        return p.spunWheelToday;
      case 'streak_3':
        return p.currentStreakDay >= 3;
      case 'streak_7':
        return p.currentStreakDay >= 7;
      case 'league_top_10':
        return p.leaguePosition !== null && p.leaguePosition <= 10;
      case 'league_top_3':
        return p.leaguePosition !== null && p.leaguePosition <= 3;
      case 'vip_silver':
        return ['silver', 'gold', 'platinum'].includes(p.vipTier);
      case 'vip_gold':
        return ['gold', 'platinum'].includes(p.vipTier);
      case 'vip_platinum':
        return p.vipTier === 'platinum';
      default:
        // Codes desconocidos (definiciones custom posteriores sin predicate
        // implementado) no desbloquean nada. Loggeamos warning una vez.
        this.logger.warn(`Sin predicate para code "${code}" — skipping`);
        return false;
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Snapshot del progreso del user (1 viaje agregado)
  // ──────────────────────────────────────────────────────────────────────

  private async evaluateUserProgress(
    db: TenantDb,
    userId: string,
  ): Promise<UserProgressSnapshot> {
    // 1. wallet del user (si no existe, todavía no jugó nada).
    const wallet = await this.walletService.getOrCreateWalletForUser(db, userId);

    // 2. wallet_transactions aggregates: existencia de bet/win/deposit +
    //    sum total bet (volumen lifetime).
    const [txAggregate] = await db
      .select({
        hasBet: sql<boolean>`bool_or(${walletTransactions.type} = 'bet')`,
        hasWin: sql<boolean>`bool_or(${walletTransactions.type} IN ('win','jackpot_win'))`,
        hasDeposit: sql<boolean>`bool_or(${walletTransactions.type} = 'deposit')`,
        betVolume: sql<string>`coalesce(sum(case when ${walletTransactions.type} = 'bet' then ${walletTransactions.amount} else 0 end), 0)::text`,
      })
      .from(walletTransactions)
      .where(eq(walletTransactions.walletId, wallet.id));

    // 3. bonos activos / pending del user
    const [bonusCount] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(userBonuses)
      .where(
        and(
          eq(userBonuses.userId, userId),
          inArray(userBonuses.status, ['active', 'pending']),
        ),
      );

    // 4. spun wheel today: hay un promo_reward con created_at >= today UTC?
    //    Forma simple: query desde wallet_transactions por type promo_reward.
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const [wheelToday] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(walletTransactions)
      .where(
        and(
          eq(walletTransactions.walletId, wallet.id),
          eq(walletTransactions.type, 'promo_reward'),
          gte(walletTransactions.createdAt, todayStart),
        ),
      );

    // 5. login_streak progress — el state vive en promotion_participants.
    //    Joineamos con promotions para filtrar por type=login_streak +
    //    status=active. El currentProgress es `{ streak, lastClaimDay }`.
    const [streakRow] = await db
      .select({ progress: promotionParticipants.currentProgress })
      .from(promotionParticipants)
      .innerJoin(
        promotions,
        eq(promotions.id, promotionParticipants.promotionId),
      )
      .where(
        and(
          eq(promotionParticipants.userId, userId),
          eq(promotions.type, 'login_streak'),
          eq(promotions.status, 'active'),
        ),
      )
      .limit(1);
    const currentStreakDay =
      (streakRow?.progress as { streak?: number } | undefined)?.streak ?? 0;

    // 6. league position: liga activa más reciente + mi posición ahí (si está).
    const [activeLeague] = await db
      .select({ id: leagues.id })
      .from(leagues)
      .where(eq(leagues.status, 'active'))
      .orderBy(leagues.startsAt)
      .limit(1);

    let leaguePosition: number | null = null;
    if (activeLeague) {
      const [myStanding] = await db
        .select({ position: leagueStandings.position })
        .from(leagueStandings)
        .where(
          and(
            eq(leagueStandings.leagueId, activeLeague.id),
            eq(leagueStandings.userId, userId),
          ),
        )
        .limit(1);
      leaguePosition = myStanding?.position ?? null;
    }

    // 7. VIP tier: calculado desde sum de bets últimos 30d (mismo que
    //    client + el VipService futuro). Reuso la query del wallet stats.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [vipAggregate] = await db
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
    const volume30d = Number(vipAggregate?.vol ?? '0');
    const vipTier = this.tierForVolume(volume30d);

    return {
      hasAnyBet: txAggregate?.hasBet ?? false,
      hasAnyWin: txAggregate?.hasWin ?? false,
      hasAnyDeposit: txAggregate?.hasDeposit ?? false,
      activeBonusCount: bonusCount?.n ?? 0,
      betVolumeAllTime: Number(txAggregate?.betVolume ?? '0'),
      spunWheelToday: (wheelToday?.n ?? 0) > 0,
      currentStreakDay,
      leaguePosition,
      vipTier,
    };
  }

  private tierForVolume(volume: number): UserProgressSnapshot['vipTier'] {
    if (volume >= 500_000) return 'platinum';
    if (volume >= 100_000) return 'gold';
    if (volume >= 10_000) return 'silver';
    return 'bronze';
  }

  private async getUnlockedCodes(
    db: TenantDb,
    userId: string,
  ): Promise<Set<string>> {
    const rows = await db
      .select({ code: userAchievements.achievementCode })
      .from(userAchievements)
      .where(eq(userAchievements.userId, userId));
    return new Set(rows.map((r) => r.code));
  }

  // ──────────────────────────────────────────────────────────────────────
  // Grant + reward mint
  // ──────────────────────────────────────────────────────────────────────

  private async grantAchievement(
    db: TenantDb,
    userId: string,
    def: AchievementDefinition,
  ): Promise<AchievementUnlockEvent> {
    const rewardAmount = Number(def.rewardChips);
    let rewardWalletTxId: string | null = null;

    if (rewardAmount > 0) {
      // Mint chips directo al wallet del user via mintToWallet (primitive
      // wallet operation usado normalmente por bonuses / promotions).
      // El "source" identifica al subsystem (`achievement`). El actor
      // registrado en createdBy es el propio userId (operación system —
      // no hay admin explícito; el achievement code en notes da contexto).
      try {
        const userWallet = await this.walletService.getOrCreateWalletForUser(
          db,
          userId,
        );
        const tx = await this.walletService.mintToWallet(db, {
          walletId: userWallet.id,
          amount: rewardAmount.toFixed(2),
          source: 'achievement',
          referenceId: def.id,
          idempotencyKey: `achievement_reward:${userId}:${def.code}`,
          reason: `Achievement reward: ${def.label}`,
          createdBy: userId,
          counterpartyUserId: null,
        });
        rewardWalletTxId = tx.id;
      } catch (err) {
        // Fail-soft: log + sigue con NULL.
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Achievement ${def.code} reward mint falló para user ${userId}: ${msg}. ` +
            `Otorgamos el achievement igual pero con reward_wallet_tx_id=NULL.`,
        );
      }
    }

    const now = new Date();
    const [inserted] = await db
      .insert(userAchievements)
      .values({
        id: randomUUID(),
        userId,
        achievementCode: def.code,
        unlockedAt: now,
        rewardWalletTxId,
        metadata: {
          rewardChipsAttempted: rewardAmount,
          rewardSucceeded: rewardWalletTxId !== null,
        },
      })
      .returning();

    return {
      code: def.code,
      unlockedAt: inserted!.unlockedAt,
      rewardChips: def.rewardChips,
      rewardWalletTxId: inserted!.rewardWalletTxId,
    };
  }
}
