/**
 * La respuesta del operador, saliendo por Telegram (**2.7** texto, **2.8**
 * archivos).
 *
 * Cierra el hueco de la etapa 2: hasta acá el operador **recibía y no podía
 * contestar**. Su respuesta se guardaba y se emitía por socket.io, que es donde
 * escucha el widget web — y el jugador de Telegram no está ahí.
 *
 * ## El orden, y por qué es ése
 *
 * 1. El mensaje se **persiste** (lo hace el gateway).
 * 2. Recién después sale para Telegram.
 * 3. El resultado se anota sobre el mensaje ya guardado.
 *
 * Al revés —mandar primero, guardar si salió bien— el operador perdería lo que
 * escribió cada vez que Telegram tarde o falle, y encima esperaría la latencia
 * de una API externa antes de ver su propio mensaje en el hilo.
 *
 * El precio de este orden es que hay un instante en que el mensaje está
 * guardado y todavía no salió. Por eso existe la anotación del paso 3: sin
 * ella, ese instante duraría para siempre y un mensaje que nunca llegó se
 * vería igual que uno entregado. **El operador le estaría escribiendo a
 * nadie sin saberlo.**
 *
 * ## Nunca tira
 *
 * Un fallo acá no puede voltear la respuesta del operador: el mensaje ya está
 * guardado y ya se le mostró. Lo único que corresponde es dejar registrado por
 * qué no llegó.
 */

import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { crmChannels, crmContacts, crmConversations } from '@casino/db';
import type { TenantDb } from '../../tenant-resolver/tenant-context';
import { StorageService } from '../../storage/storage.service';
import { CHAT_ATTACHMENT_MAX_BYTES, type ChatAttachment } from '../chat.types';
import { TelegramApiService } from './telegram-api.service';
import { tokenDelCanal } from './telegram-token';

/** El tipo de canal que atiende este servicio. */
const TIPO = 'telegram';

/** Traer un adjunto de nuestro propio storage es un salto corto. */
const TIMEOUT_BAJADA_MS = 20_000;

/** Lo que se le anota al mensaje después de intentar mandarlo. */
export interface ResultadoDeEnvio {
  /** `true` si Telegram lo aceptó. */
  entregado: boolean;
  /** El `message_id` de Telegram, para la clave del mensaje. */
  channelMessageId?: string;
  /** Por qué no llegó, en palabras que el operador pueda leer. */
  error?: string;
}

@Injectable()
export class TelegramOutboundService {
  private readonly logger = new Logger(TelegramOutboundService.name);

  constructor(
    private readonly api: TelegramApiService,
    private readonly storage: StorageService,
  ) {}

  /**
   * ¿Esta conversación sale por un canal externo?
   *
   * Lo usa el gateway para saber si, después de persistir el mensaje, además
   * hay que despacharlo para afuera.
   */
  async canalExterno(
    db: TenantDb,
    conversationId: string,
  ): Promise<{ tipo: string } | null> {
    const filas = await db
      .select({ tipo: crmChannels.type })
      .from(crmConversations)
      .innerJoin(crmChannels, eq(crmChannels.id, crmConversations.channelId))
      .where(eq(crmConversations.id, conversationId))
      .limit(1);
    const tipo = filas[0]?.tipo;
    // El widget web no es un canal externo: ahí "mandar" es emitir por
    // socket.io, que el gateway ya hace.
    return tipo === TIPO ? { tipo } : null;
  }

  /**
   * Manda el texto por el bot del canal de esta conversación.
   *
   * Devuelve qué pasó; no tira nunca.
   */
  async enviar(
    db: TenantDb,
    params: {
      conversationId: string;
      texto: string;
      adjuntos?: ChatAttachment[];
    },
  ): Promise<ResultadoDeEnvio> {
    const texto = params.texto.trim();
    const adjuntos = params.adjuntos ?? [];
    if (!texto && adjuntos.length === 0) {
      return { entregado: false, error: 'El mensaje estaba vacío.' };
    }

    const filas = await db
      .select({
        canalId: crmChannels.id,
        config: crmChannels.config,
        activo: crmChannels.isActive,
        atributos: crmContacts.attributes,
      })
      .from(crmConversations)
      .innerJoin(crmChannels, eq(crmChannels.id, crmConversations.channelId))
      .innerJoin(crmContacts, eq(crmContacts.id, crmConversations.contactId))
      .where(eq(crmConversations.id, params.conversationId))
      .limit(1);

    const fila = filas[0];
    if (!fila) {
      return { entregado: false, error: 'La conversación ya no existe.' };
    }

    if (!fila.activo) {
      // Pasa si desvincularon el bot con la conversación abierta.
      return {
        entregado: false,
        error: 'El bot de este canal está desvinculado. Volvé a vincularlo.',
      };
    }

    const chatId = (
      fila.atributos as { telegram?: { chatId?: string } } | null
    )?.telegram?.chatId;
    if (!chatId) {
      // No debería pasar: el contacto se crea desde un update de Telegram, que
      // siempre trae el chat. Si pasa, el contacto se creó por otra vía y no
      // hay a dónde escribirle.
      return {
        entregado: false,
        error: 'Este contacto no tiene un chat de Telegram asociado.',
      };
    }

    const token = tokenDelCanal({ config: fila.config });
    if (!token) {
      // Sin `CHANNEL_SECRET_KEY` en el entorno, o cifrado con una clave que ya
      // no está. No es algo que el operador pueda arreglar solo.
      this.logger.error(
        `No se pudo abrir el token del canal ${fila.canalId}: la respuesta no sale.`,
      );
      return {
        entregado: false,
        error:
          'No se pudo leer la credencial del bot. Avisale al administrador.',
      };
    }

    // ── El orden: primero el texto, después los archivos (2.8) ──────────────
    //
    // Un mensaje del operador es UNA fila con cuerpo y adjuntos, pero Telegram
    // no tiene eso: son llamadas distintas. Se podría meter el texto como
    // `caption` del primer archivo y quedaría un solo globo, más prolijo — pero
    // el caption se corta en 1024 caracteres, y **una respuesta cortada por la
    // mitad es peor que dos globos**. Además serían dos comportamientos según
    // el largo, y el que casi nunca corre es el que se rompe sin que nadie mire.
    let primerId = '';
    let mandados = 0;

    try {
      if (texto) {
        primerId = await this.api.sendMessage(token, chatId, texto);
        mandados += 1;
      }

      for (const adjunto of adjuntos) {
        const bytes = await this.bajarDelStorage(adjunto.storageKey);
        if (!bytes) {
          // El archivo está en la base pero no se pudo traer del storage.
          return {
            entregado: false,
            error: parcial(
              mandados,
              `no se pudo leer el archivo "${adjunto.name}".`,
            ),
          };
        }
        const id = await this.api.sendDocument(token, chatId, {
          bytes,
          nombre: adjunto.name,
          mime: adjunto.mime,
        });
        if (!primerId) primerId = id;
        mandados += 1;
      }

      const messageId = primerId;
      return {
        entregado: true,
        // ⚠️ Prefijo propio, distinto del de los mensajes que entran.
        //
        // En un chat privado el `message_id` es un contador compartido entre lo
        // que manda la persona y lo que manda el bot, así que en teoría no
        // habría choque. Pero si esa suposición fuera falsa, el choque contra
        // el índice único **haría perder la respuesta del operador**, y el
        // índice está para cortar reintentos de ENTRADA: no le cuesta nada
        // separarlos y deja de depender de una suposición.
        channelMessageId: `tg-out:${fila.canalId}:${chatId}:${messageId}`,
      };
    } catch (err) {
      // El cliente de Telegram tira `BadRequestException` con la descripción
      // que dio Telegram —ya sin el token—. Eso es justo lo accionable:
      // "bot was blocked by the user" se resuelve pidiéndole a la persona que
      // lo desbloquee; "Unauthorized", revinculando el bot.
      const motivo = mensajeDeError(err);
      this.logger.warn(
        `No salió la respuesta por el canal ${fila.canalId}: ${motivo}`,
      );
      return { entregado: false, error: parcial(mandados, motivo) };
    }
  }

  /**
   * Los bytes de un adjunto nuestro. `null` si no se pudieron traer.
   *
   * Va por la URL que da el storage —firmada y de vida corta si el bucket es
   * privado (**D12**)— en vez de leer el archivo directo, porque **el driver no
   * expone leer**: sólo subir, dar URL y borrar. Agregarle un método a los tres
   * drivers para esto sería más superficie de la que el caso justifica.
   *
   * El salto es corto y del lado de adentro: la API le pide a su propio
   * storage. No es la URL la que viaja a Telegram — eso está descartado a
   * propósito (ver `sendDocument`).
   */
  private async bajarDelStorage(storageKey: string): Promise<Buffer | null> {
    try {
      const url = await this.storage.getUrl(storageKey, 120);
      const res = await fetch(url, {
        signal: AbortSignal.timeout(TIMEOUT_BAJADA_MS),
      });
      if (!res.ok) {
        this.logger.warn(`El storage devolvió ${res.status} para ${storageKey}`);
        return null;
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      // El tope ya se aplicó al subir, pero el archivo pudo haberse subido con
      // otro límite, o por otra vía. Telegram rechazaría igual; mejor un
      // mensaje nuestro que uno suyo.
      if (bytes.byteLength > CHAT_ATTACHMENT_MAX_BYTES) {
        this.logger.warn(`${storageKey} pesa más que el tope de adjuntos.`);
        return null;
      }
      return bytes;
    } catch (err) {
      this.logger.warn(
        `No se pudo traer ${storageKey} del storage: ${(err as Error).message}`,
      );
      return null;
    }
  }
}

/**
 * El motivo, diciendo **qué alcanzó a salir**.
 *
 * Un mensaje del operador puede ser texto y varios archivos, o sea varias
 * llamadas a Telegram, y una puede fallar con las anteriores ya entregadas. Sin
 * esto el operador lee "no llegó", lo manda de nuevo entero, y el jugador
 * recibe el texto dos veces.
 */
function parcial(mandados: number, motivo: string): string {
  if (mandados === 0) return motivo;
  return `Se entregó una parte (${mandados}) y el resto no: ${motivo}`;
}

/** El mensaje legible de un error de Nest, o algo que se entienda. */
function mensajeDeError(err: unknown): string {
  const respuesta = (err as { getResponse?: () => unknown })?.getResponse?.();
  if (respuesta && typeof respuesta === 'object') {
    const m = (respuesta as { message?: unknown }).message;
    if (typeof m === 'string' && m) return m;
  }
  const directo = (err as { message?: string })?.message;
  return directo || 'No se pudo entregar el mensaje.';
}
