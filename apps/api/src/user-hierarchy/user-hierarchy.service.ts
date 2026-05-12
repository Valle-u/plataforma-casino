/**
 * UserHierarchyService — gestión de la red parent → child de un tenant.
 *
 * Operaciones clave:
 *   - `setParent`: asigna o cambia el parent activo de un user. Cierra
 *     la fila anterior con `until = now()` y crea una nueva con
 *     `until = NULL`. Atómico.
 *   - `clearParent`: cierra la fila activa sin abrir nueva (el user
 *     queda sin parent — root).
 *   - `getActiveParent`: lee el parent actual.
 *   - `getActiveAncestors`: lista todos los ancestros vía recursión SQL.
 *   - `getActiveDescendants`: lista toda la red bajo un user.
 *   - `isAncestorOf`: verifica si ancestor está en la chain de descendant.
 *
 * Anti-ciclo: antes de setear un parent, verificamos que el nuevo parent
 * NO sea un descendant del user. Sino crearíamos circular A→B y B→A.
 *
 * Self-parent rechazado explícitamente.
 *
 * Histórico: las filas viejas (con `until` no NULL) NUNCA se borran.
 * Se pueden consultar para reconstruir relaciones del pasado.
 */

import { Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  generateUuidV7,
  userHierarchy,
  type UserHierarchy,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import {
  HierarchyCycleError,
  SelfParentError,
} from './user-hierarchy.errors';

export interface SetParentParams {
  userId: string;
  parentUserId: string;
  relationType: string;
  actorUserId: string;
}

@Injectable()
export class UserHierarchyService {
  /**
   * Asigna o cambia el parent activo del user. Cierra la fila anterior
   * (si existía) e inserta una nueva. Todo dentro de TX postgres.
   */
  async setParent(db: TenantDb, params: SetParentParams): Promise<UserHierarchy> {
    if (params.userId === params.parentUserId) {
      throw new SelfParentError();
    }

    // Anti-ciclo: el nuevo parent NO debe estar entre los descendants
    // actuales del user. Si lo está, asignarlo crearía un ciclo.
    const wouldCycle = await this.isAncestorOf(db, params.userId, params.parentUserId);
    if (wouldCycle) {
      throw new HierarchyCycleError(params.userId, params.parentUserId);
    }

    return db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);

      // Cerrar fila activa anterior, si existe.
      await tx
        .update(userHierarchy)
        .set({ until: new Date() })
        .where(
          and(
            eq(userHierarchy.userId, params.userId),
            isNull(userHierarchy.until),
          ),
        );

      // Insertar nueva fila activa.
      const inserted = await tx
        .insert(userHierarchy)
        .values({
          id: generateUuidV7(),
          userId: params.userId,
          parentUserId: params.parentUserId,
          relationType: params.relationType,
          createdBy: params.actorUserId,
        })
        .returning();
      return inserted[0]!;
    });
  }

  /**
   * Cierra el parent activo del user sin abrir uno nuevo. El user queda
   * como "root". Idempotente: si ya no tenía parent activo, no hace nada.
   */
  async clearParent(db: TenantDb, userId: string): Promise<void> {
    await db
      .update(userHierarchy)
      .set({ until: new Date() })
      .where(and(eq(userHierarchy.userId, userId), isNull(userHierarchy.until)));
  }

  /** Devuelve la fila activa de hierarchy del user, o null si no tiene. */
  async getActiveParent(db: TenantDb, userId: string): Promise<UserHierarchy | null> {
    const rows = await db
      .select()
      .from(userHierarchy)
      .where(and(eq(userHierarchy.userId, userId), isNull(userHierarchy.until)))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Devuelve los IDs de TODOS los ancestros activos del user (parent,
   * grandparent, etc.) usando WITH RECURSIVE.
   */
  async getActiveAncestors(db: TenantDb, userId: string): Promise<string[]> {
    const result = await db.execute(sql`
      WITH RECURSIVE ancestors AS (
        SELECT parent_user_id
        FROM user_hierarchy
        WHERE user_id = ${userId} AND until IS NULL AND parent_user_id IS NOT NULL
        UNION
        SELECT uh.parent_user_id
        FROM user_hierarchy uh
        INNER JOIN ancestors a ON uh.user_id = a.parent_user_id
        WHERE uh.until IS NULL AND uh.parent_user_id IS NOT NULL
      )
      SELECT parent_user_id FROM ancestors
    `);
    const rows = ((result as unknown as { rows?: Array<{ parent_user_id: string }> }).rows ??
      (result as unknown as Array<{ parent_user_id: string }>)) as Array<{
      parent_user_id: string;
    }>;
    return rows.map((r) => r.parent_user_id);
  }

  /**
   * Devuelve los IDs de TODOS los descendants activos del user (children,
   * grandchildren, etc.). BFS recursivo via SQL.
   */
  async getActiveDescendants(db: TenantDb, parentUserId: string): Promise<string[]> {
    const result = await db.execute(sql`
      WITH RECURSIVE descendants AS (
        SELECT user_id
        FROM user_hierarchy
        WHERE parent_user_id = ${parentUserId} AND until IS NULL
        UNION
        SELECT uh.user_id
        FROM user_hierarchy uh
        INNER JOIN descendants d ON uh.parent_user_id = d.user_id
        WHERE uh.until IS NULL
      )
      SELECT user_id FROM descendants
    `);
    const rows = ((result as unknown as { rows?: Array<{ user_id: string }> }).rows ??
      (result as unknown as Array<{ user_id: string }>)) as Array<{ user_id: string }>;
    return rows.map((r) => r.user_id);
  }

  /**
   * True si `ancestorId` es ancestor activo (directo o indirecto) de
   * `descendantId`. False si no hay relación o si descendantId === ancestorId.
   */
  async isAncestorOf(
    db: TenantDb,
    ancestorId: string,
    descendantId: string,
  ): Promise<boolean> {
    if (ancestorId === descendantId) return false;
    const ancestors = await this.getActiveAncestors(db, descendantId);
    return ancestors.includes(ancestorId);
  }
}
