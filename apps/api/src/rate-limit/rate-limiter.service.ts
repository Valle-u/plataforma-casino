/**
 * RateLimiterService — limiter con respaldo Redis para rate limiting distribuido.
 *
 * Estrategia: **fixed window counter**. Por cada clave (ej. "login:ip:1.2.3.4")
 * llevamos un contador que se resetea cuando expira la ventana.
 *
 * Storage:
 *   - Si Redis está habilitado → Redis (`ratelimit:<key>` con TTL).
 *     Permite que múltiples instancias del API compartan el mismo contador.
 *   - Si Redis está deshabilitado → `Map<string, Entry>` in-memory (fallback).
 *
 * Trade-offs vs sliding window / leaky bucket:
 *   - Burst en el borde de la ventana. Aceptamos por simplicidad.
 *
 * Configuración:
 *   - env `RATE_LIMIT_ENABLED=false` deshabilita todos los checks.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';

interface Entry {
  count: number;
  resetAt: number;
}

export interface RateLimitConfig {
  rule: string;
  limit: number;
  windowSec: number;
}

export interface RateLimitResult {
  ok: boolean;
  current: number;
  retryAfterMs: number;
}

@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);
  private readonly store = new Map<string, Entry>();
  private readonly enabled: boolean;

  private static readonly SWEEP_THRESHOLD = 10_000;

  constructor(
    config: ConfigService,
    private readonly redis: RedisService,
  ) {
    const raw = config.get<string>('RATE_LIMIT_ENABLED');
    this.enabled = raw !== 'false';
    if (!this.enabled) {
      this.logger.warn('RateLimiter DISABLED via RATE_LIMIT_ENABLED=false');
    }
    if (this.redis.isEnabled()) {
      this.logger.log('RateLimiter usando Redis como backend distribuido');
    }
  }

  async check(key: string, cfg: RateLimitConfig): Promise<RateLimitResult> {
    if (!this.enabled) {
      return { ok: true, current: 0, retryAfterMs: 0 };
    }

    if (this.redis.isEnabled()) {
      return this.checkRedis(key, cfg);
    }

    return this.checkMemory(key, cfg);
  }

  async reset(key: string): Promise<void> {
    if (this.redis.isEnabled()) {
      await this.redis.del(`ratelimit:${key}`);
    }
    this.store.delete(key);
  }

  async clear(): Promise<void> {
    if (this.redis.isEnabled()) {
      await this.redis.deletePattern('ratelimit:*');
    }
    this.store.clear();
  }

  async peek(key: string): Promise<number> {
    if (this.redis.isEnabled()) {
      const entry = await this.redis.get<Entry>(`ratelimit:${key}`);
      if (!entry || entry.resetAt <= Date.now()) return -1;
      return entry.count;
    }
    const entry = this.store.get(key);
    if (!entry || entry.resetAt <= Date.now()) return -1;
    return entry.count;
  }

  // ── Redis backend ──────────────────────────────────────────────────

  private async checkRedis(
    key: string,
    cfg: RateLimitConfig,
  ): Promise<RateLimitResult> {
    const redisKey = `ratelimit:${key}`;
    const now = Date.now();
    const entry = await this.redis.get<Entry>(redisKey);

    if (!entry || entry.resetAt <= now) {
      // Ventana nueva — iniciar contador
      const newEntry: Entry = {
        count: 1,
        resetAt: now + cfg.windowSec * 1000,
      };
      await this.redis.set(redisKey, newEntry, cfg.windowSec);
      return { ok: true, current: 1, retryAfterMs: cfg.windowSec * 1000 };
    }

    if (entry.count >= cfg.limit) {
      return {
        ok: false,
        current: entry.count,
        retryAfterMs: Math.max(entry.resetAt - now, 0),
      };
    }

    // Incrementar contador
    entry.count += 1;
    const remainingTtl = Math.max(Math.ceil((entry.resetAt - now) / 1000), 1);
    await this.redis.set(redisKey, entry, remainingTtl);
    return {
      ok: true,
      current: entry.count,
      retryAfterMs: Math.max(entry.resetAt - now, 0),
    };
  }

  // ── In-memory backend (fallback) ───────────────────────────────────

  private checkMemory(
    key: string,
    cfg: RateLimitConfig,
  ): RateLimitResult {
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || entry.resetAt <= now) {
      this.store.set(key, {
        count: 1,
        resetAt: now + cfg.windowSec * 1000,
      });
      this.maybeSweep(now);
      return { ok: true, current: 1, retryAfterMs: cfg.windowSec * 1000 };
    }

    if (entry.count >= cfg.limit) {
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

  private maybeSweep(now: number): void {
    if (this.store.size < RateLimiterService.SWEEP_THRESHOLD) return;
    let deleted = 0;
    for (const [k, entry] of this.store) {
      if (entry.resetAt <= now) {
        this.store.delete(k);
        deleted += 1;
      }
    }
    if (deleted > 0) {
      this.logger.debug(`RateLimiter sweep eliminó ${deleted} entradas expiradas.`);
    }
  }
}
