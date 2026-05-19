/**
 * ResponsibleGamingService — límites self-service + auto-exclusión.
 *
 * Operaciones:
 *
 *   Settings (límites):
 *     - getSettings(userId): la fila de `responsible_gaming_settings` o
 *       null si el user nunca seteó nada (= sin límites).
 *     - upsertSettings(userId, patch, actorId, reason?): crea o pisa.
 *       Si `actorId !== userId`, se considera admin force y guarda el
 *       reason en `updated_by_reason` para audit trail.
 *
 *   Exclusions:
 *     - getActiveExclusion(userId): la `self_exclusions` activa o null.
 *     - createExclusion(userId, params, actorId): valida que no haya
 *       otra activa (unique index lo refuerza), inserta. Si actor != user
 *       → admin force.
 *     - revokeExclusion(id, actorId, reason): marca status='revoked' +
 *       timestamps. Requiere reason (audit).
 *
 *   Enforcement (helpers para hooks externos):
 *     - assertCanDeposit(userId, amount): tira `DepositLimitExceededError`
 *       o `UserExcludedError` si el user no puede crear el depósito.
 *       NO llama a DB innecesariamente — chequea exclusion + 3 caps.
 *     - assertCanLogin(userId): tira `UserExcludedError` si hay exclusion
 *       activa. Usado en TenantAuthService.login.
 *
 * Nota: el chequeo de bet/loss limits queda como `assertCanBet` reservado
 * para cuando exista wallet.bet (post-Sprint 33 cuando llegue el game
 * provider).
 */

import { Injectable } from '@nestjs/common';
import { and, eq, gte, sql } from 'drizzle-orm';
import {
  deposits,
  gameRounds,
  responsibleGamingSettings,
  selfExclusions,
  type NewResponsibleGamingSettings,
  type NewSelfExclusion,
  type ResponsibleGamingSettings,
  type SelfExclusion,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import {
  BetLimitPerRoundExceededError,
  DepositLimitExceededError,
  ExclusionAlreadyActiveError,
  ExclusionNotFoundError,
  LossLimitExceededError,
  UserExcludedError,
} from './responsible-gaming.errors';

export interface SettingsPatch {
  depositLimitDaily?: string | null;
  depositLimitWeekly?: string | null;
  depositLimitMonthly?: string | null;
  betLimitPerRound?: string | null;
  lossLimitPeriod?: string | null;
  lossLimitPeriodUnit?: 'day' | 'week' | 'month' | null;
  ageConfirmedAt?: Date | null;
  ageConfirmedMin?: number | null;
}

export interface CreateExclusionParams {
  type: 'cool_off' | 'temporary' | 'permanent';
  /** Para cool_off/temporary: cuándo termina. Para permanent: null. */
  endsAt: Date | null;
  reason?: string | null;
}

@Injectable()
export class ResponsibleGamingService {
  // ──────────────────────────────────────────────────────────────────────
  // Settings (límites)
  // ──────────────────────────────────────────────────────────────────────

  async getSettings(
    db: TenantDb,
    userId: string,
  ): Promise<ResponsibleGamingSettings | null> {
    const rows = await db
      .select()
      .from(responsibleGamingSettings)
      .where(eq(responsibleGamingSettings.userId, userId))
      .limit(1);
    return rows[0] ?? null;
  }

  async upsertSettings(
    db: TenantDb,
    userId: string,
    patch: SettingsPatch,
    actorId: string,
    reason?: string | null,
  ): Promise<ResponsibleGamingSettings> {
    const existing = await this.getSettings(db, userId);
    const isAdminForce = actorId !== userId;

    if (!existing) {
      const values: NewResponsibleGamingSettings = {
        userId,
        depositLimitDaily: patch.depositLimitDaily ?? null,
        depositLimitWeekly: patch.depositLimitWeekly ?? null,
        depositLimitMonthly: patch.depositLimitMonthly ?? null,
        betLimitPerRound: patch.betLimitPerRound ?? null,
        lossLimitPeriod: patch.lossLimitPeriod ?? null,
        lossLimitPeriodUnit: patch.lossLimitPeriodUnit ?? null,
        ageConfirmedAt: patch.ageConfirmedAt ?? null,
        ageConfirmedMin: patch.ageConfirmedMin ?? null,
        updatedByUserId: actorId,
        updatedByReason: isAdminForce ? (reason ?? null) : null,
      };
      const inserted = await db
        .insert(responsibleGamingSettings)
        .values(values)
        .returning();
      return inserted[0]!;
    }

    const set: Partial<NewResponsibleGamingSettings> = {
      updatedAt: new Date(),
      updatedByUserId: actorId,
      updatedByReason: isAdminForce ? (reason ?? null) : null,
    };
    if (patch.depositLimitDaily !== undefined) {
      set.depositLimitDaily = patch.depositLimitDaily;
    }
    if (patch.depositLimitWeekly !== undefined) {
      set.depositLimitWeekly = patch.depositLimitWeekly;
    }
    if (patch.depositLimitMonthly !== undefined) {
      set.depositLimitMonthly = patch.depositLimitMonthly;
    }
    if (patch.betLimitPerRound !== undefined) {
      set.betLimitPerRound = patch.betLimitPerRound;
    }
    if (patch.lossLimitPeriod !== undefined) {
      set.lossLimitPeriod = patch.lossLimitPeriod;
    }
    if (patch.lossLimitPeriodUnit !== undefined) {
      set.lossLimitPeriodUnit = patch.lossLimitPeriodUnit;
    }
    if (patch.ageConfirmedAt !== undefined) {
      set.ageConfirmedAt = patch.ageConfirmedAt;
    }
    if (patch.ageConfirmedMin !== undefined) {
      set.ageConfirmedMin = patch.ageConfirmedMin;
    }

    const updated = await db
      .update(responsibleGamingSettings)
      .set(set)
      .where(eq(responsibleGamingSettings.userId, userId))
      .returning();
    return updated[0]!;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Exclusions
  // ──────────────────────────────────────────────────────────────────────

  async getActiveExclusion(
    db: TenantDb,
    userId: string,
  ): Promise<SelfExclusion | null> {
    const rows = await db
      .select()
      .from(selfExclusions)
      .where(
        and(
          eq(selfExclusions.userId, userId),
          eq(selfExclusions.status, 'active'),
        ),
      )
      .limit(1);
    const exc = rows[0] ?? null;
    if (!exc) return null;
    // Defensa: si `endsAt < now` y status sigue 'active' (cron de expiry
    // no corrió), consideramos NO activa. El cron post-MVP lo limpia.
    if (exc.endsAt && exc.endsAt.getTime() <= Date.now()) {
      return null;
    }
    return exc;
  }

  async createExclusion(
    db: TenantDb,
    userId: string,
    params: CreateExclusionParams,
    actorId: string,
  ): Promise<SelfExclusion> {
    const existing = await this.getActiveExclusion(db, userId);
    if (existing) {
      throw new ExclusionAlreadyActiveError(userId);
    }
    // Defensa: permanent forzar endsAt=null. Cool-off/temporary requieren endsAt.
    const endsAt =
      params.type === 'permanent' ? null : params.endsAt;
    if (params.type !== 'permanent' && !endsAt) {
      throw new Error(`Exclusión ${params.type} requiere endsAt.`);
    }
    const values: NewSelfExclusion = {
      userId,
      type: params.type,
      endsAt,
      reason: params.reason ?? null,
      createdByUserId: actorId,
      status: 'active',
    };
    try {
      const inserted = await db
        .insert(selfExclusions)
        .values(values)
        .returning();
      return inserted[0]!;
    } catch (err: unknown) {
      // 23505 = unique_violation por el partial index `status='active'`.
      // Race: otra request creó la exclusion entre nuestro check y nuestro
      // insert. Tratamos como ExclusionAlreadyActiveError.
      if (
        err instanceof Error &&
        'code' in err &&
        (err as { code: string }).code === '23505'
      ) {
        throw new ExclusionAlreadyActiveError(userId);
      }
      throw err;
    }
  }

  async revokeExclusion(
    db: TenantDb,
    id: string,
    actorId: string,
    reason: string,
  ): Promise<SelfExclusion> {
    const updated = await db
      .update(selfExclusions)
      .set({
        status: 'revoked',
        revokedAt: new Date(),
        revokedByUserId: actorId,
        revokedReason: reason,
      })
      .where(
        and(
          eq(selfExclusions.id, id),
          eq(selfExclusions.status, 'active'),
        ),
      )
      .returning();
    if (!updated[0]) {
      throw new ExclusionNotFoundError(id);
    }
    return updated[0];
  }

  // ──────────────────────────────────────────────────────────────────────
  // Enforcement (helpers para hooks)
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Llamado desde `DepositsService.create` ANTES de insertar el deposit.
   * Chequea exclusion activa + 3 caps de depósito.
   *
   * Si el user no tiene settings ni exclusion: no hace nada (pasa).
   */
  async assertCanDeposit(
    db: TenantDb,
    userId: string,
    amountChips: string,
  ): Promise<void> {
    // 1. Exclusion activa bloquea.
    const exclusion = await this.getActiveExclusion(db, userId);
    if (exclusion) {
      throw new UserExcludedError(userId, exclusion.type, exclusion.endsAt);
    }

    // 2. Settings caps.
    const settings = await this.getSettings(db, userId);
    if (!settings) return;

    const amountCents = Math.round(Number(amountChips) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) return;

    if (settings.depositLimitDaily) {
      const usedCents = await this.sumDepositsSince(
        db,
        userId,
        startOfTodayUtc(),
      );
      const capCents = Math.round(Number(settings.depositLimitDaily) * 100);
      if (usedCents + amountCents > capCents) {
        throw new DepositLimitExceededError(
          'daily',
          settings.depositLimitDaily,
          (usedCents / 100).toFixed(2),
          amountChips,
        );
      }
    }
    if (settings.depositLimitWeekly) {
      const usedCents = await this.sumDepositsSince(
        db,
        userId,
        daysAgo(7),
      );
      const capCents = Math.round(Number(settings.depositLimitWeekly) * 100);
      if (usedCents + amountCents > capCents) {
        throw new DepositLimitExceededError(
          'weekly',
          settings.depositLimitWeekly,
          (usedCents / 100).toFixed(2),
          amountChips,
        );
      }
    }
    if (settings.depositLimitMonthly) {
      const usedCents = await this.sumDepositsSince(
        db,
        userId,
        daysAgo(30),
      );
      const capCents = Math.round(Number(settings.depositLimitMonthly) * 100);
      if (usedCents + amountCents > capCents) {
        throw new DepositLimitExceededError(
          'monthly',
          settings.depositLimitMonthly,
          (usedCents / 100).toFixed(2),
          amountChips,
        );
      }
    }
  }

  /**
   * Llamado desde `TenantAuthService.login`. Si hay exclusion activa,
   * tira `UserExcludedError`. El controller mapea a 401 con mensaje claro.
   */
  async assertCanLogin(
    db: TenantDb,
    userId: string,
  ): Promise<void> {
    const exclusion = await this.getActiveExclusion(db, userId);
    if (exclusion) {
      throw new UserExcludedError(userId, exclusion.type, exclusion.endsAt);
    }
  }

  /**
   * Llamado desde `GameRoundsService.placeBet` (Sprint 35). Chequea:
   *   - Exclusion activa → bloquea.
   *   - betLimitPerRound: si está set, bet > cap → tira `BetLimitExceededError`.
   *   - lossLimitPeriod: si está set, (loss histórica + nuevo bet) > cap →
   *     tira `LossLimitExceededError`. Loss = SUM(netAmount<0) en ventana.
   *
   * No bloquea si user no tiene settings — solo enforce caps explícitos.
   */
  async assertCanBet(
    db: TenantDb,
    userId: string,
    betAmount: string,
  ): Promise<void> {
    const exclusion = await this.getActiveExclusion(db, userId);
    if (exclusion) {
      throw new UserExcludedError(userId, exclusion.type, exclusion.endsAt);
    }
    const settings = await this.getSettings(db, userId);
    if (!settings) return;

    const betCents = Math.round(Number(betAmount) * 100);
    if (!Number.isFinite(betCents) || betCents <= 0) return;

    if (settings.betLimitPerRound) {
      const capCents = Math.round(
        Number(settings.betLimitPerRound) * 100,
      );
      if (betCents > capCents) {
        throw new BetLimitPerRoundExceededError(
          settings.betLimitPerRound,
          betAmount,
        );
      }
    }

    if (settings.lossLimitPeriod && settings.lossLimitPeriodUnit) {
      const since = windowSince(settings.lossLimitPeriodUnit);
      const lossCents = await this.sumLossesSince(db, userId, since);
      const capCents = Math.round(Number(settings.lossLimitPeriod) * 100);
      // Loss "potencial" si pierde todo el bet del round = lossCents + betCents.
      // Política conservadora: bloquea si peor-case excede cap.
      if (lossCents + betCents > capCents) {
        throw new LossLimitExceededError(
          settings.lossLimitPeriodUnit,
          settings.lossLimitPeriod,
          (lossCents / 100).toFixed(2),
          betAmount,
        );
      }
    }
  }

  /**
   * Suma de pérdidas netas (|netAmount| donde netAmount < 0) en la
   * ventana. Solo cuenta rounds settled (placed sin settle no son loss
   * todavía; rolled_back son neutrales).
   */
  private async sumLossesSince(
    db: TenantDb,
    userId: string,
    since: Date,
  ): Promise<number> {
    const rows = await db
      .select({
        loss: sql<string>`COALESCE(SUM(CASE WHEN ${gameRounds.netAmount} < 0 THEN -${gameRounds.netAmount} ELSE 0 END), 0)::text`,
      })
      .from(gameRounds)
      .where(
        and(
          eq(gameRounds.userId, userId),
          gte(gameRounds.placedAt, since),
          eq(gameRounds.status, 'settled'),
        ),
      );
    return Math.round(Number(rows[0]?.loss ?? 0) * 100);
  }

  /**
   * Suma de `amount_chips` de los depósitos del user que cuentan para
   * el cap: incluye `pending`, `under_review` y `approved` (ya pidió o
   * ya tiene). `rejected`/`cancelled`/`expired` NO suman.
   */
  private async sumDepositsSince(
    db: TenantDb,
    userId: string,
    since: Date,
  ): Promise<number> {
    const rows = await db
      .select({
        sum: sql<string>`COALESCE(SUM(${deposits.amountChips}), 0)::text`,
      })
      .from(deposits)
      .where(
        and(
          eq(deposits.userId, userId),
          gte(deposits.createdAt, since),
          // status enum exists; usamos NOT IN para incluir todo menos los terminales-no-cuentan.
          sql`${deposits.status} IN ('pending', 'under_review', 'approved')`,
        ),
      );
    return Math.round(Number(rows[0]?.sum ?? 0) * 100);
  }
}

// ──────────────────────────────────────────────────────────────────────
// Time helpers
// ──────────────────────────────────────────────────────────────────────

function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function windowSince(unit: 'day' | 'week' | 'month'): Date {
  if (unit === 'day') return startOfTodayUtc();
  if (unit === 'week') return daysAgo(7);
  return daysAgo(30);
}
