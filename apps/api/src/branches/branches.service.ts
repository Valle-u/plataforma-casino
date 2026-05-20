/**
 * BranchesService — Sprint 51.
 *
 * Gestiona el flag `is_independent_branch` sobre socios + la operación
 * de "venta de fichas" del tenant al socio independent.
 *
 * Modelo (decidido por dueño 2026-05-20):
 *   - Default: socios son DEPENDENT. Operan contra el banco del tenant
 *     y reciben commissions vía el flujo accrued/settle del Sprint 50.
 *   - Toggle a INDEPENDENT: el socio pasa a operar con su propio banco.
 *     El admin le configura `branchBankAccount` + `branchChipsPricePerUnit`.
 *     Las commissions upstream NO se acumulan (modelo "pago por adelantado":
 *     el socio ya pagó al comprar las fichas al precio mayorista).
 *   - Sell-chips: el admin mintea fichas DIRECTO al wallet del socio
 *     independent con source='branch_chip_sale' y reason que registra
 *     `amountFiat = amountChips * branchChipsPricePerUnit`. El intercambio
 *     real de plata es offline (el socio le transfiere al admin por fuera).
 *
 * Sensibilidad: ambas operaciones (toggle + sell) son admin-only,
 * audit severity:high. NO delegables vía override (gate de permisos).
 */

import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { roles, userRoles, users, type User } from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { WalletService } from '../wallet/wallet.service';
import {
  BranchInvalidPriceError,
  BranchNotASocioError,
  BranchNotIndependentError,
  BranchPriceNotConfiguredError,
  BranchSocioNotFoundError,
} from './branches.errors';

export interface ToggleIndependenceParams {
  socioId: string;
  isIndependent: boolean;
  branchBankAccount?: string | null;
  branchChipsPricePerUnit?: string | null;
}

export interface SellChipsParams {
  socioId: string;
  actorUserId: string;
  amountChips: string;
  idempotencyKey: string;
  notes?: string | null;
}

export interface SellChipsResult {
  socioId: string;
  amountChips: string;
  pricePerUnit: string;
  amountFiat: string;
  walletTxId: string;
  newBalance: string;
}

@Injectable()
export class BranchesService {
  constructor(private readonly walletService: WalletService) {}

  /**
   * Activa/desactiva el modo sucursal independiente para un socio.
   *
   * - Valida que el user existe y tiene rol 'socio'.
   * - Si isIndependent=true: branchBankAccount y branchChipsPricePerUnit
   *   son obligatorios y se persisten.
   * - Si isIndependent=false: limpia los dos campos.
   */
  async toggleIndependence(
    db: TenantDb,
    params: ToggleIndependenceParams,
  ): Promise<User> {
    const user = await this.assertSocio(db, params.socioId);

    if (params.isIndependent) {
      if (!params.branchBankAccount) {
        throw new BranchInvalidPriceError('branchBankAccount es obligatorio');
      }
      if (!params.branchChipsPricePerUnit) {
        throw new BranchInvalidPriceError('branchChipsPricePerUnit es obligatorio');
      }
      this.assertPriceValid(params.branchChipsPricePerUnit);
    }

    const updated = await db
      .update(users)
      .set({
        isIndependentBranch: params.isIndependent,
        branchBankAccount: params.isIndependent ? params.branchBankAccount! : null,
        branchChipsPricePerUnit: params.isIndependent
          ? params.branchChipsPricePerUnit!
          : null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id))
      .returning();
    return updated[0]!;
  }

  /**
   * Vende fichas al socio independent: mintea al wallet del socio.
   *
   * - Valida que el socio existe, es socio, está marcado independent
   *   y tiene precio configurado.
   * - Calcula amountFiat = amountChips * pricePerUnit (con 2 decimales).
   * - Mintea via WalletService.mintToWallet con idempotency garantizada
   *   por `branch_chip_sale:<idempotencyKey>`.
   */
  async sellChips(db: TenantDb, params: SellChipsParams): Promise<SellChipsResult> {
    const socio = await this.assertSocio(db, params.socioId);
    if (!socio.isIndependentBranch) {
      throw new BranchNotIndependentError(socio.id);
    }
    if (!socio.branchChipsPricePerUnit) {
      throw new BranchPriceNotConfiguredError(socio.id);
    }

    const amountChipsNum = Number(params.amountChips);
    const priceNum = Number(socio.branchChipsPricePerUnit);
    if (!isFinite(amountChipsNum) || amountChipsNum <= 0) {
      throw new BranchInvalidPriceError(`amountChips inválido: ${params.amountChips}`);
    }
    if (!isFinite(priceNum) || priceNum <= 0) {
      throw new BranchInvalidPriceError(socio.branchChipsPricePerUnit);
    }
    const amountFiat = (amountChipsNum * priceNum).toFixed(2);

    const wallet = await this.walletService.getOrCreateWalletForUser(db, socio.id);
    const idempotencyKey = `branch_chip_sale:${params.idempotencyKey}`;
    const walletTx = await this.walletService.mintToWallet(db, {
      walletId: wallet.id,
      amount: params.amountChips,
      source: 'branch_chip_sale',
      referenceId: socio.id,
      idempotencyKey,
      reason: `Venta de fichas a sucursal ${socio.username} — ${amountFiat} fiat al precio ${socio.branchChipsPricePerUnit}/ficha${params.notes ? ` — ${params.notes}` : ''}`,
      createdBy: params.actorUserId,
      counterpartyUserId: params.actorUserId,
    });

    return {
      socioId: socio.id,
      amountChips: params.amountChips,
      pricePerUnit: socio.branchChipsPricePerUnit,
      amountFiat,
      walletTxId: walletTx.id,
      newBalance: walletTx.balanceAfter,
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // helpers
  // ──────────────────────────────────────────────────────────────────────

  private async assertSocio(db: TenantDb, userId: string): Promise<User> {
    const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const user = userRows[0];
    if (!user) throw new BranchSocioNotFoundError(userId);

    const roleRows = await db
      .select({ code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(userRoles.userId, userId), eq(roles.code, 'socio')))
      .limit(1);
    if (!roleRows[0]) throw new BranchNotASocioError(userId);
    return user;
  }

  private assertPriceValid(price: string): void {
    const n = Number(price);
    if (!isFinite(n) || n <= 0) {
      throw new BranchInvalidPriceError(price);
    }
  }
}
