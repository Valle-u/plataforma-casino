/**
 * PaymentMethodsService — lectura del catálogo de métodos de pago del tenant.
 *
 * Operaciones MVP:
 *   - `list({ activeOnly })`: devuelve los métodos configurados. Se usa
 *     en el frontend tanto en el panel admin (sumar al config futuro)
 *     como en la app player (form de depósito/retiro).
 *
 * Sin mutations en MVP: la config inicial se hace via SQL/seed. CRUD admin
 * de payment_methods queda para sprint futuro cuando emerja necesidad real.
 */

import { Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { paymentMethods, type PaymentMethod } from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';

export interface ListPaymentMethodsOptions {
  /** Si true (default), filtra solo `is_active = true`. */
  activeOnly?: boolean;
}

@Injectable()
export class PaymentMethodsService {
  async list(
    db: TenantDb,
    opts: ListPaymentMethodsOptions = {},
  ): Promise<PaymentMethod[]> {
    const activeOnly = opts.activeOnly !== false;
    const rows = activeOnly
      ? await db
          .select()
          .from(paymentMethods)
          .where(eq(paymentMethods.isActive, true))
          .orderBy(asc(paymentMethods.name))
      : await db
          .select()
          .from(paymentMethods)
          .orderBy(asc(paymentMethods.name));
    return rows;
  }
}
