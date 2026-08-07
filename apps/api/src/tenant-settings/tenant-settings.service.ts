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
 * Cache in-memory con TTL de 5 minutos. Se invalida automáticamente
 * al hacer `set()` o `unset()`.
 */

import { Injectable } from '@nestjs/common';
import { desc, eq, lt } from 'drizzle-orm';
import {
  tenantSettings,
  tenantSettingsHistory,
  type NewTenantSetting,
  type NewTenantSettingHistory,
  type TenantSetting,
  type TenantSettingHistory,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

@Injectable()
export class TenantSettingsService {
  private readonly cache = new Map<string, CacheEntry>();
  private dbIdCounter = 0;
  private readonly dbIds = new WeakMap<TenantDb, number>();

  private getDbId(db: TenantDb): number {
    let id = this.dbIds.get(db);
    if (id === undefined) {
      id = ++this.dbIdCounter;
      this.dbIds.set(db, id);
    }
    return id;
  }

  private cacheKey(db: TenantDb, key: string): string {
    return `${this.getDbId(db)}:${key}`;
  }

  private invalidate(db: TenantDb, key: string): void {
    this.cache.delete(this.cacheKey(db, key));
  }

  /**
   * Devuelve el value del setting. Si no existe, retorna undefined.
   * El caller hace el cast — JSONB puede contener cualquier shape.
   *
   * Cache in-memory con TTL de 5 minutos. Se invalida al hacer set/unset.
   */
  async get<T = unknown>(db: TenantDb, key: string): Promise<T | undefined> {
    const ck = this.cacheKey(db, key);
    const entry = this.cache.get(ck);
    if (entry && entry.expiresAt > Date.now()) {
      return entry.value as T;
    }
    this.cache.delete(ck);

    const rows = await db
      .select({ value: tenantSettings.value })
      .from(tenantSettings)
      .where(eq(tenantSettings.key, key))
      .limit(1);

    const val = rows[0]?.value as T | undefined;
    this.cache.set(ck, { value: val, expiresAt: Date.now() + CACHE_TTL_MS });
    return val;
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
   * Puede ser `null` para writes de sistema (crons/syncs) — ambas
   * columnas de audit (updated_by_user_id / changed_by_user_id) son
   * nullable.
   *
   * Atomico via `db.transaction`: el upsert + el insert en history se
   * comitean juntos. Sin esto, un crash entre los dos statements
   * podría dejar el setting actualizado sin entry de history (drift).
   */
  async set(
    db: TenantDb,
    key: string,
    value: unknown,
    actorUserId: string | null,
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
        value: value,
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
        previousValue: previousValue === undefined ? null : (previousValue),
        newValue: value,
        action: 'set',
        changedByUserId: actorUserId,
      };
      await tx.insert(tenantSettingsHistory).values(historyRow);

      return result[0]!;
    }).then((result) => {
      this.invalidate(db, key);
      return result;
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
        previousValue: prevRow[0].value,
        newValue: null,
        action: 'unset',
        changedByUserId: actorUserId ?? null,
      };
      await tx.insert(tenantSettingsHistory).values(historyRow);
    }).then(() => {
      this.invalidate(db, key);
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

  /**
   * Purga entries con `changed_at < NOW() - retentionDays`.
   *
   * Es DELETE puro — el history se diseñó append-only para auditoría,
   * pero para retención larga conviene caducar entries muy viejas. La
   * key para el setting recomendado: `tenant_settings.history_retention_days`
   * (default 365 días en el cron).
   *
   * Devuelve cuántas filas se borraron. Si retentionDays <= 0 → no-op
   * (defensivo: nunca queremos purgar TODO accidentalmente con un mal
   * config).
   */
  async purgeOldHistory(
    db: TenantDb,
    retentionDays: number,
  ): Promise<number> {
    if (retentionDays <= 0) return 0;
    const cutoff = new Date(Date.now() - retentionDays * 24 * 3600 * 1000);
    const deleted = await db
      .delete(tenantSettingsHistory)
      .where(lt(tenantSettingsHistory.changedAt, cutoff))
      .returning({ id: tenantSettingsHistory.id });
    return deleted.length;
  }
}

