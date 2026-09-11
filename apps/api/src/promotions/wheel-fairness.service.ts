/**
 * El sobre cerrado del giro — `docs/27-ruleta-diaria.md` §8.
 *
 * El premio lo decide el servidor. Sin esto el jugador sólo puede creernos: se
 * guardaba el número aleatorio y el dueño podía auditarlo, pero él no tenía
 * forma de comprobar que el premio no se eligió **al ver quién era**.
 *
 * ## El orden es todo
 *
 * 1. Al abrir la ruleta se guarda una semilla secreta y se publica su huella.
 * 2. Al girar, el resultado se **deriva** de esa semilla — no de `Math.random`.
 * 3. Terminado el giro, la semilla se revela.
 * 4. El jugador comprueba que la semilla da la huella que vio antes, y que esa
 *    semilla da el gajo que le salió.
 *
 * **Si la semilla se generara en el momento del giro, nada de esto probaría
 * nada**: nadie impediría elegirla después de mirar quién giró. Todo el valor
 * está en que el compromiso es anterior.
 *
 * ## Por qué también hay una semilla del jugador
 *
 * Con sólo la del servidor, el compromiso es válido y la trampa sigue siendo
 * posible: se generan mil semillas, se mira cuál da el peor premio, y se
 * publica la huella de ésa. La semilla del jugador lo corta, porque el
 * resultado depende de algo que él eligió y el servidor no controla.
 */

import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import {
  promotionSpinCommitments,
  type PromotionSpinCommitment,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { isUniqueViolation } from '../common/pg-error';

/** Lo que se le puede mostrar al jugador ANTES de girar. */
export interface CompromisoPublico {
  serverSeedHash: string;
  clientSeed: string;
  dayAnchor: string;
}

@Injectable()
export class WheelFairnessService {
  /**
   * El compromiso de hoy para este jugador. Lo crea si no existe.
   *
   * Idempotente por `(promo, jugador, día)`: pedirlo diez veces devuelve el
   * mismo. Es lo que impide pedir muchos y quedarse con el que más guste.
   */
  async obtenerOCrear(
    db: TenantDb,
    params: {
      promotionId: string;
      userId: string;
      dayAnchor: string;
      /** La que manda el jugador. Si no manda, se genera una. */
      clientSeed?: string;
    },
  ): Promise<PromotionSpinCommitment> {
    const existente = await this.buscar(db, params);
    if (existente) return existente;

    const serverSeed = randomBytes(32).toString('hex');
    const clientSeed = this.normalizarClientSeed(params.clientSeed);

    try {
      const filas = await db
        .insert(promotionSpinCommitments)
        .values({
          promotionId: params.promotionId,
          userId: params.userId,
          dayAnchor: params.dayAnchor,
          serverSeed,
          serverSeedHash: this.huella(serverSeed),
          clientSeed,
        })
        .returning();
      return filas[0]!;
    } catch (err) {
      // Dos pedidos a la vez: gana uno y el otro relee. No se reintenta con
      // otra semilla — el jugador tiene que ver SIEMPRE la misma huella.
      if (isUniqueViolation(err)) {
        const reintento = await this.buscar(db, params);
        if (reintento) return reintento;
      }
      throw err;
    }
  }

  /** Lo que se puede publicar antes del giro. Nunca `serverSeed`. */
  publico(c: PromotionSpinCommitment): CompromisoPublico {
    return {
      serverSeedHash: c.serverSeedHash,
      clientSeed: c.clientSeed,
      dayAnchor: c.dayAnchor,
    };
  }

  /**
   * El valor del sorteo, en `[0, 1)`, derivado del compromiso.
   *
   * HMAC-SHA256 con la semilla del servidor como clave y
   * `clientSeed:dayAnchor` como mensaje. Se toman los primeros 52 bits, que es
   * toda la precisión que un `number` puede representar sin perder nada — con
   * 32 bits el sorteo tendría una granularidad de 1/4.000.000.000, que alcanza,
   * pero 52 no cuesta más y evita tener que explicar por qué alcanza.
   *
   * Determinístico: la misma entrada da siempre el mismo número. Eso es lo que
   * permite que el jugador lo recalcule.
   */
  valorDelSorteo(c: Pick<PromotionSpinCommitment, 'serverSeed' | 'clientSeed' | 'dayAnchor'>): number {
    const hmac = createHmac('sha256', c.serverSeed)
      .update(`${c.clientSeed}:${c.dayAnchor}`)
      .digest('hex');
    const bits52 = Number.parseInt(hmac.slice(0, 13), 16);
    return bits52 / 2 ** 52;
  }

  /** Marca el compromiso como revelado. A partir de acá la semilla es pública. */
  async revelar(db: TenantDb, commitmentId: string): Promise<void> {
    await db
      .update(promotionSpinCommitments)
      .set({ revealedAt: new Date() })
      .where(eq(promotionSpinCommitments.id, commitmentId));
  }

  huella(valor: string): string {
    return createHash('sha256').update(valor).digest('hex');
  }

  private async buscar(
    db: TenantDb,
    params: { promotionId: string; userId: string; dayAnchor: string },
  ): Promise<PromotionSpinCommitment | null> {
    const filas = await db
      .select()
      .from(promotionSpinCommitments)
      .where(
        and(
          eq(promotionSpinCommitments.promotionId, params.promotionId),
          eq(promotionSpinCommitments.userId, params.userId),
          eq(promotionSpinCommitments.dayAnchor, params.dayAnchor),
        ),
      )
      .limit(1);
    return filas[0] ?? null;
  }

  /**
   * La semilla del jugador, acotada.
   *
   * Se limita el largo porque entra por la API y termina en la base y en un
   * HMAC; y se cae a una generada cuando no viene, para que el mecanismo
   * funcione igual con clientes que no la manden.
   */
  private normalizarClientSeed(cruda?: string): string {
    const limpia = (cruda ?? '').trim().slice(0, 64);
    return limpia.length > 0 ? limpia : randomBytes(8).toString('hex');
  }
}
