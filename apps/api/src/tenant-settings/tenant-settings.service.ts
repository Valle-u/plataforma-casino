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
import { eq } from 'drizzle-orm';
import {
  tenantSettings,
  type NewTenantSetting,
  type TenantSetting,
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
   */
  async set(
    db: TenantDb,
    key: string,
    value: unknown,
    actorUserId: string,
  ): Promise<TenantSetting> {
    const row: NewTenantSetting = {
      key,
      value: value as object,
      updatedByUserId: actorUserId,
      updatedAt: new Date(),
    };
    const result = await db
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
    return result[0]!;
  }

  /** Lista todos los settings (panel admin). */
  async list(db: TenantDb): Promise<TenantSetting[]> {
    return db.select().from(tenantSettings).orderBy(tenantSettings.key);
  }

  /**
   * Borra un setting (vuelve al default). Llamado desde DELETE.
   */
  async unset(db: TenantDb, key: string): Promise<void> {
    await db.delete(tenantSettings).where(eq(tenantSettings.key, key));
  }
}
