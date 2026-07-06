/**
 * EmployeeSalariesService — CRUD sobre la tabla `employee_salaries`.
 *
 * Reglas de negocio:
 *   - El monto se guarda como string (numeric 20,2). El input llega como
 *     number desde el DTO; convertimos a string con 2 decimales fijos para
 *     no depender del formatter de Postgres.
 *   - `upsert()` es idempotente por PK (userId). Devuelve el estado antes/
 *     después (para audit) + un flag `changed` que indica si hubo cambio
 *     real (útil para no ensuciar audit con no-ops).
 *   - `list()` pagina por offset. Orden por `updated_at DESC` (más recientes
 *     primero) — es la vista "sueldos recientes que revisó el admin".
 *
 * El service NO valida rol / hierarquia del target — eso lo hace el
 * controller (permisos + rol admin-only). Nuestro trabajo acá es puro
 * data-access + normalización de tipos.
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { employeeSalaries, users, type EmployeeSalary } from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';

export interface UpsertSalaryParams {
  userId: string;
  monthlyAmount: number;
  currency?: string;
  notes?: string | null;
  updatedBy: string;
}

export interface UpsertSalaryResult {
  before: EmployeeSalary | null;
  after: EmployeeSalary;
  changed: boolean;
}

export interface SalaryListRow {
  userId: string;
  username: string;
  displayName: string;
  monthlyAmount: string;
  currency: string;
  updatedAt: Date;
  updatedBy: string | null;
  updatedByUsername: string | null;
  notes: string | null;
}

@Injectable()
export class EmployeeSalariesService {
  /** Devuelve la fila del sueldo del user o null. */
  async findByUserId(
    db: TenantDb,
    userId: string,
  ): Promise<EmployeeSalary | null> {
    const rows = await db
      .select()
      .from(employeeSalaries)
      .where(eq(employeeSalaries.userId, userId))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Upsert por PK. Devuelve before + after + `changed` (true si hubo cambio
   * real vs. before). Un upsert que no cambia nada (mismo monto, misma
   * currency, mismas notas) se considera changed=false — el controller
   * decide si loguear audit o no.
   */
  async upsert(
    db: TenantDb,
    params: UpsertSalaryParams,
  ): Promise<UpsertSalaryResult> {
    // Verificamos que el user exista (404 amigable, no 500 por FK).
    const userRows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, params.userId))
      .limit(1);
    if (userRows.length === 0) {
      throw new NotFoundException(`User ${params.userId} no existe.`);
    }

    const before = await this.findByUserId(db, params.userId);
    const amountStr = params.monthlyAmount.toFixed(2);
    const currency = params.currency ?? 'ARS';
    const now = new Date();

    const inserted = await db
      .insert(employeeSalaries)
      .values({
        userId: params.userId,
        monthlyAmount: amountStr,
        currency,
        notes: params.notes ?? null,
        updatedBy: params.updatedBy,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: employeeSalaries.userId,
        set: {
          monthlyAmount: amountStr,
          currency,
          notes: params.notes ?? null,
          updatedBy: params.updatedBy,
          updatedAt: now,
        },
      })
      .returning();

    const after = inserted[0];
    if (!after) {
      throw new Error('Upsert employee_salary falló sin error explícito.');
    }

    // "Cambio real" ignora updated_at/updated_by (que siempre cambian).
    const changed =
      !before ||
      before.monthlyAmount !== after.monthlyAmount ||
      before.currency !== after.currency ||
      (before.notes ?? null) !== (after.notes ?? null);

    return { before, after, changed };
  }

  /**
   * Lista paginada de sueldos. Orden `updated_at DESC`. Filtro opcional
   * `hasSalary`: si true (default), solo devuelve rows con monthly_amount > 0
   * (los que efectivamente cobran). Si false, incluye los que están en 0
   * (sueldo "puesto a cero" explícito). Users sin fila en la tabla nunca
   * aparecen — la lista es por sueldos existentes, no por users.
   */
  async list(
    db: TenantDb,
    params: { limit: number; offset: number; hasSalary?: boolean } = {
      limit: 50,
      offset: 0,
    },
  ): Promise<{ data: SalaryListRow[]; total: number }> {
    const limit = Math.min(Math.max(params.limit, 1), 200);
    const offset = Math.max(params.offset, 0);
    const hasSalary = params.hasSalary ?? true;

    const conditions = [];
    if (hasSalary) {
      conditions.push(sql`${employeeSalaries.monthlyAmount} > 0`);
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Self-join con users para el username del target + LEFT JOIN al user
    // del actor (updated_by) para su username.
    const [rows, totalRows] = await Promise.all([
      db
        .select({
          userId: employeeSalaries.userId,
          username: users.username,
          displayName: users.displayName,
          monthlyAmount: employeeSalaries.monthlyAmount,
          currency: employeeSalaries.currency,
          updatedAt: employeeSalaries.updatedAt,
          updatedBy: employeeSalaries.updatedBy,
          notes: employeeSalaries.notes,
        })
        .from(employeeSalaries)
        .innerJoin(users, eq(users.id, employeeSalaries.userId))
        .where(whereClause)
        .orderBy(desc(employeeSalaries.updatedAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ n: count() })
        .from(employeeSalaries)
        .where(whereClause),
    ]);

    // Segunda query batched para resolver los usernames de los updatedBy.
    const updaterIds = [
      ...new Set(
        rows.map((r) => r.updatedBy).filter((v): v is string => !!v),
      ),
    ];
    const updaterMap = new Map<string, string>();
    if (updaterIds.length > 0) {
      const upRows = await db
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(
          sql`${users.id} IN (${sql.join(
            updaterIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        );
      for (const r of upRows) updaterMap.set(r.id, r.username);
    }

    const data: SalaryListRow[] = rows.map((r) => ({
      userId: r.userId,
      username: r.username,
      displayName: r.displayName,
      monthlyAmount: r.monthlyAmount,
      currency: r.currency,
      updatedAt: r.updatedAt,
      updatedBy: r.updatedBy,
      updatedByUsername: r.updatedBy ? updaterMap.get(r.updatedBy) ?? null : null,
      notes: r.notes,
    }));

    return {
      data,
      total: Number(totalRows[0]?.n ?? 0),
    };
  }
}
