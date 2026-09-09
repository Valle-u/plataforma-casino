/**
 * La respuesta del operador, saliendo por Telegram (**2.7**).
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
import { TelegramApiService } from './telegram-api.service';
import { tokenDelCanal } from './telegram-token';

/** El tipo de canal que atiende este servicio. */
const TIPO = 'telegram';

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

  constructor(private readonly api: TelegramApiService) {}

  /**
   * ¿Esta conversación sale por un canal externo?
   *
   * Lo usa el gateway **antes** de persistir, para dos cosas: saber si después
   * hay que despachar, y rechazar los adjuntos (que en esta versión no salen).
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
    params: { conversationId: string; texto: string },
  ): Promise<ResultadoDeEnvio> {
    const texto = params.texto.trim();
    if (!texto) {
      return { entregado: false, error: 'El mensaje no tenía texto.' };
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

    try {
      const messageId = await this.api.sendMessage(token, chatId, texto);
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
      return { entregado: false, error: motivo };
    }
  }
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
