/**
 * Factory de clientes Drizzle para la DB de control y DBs de tenant.
 *
 * Decisiones (ver docs/02-arquitectura.md §2.5 + §4):
 *   - Driver: postgres.js (más rápido y mejor soportado por Drizzle).
 *   - Multi-tenant físico: una conexión por DB. La DB de control va separada.
 *   - Pool de pools con LRU para tenants se implementa en una sesión posterior.
 *
 * Este archivo expone:
 *   createControlDb()  → cliente Drizzle conectado a `platform_control`.
 *   createTenantDb()   → cliente Drizzle conectado a una DB de tenant específica.
 *                        (placeholder para futuro)
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as controlSchema from './control';

export type ControlDb = ReturnType<typeof createControlDb>;

/**
 * Crea un cliente Drizzle conectado a la DB de control (`platform_control`).
 * @param connectionUrl URL Postgres (ej: `postgresql://postgres:pass@localhost:5432/platform_control`).
 * @param options       Opciones extra para postgres.js (max conns, ssl, etc.).
 */
export function createControlDb(
  connectionUrl: string,
  options: postgres.Options<Record<string, never>> = {},
): ReturnType<typeof drizzle<typeof controlSchema>> {
  const sql = postgres(connectionUrl, {
    // Sprint 53.5 perf fix: pool 10 → 30 para mejorar p95 bajo carga.
    // Spike test 200 VUs mostró cuello de botella en conexiones (queue
    // de queries esperando pool). 30 conexiones × 3 pools (control + 2
    // tenants en MVP) = 90 conexiones totales, dentro del default 100
    // de Postgres. Override via env DB_POOL_MAX si Postgres tiene
    // max_connections más alto.
    max: Number(process.env.DB_POOL_MAX ?? '30'),
    idle_timeout: 600, // 10 min — keep connections alive
    connect_timeout: 10, // segundos para fallar el connect
    ...options,
  });

  return drizzle(sql, { schema: controlSchema });
}

/**
 * Crea un cliente Drizzle para una DB de tenant.
 *
 * En MVP early este cliente es un wrapper directo. La estrategia de pool de
 * pools con LRU (según docs/13-escalabilidad.md §6.2) se implementa cuando
 * tengamos múltiples tenants activos.
 *
 * @param connectionUrl URL Postgres a la DB del tenant.
 */
export function createTenantDb(
  connectionUrl: string,
  options: postgres.Options<Record<string, never>> = {},
): ReturnType<typeof drizzle> {
  const sql = postgres(connectionUrl, {
    // 2026-08-31: 10 → 20.
    //
    // Este es el pool que usan LOS JUGADORES (el de control lo usa el panel),
    // y era el más ajustado de los dos: la suba a 30 del Sprint 53.5 se hizo
    // sólo del lado de control y este quedó en el default viejo.
    //
    // La cuenta, que es lo que limita el número: Postgres viene con
    // `max_connections = 100` por defecto. Con 20 acá el total es
    // 30 (control) + 20 × N tenants. Con 1 tenant son 50 y sobra; con los 3
    // del target de MVP son 90, que todavía entra. Pasar de ahí — más tenants
    // o un número más alto — exige subir `max_connections` en Postgres ANTES,
    // o los connects empiezan a fallar con "too many clients".
    //
    // ⚠️ No se pudo verificar el `max_connections` real de producción desde
    //    el repo. 20 es conservador a propósito: es seguro incluso si el
    //    server está en el default.
    max: Number(process.env.DB_POOL_MAX_TENANT ?? '20'),
    idle_timeout: 600, // 10 min — keep connections alive for Palace callbacks
    connect_timeout: 10,
    ...options,
  });

  // Placeholder: el schema de tenant todavía no existe. Cuando se implemente,
  // pasar `{ schema: tenantSchema }`.
  return drizzle(sql);
}
