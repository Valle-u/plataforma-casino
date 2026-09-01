/**
 * GamesCatalogCache — caché en Redis del catálogo de juegos.
 *
 * **Por qué existe.** El catálogo es el dato más leído y el que menos cambia:
 * 2.840 juegos en producción, que sólo se mueven cuando el dueño edita uno o
 * corre un sync manual del proveedor. Sin caché, cada carga de la home y cada
 * cambio de filtro de cada jugador iba a Postgres. Con 100 jugadores eso es
 * carga constante sobre la base para devolver siempre lo mismo.
 *
 * **Qué se cachea.** Lecturas públicas de juegos: el catálogo (listado,
 * facetas, nombres de proveedor) y el feed de ganadores del ticker. Nada de
 * plata, nada de saldos, nada por usuario.
 *
 * El ticker comparte este espacio de claves a propósito: muestra nombres de
 * juego, así que una edición del catálogo también debería refrescarlo, y
 * `invalidate()` lo alcanza sin hacer nada extra.
 *
 * ⚠️ **La clave SIEMPRE lleva el `tenantId` primero.** Es lo único que impide
 * que un tenant vea el catálogo de otro. Por eso `tenantId` es el primer
 * parámetro obligatorio de los dos métodos: no hay forma de llamarlos sin él.
 *
 * **Invalidación.** Las mutaciones del catálogo llaman a `invalidate()`. Como
 * red de seguridad hay además un TTL corto: si algún camino de escritura se
 * olvida de invalidar (hoy: el sync de proveedor, que corre fire-and-forget
 * desde `GameProvidersService` y no tiene el tenantId a mano), lo peor que pasa
 * es que el catálogo quede desactualizado ese rato, no para siempre.
 *
 * Si Redis está caído o deshabilitado, `RedisService` devuelve null en todo y
 * esto degrada a "siempre va a la base": más lento, nunca roto.
 */

import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

/**
 * Partes admitidas en una clave de caché.
 *
 * Sólo primitivos a propósito: un objeto se stringifica como `[object Object]`,
 * así que dos filtros distintos colapsarían en la MISMA clave y un jugador
 * recibiría el resultado de otra consulta. El tipo lo vuelve imposible.
 */
type KeyPart = string | number | boolean | undefined | null;

/**
 * Cuánto vive una entrada del catálogo.
 *
 * 60s es el techo de desactualización que puede ver un jugador si una
 * invalidación se pierde. Para un catálogo que cambia unas pocas veces por
 * semana es intrascendente, y para el operador que acaba de marcar un juego
 * como destacado la invalidación explícita ya lo resolvió al instante.
 */
export const CATALOG_TTL_SECONDS = 60;

/**
 * Cuánto vive el feed de ganadores del ticker.
 *
 * Mucho más corto porque es dato vivo. El número sale de la medición: el
 * ticker es el ÚNICO endpoint que cada jugador pide solo, cada 15s. Con 100
 * jugadores eran ~7 consultas por segundo sobre `game_rounds`, la tabla que
 * más crece. Con 10s de TTL pasan a ser ~0,1 por segundo **sin importar**
 * cuántos jugadores haya: el primero que llega paga la consulta y el resto
 * lee de Redis.
 *
 * El costo es que un premio puede tardar hasta 10s extra en aparecer, sobre
 * un poll que ya era de 15. Aceptado explícitamente por el dueño.
 */
export const RECENT_WINS_TTL_SECONDS = 10;

@Injectable()
export class GamesCatalogCache {
  private readonly logger = new Logger(GamesCatalogCache.name);

  constructor(private readonly redis: RedisService) {}

  /** `games:<tenantId>:<...partes>` — el tenant SIEMPRE primero. */
  private key(tenantId: string, parts: readonly KeyPart[]): string {
    const suffix = parts
      .map((p) => (p === undefined || p === null || p === '' ? '-' : String(p)))
      .join('|');
    return `games:${tenantId}:${suffix}`;
  }

  /**
   * Devuelve el valor cacheado o ejecuta `load()` y lo guarda.
   *
   * Un error de Redis nunca se propaga al jugador: se loguea y se sirve desde
   * la base. Un catálogo lento es un problema; un catálogo caído es otro.
   */
  async getOrLoad<T>(
    tenantId: string,
    parts: readonly KeyPart[],
    load: () => Promise<T>,
    ttlSeconds: number = CATALOG_TTL_SECONDS,
  ): Promise<T> {
    const key = this.key(tenantId, parts);
    try {
      const hit = await this.redis.get<T>(key);
      if (hit !== null) return hit;
    } catch (err) {
      this.logger.warn(`Lectura de caché falló (${key}): ${(err as Error).message}`);
    }

    const fresh = await load();

    try {
      await this.redis.set(key, fresh, ttlSeconds);
    } catch (err) {
      this.logger.warn(`Escritura de caché falló (${key}): ${(err as Error).message}`);
    }
    return fresh;
  }

  /** Tira todo el catálogo cacheado de UN tenant. Nunca toca a los demás. */
  async invalidate(tenantId: string): Promise<void> {
    try {
      await this.redis.deletePattern(`games:${tenantId}:*`);
    } catch (err) {
      // Que falle la invalidación no puede tumbar la edición que la disparó:
      // el TTL se encarga igual, sólo que más tarde.
      this.logger.warn(
        `Invalidación de caché falló (tenant ${tenantId}): ${(err as Error).message}`,
      );
    }
  }
}
