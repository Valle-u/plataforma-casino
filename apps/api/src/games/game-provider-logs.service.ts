/**
 * GameProviderLogsService — escritura/lectura de logs de proveedores.
 *
 * `write` es BEST-EFFORT: nunca tira (loguear un error no debe romper el
 * flujo que lo originó — ej. el callback que mueve fichas). Se usa desde el
 * sync, el launch, el callback y el ping.
 */

import { Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { gameProviderLogs, type GameProviderLog } from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';

export type LogSeverity = 'info' | 'warning' | 'error';

export interface WriteLogParams {
  providerCode: string;
  eventType: string;
  severity?: LogSeverity;
  message: string;
  detail?: Record<string, unknown> | null;
}

@Injectable()
export class GameProviderLogsService {
  private readonly logger = new Logger(GameProviderLogsService.name);

  /** Inserta un log. Best-effort: cualquier error se traga (solo warn). */
  async write(db: TenantDb, params: WriteLogParams): Promise<void> {
    try {
      await db.insert(gameProviderLogs).values({
        providerCode: params.providerCode,
        eventType: params.eventType,
        severity: params.severity ?? 'info',
        message: params.message,
        detail: params.detail ?? null,
      });
    } catch (err) {
      this.logger.warn(
        `No se pudo escribir game_provider_log (${params.eventType}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Lista paginada con filtros para el tab Logs. */
  async list(
    db: TenantDb,
    filters: {
      providerCode?: string;
      eventType?: string;
      severity?: LogSeverity;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<{ data: GameProviderLog[]; total: number }> {
    const conditions = [];
    if (filters.providerCode)
      conditions.push(eq(gameProviderLogs.providerCode, filters.providerCode));
    if (filters.eventType)
      conditions.push(eq(gameProviderLogs.eventType, filters.eventType));
    if (filters.severity)
      conditions.push(eq(gameProviderLogs.severity, filters.severity));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const offset = Math.max(filters.offset ?? 0, 0);

    const [data, totalRows] = await Promise.all([
      db
        .select()
        .from(gameProviderLogs)
        .where(where)
        .orderBy(desc(gameProviderLogs.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(gameProviderLogs)
        .where(where),
    ]);
    return { data, total: totalRows[0]?.n ?? 0 };
  }

  /** Borra logs más viejos que `days`. Devuelve cuántos borró. */
  async purgeOlderThan(db: TenantDb, days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const deleted = await db
      .delete(gameProviderLogs)
      .where(lt(gameProviderLogs.createdAt, cutoff))
      .returning({ id: gameProviderLogs.id });
    return deleted.length;
  }
}
