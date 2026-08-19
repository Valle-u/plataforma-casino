/**
 * BonusesExpirationService — cierre periódico de bonos expirados.
 *
 * Bonos con `status='active' AND expires_at < NOW()` quedan colgados si
 * nadie los procesa: el funder sigue con el dinero "comprometido" desde
 * el punto de vista contable (lo gastó al fondear, no lo recuperó) pero
 * el user nunca lo va a usar. Este job:
 *   1. Lista los bonos vencidos del tenant.
 *   2. Por cada uno: revert al funder + UPDATE status='expired'.
 *   3. Audit entry por cada uno.
 *
 * Diseño:
 *   - Idempotent: si el job se corre dos veces, los bonos ya 'expired'
 *     no entran al SELECT (filtramos por status='active').
 *   - Wallet revert con key `bonus_expire:<bonusId>` — el wallet UNIQUE
 *     idempotency_key lo blinda contra duplicados aún si por algún motivo
 *     el job se ejecuta concurrentemente sobre el mismo bono.
 *   - Por bono el flow es `wallet revert → update bonus`. Si el server
 *     muere entre ambos commits, el siguiente run completa (el wallet
 *     revert es idempotent, el SELECT incluye el bono porque status sigue
 *     siendo 'active').
 *   - Fallo aislado: si un bono individual falla, lo logueamos y
 *     continuamos con los demás. No abortamos todo el batch.
 *   - Batch grande: procesamos hasta `MAX_PER_RUN` bonos por invocación.
 *     Si hay más, el próximo run los toma. Evita transacciones eternas.
 *
 * Multi-tenant: el caller (cron) itera tenants activos y llama
 * `expireDueForTenant(tenantDb)` por cada uno.
 */

import { Injectable, Logger } from '@nestjs/common';
import { and, eq, lt } from 'drizzle-orm';
import { userBonuses, type UserBonus } from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { WalletService } from '../wallet/wallet.service';
import { AuditLogService } from '../audit/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';

const MAX_PER_RUN = 500;

export interface ExpirationRunResult {
  totalProcessed: number;
  succeeded: number;
  failed: number;
  /** ids de bonos donde el revert falló (loguear + revisar). */
  failedIds: string[];
}

@Injectable()
export class BonusesExpirationService {
  private readonly logger = new Logger(BonusesExpirationService.name);

  constructor(
    private readonly walletService: WalletService,
    private readonly audit: AuditLogService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Cierra todos los bonos `active` con `expires_at < NOW()` en el tenant
   * provisto. Procesa hasta `MAX_PER_RUN` por invocación.
   */
  async expireDueForTenant(db: TenantDb): Promise<ExpirationRunResult> {
    const now = new Date();
    const due = await db
      .select()
      .from(userBonuses)
      .where(and(eq(userBonuses.status, 'active'), lt(userBonuses.expiresAt, now)))
      .limit(MAX_PER_RUN);

    if (due.length === 0) {
      return { totalProcessed: 0, succeeded: 0, failed: 0, failedIds: [] };
    }

    this.logger.log(`Expiration: procesando ${due.length} bonos vencidos.`);

    let succeeded = 0;
    let failed = 0;
    const failedIds: string[] = [];

    for (const bonus of due) {
      try {
        await this.expireOne(db, bonus);
        succeeded += 1;
      } catch (err) {
        failed += 1;
        failedIds.push(bonus.id);
        this.logger.error(
          `Expiration de bono ${bonus.id} falló: ${(err as Error).message}`,
        );
        // Audit del fallo para que el Admin Tenant lo vea en panel.
        try {
          await this.audit.record(db, {
            actorUserId: null,
            actorUsername: null,
            actionCode: 'bonus.expire_failed',
            targetType: 'user_bonus',
            targetId: bonus.id,
            metadata: {
              severity: 'high',
              error: (err as Error).message,
              userId: bonus.userId,
              fundedByUserId: bonus.fundedByUserId,
            },
            requestId: null,
            ip: null,
            userAgent: null,
            sessionId: null,
          });
        } catch {
          // Si el audit log mismo falla, no romper más el flow.
        }
      }
    }

    this.logger.log(
      `Expiration: total=${due.length} ok=${succeeded} failed=${failed}`,
    );
    return {
      totalProcessed: due.length,
      succeeded,
      failed,
      failedIds,
    };
  }

  /**
   * Procesa un único bono: reversa al funder (si remaining > 0) y marca
   * como expired. Cada paso es idempotent — re-run del job no duplica.
   */
  private async expireOne(db: TenantDb, bonus: UserBonus): Promise<void> {
    // Auditoría económica #3/#8: solo se revierte/saca lo que REALMENTE queda
    // del bono en la pool del jugador. `remainingAmount` no baja al apostar
    // (el bet consume `bonus_balance` fungible), así que confiar en él
    // sobre-reintegraba al funder (#3) y NO limpiaba al jugador (#8). Tomamos
    // el mínimo entre `remaining` y el `bonus_balance` actual del jugador.
    const playerWallet = await this.walletService.getOrCreateWalletForUser(
      db,
      bonus.userId,
    );
    const revertCents = Math.min(
      this.toCents(bonus.remainingAmount),
      this.toCents(playerWallet.bonusBalance ?? '0'),
    );
    const revertAmount = this.fromCents(revertCents);

    await db.transaction(async (tx) => {
      const txDb = tx as unknown as TenantDb;
      if (revertCents > 0) {
        // #8: sacar las fichas de bono del jugador (antes se le quedaban).
        await this.walletService.debitBonusBalance(txDb, {
          walletId: playerWallet.id,
          amount: revertAmount,
          idempotencyKey: `bonus_expire_debit:${bonus.id}`,
          actorUserId: bonus.userId,
          reason: `Expiración de bono ${bonus.id}`,
          counterpartyUserId: bonus.fundedByUserId,
        });
        // #3: devolver al funder SOLO lo que quedaba (no el monto original).
        const funderWallet = await this.walletService.getOrCreateWalletForUser(
          txDb,
          bonus.fundedByUserId,
        );
        await this.walletService.executeBonusFundingRevert(txDb, {
          walletId: funderWallet.id,
          amount: revertAmount,
          // Key idempotente — re-run del job no duplica el revert.
          idempotencyKey: `bonus_expire:${bonus.id}`,
          // No hay actor humano.
          actorUserId: bonus.fundedByUserId,
          reason: `Expiración automática de bono ${bonus.id}`,
          counterpartyUserId: bonus.userId,
          relatedTxId: bonus.fundingTxId,
        });
      }

      // UPDATE con guarda WHERE status='active' por si el bono fue
      // cancelado/clearado entre el SELECT y este UPDATE (raro pero defensivo).
      await tx
        .update(userBonuses)
        .set({
          status: 'expired',
          remainingAmount: '0.00',
          updatedAt: new Date(),
        })
        .where(
          and(eq(userBonuses.id, bonus.id), eq(userBonuses.status, 'active')),
        );
    });

    await this.audit.record(db, {
      actorUserId: null,
      actorUsername: null,
      actionCode: 'bonus.expired',
      targetType: 'user_bonus',
      targetId: bonus.id,
      before: { status: 'active', remainingAmount: bonus.remainingAmount },
      after: { status: 'expired', remainingAmount: '0.00' },
      metadata: {
        severity: 'medium',
        userId: bonus.userId,
        fundedByUserId: bonus.fundedByUserId,
        reverted: this.fromCents(revertCents),
      },
      requestId: null,
      ip: null,
      userAgent: null,
      sessionId: null,
    });

    // Notif al user: "tu bono expiró". Fail-soft — el bono ya está
    // marcado expired y el funder recibió su revert; la notif es UX.
    for (const channel of ['in_app', 'email'] as const) {
      try {
        await this.notifications.enqueue(db, {
          userId: bonus.userId,
          kind: 'bonus_expired',
          channel,
          payload: {
            bonusId: bonus.id,
            remainingAmount: bonus.remainingAmount,
          },
        });
      } catch (err) {
        this.logger.error(
          `Notif bonus_expired (${channel}) falló user=${bonus.userId} bonus=${bonus.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Helpers (duplicados de UserBonusesService — extraer a util cuando
  // empiecen a aparecer en más lugares).
  // ──────────────────────────────────────────────────────────────────────

  private toCents(amount: string): number {
    const [int, dec = ''] = amount.split('.');
    const decPadded = (dec + '00').slice(0, 2);
    return Number(int) * 100 + Number(decPadded);
  }

  private fromCents(cents: number): string {
    const sign = cents < 0 ? '-' : '';
    const abs = Math.abs(cents);
    const int = Math.floor(abs / 100);
    const dec = (abs % 100).toString().padStart(2, '0');
    return `${sign}${int}.${dec}`;
  }
}
