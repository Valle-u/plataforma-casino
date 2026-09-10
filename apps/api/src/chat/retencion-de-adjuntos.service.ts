/**
 * Borrar los adjuntos vencidos del chat — **D15**, roadmap **4.1**.
 *
 * > El texto se guarda para siempre; los adjuntos, seis meses.
 *
 * El riesgo no está en el texto: está en las imágenes. Ahí es donde viajan el
 * DNI, el CBU y la cara de la gente. El texto pesa poco y sirve para reclamos;
 * la foto pesa, no se busca, y es lo único que hace daño si se filtra.
 *
 * El mensaje **queda**, con la marca de que había un archivo:
 *
 * ```
 * [12-mar] Juan: "te mando el comprobante"
 *          📎 (archivo eliminado · retención)
 * ```
 *
 * ## El orden: primero el archivo, después la base
 *
 * Al revés dejaría **archivos huérfanos invisibles**: la base diría que se
 * borró, el archivo seguiría en el bucket, y nadie lo buscaría nunca porque el
 * registro dice que está todo bien. Así, un fallo deja un estado que la próxima
 * corrida arregla — el adjunto sigue sin marcar y se reintenta.
 *
 * Y por eso el borrado **tiene que poder informar si funcionó**. Hasta esta
 * tanda los tres drivers se tragaban el fallo y devolvían `void`: alcanzaba para
 * limpiar un comprobante rechazado, no para esto. Ver `storage.types.ts`.
 *
 * ## ⚠️ El cinturón: qué claves puede tocar
 *
 * **Sólo `/chat/attachments/`.** D15 lo dice explícitamente: el comprobante
 * oficial de un depósito (`deposits/proofs/…`) es **otro archivo, con su propio
 * ciclo de vida**, y que se borre la foto que el jugador mandó por chat no toca
 * el comprobante con el que se aprobó el depósito.
 *
 * Hoy nada mete una clave de comprobante adentro de un mensaje. El chequeo está
 * igual porque el costo de equivocarse acá **no es un bug, es un documento
 * financiero borrado sin vuelta atrás**, y porque este proceso va a seguir
 * corriendo mucho después de que nadie recuerde por qué era seguro.
 */

import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { crmMessages } from '@casino/db';
import { eq } from 'drizzle-orm';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { StorageService } from '../storage/storage.service';
import type { ChatAttachment } from './chat.types';

/** Lo que fija **D15**. */
export const MESES_DE_RETENCION = 6;

/**
 * Lo único que este proceso puede borrar. Ver el cinturón, arriba.
 *
 * No incluye el slug del tenant a propósito: la consulta ya corre contra la base
 * de un solo casino, así que el prefijo que importa es la **carpeta**.
 */
const CARPETA_DEL_CHAT = '/chat/attachments/';

/**
 * Cuántos mensajes se miran por corrida y por casino.
 *
 * Cada adjunto es una llamada de red al storage. Sin tope, la primera corrida
 * sobre un historial de años haría miles de llamadas seguidas y podría comerse
 * el rate limit del bucket. Lo que queda se toma la corrida siguiente: no hay
 * apuro, el archivo ya vivió seis meses.
 */
const MENSAJES_POR_CORRIDA = 200;

export interface ResultadoDeRetencion {
  /** Mensajes con al menos un adjunto vencido que se miraron. */
  mensajes: number;
  /** Adjuntos que ya no están y quedaron marcados. */
  borrados: number;
  /** Adjuntos que el storage no pudo borrar. Se reintentan la próxima. */
  fallados: number;
  /** Claves fuera de `/chat/attachments/`. **Si esto no es 0, hay que mirar.** */
  omitidos: number;
}

@Injectable()
export class RetencionDeAdjuntosService {
  private readonly logger = new Logger(RetencionDeAdjuntosService.name);

  constructor(private readonly storage: StorageService) {}

  /**
   * Borra los adjuntos vencidos de **un** casino.
   *
   * `simulacro` recorre todo y **no toca nada**: ni el storage ni la base. Es la
   * forma de ver qué haría la primera corrida sobre un historial real antes de
   * dejarla borrar, y de comprobar de paso que el borrado en el bucket anda —
   * que es nuevo y el roadmap avisa que no hay que darlo por hecho.
   */
  async purgar(
    db: TenantDb,
    opciones: { simulacro?: boolean } = {},
  ): Promise<ResultadoDeRetencion> {
    const simulacro = opciones.simulacro ?? false;
    const res: ResultadoDeRetencion = {
      mensajes: 0,
      borrados: 0,
      fallados: 0,
      omitidos: 0,
    };

    for (const fila of await this.mensajesConAdjuntosVencidos(db)) {
      res.mensajes += 1;
      const adjuntos = Array.isArray(fila.attachments)
        ? (fila.attachments as ChatAttachment[])
        : [];

      let cambio = false;
      const actualizados: ChatAttachment[] = [];

      for (const adjunto of adjuntos) {
        if (adjunto.purgedAt || !adjunto.storageKey) {
          actualizados.push(adjunto);
          continue;
        }

        if (!adjunto.storageKey.includes(CARPETA_DEL_CHAT)) {
          // El cinturón. Si esto salta, alguien metió en un mensaje una clave
          // que no es del chat y hay que mirarlo antes de borrar nada.
          this.logger.error(
            `Adjunto fuera de la carpeta del chat, NO se borra: ${adjunto.storageKey}`,
          );
          res.omitidos += 1;
          actualizados.push(adjunto);
          continue;
        }

        if (simulacro) {
          res.borrados += 1;
          actualizados.push(adjunto);
          continue;
        }

        // Primero el archivo. Ver el docblock: al revés deja huérfanos que
        // nadie va a buscar.
        const yaNoEsta = await this.storage.delete(adjunto.storageKey);
        if (!yaNoEsta) {
          res.fallados += 1;
          actualizados.push(adjunto);
          continue;
        }

        res.borrados += 1;
        cambio = true;
        actualizados.push({ ...adjunto, purgedAt: new Date().toISOString() });
      }

      if (cambio && !simulacro) {
        await db
          .update(crmMessages)
          .set({ attachments: actualizados })
          .where(eq(crmMessages.id, fila.id));
      }
    }

    return res;
  }

  /**
   * Los mensajes con **al menos un adjunto sin marcar** más viejos que la
   * retención.
   *
   * El `EXISTS` sobre los elementos del array es lo que hace que un mensaje ya
   * purgado no vuelva a aparecer en cada corrida: sin eso, la consulta traería
   * siempre los mismos mensajes viejos y nunca llegaría a los de más atrás.
   *
   * `jsonb_typeof = 'array'` antes de `jsonb_array_length` porque esa función
   * **tira** si le pasan algo que no es un array, y una fila rara pararía la
   * purga entera del casino.
   */
  private async mensajesConAdjuntosVencidos(
    db: TenantDb,
  ): Promise<Array<{ id: string; attachments: unknown }>> {
    const filas = await db.execute(sql`
      SELECT id, attachments
        FROM crm_messages
       WHERE created_at < now() - (${MESES_DE_RETENCION} || ' months')::interval
         AND jsonb_typeof(attachments) = 'array'
         AND jsonb_array_length(attachments) > 0
         AND EXISTS (
           SELECT 1
             FROM jsonb_array_elements(attachments) a
            WHERE a ->> 'purgedAt' IS NULL
         )
       ORDER BY created_at
       LIMIT ${MENSAJES_POR_CORRIDA}
    `);
    return filas as unknown as Array<{ id: string; attachments: unknown }>;
  }
}
