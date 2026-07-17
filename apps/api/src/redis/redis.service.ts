/**
 * RedisService — wrapper tipado sobre ioredis.
 *
 * Sprint 56: conecta a Upstash/Railway Redis via `REDIS_URL`.
 * Si no hay URL configurada, el servicio opera en modo "disabled":
 * todas las operaciones devuelven null/false sin romper callers.
 *
 * Uso:
 *   - Cache: `get<T>(key)`, `set(key, value, ttl)`.
 *   - Distributed locks: `lock(name, ttl)`, `unlock(name, value)`.
 *   - Pub/sub, lists, etc. se agregan a medida que se necesiten.
 */

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { loadRedisConfig, type RedisConfig } from './redis.config';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly config: RedisConfig;
  private readonly redis: Redis | null = null;

  constructor() {
    this.config = loadRedisConfig();
    if (this.config.enabled) {
      this.redis = new Redis(this.config.url as string, {
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        retryStrategy: (times) => Math.min(times * 100, 3000),
      });
      this.redis.on('error', (err) => {
        this.logger.error(`Redis connection error: ${err.message}`);
      });
      this.redis.on('connect', () => {
        this.logger.log('Redis connected');
      });
      this.logger.log(`Redis configured with prefix ${this.config.keyPrefix}`);
    } else {
      this.logger.warn(
        'REDIS_URL not set — Redis is disabled. BullMQ, distributed rate limiting and cache will not work.',
      );
    }
  }

  onModuleDestroy(): void {
    void this.redis?.quit();
  }

  private key(name: string): string {
    return `${this.config.keyPrefix}${name}`;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.redis) return null;
    const raw = await this.redis.get(this.key(key));
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set<T>(
    key: string,
    value: T,
    ttlSeconds?: number,
  ): Promise<void> {
    if (!this.redis) return;
    const ttl = ttlSeconds ?? this.config.defaultTtlSeconds;
    await this.redis.set(
      this.key(key),
      JSON.stringify(value),
      'EX',
      ttl,
    );
  }

  async del(key: string): Promise<void> {
    await this.redis?.del(this.key(key));
  }

  /**
   * Distributed lock con SET NX EX.
   * Devuelve el lock value si se adquiere, o null si no.
   */
  async lock(name: string, ttlSeconds: number): Promise<string | null> {
    if (!this.redis) return null;
    const value = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const fullKey = this.key(`lock:${name}`);
    const acquired = await this.redis.setnx(fullKey, value);
    if (acquired === 1) {
      await this.redis.expire(fullKey, ttlSeconds);
      return value;
    }
    return null;
  }

  async unlock(name: string, value: string): Promise<void> {
    if (!this.redis) return;
    const fullKey = this.key(`lock:${name}`);
    const current = await this.redis.get(fullKey);
    // Solo liberar si el value coincide (evita liberar un lock de otro proceso).
    if (current === value) {
      await this.redis.del(fullKey);
    }
  }

  /** Invalida patrones de cache (ej. `users:*`). */
  async deletePattern(pattern: string): Promise<void> {
    if (!this.redis) return;
    const fullPattern = this.key(pattern);
    const keys: string[] = [];
    let cursor = '0';
    do {
      const result = await this.redis.scan(
        cursor,
        'MATCH',
        fullPattern,
        'COUNT',
        100,
      );
      cursor = result[0];
      keys.push(...result[1]);
    } while (cursor !== '0');
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }
}
