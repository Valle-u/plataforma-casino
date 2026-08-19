/**
 * CronLockService — leader-election por tick de cron, cross-instancia.
 *
 * Problema: los crons corren en cada instancia del proceso. Con >1 réplica
 * (escalado horizontal) el MISMO cron correría en paralelo en cada una →
 * doble reconciliación, doble expiración de bonos, y sobre todo **doble envío
 * de emails/SMS**. Los guards `running` de cada cron son en-memoria: solo
 * protegen contra solapamiento dentro del mismo proceso, no entre réplicas.
 *
 * Solución: un advisory lock de Postgres sobre la **DB de control** (la única
 * DB compartida por todas las réplicas). `pg_try_advisory_lock` es no-bloqueante:
 * si otra instancia ya lo tiene, esta se saltea el tick. El lock es de SESIÓN,
 * así que vive atado a UNA conexión — la reservamos (`reserve()`) para todo el
 * tick y la liberamos al final (junto con `pg_advisory_unlock`).
 *
 * Nota: este lock también cubre el solapamiento intra-proceso (una 2ª reserva
 * no obtendría el lock), pero los crons mantienen igual su guard `running`
 * barato para no reservar conexión cuando ya están corriendo localmente.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ControlDb } from '@casino/db';
import { CONTROL_DB } from '../common/symbols';

/** Conexión reservada del pool de postgres-js (subconjunto que usamos). */
interface ReservedSql {
  unsafe: <T>(query: string, params?: unknown[]) => Promise<T>;
  release: () => void;
}
interface RawSql {
  reserve: () => Promise<ReservedSql>;
}

@Injectable()
export class CronLockService {
  private readonly logger = new Logger(CronLockService.name);

  constructor(@Inject(CONTROL_DB) private readonly controlDb: ControlDb) {}

  /**
   * Corre `fn` SOLO si esta instancia adquiere el advisory lock `lockName`.
   * Si otra instancia (o un tick previo) lo tiene, no corre `fn` y devuelve
   * `false`. Garantiza ejecución única cross-instancia por tick.
   *
   * Ante error al obtener la conexión de control, hace fail-open: corre `fn`
   * igual (mejor ejecutar el cron que saltearlo silenciosamente por un
   * problema de infra). El caller ya envuelve `fn` en su propio try/catch.
   */
  async runExclusive(lockName: string, fn: () => Promise<void>): Promise<boolean> {
    const client = (this.controlDb as unknown as { $client: RawSql }).$client;

    let conn: ReservedSql;
    try {
      conn = await client.reserve();
    } catch (err) {
      this.logger.error(
        `No pude reservar conexión de control para el lock "${lockName}" — corro sin lock (fail-open): ${(err as Error).message}`,
      );
      await fn();
      return true;
    }

    try {
      const rows = await conn.unsafe<Array<{ locked: boolean }>>(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
        [lockName],
      );
      const locked = rows[0]?.locked === true;
      if (!locked) {
        this.logger.warn(
          `Cron "${lockName}" ya está corriendo en otra instancia — tick salteado.`,
        );
        return false;
      }
      try {
        await fn();
        return true;
      } finally {
        await conn.unsafe('SELECT pg_advisory_unlock(hashtext($1))', [lockName]);
      }
    } finally {
      conn.release();
    }
  }
}
