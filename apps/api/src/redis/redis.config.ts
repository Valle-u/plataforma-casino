/**
 * Redis configuration.
 *
 * Supports:
 *   - Upstash Redis via `REDIS_URL` (rediss://...).
 *   - Local Redis via `REDIS_URL` (redis://localhost:6379).
 *   - Railway/self-hosted Redis via `REDIS_URL`.
 *
 * If `REDIS_URL` is not set, Redis is disabled gracefully: the service
 * methods return null/false and log a warning. This lets the app boot
 * without Redis in dev or during migrations.
 */

export interface RedisConfig {
  /** Full Redis URL, including credentials if needed. */
  url: string | undefined;
  /** Key prefix for multi-tenant isolation in shared Redis. */
  keyPrefix: string;
  /** Default TTL for cache entries (seconds). */
  defaultTtlSeconds: number;
  /** Enabled only when a URL is provided. */
  enabled: boolean;
}

export function loadRedisConfig(): RedisConfig {
  const url = process.env.REDIS_URL;
  return {
    url,
    keyPrefix: process.env.REDIS_KEY_PREFIX ?? 'casino:',
    defaultTtlSeconds: Number(process.env.REDIS_DEFAULT_TTL_SECONDS ?? 300),
    enabled: !!url && url.length > 0,
  };
}
