/**
 * BankAccountsService — las cuentas bancarias PROPIAS del tenant.
 *
 * Por qué existe: al cargar una transferencia, el titular y el banco de nuestra
 * cuenta se escribían a mano en dos cajas de texto libre. Nada impedía poner ahí
 * un tercero, y es lo que pasó — en producción quedó una entrante con
 * `account_holder = 'Juan Pérez'`, que en las otras seis filas es el
 * `sender_name` (el que envía).
 *
 * Acá se definen una vez; el formulario de transferencias las elige de una
 * lista. Ver migración 0108.
 */

import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { bankAccounts, type BankAccount } from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';

export interface UpsertBankAccountInput {
  label: string;
  accountHolder: string;
  bankName: string;
  accountIdentifier?: string | null;
}

/** Postgres: violación de índice único. */
const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur; i += 1) {
    if ((cur as { code?: unknown }).code === UNIQUE_VIOLATION) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

@Injectable()
export class BankAccountsService {
  /**
   * Lista las cuentas. Por default solo las ACTIVAS — es lo que necesita el
   * selector del formulario. El panel de administración pide también las dadas
   * de baja para poder reactivarlas.
   */
  async list(
    db: TenantDb,
    opts: { includeInactive?: boolean } = {},
  ): Promise<BankAccount[]> {
    const where = opts.includeInactive
      ? undefined
      : eq(bankAccounts.isActive, true);
    const q = db.select().from(bankAccounts).orderBy(asc(bankAccounts.label));
    return where ? q.where(where) : q;
  }

  async create(
    db: TenantDb,
    actorId: string,
    input: UpsertBankAccountInput,
  ): Promise<BankAccount> {
    try {
      const rows = await db
        .insert(bankAccounts)
        .values({
          label: input.label.trim(),
          accountHolder: input.accountHolder.trim(),
          bankName: input.bankName.trim(),
          accountIdentifier: input.accountIdentifier?.trim() || null,
          createdBy: actorId,
        })
        .returning();
      return rows[0]!;
    } catch (err) {
      // El índice único es sobre (titular, banco, identificador) de las
      // ACTIVAS. Dos cuentas iguales serían indistinguibles en el selector y se
      // elegiría cualquiera.
      if (isUniqueViolation(err)) {
        throw new ConflictException({
          message:
            'Ya existe una cuenta activa con ese titular, banco e identificador.',
          error: 'BANK_ACCOUNT_DUPLICATE',
        });
      }
      throw err;
    }
  }

  async update(
    db: TenantDb,
    id: string,
    input: Partial<UpsertBankAccountInput>,
  ): Promise<BankAccount> {
    await this.getOrThrow(db, id);
    try {
      const rows = await db
        .update(bankAccounts)
        .set({
          ...(input.label !== undefined ? { label: input.label.trim() } : {}),
          ...(input.accountHolder !== undefined
            ? { accountHolder: input.accountHolder.trim() }
            : {}),
          ...(input.bankName !== undefined
            ? { bankName: input.bankName.trim() }
            : {}),
          ...(input.accountIdentifier !== undefined
            ? { accountIdentifier: input.accountIdentifier?.trim() || null }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(bankAccounts.id, id))
        .returning();
      return rows[0]!;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({
          message:
            'Ya existe una cuenta activa con ese titular, banco e identificador.',
          error: 'BANK_ACCOUNT_DUPLICATE',
        });
      }
      throw err;
    }
  }

  /**
   * Baja y alta lógica. Nunca se borra: las transferencias viejas se cargaron
   * con esta cuenta y borrarla dejaría huérfano un dato de auditoría de plata
   * real. Una cuenta inactiva no se ofrece al cargar, pero las transferencias
   * que la usaron la siguen mostrando.
   */
  async setActive(
    db: TenantDb,
    id: string,
    isActive: boolean,
  ): Promise<BankAccount> {
    await this.getOrThrow(db, id);
    try {
      const rows = await db
        .update(bankAccounts)
        .set({ isActive, updatedAt: new Date() })
        .where(eq(bankAccounts.id, id))
        .returning();
      return rows[0]!;
    } catch (err) {
      // Reactivar puede chocar con otra cuenta activa igual creada mientras
      // esta estaba de baja.
      if (isUniqueViolation(err)) {
        throw new ConflictException({
          message:
            'No se puede reactivar: ya hay otra cuenta activa con ese titular, banco e identificador.',
          error: 'BANK_ACCOUNT_DUPLICATE',
        });
      }
      throw err;
    }
  }

  /** Una cuenta ACTIVA por id. Lo usa el alta de transferencias al copiar. */
  async getActive(db: TenantDb, id: string): Promise<BankAccount | null> {
    const rows = await db
      .select()
      .from(bankAccounts)
      .where(and(eq(bankAccounts.id, id), eq(bankAccounts.isActive, true)))
      .limit(1);
    return rows[0] ?? null;
  }

  private async getOrThrow(db: TenantDb, id: string): Promise<BankAccount> {
    const rows = await db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw new NotFoundException({
        message: 'Cuenta bancaria no encontrada.',
        error: 'BANK_ACCOUNT_NOT_FOUND',
      });
    }
    return row;
  }
}
