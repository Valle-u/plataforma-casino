/**
 * TenantSettingsService — key-value config bag por tenant.
 *
 * API:
 *   - `get<T>(db, key)`: devuelve el value parseado o `undefined` si no
 *     existe.
 *   - `getNumeric(db, key, defaultValue)`: convenience para settings
 *     numéricos (e.g. thresholds). Si no existe o no es número, default.
 *   - `set(db, key, value, actorId)`: upsert. Cualquier JSON serializable.
 *   - `list(db)`: lista todos los settings para el panel admin.
 *
 * Sin cache para MVP — queries son O(1) por PK index. Si crece tráfico:
 * cachear en-memory con TTL corto e invalidación on-set.
 */

import { Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import {
  tenantSettings,
  tenantSettingsHistory,
  type NewTenantSetting,
  type NewTenantSettingHistory,
  type TenantSetting,
  type TenantSettingHistory,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';

@Injectable()
export class TenantSettingsService {
  /**
   * Devuelve el value del setting. Si no existe, retorna undefined.
   * El caller hace el cast — JSONB puede contener cualquier shape.
   */
  async get<T = unknown>(db: TenantDb, key: string): Promise<T | undefined> {
    const rows = await db
      .select({ value: tenantSettings.value })
      .from(tenantSettings)
      .where(eq(tenantSettings.key, key))
      .limit(1);
    if (!rows[0]) return undefined;
    return rows[0].value as T;
  }

  /**
   * Convenience: lee un setting numérico. Si no existe o no es número
   * válido, retorna `defaultValue`. Useful para thresholds, limits, etc.
   */
  async getNumeric(
    db: TenantDb,
    key: string,
    defaultValue: number,
  ): Promise<number> {
    const v = await this.get<unknown>(db, key);
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    // Postgres jsonb numéricos pueden volver como string en algunos
    // drivers — defensivo.
    if (typeof v === 'string') {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    return defaultValue;
  }

  /**
   * Upsert. `actorUserId` queda en `updated_by_user_id` para audit.
   *
   * Atomico via `db.transaction`: el upsert + el insert en history se
   * comitean juntos. Sin esto, un crash entre los dos statements
   * podría dejar el setting actualizado sin entry de history (drift).
   */
  async set(
    db: TenantDb,
    key: string,
    value: unknown,
    actorUserId: string,
  ): Promise<TenantSetting> {
    return db.transaction(async (tx) => {
      // 1. Leer el previous value para el history (puede ser undefined).
      const prevRow = await tx
        .select({ value: tenantSettings.value })
        .from(tenantSettings)
        .where(eq(tenantSettings.key, key))
        .limit(1);
      const previousValue = prevRow[0]?.value;

      // 2. Upsert.
      const row: NewTenantSetting = {
        key,
        value: value as object,
        updatedByUserId: actorUserId,
        updatedAt: new Date(),
      };
      const result = await tx
        .insert(tenantSettings)
        .values(row)
        .onConflictDoUpdate({
          target: tenantSettings.key,
          set: {
            value: row.value,
            updatedByUserId: actorUserId,
            updatedAt: new Date(),
          },
        })
        .returning();

      // 3. History insert (append-only).
      const historyRow: NewTenantSettingHistory = {
        key,
        previousValue: previousValue === undefined ? null : (previousValue as object),
        newValue: value as object,
        action: 'set',
        changedByUserId: actorUserId,
      };
      await tx.insert(tenantSettingsHistory).values(historyRow);

      return result[0]!;
    });
  }

  /** Lista todos los settings (panel admin). */
  async list(db: TenantDb): Promise<TenantSetting[]> {
    return db.select().from(tenantSettings).orderBy(tenantSettings.key);
  }

  /**
   * Borra un setting (vuelve al default). Llamado desde DELETE.
   * Idempotent: si el setting no existe, no hace nada y NO inserta
   * history entry (no hubo cambio real).
   */
  async unset(db: TenantDb, key: string, actorUserId?: string): Promise<void> {
    await db.transaction(async (tx) => {
      // Leer el value previo para el history.
      const prevRow = await tx
        .select({ value: tenantSettings.value })
        .from(tenantSettings)
        .where(eq(tenantSettings.key, key))
        .limit(1);
      if (!prevRow[0]) return; // nada que borrar, nada que historiar

      await tx.delete(tenantSettings).where(eq(tenantSettings.key, key));

      const historyRow: NewTenantSettingHistory = {
        key,
        previousValue: prevRow[0].value as object,
        newValue: null,
        action: 'unset',
        changedByUserId: actorUserId ?? null,
      };
      await tx.insert(tenantSettingsHistory).values(historyRow);
    });
  }

  /**
   * Lista el history de cambios para un setting key, ordenado por
   * `changedAt` DESC (más reciente primero). Paginable.
   */
  async listHistoryForKey(
    db: TenantDb,
    key: string,
    limit = 50,
    offset = 0,
  ): Promise<TenantSettingHistory[]> {
    return db
      .select()
      .from(tenantSettingsHistory)
      .where(eq(tenantSettingsHistory.key, key))
      .orderBy(desc(tenantSettingsHistory.changedAt))
      .limit(limit)
      .offset(offset);
  }

  /**
   * Lista TODO el history (cualquier key) ordenado por `changedAt` DESC.
   * Paginable. Para el panel "auditoría de configuración".
   */
  async listAllHistory(
    db: TenantDb,
    limit = 50,
    offset = 0,
  ): Promise<TenantSettingHistory[]> {
    return db
      .select()
      .from(tenantSettingsHistory)
      .orderBy(desc(tenantSettingsHistory.changedAt))
      .limit(limit)
      .offset(offset);
  }
}

