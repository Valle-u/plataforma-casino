/**
 * PaymentMethodsService — CRUD del catálogo de métodos de pago del tenant.
 *
 * Operaciones:
 *   - `list({ activeOnly })`: read público (user logueado del tenant).
 *   - `findById(id)`: read.
 *   - `create(params)`: crea uno nuevo. Valida code único intra-tenant.
 *   - `update(id, patch)`: update parcial. NO acepta cambiar `type` (rompería
 *     supuestos de los deposits/withdrawals con method_id apuntando a un type
 *     distinto al original — lo correcto es archive + create).
 *   - `archive(id)`: soft-delete (status='inactive'). No exponemos DELETE
 *     duro porque hay FK de deposits/withdrawals.
 *
 * `config` es JSONB libre — shape específico según `type`:
 *   - bank_transfer: { cbu, alias, beneficiario, banco? }
 *   - crypto: { network, address, memo? }
 *   - other: cualquier shape
 *
 * NO hay validación de shape en backend (jsonb libre, igual que en `bonus_
 * definitions.config`). El frontend tipa los forms por type.
 */

import { Injectable } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import {
  paymentMethods,
  type NewPaymentMethod,
  type PaymentMethod,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { isUniqueViolation } from '../common/pg-error';
import {
  PaymentMethodCodeConflictError,
  PaymentMethodNotFoundError,
} from './payment-methods.errors';

export interface ListPaymentMethodsOptions {
  /** Si true (default), filtra solo `is_active = true`. */
  activeOnly?: boolean;
  /** Filtrar por owner (NULL = tenant-level, string = node-level). */
  ownerId?: string | null;
}

export interface CreatePaymentMethodParams {
  code: string;
  name: string;
  type: 'bank_transfer' | 'crypto' | 'other';
  config?: Record<string, unknown>;
  /** Fichas por unidad de la moneda del método (ratio ficha↔plata). Default 1. */
  chipsPerUnit?: number;
  isActive?: boolean;
  /** Owner del método. NULL = tenant-level. */
  ownerId?: string | null;
}

export interface UpdatePaymentMethodParams {
  name?: string;
  config?: Record<string, unknown>;
  chipsPerUnit?: number;
  isActive?: boolean;
}

@Injectable()
export class PaymentMethodsService {
  async list(
    db: TenantDb,
    opts: ListPaymentMethodsOptions = {},
  ): Promise<PaymentMethod[]> {
    const conditions = [];

    if (opts.activeOnly !== false) {
      conditions.push(eq(paymentMethods.isActive, true));
    }

    if (opts.ownerId === undefined) {
      // Default: tenant-level only (backward compat)
      conditions.push(isNull(paymentMethods.ownerId));
    } else if (opts.ownerId === null) {
      // Explicit: tenant-level only
      conditions.push(isNull(paymentMethods.ownerId));
    } else {
      // Node-level: filter by specific owner
      conditions.push(eq(paymentMethods.ownerId, opts.ownerId));
    }

    const rows = await db
      .select()
      .from(paymentMethods)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(paymentMethods.name));
    return rows;
  }

  async findById(db: TenantDb, id: string): Promise<PaymentMethod> {
    const rows = await db
      .select()
      .from(paymentMethods)
      .where(eq(paymentMethods.id, id))
      .limit(1);
    if (!rows[0]) throw new PaymentMethodNotFoundError(id);
    return rows[0];
  }

  /**
   * Like findById but also verifies that the method belongs to the given
   * ownerId (or is tenant-level when ownerId is null). Useful for node
   * payment method operations where caller must be the owner.
   */
  async findByIdAndOwner(
    db: TenantDb,
    id: string,
    ownerId: string | null,
  ): Promise<PaymentMethod> {
    const rows = await db
      .select()
      .from(paymentMethods)
      .where(
        ownerId === null
          ? and(eq(paymentMethods.id, id), isNull(paymentMethods.ownerId))
          : and(eq(paymentMethods.id, id), eq(paymentMethods.ownerId, ownerId)),
      )
      .limit(1);
    if (!rows[0]) throw new PaymentMethodNotFoundError(id);
    return rows[0];
  }

  async create(
    db: TenantDb,
    params: CreatePaymentMethodParams,
  ): Promise<PaymentMethod> {
    const values: NewPaymentMethod = {
      code: params.code,
      name: params.name,
      type: params.type,
      ownerId: params.ownerId ?? null,
      config: params.config ?? {},
      chipsPerUnit: String(params.chipsPerUnit ?? 1),
      isActive: params.isActive ?? true,
    };
    try {
      const inserted = await db
        .insert(paymentMethods)
        .values(values)
        .returning();
      return inserted[0]!;
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        throw new PaymentMethodCodeConflictError(params.code);
      }
      throw err;
    }
  }

  async update(
    db: TenantDb,
    id: string,
    patch: UpdatePaymentMethodParams,
  ): Promise<PaymentMethod> {
    await this.findById(db, id); // 404 si no existe
    const set: Partial<NewPaymentMethod> = { updatedAt: new Date() };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.config !== undefined) set.config = patch.config;
    if (patch.chipsPerUnit !== undefined)
      set.chipsPerUnit = String(patch.chipsPerUnit);
    if (patch.isActive !== undefined) set.isActive = patch.isActive;
    const updated = await db
      .update(paymentMethods)
      .set(set)
      .where(eq(paymentMethods.id, id))
      .returning();
    return updated[0]!;
  }

  /**
   * Soft-delete: pasa `is_active=false`. No exponemos DELETE duro porque
   * los deposits/withdrawals tienen FK a payment_methods. Si querés "borrar"
   * un método, archivalo — desaparece del dropdown del jugador pero
   * mantenés referential integrity.
   */
  async archive(db: TenantDb, id: string): Promise<PaymentMethod> {
    return this.update(db, id, { isActive: false });
  }
}
