/**
 * MovementAlertsService — detección de fraude INTERNO sobre el ledger.
 *
 * Corre 6 reglas sobre movimientos válidos (que la integridad del ledger NO
 * pesca, porque están bien registrados) y emite alertas para que el admin
 * revise. Read-only sobre la economía (no muta wallets). Espeja el flujo del
 * módulo antifraude de cuentas (scan → alertas → confirmar/descartar).
 *
 * Reglas: mint_near_cap · employee_cap_abuse · actor_burst ·
 * actor_concentration · repeat_counterparty · fast_cashout.
 */

import { Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { movementAlerts, users } from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { HouseService } from '../house/house.service';
import { EmployeeCorrectionService } from '../wallet/employee-correction.service';
import { TenantSettingsService } from '../tenant-settings/tenant-settings.service';
import { NotificationsService } from '../notifications/notifications.service';

type Severity = 'low' | 'medium' | 'high';
type AlertStatus = 'suspected' | 'confirmed' | 'dismissed';

interface Candidate {
  rule: string;
  actorUserId: string | null;
  subjectUserId: string | null;
  amount: string | null;
  severity: Severity;
  details: Record<string, unknown>;
  period: string;
}

export interface MovementScanResult {
  alertsCreated: number;
  newSuspected: number;
  preservedDismissed: number;
}

export interface MovementAlertStats {
  suspected: number;
  confirmed: number;
  dismissed: number;
}

const SENSITIVE_TYPES =
  "'mint','burn','load','unload','adjustment','transfer_out','bonus_funding'";

function rowsOf<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  const r = (res as { rows?: T[] }).rows;
  return Array.isArray(r) ? r : [];
}

function monthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function dayKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function pctSeverity(ratio: number): Severity {
  return ratio >= 100 ? 'high' : ratio >= 90 ? 'medium' : 'low';
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

@Injectable()
export class MovementAlertsService {
  private readonly logger = new Logger(MovementAlertsService.name);

  constructor(
    private readonly house: HouseService,
    private readonly employeeCorrection: EmployeeCorrectionService,
    private readonly settings: TenantSettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Scan ─────────────────────────────────────────────────────────────────

  async runScan(db: TenantDb): Promise<MovementScanResult> {
    const candidates: Candidate[] = [];
    for (const rule of [
      () => this.ruleMintNearCap(db),
      () => this.ruleEmployeeCapAbuse(db),
      () => this.ruleActorBurst(db),
      () => this.ruleActorConcentration(db),
      () => this.ruleRepeatCounterparty(db),
      () => this.ruleFastCashout(db),
    ]) {
      try {
        candidates.push(...(await rule()));
      } catch (err) {
        this.logger.error(`Regla falló: ${(err as Error).message}`);
      }
    }

    let alertsCreated = 0;
    let newSuspected = 0;
    let preservedDismissed = 0;
    const newIds: string[] = [];

    for (const c of candidates) {
      const dedupKey = `${c.rule}|${c.actorUserId ?? '-'}|${c.subjectUserId ?? '-'}|${c.period}`;
      const existing = await db
        .select({ id: movementAlerts.id, status: movementAlerts.status })
        .from(movementAlerts)
        .where(eq(movementAlerts.dedupKey, dedupKey))
        .limit(1);

      if (existing[0]) {
        if (existing[0].status === 'dismissed') {
          preservedDismissed++;
          continue;
        }
        await db
          .update(movementAlerts)
          .set({
            severity: c.severity,
            amount: c.amount,
            details: c.details,
            lastUpdatedAt: new Date(),
          })
          .where(eq(movementAlerts.id, existing[0].id));
      } else {
        const inserted = await db
          .insert(movementAlerts)
          .values({
            rule: c.rule,
            actorUserId: c.actorUserId,
            subjectUserId: c.subjectUserId,
            amount: c.amount,
            severity: c.severity,
            details: c.details,
            period: c.period,
            dedupKey,
            status: 'suspected',
          })
          .returning({ id: movementAlerts.id });
        alertsCreated++;
        newSuspected++;
        if (inserted[0]) newIds.push(inserted[0].id);
      }
    }

    if (newIds.length > 0) await this.notifyAdmins(db, newIds.length);

    return { alertsCreated, newSuspected, preservedDismissed };
  }

  private async notifyAdmins(db: TenantDb, count: number): Promise<void> {
    for (const channel of ['in_app', 'email'] as const) {
      try {
        await this.notifications.enqueueForRole(db, {
          roleCode: 'admin_tenant',
          kind: 'movement_alert_suspected',
          channel,
          payload: { count },
        });
      } catch (err) {
        this.logger.warn(`Notif movimientos: ${(err as Error).message}`);
      }
    }
  }

  // ── Reglas ───────────────────────────────────────────────────────────────

  /** 1. Minteo del mes cerca/encima del tope mensual (E3). */
  private async ruleMintNearCap(db: TenantDb): Promise<Candidate[]> {
    const status = await this.house.getMintBudgetStatus(db);
    const budget = Number(status.monthlyBudget);
    const minted = Number(status.mintedThisMonth);
    const pct = await this.settings.getNumeric(db, 'mov_alerts.mint_near_cap_pct', 90);
    // Skip si el tope está sin configurar (default ~1e12 = "sin límite práctico").
    if (!(budget > 0 && budget < 1e11)) return [];
    if (minted < (budget * pct) / 100) return [];
    const ratio = (minted / budget) * 100;
    return [
      {
        rule: 'mint_near_cap',
        actorUserId: null,
        subjectUserId: null,
        amount: status.mintedThisMonth,
        severity: pctSeverity(ratio),
        details: { minted, budget, pct: round2(ratio) },
        period: monthKey(),
      },
    ];
  }

  /** 2. Empleado con correcciones+bonos cerca/encima de su cupo mensual (R7). */
  private async ruleEmployeeCapAbuse(db: TenantDb): Promise<Candidate[]> {
    const emps = await this.employeeCorrection.listEmployeesWithCap(db);
    const pct = await this.settings.getNumeric(db, 'mov_alerts.employee_cap_pct', 90);
    const out: Candidate[] = [];
    for (const e of emps) {
      const cap = Number(e.cap);
      const used = Number(e.used);
      if (cap <= 0 || used < (cap * pct) / 100) continue;
      const ratio = (used / cap) * 100;
      out.push({
        rule: 'employee_cap_abuse',
        actorUserId: e.userId,
        subjectUserId: null,
        amount: e.used,
        severity: pctSeverity(ratio),
        details: { used, cap, pct: round2(ratio), username: e.username },
        period: monthKey(),
      });
    }
    return out;
  }

  /** 3. Actor con muchos movimientos sensibles en poco tiempo (ráfaga). */
  private async ruleActorBurst(db: TenantDb): Promise<Candidate[]> {
    const count = await this.settings.getNumeric(db, 'mov_alerts.burst_count', 30);
    const hours = await this.settings.getNumeric(db, 'mov_alerts.burst_window_hours', 24);
    const res = await db.execute(sql`
      SELECT created_by AS actor, COUNT(*)::int AS n, COALESCE(SUM(amount),0)::text AS total
      FROM wallet_transactions
      WHERE created_by IS NOT NULL
        AND type IN (${sql.raw(SENSITIVE_TYPES)})
        AND created_at >= now() - (${hours} || ' hours')::interval
      GROUP BY created_by
      HAVING COUNT(*) >= ${count}
    `);
    return rowsOf<{ actor: string; n: number; total: string }>(res).map((r) => ({
      rule: 'actor_burst',
      actorUserId: r.actor,
      subjectUserId: null,
      amount: r.total,
      severity: r.n >= count * 2 ? 'high' : 'medium',
      details: { count: r.n, windowHours: hours, total: r.total },
      period: dayKey(),
    }));
  }

  /** 4. Actor que concentra una tajada anómala del monto sensible del mes. */
  private async ruleActorConcentration(db: TenantDb): Promise<Candidate[]> {
    const pct = await this.settings.getNumeric(db, 'mov_alerts.concentration_pct', 60);
    const floor = await this.settings.getNumeric(db, 'mov_alerts.concentration_floor', 100000);
    const res = await db.execute(sql`
      WITH per_actor AS (
        SELECT created_by AS actor, COALESCE(SUM(amount),0) AS amt
        FROM wallet_transactions
        WHERE created_by IS NOT NULL
          AND type IN (${sql.raw(SENSITIVE_TYPES)})
          AND created_at >= date_trunc('month', now() AT TIME ZONE 'utc')
        GROUP BY created_by
      ), tot AS (SELECT COALESCE(SUM(amt),0) AS total FROM per_actor)
      SELECT pa.actor, pa.amt::text AS amt,
             (pa.amt / NULLIF(t.total,0) * 100)::numeric(6,2)::text AS share
      FROM per_actor pa CROSS JOIN tot t
      WHERE pa.amt >= ${floor}
        AND (pa.amt / NULLIF(t.total,0) * 100) >= ${pct}
    `);
    return rowsOf<{ actor: string; amt: string; share: string }>(res).map((r) => ({
      rule: 'actor_concentration',
      actorUserId: r.actor,
      subjectUserId: null,
      amount: r.amt,
      severity: Number(r.share) >= 80 ? 'high' : 'medium',
      details: { amount: r.amt, sharePct: Number(r.share) },
      period: monthKey(),
    }));
  }

  /** 5. Actor que carga/transfiere repetidamente a la misma contraparte. */
  private async ruleRepeatCounterparty(db: TenantDb): Promise<Candidate[]> {
    const count = await this.settings.getNumeric(db, 'mov_alerts.repeat_count', 10);
    const res = await db.execute(sql`
      SELECT created_by AS actor, counterparty_user_id AS subject,
             COUNT(*)::int AS n, COALESCE(SUM(amount),0)::text AS total
      FROM wallet_transactions
      WHERE created_by IS NOT NULL
        AND counterparty_user_id IS NOT NULL
        AND created_by <> counterparty_user_id
        AND type IN ('load','transfer_out')
        AND created_at >= now() - '24 hours'::interval
      GROUP BY created_by, counterparty_user_id
      HAVING COUNT(*) >= ${count}
    `);
    return rowsOf<{ actor: string; subject: string; n: number; total: string }>(
      res,
    ).map((r) => ({
      rule: 'repeat_counterparty',
      actorUserId: r.actor,
      subjectUserId: r.subject,
      amount: r.total,
      severity: r.n >= count * 2 ? 'high' : 'medium',
      details: { count: r.n, total: r.total },
      period: dayKey(),
    }));
  }

  /** 6. Jugador que deposita y retira casi lo mismo enseguida (cash-out). */
  private async ruleFastCashout(db: TenantDb): Promise<Candidate[]> {
    const pct = await this.settings.getNumeric(db, 'mov_alerts.cashout_pct', 80);
    const hours = await this.settings.getNumeric(db, 'mov_alerts.cashout_window_hours', 6);
    const res = await db.execute(sql`
      SELECT w.user_id AS actor,
             wt_w.amount::text AS withdrawal,
             wt_d.amount::text AS deposit,
             wt_w.created_at AS at
      FROM wallet_transactions wt_w
      JOIN wallets w ON w.id = wt_w.wallet_id
      JOIN wallet_transactions wt_d ON wt_d.wallet_id = wt_w.wallet_id
        AND wt_d.type = 'deposit'
        AND wt_d.created_at <= wt_w.created_at
        AND wt_d.created_at >= wt_w.created_at - (${hours} || ' hours')::interval
      WHERE wt_w.type = 'withdrawal'
        AND wt_w.created_at >= now() - '7 days'::interval
        AND wt_w.amount >= wt_d.amount * ${pct} / 100
    `);
    return rowsOf<{
      actor: string;
      withdrawal: string;
      deposit: string;
      at: string;
    }>(res).map((r) => ({
      rule: 'fast_cashout',
      actorUserId: r.actor,
      subjectUserId: null,
      amount: r.withdrawal,
      severity: 'medium',
      details: {
        deposit: r.deposit,
        withdrawal: r.withdrawal,
        windowHours: hours,
      },
      period: dayKey(),
    }));
  }

  // ── Consultas / review ──────────────────────────────────────────────────

  async stats(
    db: TenantDb,
    scope?: Set<string>,
  ): Promise<MovementAlertStats> {
    const conds = scope
      ? [inArray(movementAlerts.actorUserId, [...scope])]
      : [];
    const rows = await db
      .select({
        status: movementAlerts.status,
        n: sql<number>`count(*)::int`,
      })
      .from(movementAlerts)
      .where(conds.length ? and(...conds) : undefined)
      .groupBy(movementAlerts.status);
    const out: MovementAlertStats = { suspected: 0, confirmed: 0, dismissed: 0 };
    for (const r of rows) out[r.status as AlertStatus] = r.n;
    return out;
  }

  async listAlerts(
    db: TenantDb,
    filters: { status?: AlertStatus; limit: number; offset: number },
    scope?: Set<string>,
  ) {
    const actor = alias(users, 'actor_user');
    const subject = alias(users, 'subject_user');
    const conds = [];
    if (filters.status) conds.push(eq(movementAlerts.status, filters.status));
    if (scope) conds.push(inArray(movementAlerts.actorUserId, [...scope]));

    const rows = await db
      .select({
        id: movementAlerts.id,
        rule: movementAlerts.rule,
        actorUserId: movementAlerts.actorUserId,
        actorUsername: actor.username,
        actorDisplayName: actor.displayName,
        subjectUserId: movementAlerts.subjectUserId,
        subjectUsername: subject.username,
        subjectDisplayName: subject.displayName,
        amount: movementAlerts.amount,
        severity: movementAlerts.severity,
        details: movementAlerts.details,
        period: movementAlerts.period,
        status: movementAlerts.status,
        reviewedByUserId: movementAlerts.reviewedByUserId,
        reviewedAt: movementAlerts.reviewedAt,
        detectedAt: movementAlerts.detectedAt,
        lastUpdatedAt: movementAlerts.lastUpdatedAt,
      })
      .from(movementAlerts)
      .leftJoin(actor, eq(actor.id, movementAlerts.actorUserId))
      .leftJoin(subject, eq(subject.id, movementAlerts.subjectUserId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(movementAlerts.lastUpdatedAt))
      .limit(filters.limit)
      .offset(filters.offset);

    const totalRows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(movementAlerts)
      .where(conds.length ? and(...conds) : undefined);

    return { data: rows, total: totalRows[0]?.n ?? 0 };
  }

  async confirmAlert(
    db: TenantDb,
    id: string,
    actorUserId: string,
    scope?: Set<string>,
  ) {
    return this.review(db, id, actorUserId, 'confirmed', scope);
  }

  async dismissAlert(
    db: TenantDb,
    id: string,
    actorUserId: string,
    scope?: Set<string>,
  ) {
    return this.review(db, id, actorUserId, 'dismissed', scope);
  }

  private async review(
    db: TenantDb,
    id: string,
    actorUserId: string,
    status: 'confirmed' | 'dismissed',
    scope?: Set<string>,
  ) {
    const rows = await db
      .select()
      .from(movementAlerts)
      .where(eq(movementAlerts.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (scope && row.actorUserId && !scope.has(row.actorUserId)) return null;
    if (row.status !== 'suspected') return 'already-resolved' as const;
    await db
      .update(movementAlerts)
      .set({
        status,
        reviewedByUserId: actorUserId,
        reviewedAt: new Date(),
        lastUpdatedAt: new Date(),
      })
      .where(and(eq(movementAlerts.id, id), ne(movementAlerts.status, status)));
    return { ...row, status };
  }
}
