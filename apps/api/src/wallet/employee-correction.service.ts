/**
 * EmployeeCorrectionService — cargas manuales por corrección/bonificación/
 * reintegro que hace un EMPLEADO con permiso `wallet.correct`, contra su cupo
 * mensual (docs/19-cupo-empleado.md).
 *
 * Reglas:
 *   - Las fichas salen de la Casa (drena su saldo). El cupo es un TECHO, no un
 *     stock: `Σ(wallet_transactions.amount WHERE source='employee_correction'
 *     AND created_by = actor AND created_at >= inicio del mes UTC)` no puede
 *     superar `users.employee_correction_cap_monthly` del actor.
 *   - Siempre a un cliente específico (targetUserId obligatorio, no puede ser
 *     la Casa ni el propio actor).
 *   - Motivo obligatorio (dropdown). Si es 'other', el texto libre es obligatorio.
 *   - Atómico: valida cupo + transfer Casa→cliente + audit en una sola tx.
 */

import { Injectable } from '@nestjs/common';
import { and, eq, gt, gte, sql } from 'drizzle-orm';
import {
  HOUSE_USERNAME,
  users,
  walletTransactions,
  type WalletTransaction,
} from '@casino/db';
import { HouseService } from '../house/house.service';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { WalletService } from './wallet.service';

export type CorrectionReasonType = 'correction' | 'bonus' | 'refund' | 'other';

export const CORRECTION_REASON_TYPES: CorrectionReasonType[] = [
  'correction',
  'bonus',
  'refund',
  'other',
];

/** El empleado no tiene cupo configurado (0 = sin permiso implícito). */
export class NoCorrectionCapError extends Error {
  constructor() {
    super('El empleado no tiene un cupo configurado para cargas por corrección.');
    this.name = 'NoCorrectionCapError';
  }
}

/** El empleado ya usó su cupo del mes. */
export class CorrectionCapExceededError extends Error {
  constructor(
    public readonly cap: string,
    public readonly used: string,
    public readonly remaining: string,
    public readonly requested: string,
  ) {
    super(
      `Cupo mensual insuficiente: usado ${used} de ${cap}, quedan ${remaining}, se pedían ${requested}.`,
    );
    this.name = 'CorrectionCapExceededError';
  }
}

/** El destino no puede ser el propio actor ni la Casa. */
export class InvalidCorrectionTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCorrectionTargetError';
  }
}

export interface CorrectionStatus {
  /** Cupo mensual configurado. '0' = sin permiso. */
  cap: string;
  /** Consumido este mes UTC. */
  used: string;
  /** Restante (cap - used, mínimo 0). */
  remaining: string;
}

export interface CorrectionParams {
  actorUserId: string;
  targetUserId: string;
  amount: string;
  reasonType: CorrectionReasonType;
  reasonNotes?: string | null;
  idempotencyKey: string;
}

@Injectable()
export class EmployeeCorrectionService {
  constructor(
    private readonly wallet: WalletService,
    private readonly house: HouseService,
  ) {}

  /**
   * Estado del cupo del empleado: cap configurado, consumido este mes,
   * restante. UTC-based (docs/19). Devuelve `cap='0'` si no está configurado.
   */
  async getStatus(db: TenantDb, employeeUserId: string): Promise<CorrectionStatus> {
    const rows = await db
      .select({ cap: users.employeeCorrectionCapMonthly })
      .from(users)
      .where(eq(users.id, employeeUserId))
      .limit(1);
    const cap = rows[0]?.cap ?? '0';

    const used = await this.sumUsedThisMonth(db, employeeUserId);
    const remaining = maxDecimal(subDecimal(cap, used), '0');
    return { cap, used, remaining };
  }

  /** Suma de cargas por corrección hechas por este empleado en el mes UTC actual. */
  private async sumUsedThisMonth(
    db: TenantDb,
    employeeUserId: string,
  ): Promise<string> {
    const start = startOfMonthUtc(new Date());
    // Solo la pata del CRÉDITO al cliente (type='adjustment'), no la del
    // DÉBITO de la Casa (type='transfer_out') — ambos comparten source y
    // createdBy, así que sin este filtro contamos el doble.
    const rows = await db
      .select({
        total: sql<string>`COALESCE(SUM(${walletTransactions.amount}), 0)::text`,
      })
      .from(walletTransactions)
      .where(
        and(
          eq(walletTransactions.source, 'employee_correction'),
          eq(walletTransactions.type, 'adjustment'),
          eq(walletTransactions.createdBy, employeeUserId),
          gte(walletTransactions.createdAt, start),
        ),
      );
    return rows[0]?.total ?? '0';
  }

  /**
   * Lista los empleados con cupo > 0, con su consumo y restante del mes.
   * Pensado para el panel admin de tesorería (docs/19). El propio actor NO
   * queda excluido (si tiene cupo, aparece).
   */
  async listEmployeesWithCap(
    db: TenantDb,
  ): Promise<
    Array<{
      userId: string;
      username: string;
      displayName: string;
      cap: string;
      used: string;
      remaining: string;
    }>
  > {
    const list = await db
      .select({
        userId: users.id,
        username: users.username,
        displayName: users.displayName,
        cap: users.employeeCorrectionCapMonthly,
      })
      .from(users)
      .where(
        and(
          gt(users.employeeCorrectionCapMonthly, '0'),
          eq(users.isSystem, false),
        ),
      )
      .orderBy(users.username);

    // N+1 controlado: N es "empleados con cupo > 0", típicamente decenas. El
    // SUM correlacionado por-fila fallaba en Postgres con `users.id` (ambigüedad
    // de scope en subquery). Este approach reusa el `sumUsedThisMonth` probado.
    return await Promise.all(
      list.map(async (r) => {
        const used = await this.sumUsedThisMonth(db, r.userId);
        return {
          ...r,
          used,
          remaining: maxDecimal(subDecimal(r.cap, used), '0'),
        };
      }),
    );
  }

  /**
   * Ejecuta la corrección: Casa → cliente, dentro del cupo del empleado.
   * Atómico. Idempotente por `idempotencyKey`.
   */
  async apply(
    db: TenantDb,
    params: CorrectionParams,
  ): Promise<WalletTransaction> {
    // 1. Validar motivo 'other' -> notes obligatorio.
    if (params.reasonType === 'other' && !params.reasonNotes?.trim()) {
      throw new InvalidCorrectionTargetError(
        'Motivo "other" requiere texto libre (reasonNotes).',
      );
    }

    // 2. Validar target != actor y target != Casa.
    if (params.targetUserId === params.actorUserId) {
      throw new InvalidCorrectionTargetError(
        'No podés cargarte fichas a vos mismo.',
      );
    }
    const targetRows = await db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(eq(users.id, params.targetUserId))
      .limit(1);
    const target = targetRows[0];
    if (!target) {
      throw new InvalidCorrectionTargetError('El cliente destino no existe.');
    }
    if (target.username === HOUSE_USERNAME) {
      throw new InvalidCorrectionTargetError(
        'No podés cargar fichas a la Casa por corrección.',
      );
    }

    // 3. Validar cupo del actor.
    const status = await this.getStatus(db, params.actorUserId);
    if (cmpDecimal(status.cap, '0') === 0) {
      throw new NoCorrectionCapError();
    }
    if (cmpDecimal(status.remaining, params.amount) < 0) {
      throw new CorrectionCapExceededError(
        status.cap,
        status.used,
        status.remaining,
        params.amount,
      );
    }

    // 4. Transferir Casa → cliente en una sola tx. Uso executeTransferPair del
    //    WalletService: la casa es sourceUserId (system user __casa__), el
    //    cliente es targetUserId, targetType='adjustment', source='employee_correction'.
    //    La suma del cupo del mes se recomputa mirando esas rows.
    const houseUser = await this.house.getHouseUser(db);
    if (!houseUser) {
      // muy raro — el HouseService debería haber lanzado antes.
      throw new Error('La Casa no está provisionada.');
    }

    const reason = this.formatReason(params.reasonType, params.reasonNotes);

    const result = await this.wallet.executeTransferPair(db, {
      actorUserId: params.actorUserId,
      sourceUserId: houseUser.id,
      targetUserId: params.targetUserId,
      amount: params.amount,
      sourceType: 'transfer_out',
      targetType: 'adjustment',
      source: 'employee_correction',
      idempotencyKey: params.idempotencyKey,
      reason,
      notes: params.reasonNotes ?? null,
    });
    return result.targetTx;
  }

  private formatReason(
    type: CorrectionReasonType,
    notes: string | null | undefined,
  ): string {
    const label = {
      correction: 'Corrección por error de plataforma',
      bonus: 'Bonificación / cortesía',
      refund: 'Reintegro por retiro no procesado',
      other: 'Otro',
    }[type];
    if (notes?.trim()) return `${label}: ${notes.trim()}`;
    return label;
  }
}

// ─── Helpers de decimales string (evitar float) ─────────────────────────────

/** a - b como string numeric con 2 decimales. */
function subDecimal(a: string, b: string): string {
  return (toCents(a) - toCents(b)) / 100 === 0
    ? '0'
    : ((toCents(a) - toCents(b)) / 100).toFixed(2);
}

function maxDecimal(a: string, b: string): string {
  return cmpDecimal(a, b) >= 0 ? a : b;
}

/** -1 si a<b, 0 si a==b, 1 si a>b. */
function cmpDecimal(a: string, b: string): number {
  const ca = toCents(a);
  const cb = toCents(b);
  return ca === cb ? 0 : ca < cb ? -1 : 1;
}

function toCents(v: string): number {
  const n = Number(v);
  return Math.round(n * 100);
}

function startOfMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}
