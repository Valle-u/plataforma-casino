/**
 * RateLimiterService — limiter in-memory para endpoints sensibles.
 *
 * Estrategia: **fixed window counter**. Por cada clave (e.g. "login:ip:1.2.3.4")
 * llevamos un contador que se resetea cuando expira la ventana.
 *
 * Trade-offs vs sliding window / leaky bucket:
 *   - Más simple de implementar (1 entrada por clave, 2 campos).
 *   - Burst en el borde de la ventana (el atacante puede tirar 2x limit en el
 *     instante del reset). Aceptamos: la diferencia con sliding window son
 *     ~segundos, y el rate-limit es una defensa en capas, no la única.
 *   - Memoria O(claves_activas). Limpieza lazy en cada `check`.
 *
 * Storage: `Map<string, Entry>` in-process. Si en un futuro corren múltiples
 * instancias del API detrás de un load balancer, hay que migrar a Redis
 * (un atacante podría rotar entre instancias y multiplicar el límite).
 * Para single-instance (deploy inicial) es suficiente.
 *
 * Test isolation: cada `bootstrapTestApp` crea una nueva instancia (no
 * estática), así que entre suites no hay cruce. Dentro de una suite usar
 * `clear()` para reset en `beforeEach` si el test lo necesita.
 *
 * Configuración:
 *   - env `RATE_LIMIT_ENABLED=false` deshabilita todos los checks (return
 *     ok inmediato). Útil para integration tests donde el limiter
 *     interfiere con setup multi-request.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface Entry {
  /** Cantidad de hits dentro de la ventana actual. */
  count: number;
  /** Timestamp (ms) en el que la ventana expira y reseteamos. */
  resetAt: number;
}

export interface RateLimitConfig {
  /** Identificador de la regla, e.g. "auth.login". Solo para logs. */
  rule: string;
  /** Cantidad máxima de hits permitidos en la ventana. */
  limit: number;
  /** Duración de la ventana en segundos. */
  windowSec: number;
}

export interface RateLimitResult {
  ok: boolean;
  /** Cuántos hits ya consumió esta clave (incluyendo el actual). */
  current: number;
  /** Cuánto queda hasta que la ventana se resetee. ms. */
  retryAfterMs: number;
}

@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);
  private readonly store = new Map<string, Entry>();
  private readonly enabled: boolean;

  /**
   * Threshold para limpieza preventiva. Si el store supera N entradas
   * activas, hacemos un sweep eliminando las expiradas. Anti-leak en
   * caso de tráfico con keys muy variadas (e.g. bot rotando IPs).
   */
  private static readonly SWEEP_THRESHOLD = 10_000;

  constructor(config: ConfigService) {
    const raw = config.get<string>('RATE_LIMIT_ENABLED');
    this.enabled = raw !== 'false';
    if (!this.enabled) {
      this.logger.warn('RateLimiter DISABLED via RATE_LIMIT_ENABLED=false');
    }
  }

  /**
   * Chequea + consume 1 hit. Si el limit ya se superó, devuelve
   * `ok: false` y NO incrementa más (defensa contra contador unbounded).
   */
  check(key: string, cfg: RateLimitConfig): RateLimitResult {
    if (!this.enabled) {
      return { ok: true, current: 0, retryAfterMs: 0 };
    }

    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || entry.resetAt <= now) {
      // Ventana nueva (o primera vez).
      this.store.set(key, {
        count: 1,
        resetAt: now + cfg.windowSec * 1000,
      });
      this.maybeSweep(now);
      return { ok: true, current: 1, retryAfterMs: cfg.windowSec * 1000 };
    }

    if (entry.count >= cfg.limit) {
      // Bloqueado. NO incrementamos para no extender la "deuda".
      return {
        ok: false,
        current: entry.count,
        retryAfterMs: Math.max(entry.resetAt - now, 0),
      };
    }

    entry.count += 1;
    return {
      ok: true,
      current: entry.count,
      retryAfterMs: Math.max(entry.resetAt - now, 0),
    };
  }

  /**
   * Reset manual de una clave. Útil para tests, o para limpiar después
   * de un login exitoso (no penalizar al user legítimo por fallos previos).
   */
  reset(key: string): void {
    this.store.delete(key);
  }

  /** Wipe completo. Solo para tests. */
  clear(): void {
    this.store.clear();
  }

  /** Cuántos hits lleva esta key. -1 si no existe o expiró. */
  peek(key: string): number {
    const entry = this.store.get(key);
    if (!entry || entry.resetAt <= Date.now()) return -1;
    return entry.count;
  }

  /**
   * Limpia entradas expiradas si el store crece demasiado. Hacemos esto
   * lazy (no setInterval) para no mantener handles abiertos que confundan
   * a Jest en shutdown.
   */
  private maybeSweep(now: number): void {
    if (this.store.size < RateLimiterService.SWEEP_THRESHOLD) return;
    let deleted = 0;
    for (const [key, entry] of this.store) {
      if (entry.resetAt <= now) {
        this.store.delete(key);
        deleted += 1;
      }
    }
    if (deleted > 0) {
      this.logger.debug(`RateLimiter sweep eliminó ${deleted} entradas expiradas.`);
    }
  }
}
