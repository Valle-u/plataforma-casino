/**
 * De un update de Telegram a una conversación en una bandeja (**2.2 + 2.3**).
 *
 * ## El orden
 *
 * 1. **Guardar el crudo.** Si el proceso falla —o el contenedor se reinicia en
 *    el medio— el mensaje no se perdió.
 * 2. Procesar: contacto, conversación, mensaje.
 * 3. Marcar el crudo como procesado.
 *
 * Un fallo en el paso 2 **no se propaga**: se anota en el crudo y se devuelve.
 * El que llama ya respondió 200 a Telegram, y hacer que reintente no arregla un
 * payload que no sabemos leer — sólo lo repite.
 *
 * ## Dónde caen los mensajes
 *
 * En la bandeja **dueña del canal** (**D2**), sin mirar de qué red es quien
 * escribe. El canal por el que alguien elige entrar *es* la información de a
 * quién buscaba.
 *
 * ## Casi siempre es un lead, y está bien
 *
 * Telegram **no da el teléfono** salvo que la persona lo comparta a propósito,
 * así que **D4 —el vínculo automático por teléfono— no funciona acá**. Un
 * contacto de Telegram nace sin jugador asociado, y eso va a ser lo normal, no
 * la excepción. Se lo reconoce por su `chat_id`, que es estable para esa
 * persona y ese bot.
 */

import { Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import {
  crmContacts,
  crmRawEvents,
  type CrmChannel,
} from '@casino/db';
import type { TenantDb } from '../../tenant-resolver/tenant-context';
import { ChatService } from '../chat.service';
import { UserHierarchyService } from '../../user-hierarchy/user-hierarchy.service';

/** Lo que usamos de un update. Telegram manda bastante más. */
interface UpdateDeTelegram {
  update_id?: number;
  message?: MensajeDeTelegram;
  edited_message?: MensajeDeTelegram;
}

interface MensajeDeTelegram {
  message_id?: number;
  date?: number;
  text?: string;
  caption?: string;
  chat?: { id?: number };
  from?: {
    id?: number;
    first_name?: string;
    last_name?: string;
    username?: string;
  };
}

/** Lo que guardamos de Telegram en `crm_contacts.attributes`. */
interface AtributosDeContacto {
  telegram?: { chatId: string; username?: string };
}

@Injectable()
export class TelegramInboundService {
  private readonly logger = new Logger(TelegramInboundService.name);

  constructor(
    private readonly chat: ChatService,
    private readonly hierarchy: UserHierarchyService,
  ) {}

  /**
   * Guarda el crudo y lo procesa.
   *
   * Nunca tira: el webhook ya decidió responder 200 y un error acá no puede
   * cambiar eso.
   */
  async recibir(
    db: TenantDb,
    canal: CrmChannel,
    body: unknown,
  ): Promise<void> {
    const update = (body ?? {}) as UpdateDeTelegram;

    // El `update_id` es único por bot y es lo que Telegram repite al
    // reintentar. Con el índice único de la migración 0113, un reintento choca
    // contra la base en vez de depender de que el código lo chequee.
    const externalId =
      typeof update.update_id === 'number' ? String(update.update_id) : null;

    let rawId: string;
    try {
      const fila = (
        await db
          .insert(crmRawEvents)
          .values({
            channelId: canal.id,
            externalId,
            payload: update as Record<string, unknown>,
          })
          .returning({ id: crmRawEvents.id })
      )[0]!;
      rawId = fila.id;
    } catch (err) {
      // Choque con el índice único = ya lo recibimos. Es un reintento de
      // Telegram y no hay nada que hacer: el mensaje ya está.
      if (esDuplicado(err)) return;
      this.logger.error(
        `No se pudo guardar el crudo del canal ${canal.id}: ${(err as Error).message}`,
      );
      return;
    }

    try {
      await this.procesar(db, canal, update);
      await db
        .update(crmRawEvents)
        .set({ processedAt: new Date() })
        .where(eq(crmRawEvents.id, rawId));
    } catch (err) {
      // Se anota y se sigue. El crudo queda con `processed_at` en NULL, que es
      // como se detecta después que algo se está trabando.
      const motivo = (err as Error).message;
      this.logger.error(`Update de Telegram sin procesar (${rawId}): ${motivo}`);
      await db
        .update(crmRawEvents)
        .set({ error: motivo.slice(0, 500) })
        .where(eq(crmRawEvents.id, rawId));
    }
  }

  /** Convierte el update en contacto + conversación + mensaje. */
  private async procesar(
    db: TenantDb,
    canal: CrmChannel,
    update: UpdateDeTelegram,
  ): Promise<void> {
    // Una edición no crea un mensaje nuevo: se ignora, pero el crudo queda
    // guardado por si algún día se quiere reflejar.
    const msg = update.message;
    if (!msg) return;

    const chatId = msg.chat?.id;
    if (typeof chatId !== 'number') return;

    // `caption` es el texto de una foto o un archivo. Sin los medios (2.4) al
    // menos se ve lo que la persona escribió con el adjunto, en vez de un
    // mensaje vacío que parece un error.
    const cuerpo = (msg.text ?? msg.caption ?? '').trim();
    const sinTexto = cuerpo === '';

    const owner = canal.ownerUserId;
    const contactId = await this.contactoDeChat(db, {
      chatId: String(chatId),
      owner,
      nombre: nombreVisible(msg),
      username: msg.from?.username,
    });

    const conv = await this.chat.getOrCreateOpenConversation(db, {
      contactId,
      channelId: canal.id,
      // La bandeja del dueño del canal (D2).
      //
      // `owner` es `null` para un canal central, pero `assigned_operator_id`
      // guarda el **id del admin principal** en ese caso — es la traducción
      // inversa de `resolveContactOwner`, y tiene que coincidir con lo que
      // `resolveInboxOwner` le devuelve al staff, o la conversación no le
      // aparecería a nadie.
      operatorId: owner ?? (await this.hierarchy.getPrimaryAdminUserId(db)),
    });

    await this.chat.postMessage(db, {
      conversationId: conv.id,
      direction: 'inbound',
      senderUserId: null,
      body: sinTexto ? '(adjunto sin texto)' : cuerpo,
      // Único por bot: es lo que corta los duplicados en `crm_messages`.
      channelMessageId: `tg:${canal.id}:${msg.message_id ?? ''}`,
    });
  }

  /**
   * El contacto de esa persona **en esta bandeja** (**D6**).
   *
   * Se lo busca por `chat_id` dentro de `attributes`, no por teléfono: Telegram
   * no lo da. El `chat_id` es estable para esa persona y ese bot, así que sirve
   * de llave — pero **sólo dentro de este canal**: el mismo humano escribiendo
   * al bot de otro operador es otro `chat_id` y otro contacto, que es
   * exactamente lo que D6 pide.
   */
  private async contactoDeChat(
    db: TenantDb,
    params: {
      chatId: string;
      owner: string | null;
      nombre: string;
      username?: string;
    },
  ): Promise<string> {
    const existente = (
      await db
        .select({ id: crmContacts.id })
        .from(crmContacts)
        .where(
          and(
            sql`${crmContacts.attributes} -> 'telegram' ->> 'chatId' = ${params.chatId}`,
            params.owner === null
              ? sql`${crmContacts.ownerUserId} IS NULL`
              : eq(crmContacts.ownerUserId, params.owner),
          ),
        )
        .limit(1)
    )[0];
    if (existente) return existente.id;

    const creado = (
      await db
        .insert(crmContacts)
        .values({
          ownerUserId: params.owner,
          displayName: params.nombre,
          // Sin `user_id`: nace como lead. Vincularlo a un jugador es una
          // acción a mano, porque D4 no aplica sin teléfono.
          isLead: true,
          attributes: {
            telegram: {
              chatId: params.chatId,
              ...(params.username ? { username: params.username } : {}),
            },
          } satisfies AtributosDeContacto,
        })
        .returning({ id: crmContacts.id })
    )[0]!;
    return creado.id;
  }
}

/** El nombre que Telegram da de quien escribe. Puede no venir ninguno. */
function nombreVisible(msg: MensajeDeTelegram): string {
  const partes = [msg.from?.first_name, msg.from?.last_name].filter(Boolean);
  if (partes.length > 0) return partes.join(' ').slice(0, 120);
  if (msg.from?.username) return `@${msg.from.username}`;
  return 'Contacto de Telegram';
}

/** ¿El error es un choque con un índice único? */
function esDuplicado(err: unknown): boolean {
  const code = (err as { code?: string; cause?: { code?: string } })?.code
    ?? (err as { cause?: { code?: string } })?.cause?.code;
  // 23505 = unique_violation en Postgres.
  return code === '23505' || /duplicate key|unique/i.test(String(err));
}
