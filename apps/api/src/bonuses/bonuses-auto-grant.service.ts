/**
 * BonusesAutoGrantService — selección y otorgamiento automático de bonos
 * en eventos del sistema (welcome/reload al aprobarse depósito por ahora).
 *
 * Diseño:
 *   - **Idempotent por evento**: la grant key se deriva del id del evento
 *     que dispara (e.g. `auto_grant:<depositId>:welcome`). Si el evento
 *     se reintenta, el segundo intento ve el grant existente y no duplica.
 *   - **Fail-soft**: si no hay definition matcheable, o el funder no tiene
 *     saldo, o cualquier error transient, retornamos `null` o tiramos un
 *     error específico. El caller decide si rompe el flow padre o solo
 *     loguea. En deposits.approve: log + audit "auto_grant_failed" pero
 *     NO revierte el depósito.
 *   - **Selección de definition** simple en MVP:
 *     - welcome → primer deposit aprobado del user (count == 1).
 *     - reload  → cualquier deposit aprobado posterior (count > 1).
 *     - Match: primera definition activa de ese type, orden por code ASC
 *       (predictible — el Admin Tenant nombra sus codes con prefijo numérico
 *       si quiere prioridad).
 *   - **Eval de config**:
 *     `bonusAmount = min(deposit * matchPct/100, maxAmount)`.
 *     `minDeposit` corta si el depósito es menor.
 *   - **`segmentFilter` se IGNORA en MVP** — todos los users elegibles.
 *     Cuando llegue feature de segmentación, evaluar el JSONB acá.
 */

import { Injectable, Logger } from '@nestjs/common';
import { and, asc, count, eq, inArray, isNotNull } from 'drizzle-orm';
import {
  bonusDefinitions,
  deposits,
  roles,
  userRoles,
  users,
  type UserBonus,
} from '@casino/db';
import { FraudDetectionService } from '../fraud/fraud-detection.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { UserHierarchyService } from '../user-hierarchy/user-hierarchy.service';
import { UserBonusesService } from './user-bonuses.service';

interface AutoGrantParams {
  depositId: string;
  userId: string;
  /** Monto del depósito en numeric(20,2) string. */
  depositAmount: string;
  actorUserId: string;
}

export interface AutoGrantResult {
  /** El bono otorgado, o null si ningún definition matcheó / no calificó. */
  bonus: UserBonus | null;
  /** Tipo de bono otorgado (para logging). */
  kind: 'welcome' | 'reload' | null;
  /**
   * Si bonus es null, este campo dice por qué — útil para audit/diagnóstico.
   *   - `no_definition`: no hay welcome/reload definition activa.
   *   - `below_min_deposit`: depósito menor al minDeposit configurado.
   *   - `computed_zero`: matchPct=0 o cálculo da 0.
   *   - `fraud_blocked`: user en cluster confirmed con score >= 90
   *     (doc 15 §D3). Audit con severity:high — admin debe verlo.
   */
  skipReason?:
    | 'no_definition'
    | 'below_min_deposit'
    | 'computed_zero'
    | 'fraud_blocked';
}

interface WelcomeReloadConfig {
  matchPct?: number;
  maxAmount?: number | string;
  minDeposit?: number | string;
}

@Injectable()
export class BonusesAutoGrantService {
  private readonly logger = new Logger(BonusesAutoGrantService.name);

  constructor(
    private readonly userBonusesService: UserBonusesService,
    private readonly fraudService: FraudDetectionService,
    private readonly notificationsService: NotificationsService,
    private readonly hierarchy: UserHierarchyService,
  ) {}

  /**
   * Llamado por el `DepositsController.approve` post-credit-de-wallet.
   * Mira si corresponde welcome o reload, busca definition, calcula
   * monto, y otorga. Idempotente vía depositId.
   *
   * NO tira excepciones de "no aplica" (devuelve `{bonus: null, ...}`).
   * SÍ tira si la creación del bonus falla (e.g. funder sin saldo) — el
   * caller hace fail-soft.
   */
  async autoGrantForApprovedDeposit(
    db: TenantDb,
    params: AutoGrantParams,
  ): Promise<AutoGrantResult> {
    // 0. Antifraude (doc 15 §D3): bloquear si el user está en un
    //    cluster CONFIRMED por admin con score >= 90. Es una decisión
    //    cara — solo aplica si el admin ya revisó y marcó confirmed.
    //    No bloqueamos por 'suspected' acá (false positives existen y
    //    el welcome bonus es atractivo para usuarios legítimos nuevos).
    const blocked = await this.fraudService.isUserInConfirmedHighRiskCluster(
      db,
      params.userId,
    );
    if (blocked) {
      this.logger.warn(
        `Auto-grant BLOQUEADO por antifraude: user=${params.userId} ` +
          `deposit=${params.depositId} (cluster confirmed score >= 90).`,
      );
      // Notif al user: in_app + email. Fail-soft — si la notif falla
      // no rollback del bloqueo (el bloqueo ya está hecho, la notif
      // es UX no-crítica).
      for (const channel of ['in_app', 'email'] as const) {
        try {
          await this.notificationsService.enqueue(db, {
            userId: params.userId,
            kind: 'welcome_bonus_blocked',
            channel,
            payload: {
              depositId: params.depositId,
              reason: 'revisión de seguridad',
            },
          });
        } catch (err) {
          this.logger.error(
            `Falló enqueue de welcome_bonus_blocked (${channel}) para user=${params.userId}: ${(err as Error).message}`,
          );
        }
      }
      return { bonus: null, kind: null, skipReason: 'fraud_blocked' };
    }

    // 1. ¿Welcome o reload? Contamos deposits aprobados del user.
    //    El depósito que disparó este flow ya está en status='approved'
    //    (porque el caller llama acá DESPUÉS de approve commit).
    const cntRows = await db
      .select({ value: count() })
      .from(deposits)
      .where(and(eq(deposits.userId, params.userId), eq(deposits.status, 'approved')));
    const approvedCount = cntRows[0]?.value ?? 0;
    const kind: 'welcome' | 'reload' = approvedCount <= 1 ? 'welcome' : 'reload';

    // 2. Sprint 51.2: filtrar definitions según la branch del player.
    //    - Si el player está bajo un socio independent S → solo definitions
    //      cuyo created_by_user_id = S (los del socio mismo).
    //    - Si NO está bajo ninguno → solo definitions cuyo created_by_user_id
    //      sea un admin_tenant.
    //    Auto-grants tenant-wide NO alcanzan players bajo independent branches.
    const branchId = await this.hierarchy.getIndependentBranchAncestor(
      db,
      params.userId,
    );
    let ownerIdsForFilter: string[];
    if (branchId !== null) {
      ownerIdsForFilter = [branchId];
    } else {
      const adminRows = await db
        .select({ id: users.id })
        .from(users)
        .innerJoin(userRoles, eq(userRoles.userId, users.id))
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(eq(roles.code, 'admin_tenant'));
      ownerIdsForFilter = adminRows.map((r) => r.id);
      // Defensive: si por algún motivo no hay admin (shouldn't happen,
      // seed always crea uno), nos abrimos a permitir cualquier definition
      // legacy sin creator. Evita romper auto-grant en tenants viejos.
      if (ownerIdsForFilter.length === 0) {
        ownerIdsForFilter = [];
      }
    }

    const baseConds = [
      eq(bonusDefinitions.type, kind),
      eq(bonusDefinitions.status, 'active'),
      isNotNull(bonusDefinitions.createdByUserId),
    ];
    if (ownerIdsForFilter.length > 0) {
      baseConds.push(inArray(bonusDefinitions.createdByUserId, ownerIdsForFilter));
    }
    const candidates = await db
      .select()
      .from(bonusDefinitions)
      .where(and(...baseConds))
      .orderBy(asc(bonusDefinitions.code))
      .limit(1);
    const def = candidates[0];
    if (!def) {
      this.logger.debug(
        `Auto-grant: no hay definition activa para tipo=${kind} (deposit=${params.depositId}) ` +
          `con owner ∈ {${ownerIdsForFilter.join(', ')}}.`,
      );
      return { bonus: null, kind: null, skipReason: 'no_definition' };
    }

    // 3. Eval config.
    const config = (def.config ?? {}) as WelcomeReloadConfig;
    const depositCents = this.toCents(params.depositAmount);
    const minDepositCents = this.toCents(this.numericAsString(config.minDeposit ?? 0));

    if (depositCents < minDepositCents) {
      this.logger.debug(
        `Auto-grant: deposit ${params.depositId} (${params.depositAmount}) bajo minDeposit (${config.minDeposit ?? 0}). Skip.`,
      );
      return { bonus: null, kind, skipReason: 'below_min_deposit' };
    }

    const matchPct = Number(config.matchPct ?? 0);
    if (!Number.isFinite(matchPct) || matchPct <= 0) {
      return { bonus: null, kind, skipReason: 'computed_zero' };
    }

    // Centavos para evitar floats. `floor` corta milicentavos.
    let bonusCents = Math.floor((depositCents * matchPct) / 100);

    if (config.maxAmount !== undefined && config.maxAmount !== null) {
      const maxCents = this.toCents(this.numericAsString(config.maxAmount));
      if (bonusCents > maxCents) bonusCents = maxCents;
    }
    if (bonusCents <= 0) {
      return { bonus: null, kind, skipReason: 'computed_zero' };
    }

    const bonusAmount = this.fromCents(bonusCents);

    // 4. Grant via UserBonusesService. Idempotency key derivada del
    //    depositId + kind — un retry del approve no duplica.
    const grantKey = `auto_grant:${params.depositId}:${kind}`;
    const reason = `Auto-grant ${kind} sobre depósito ${params.depositId}`;

    const { bonus } = await this.userBonusesService.grantManual(db, {
      actorUserId: params.actorUserId,
      userId: params.userId,
      definitionId: def.id,
      amount: bonusAmount,
      reason,
      grantIdempotencyKey: grantKey,
      sourceEvent: {
        kind: `deposit_${kind}`,
        depositId: params.depositId,
        depositAmount: params.depositAmount,
      },
      // Sprint 51.2: bypass del check de rol del actor. El actor es
      // el cajero que aprobó el deposit, pero el "owner" semántico
      // del bono es el creator de la definition que ya filtramos
      // arriba. El scope target↔owner sí se valida.
      skipActorRoleCheck: true,
    });

    return { bonus, kind };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────

  /** "100.50" → 10050. */
  private toCents(amount: string): number {
    const [int, dec = ''] = amount.split('.');
    const decPadded = (dec + '00').slice(0, 2);
    return Number(int) * 100 + Number(decPadded);
  }

  /** 10050 → "100.50". */
  private fromCents(cents: number): string {
    const sign = cents < 0 ? '-' : '';
    const abs = Math.abs(cents);
    const int = Math.floor(abs / 100);
    const dec = (abs % 100).toString().padStart(2, '0');
    return `${sign}${int}.${dec}`;
  }

  /** Normaliza number | string a string para `toCents`. */
  private numericAsString(v: number | string): string {
    return typeof v === 'number' ? v.toString() : v;
  }
}
