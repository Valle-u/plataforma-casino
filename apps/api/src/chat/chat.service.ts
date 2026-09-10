/**
 * ChatService — lógica de dominio del CRM/livechat (Etapa 1).
 *
 * Vive detrás del flag CRM_ENABLED (solo se instancia si el ChatModule se
 * importa). Resuelve la DB del tenant DESDE el socket (el WS corre fuera del
 * middleware HTTP de tenant, así que resolvemos por `tenantId` del token),
 * el operador directo del jugador (por user_hierarchy) y el CRUD de
 * contacts/conversations/messages. Ver docs/22-crm-livechat.md.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import {
  crmChannels,
  crmContacts,
  crmConversations,
  crmContactTags,
  crmMessages,
  crmTags,
  tenants,
  users,
  type ControlDb,
  type CrmConversation,
  type CrmMessage,
} from '@casino/db';

/** Fila de la bandeja del operador: conversación + datos mínimos del contacto. */
export interface OperatorInboxItem {
  conversation: CrmConversation;
  /**
   * Por qué canal llegó: `web`, `telegram`, y más adelante `whatsapp`.
   *
   * La bandeja del CRM filtra por canal y muestra de cuál viene cada fila, y sin
   * esto tendría que pedir los canales aparte y cruzarlos en el cliente — una
   * consulta más y una copia de la relación en el front.
   */
  channelType: string;
  /**
   * El cuerpo del último mensaje, para el preview de la fila.
   *
   * `null` cuando la conversación no tiene ninguno; **string vacío** cuando el
   * último fue sólo un adjunto (el cuerpo se guarda vacío y el archivo va
   * aparte). Los dos casos son distintos y la pantalla los dice distinto.
   */
  lastMessageBody: string | null;
  /**
   * La ventana de 24 h de WhatsApp (**3.4**), o `null` si el canal no tiene.
   *
   * Los dos "no hay fecha" significan cosas distintas y hay que tratarlos
   * distinto — ver `ventana-24h.ts`. En resumen: `null` es "este canal no tiene
   * ventana"; `{ vence: null }` es "es WhatsApp y el cliente **nunca escribió**",
   * que es el caso en que más falta hace avisar.
   */
  ventana: VentanaDe24h | null;
  /** Las etiquetas del contacto, para mostrarlas en la fila. */
  tags: Array<{ id: string; label: string; color: string | null }>;
  contact: {
    id: string;
    displayName: string | null;
    userId: string | null;
    isLead: boolean;
    phone: string | null;
    /** username del jugador (si el contacto está linkeado a un user). */
    username: string | null;
    /** displayName del jugador en `users` (nombre real, si lo cargó). */
    userDisplayName: string | null;
  };
}
import { CONTROL_DB } from '../database/database.module';
import { TenantConnectionCache } from '../tenant-resolver/tenant-connection-cache';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { UserHierarchyService } from '../user-hierarchy/user-hierarchy.service';
import { StorageService } from '../storage/storage.service';
import {
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_MAX_COUNT,
  CHAT_ATTACHMENT_MIMES,
  type ChatAttachment,
} from './chat.types';
import { ventanaDe, type VentanaDe24h } from './ventana-24h';

const WEB_CHANNEL = 'web-livechat';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @Inject(CONTROL_DB) private readonly controlDb: ControlDb,
    private readonly tenantCache: TenantConnectionCache,
    private readonly hierarchy: UserHierarchyService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Resuelve el tenant a partir del `tenantId` del token del socket: devuelve la
   * DB + el slug (el slug se usa para validar el namespace de los adjuntos).
   */
  async resolveTenant(
    tenantId: string,
  ): Promise<{ db: TenantDb; slug: string } | null> {
    const rows = await this.controlDb
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const tenant = rows[0];
    if (!tenant) return null;
    return { db: this.tenantCache.get(tenant), slug: tenant.slug };
  }

  /** Operador directo del jugador = su parent inmediato en la jerarquía. */
  async resolveDirectOperator(
    db: TenantDb,
    playerUserId: string,
  ): Promise<string | null> {
    const parent = await this.hierarchy.getActiveParent(db, playerUserId);
    return parent?.parentUserId ?? null;
  }

  /** Canal web del tenant (uno solo). Lo crea si no existe. */
  async getOrCreateWebChannel(db: TenantDb): Promise<string> {
    const existing = await db
      .select({ id: crmChannels.id })
      .from(crmChannels)
      .where(eq(crmChannels.type, WEB_CHANNEL))
      .limit(1);
    if (existing[0]) return existing[0].id;
    const inserted = await db
      .insert(crmChannels)
      .values({ type: WEB_CHANNEL })
      .returning({ id: crmChannels.id });
    return inserted[0]!.id;
  }

  /**
   * El contacto de un jugador **en una bandeja concreta**. Lo crea si no está.
   *
   * ⚠️ **La bandeja es parte de la identidad del contacto, no un filtro.** Por
   * **D6** el mismo jugador tiene **una ficha por dueño de canal**: si Juan le
   * escribe al WhatsApp de su cajero y también al del casino, son **dos filas**,
   * que pueden apuntar al mismo `user_id` pero no comparten conversaciones,
   * notas ni etiquetas.
   *
   * Buscar sólo por `user_id` —como hacía esto antes de la migración `0112`—
   * devolvería la ficha de **otra** bandeja, y a partir de ahí todo lo que se
   * escriba cae del lado equivocado.
   *
   * `ownerUserId === null` es la bandeja **central**, y hay que buscarlo con
   * `IS NULL`: en SQL `null = null` no matchea nunca, así que un `eq()` acá
   * crearía una ficha nueva en cada mensaje.
   */
  async getOrCreateContactForUser(
    db: TenantDb,
    userId: string,
    ownerUserId: string | null,
  ): Promise<string> {
    const existing = await db
      .select({ id: crmContacts.id })
      .from(crmContacts)
      .where(
        and(
          eq(crmContacts.userId, userId),
          ownerUserId === null
            ? isNull(crmContacts.ownerUserId)
            : eq(crmContacts.ownerUserId, ownerUserId),
        ),
      )
      .limit(1);
    if (existing[0]) return existing[0].id;
    const inserted = await db
      .insert(crmContacts)
      .values({ userId, ownerUserId, isLead: false })
      .returning({ id: crmContacts.id });
    return inserted[0]!.id;
  }

  /**
   * El hilo del contacto en un canal. **Uno solo, para siempre** (`D11`).
   *
   * Si la conversación estaba resuelta y la persona vuelve a escribir, **se
   * reabre la misma**: no se crea otra. El operador ve todo lo que habló con
   * esa persona de un vistazo, sin abrir nada.
   *
   * ## ⚠️ Antes esto creaba un hilo nuevo
   *
   * La consulta filtraba por `status <> 'resolved'`, así que una conversación
   * resuelta no se encontraba y caía al `INSERT`. **No se notaba porque nada
   * marcaba una conversación como resuelta** — la columna existía y ningún
   * código la escribía. Al agregar esa acción (etapa 1.4), el bug habría
   * aparecido solo: cada vuelta de un jugador abriría un hilo nuevo, que es
   * exactamente lo que `D11` descartó.
   *
   * `ORDER BY created_at DESC` porque puede haber hilos duplicados de antes de
   * este arreglo: se toma el más nuevo, y el resultado es determinista.
   */
  async getOrCreateOpenConversation(
    db: TenantDb,
    params: { contactId: string; channelId: string; operatorId: string | null },
  ): Promise<CrmConversation> {
    const existente = await db
      .select()
      .from(crmConversations)
      .where(
        and(
          eq(crmConversations.contactId, params.contactId),
          eq(crmConversations.channelId, params.channelId),
        ),
      )
      .orderBy(desc(crmConversations.createdAt))
      .limit(1);

    const previa = existente[0];
    if (previa && previa.status !== 'resolved') return previa;
    if (previa) {
      const reabierta = await db
        .update(crmConversations)
        .set({ status: 'open', updatedAt: new Date() })
        .where(eq(crmConversations.id, previa.id))
        .returning();
      return reabierta[0]!;
    }

    const inserted = await db
      .insert(crmConversations)
      .values({
        contactId: params.contactId,
        channelId: params.channelId,
        assignedOperatorId: params.operatorId,
        status: 'open',
      })
      .returning();
    return inserted[0]!;
  }

  /**
   * Persiste un mensaje + actualiza la conversación (lastMessageAt + no leídos
   * del receptor). `direction` inbound = del contacto (jugador), outbound = del
   * operador. Devuelve el mensaje insertado.
   */
  async postMessage(
    db: TenantDb,
    params: {
      conversationId: string;
      direction: 'inbound' | 'outbound' | 'system';
      senderUserId: string | null;
      body: string;
      attachments?: ChatAttachment[];
      /**
       * Id del mensaje en el proveedor, para los canales externos.
       *
       * **Es la idempotencia**: hay un índice único parcial sobre esta columna
       * (migración `0113`), así que un reintento de Telegram o Meta choca
       * contra la base en vez de crear el mensaje dos veces. El insert **tira**
       * en ese caso, y el que llama tiene que tratarlo como "ya lo teníamos".
       *
       * Los mensajes del widget web no lo llevan: el índice es parcial y los
       * ignora.
       */
      channelMessageId?: string;
    },
  ): Promise<CrmMessage> {
    const inserted = await db
      .insert(crmMessages)
      .values({
        conversationId: params.conversationId,
        direction: params.direction,
        senderUserId: params.senderUserId,
        body: params.body,
        // Guardamos SIN url (se rehidrata al leer). sanitizeAttachments ya
        // devolvió objetos limpios sin url.
        attachments: params.attachments ?? [],
        channelMessageId: params.channelMessageId ?? null,
      })
      .returning();
    const msg = inserted[0]!;

    // No leídos del RECEPTOR: si el mensaje es del jugador (inbound) sube el
    // contador del operador; si es del operador (outbound) el del contacto.
    const bump =
      params.direction === 'inbound'
        ? { unreadForOperator: sql`${crmConversations.unreadForOperator} + 1` }
        : params.direction === 'outbound'
          ? { unreadForContact: sql`${crmConversations.unreadForContact} + 1` }
          : {};
    await db
      .update(crmConversations)
      .set({ lastMessageAt: msg.createdAt, updatedAt: new Date(), ...bump })
      .where(eq(crmConversations.id, params.conversationId));

    await this.anotarElTramo(db, params.direction, params.conversationId, msg);

    return this.hydrateMessage(msg);
  }

  /**
   * Mueve el **tramo** con este mensaje (migración `0115`).
   *
   * Un tramo va desde que alguien escribe estando la conversación resuelta
   * hasta que se vuelve a marcar resuelta, y es la unidad con la que se mide la
   * atención: por **D11** el hilo es eterno, así que medir sobre la
   * conversación mide la antigüedad del cliente.
   *
   * ## Nunca rompe un mensaje
   *
   * Si esto falla, se registra y se sigue. Es la misma regla que la línea de
   * tiempo del contacto: **una métrica no puede tumbar una respuesta a un
   * jugador**. Se pierde un tramo, que es infinitamente más barato que perder
   * el mensaje que lo generó.
   *
   * ## Quién abre y quién responde
   *
   * - `inbound` y `system` **abren** tramo si no hay uno abierto. Los avisos de
   *   **D8** cuentan a propósito: un aviso ignorado es el agujero que dejan D8
   *   y D10 juntos, igual que en el parte diario.
   * - `outbound` **no abre** tramo. Si el operador escribe primero no hay
   *   espera que medir, y ese tramo entraría con primera respuesta instantánea
   *   bajando la mediana de todos los demás.
   * - Sólo un `outbound` marca `first_response_at`. Un aviso del sistema no es
   *   una respuesta al jugador.
   *
   * El `ON CONFLICT DO NOTHING` se apoya en el índice **único parcial**
   * `crm_segments_abierto_idx`: dos mensajes simultáneos pasarían los dos un
   * chequeo hecho en el código, y la conversación quedaría con dos tramos
   * abiertos.
   */
  private async anotarElTramo(
    db: TenantDb,
    direction: 'inbound' | 'outbound' | 'system',
    conversationId: string,
    msg: CrmMessage,
  ): Promise<void> {
    // ⚠️ La fecha va como ISO, no como `Date`. En un `sql` crudo no hay columna
    // de la que deducir el tipo, así que el driver recibe el objeto y falla con
    // un `TypeError` que este `catch` se tragaría **en silencio**: no se
    // anotaría ningún tramo y las métricas quedarían en cero para siempre, sin
    // un solo error a la vista.
    const cuando = new Date(msg.createdAt).toISOString();
    try {
      if (direction === 'outbound') {
        await db.execute(sql`
          UPDATE crm_conversation_segments
             SET first_response_at = ${cuando}
           WHERE conversation_id = ${conversationId}
             AND resolved_at IS NULL
             AND first_response_at IS NULL
        `);
        return;
      }
      await db.execute(sql`
        INSERT INTO crm_conversation_segments (conversation_id, started_at)
        VALUES (${conversationId}, ${cuando})
        ON CONFLICT (conversation_id) WHERE resolved_at IS NULL DO NOTHING
      `);
    } catch (err) {
      this.logger.warn(
        `No se pudo anotar el tramo de ${conversationId}: ${(err as Error).message}`,
      );
    }
  }

  /** Historial de mensajes de una conversación (más nuevos primero). */
  async listMessages(
    db: TenantDb,
    conversationId: string,
    limit = 50,
  ): Promise<CrmMessage[]> {
    const rows = await db
      .select()
      .from(crmMessages)
      .where(eq(crmMessages.conversationId, conversationId))
      .orderBy(desc(crmMessages.createdAt))
      .limit(limit);
    return Promise.all(rows.map((r) => this.hydrateMessage(r)));
  }

  // ── Adjuntos ──────────────────────────────────────────────────────────────

  /**
   * Valida y limpia los adjuntos que manda el cliente en un mensaje. Descarta
   * cualquiera que no pertenezca al namespace del tenant (`tenants/<slug>/chat/`
   * → anti cross-tenant), con MIME no permitido o tamaño fuera de rango. Devuelve
   * objetos limpios SIN url (la url se rehidrata al leer). Tope de cantidad.
   */
  sanitizeAttachments(raw: unknown, tenantSlug: string): ChatAttachment[] {
    if (!Array.isArray(raw)) return [];
    const prefix = `tenants/${tenantSlug}/chat/`;
    const out: ChatAttachment[] = [];
    for (const item of raw.slice(0, CHAT_ATTACHMENT_MAX_COUNT)) {
      const a = item as Partial<ChatAttachment>;
      if (typeof a?.storageKey !== 'string' || !a.storageKey.startsWith(prefix)) {
        continue;
      }
      if (typeof a.mime !== 'string' || !CHAT_ATTACHMENT_MIMES.has(a.mime)) {
        continue;
      }
      const size = typeof a.sizeBytes === 'number' ? a.sizeBytes : 0;
      if (size <= 0 || size > CHAT_ATTACHMENT_MAX_BYTES) continue;
      out.push({
        storageKey: a.storageKey,
        mime: a.mime,
        sizeBytes: size,
        name: typeof a.name === 'string' ? a.name.slice(0, 120) : 'adjunto',
        kind: a.mime === 'application/pdf' ? 'pdf' : 'image',
      });
    }
    return out;
  }

  /** Rehidrata la `url` de cada adjunto (las de R2 vencen) a partir del storageKey. */
  private async hydrateMessage(msg: CrmMessage): Promise<CrmMessage> {
    // `attachments` es jsonb, o sea `unknown` en el esquema. Se anota el tipo
    // del array para que los elementos sean `unknown` y no `any`: con `any`,
    // devolver un adjunto sin tocar se cuela sin que nadie lo mire.
    const atts: unknown[] = Array.isArray(msg.attachments)
      ? (msg.attachments as unknown[])
      : [];
    if (atts.length === 0) return msg;
    const hydrated = await Promise.all(
      atts.map(async (item) => {
        const a = item as ChatAttachment;
        if (!a?.storageKey) return item;
        try {
          const url = await this.storage.getUrl(a.storageKey);
          return { ...a, url };
        } catch {
          return item;
        }
      }),
    );
    return { ...msg, attachments: hydrated };
  }

  // ── Lado operador ────────────────────────────────────────────────────────

  /**
   * Bandeja del operador: sus conversaciones NO resueltas (open|pending), con
   * los datos mínimos del contacto, ordenadas por actividad reciente. El ruteo
   * "solo el operador directo" ya se aplicó al asignar `assignedOperatorId`; acá
   * solo listamos lo suyo (nunca ve conversaciones de otro operador).
   */
  async listOperatorInbox(
    db: TenantDb,
    operatorId: string,
    opciones: { limit?: number; resueltas?: boolean } = {},
  ): Promise<OperatorInboxItem[]> {
    const limit = opciones.limit ?? 100;
    const filas = await db
      .select({
        conversation: crmConversations,
        channelType: crmChannels.type,
        /**
         * El último mensaje, como **subconsulta correlacionada** y no como una
         * consulta por fila.
         *
         * Hacerlo desde el código —traer la lista y después pedir el último
         * mensaje de cada una— serían cien viajes a la base para abrir la
         * bandeja. Acá va todo en la misma consulta, y cada subconsulta usa el
         * índice `crm_messages_conv_idx (conversation_id, created_at)`
         * recorriéndolo hacia atrás: una búsqueda de índice por conversación,
         * no un scan.
         *
         * `body` puede venir vacío: es un mensaje que era sólo un adjunto.
         */
        lastMessageBody: sql<string | null>`(
          SELECT m.body
            FROM crm_messages m
           WHERE m.conversation_id = ${crmConversations.id}
           ORDER BY m.created_at DESC
           LIMIT 1
        )`,
        /**
         * El último mensaje **del cliente**, para la ventana de 24 h (**3.4**).
         *
         * Va aparte del de arriba y no se deriva de él: el último mensaje de la
         * conversación suele ser del operador, y **lo que abre la ventana es que
         * hable el cliente**. Usarlo al revés daría 24 horas nuevas cada vez que
         * el operador escribe, que es exactamente lo contrario de la regla.
         *
         * Mismo índice `crm_messages_conv_idx (conversation_id, created_at)`
         * recorrido hacia atrás. El filtro por `direction` mira algunas filas más
         * antes de encontrar la primera entrante — en un hilo donde el operador
         * mandó veinte seguidos, veinte— y sigue siendo una búsqueda de índice.
         */
        ultimoInboundAt: sql<string | null>`(
          SELECT m.created_at
            FROM crm_messages m
           WHERE m.conversation_id = ${crmConversations.id}
             AND m.direction = 'inbound'
           ORDER BY m.created_at DESC
           LIMIT 1
        )`,
        contact: {
          id: crmContacts.id,
          displayName: crmContacts.displayName,
          userId: crmContacts.userId,
          isLead: crmContacts.isLead,
          phone: crmContacts.phone,
          username: users.username,
          userDisplayName: users.displayName,
        },
      })
      .from(crmConversations)
      .innerJoin(crmContacts, eq(crmContacts.id, crmConversations.contactId))
      .innerJoin(crmChannels, eq(crmChannels.id, crmConversations.channelId))
      .leftJoin(users, eq(users.id, crmContacts.userId))
      .where(
        and(
          eq(crmConversations.assignedOperatorId, operatorId),
          // ── Las resueltas se piden aparte, no vienen de arrastre ───────────
          //
          // La bandeja del CRM tiene una pestaña "Resueltas", así que hay que
          // poder traerlas. Pero **no** mezcladas: con un tope de 100 filas, un
          // historial de conversaciones cerradas le comería el lugar a las
          // abiertas, que son las que alguien está esperando que le contesten.
          //
          // Por eso es un pedido explícito y no un filtro del cliente: el
          // default sigue siendo exactamente el de antes.
          opciones.resueltas
            ? eq(crmConversations.status, 'resolved')
            : ne(crmConversations.status, 'resolved'),
        ),
      )
      .orderBy(sql`${crmConversations.lastMessageAt} desc nulls last`)
      .limit(limit);

    return this.conEtiquetas(db, filas);
  }

  /**
   * Una sola fila de la bandeja, por id de conversación.
   *
   * Existe para poder abrir una conversación que **no está en la lista
   * cargada** — por ejemplo una resuelta, entrando desde Contactos. Sin esto la
   * pantalla la marcaba como elegida y dibujaba la columna vacía, sin error.
   *
   * Filtra por bandeja igual que `listOperatorInbox`: no es una puerta de atrás
   * para leer la conversación de otro.
   */
  async getInboxItem(
    db: TenantDb,
    conversationId: string,
    operatorId: string,
  ): Promise<OperatorInboxItem | null> {
    const filas = await db
      .select({
        conversation: crmConversations,
        channelType: crmChannels.type,
        lastMessageBody: sql<string | null>`(
          SELECT m.body
            FROM crm_messages m
           WHERE m.conversation_id = ${crmConversations.id}
           ORDER BY m.created_at DESC
           LIMIT 1
        )`,
        /**
         * El último mensaje **del cliente**, para la ventana de 24 h (**3.4**).
         *
         * Va aparte del de arriba y no se deriva de él: el último mensaje de la
         * conversación suele ser del operador, y **lo que abre la ventana es que
         * hable el cliente**. Usarlo al revés daría 24 horas nuevas cada vez que
         * el operador escribe, que es exactamente lo contrario de la regla.
         *
         * Mismo índice `crm_messages_conv_idx (conversation_id, created_at)`
         * recorrido hacia atrás. El filtro por `direction` mira algunas filas más
         * antes de encontrar la primera entrante — en un hilo donde el operador
         * mandó veinte seguidos, veinte— y sigue siendo una búsqueda de índice.
         */
        ultimoInboundAt: sql<string | null>`(
          SELECT m.created_at
            FROM crm_messages m
           WHERE m.conversation_id = ${crmConversations.id}
             AND m.direction = 'inbound'
           ORDER BY m.created_at DESC
           LIMIT 1
        )`,
        contact: {
          id: crmContacts.id,
          displayName: crmContacts.displayName,
          userId: crmContacts.userId,
          isLead: crmContacts.isLead,
          phone: crmContacts.phone,
          username: users.username,
          userDisplayName: users.displayName,
        },
      })
      .from(crmConversations)
      .innerJoin(crmContacts, eq(crmContacts.id, crmConversations.contactId))
      .innerJoin(crmChannels, eq(crmChannels.id, crmConversations.channelId))
      .leftJoin(users, eq(users.id, crmContacts.userId))
      .where(
        and(
          eq(crmConversations.id, conversationId),
          eq(crmConversations.assignedOperatorId, operatorId),
        ),
      )
      .limit(1);

    const conEtiquetas = await this.conEtiquetas(db, filas);
    return conEtiquetas[0] ?? null;
  }

  /**
   * Le pega las etiquetas a las filas de la bandeja.
   *
   * **Una consulta para todas**, no una por contacto: se piden las etiquetas de
   * los contactos que ya salieron y se agrupan en memoria. Con cien filas, eso
   * es una consulta más — la versión ingenua serían cien.
   *
   * No va como subconsulta adentro de la anterior porque son varias filas por
   * contacto: habría que agregarlas a jsonb ahí adentro y el resultado se lee
   * bastante peor que esto.
   */
  private async conEtiquetas(
    db: TenantDb,
    filas: Array<
      Omit<OperatorInboxItem, 'tags' | 'ventana'> & {
        /** Crudo de la consulta; acá se convierte en la ventana. */
        ultimoInboundAt: string | Date | null;
      }
    >,
  ): Promise<OperatorInboxItem[]> {
    if (filas.length === 0) return [];

    const contactIds = [...new Set(filas.map((f) => f.contact.id))];
    const asignadas = await db
      .select({
        contactId: crmContactTags.contactId,
        id: crmTags.id,
        label: crmTags.label,
        color: crmTags.color,
      })
      .from(crmContactTags)
      .innerJoin(crmTags, eq(crmTags.id, crmContactTags.tagId))
      .where(inArray(crmContactTags.contactId, contactIds));

    const porContacto = new Map<string, OperatorInboxItem['tags']>();
    for (const t of asignadas) {
      const lista = porContacto.get(t.contactId) ?? [];
      lista.push({ id: t.id, label: t.label, color: t.color });
      porContacto.set(t.contactId, lista);
    }

    // La ventana se calcula acá, en el único lugar por el que pasan las dos
    // consultas de la bandeja. Hacerlo en cada una sería dos copias de la misma
    // regla, y la que se olvide de actualizarse deja de avisar en silencio.
    return filas.map(({ ultimoInboundAt, ...f }) => ({
      ...f,
      tags: porContacto.get(f.contact.id) ?? [],
      ventana: ventanaDe({
        channelType: f.channelType,
        ultimoInbound: ultimoInboundAt,
      }),
    }));
  }

  /**
   * Conversación SOLO si está asignada a este operador (barrera de autorización
   * para responder/abrir/marcar leído). Devuelve null si no es suya.
   */
  async getConversationForOperator(
    db: TenantDb,
    conversationId: string,
    operatorId: string,
  ): Promise<CrmConversation | null> {
    const rows = await db
      .select()
      .from(crmConversations)
      .where(
        and(
          eq(crmConversations.id, conversationId),
          eq(crmConversations.assignedOperatorId, operatorId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Anota qué pasó cuando el mensaje salió para un canal externo (**2.7**).
   *
   * Se llama **después** de que el mensaje ya está guardado y ya se le mostró
   * al operador: mandar primero y guardar después le haría perder lo que
   * escribió cada vez que el proveedor falle.
   *
   * Los dos campos son excluyentes por construcción —o lo aceptaron, o no— y
   * juntos dan los tres estados que documenta la migración `0114`.
   *
   * Devuelve el mensaje actualizado para que quien llame pueda re-emitirlo: el
   * operador tiene que ver la marca de "no llegó" sin recargar nada.
   */
  async marcarEntrega(
    db: TenantDb,
    messageId: string,
    resultado: { entregado: boolean; channelMessageId?: string; error?: string },
  ): Promise<void> {
    await db
      .update(crmMessages)
      .set(
        resultado.entregado
          ? {
              deliveredAt: new Date(),
              deliveryError: null,
              ...(resultado.channelMessageId
                ? { channelMessageId: resultado.channelMessageId }
                : {}),
            }
          : {
              deliveredAt: null,
              // Recortado: viene de un proveedor externo y termina en una
              // columna que se muestra en el panel.
              deliveryError: (resultado.error ?? 'No se pudo entregar.').slice(
                0,
                500,
              ),
            },
      )
      .where(eq(crmMessages.id, messageId));
  }

  /** Resetea el contador de no-leídos del operador (cuando abre la conversación). */
  async markReadForOperator(
    db: TenantDb,
    conversationId: string,
  ): Promise<void> {
    await db
      .update(crmConversations)
      .set({ unreadForOperator: 0 })
      .where(eq(crmConversations.id, conversationId));
  }

  /**
   * Cambia el estado de una conversación de la bandeja de `inboxOwnerId`.
   *
   * Los tres estados ya existían en la tabla y **nada los escribía**: la
   * columna estaba puesta desde que se creó el livechat y ninguna acción la
   * tocaba. Esto es esa acción.
   *
   *   `open`      alguien espera respuesta
   *   `pending`   se respondió y se espera algo de afuera (un comprobante,
   *               que se acredite una transferencia)
   *   `resolved`  terminado — hasta que la persona vuelva a escribir, y ahí
   *               **se reabre este mismo hilo** (`D11`)
   *
   * Resolver **marca leído**: el operador acaba de actuar sobre la
   * conversación, dejarla con no-leídos sería mentir en el badge.
   *
   * El filtro por `assigned_operator_id` no es una comodidad: es lo que impide
   * cerrar una conversación de otra bandeja sabiendo su id.
   */
  async setConversationStatus(
    db: TenantDb,
    params: {
      conversationId: string;
      inboxOwnerId: string;
      status: 'open' | 'pending' | 'resolved';
    },
  ): Promise<CrmConversation | null> {
    const filas = await db
      .update(crmConversations)
      .set({
        status: params.status,
        updatedAt: new Date(),
        ...(params.status === 'resolved' ? { unreadForOperator: 0 } : {}),
      })
      .where(
        and(
          eq(crmConversations.id, params.conversationId),
          eq(crmConversations.assignedOperatorId, params.inboxOwnerId),
        ),
      )
      .returning();
    const conv = filas[0];
    if (!conv) return null;

    // Resolver **cierra el tramo**: es el único momento en que un tramo
    // termina. Va después del `UPDATE` y sólo si devolvió fila, así que el
    // filtro por bandeja también protege esto — nadie cierra la medición de
    // una conversación ajena sabiendo su id.
    if (params.status === 'resolved') {
      try {
        await db.execute(sql`
          UPDATE crm_conversation_segments
             SET resolved_at = now()
           WHERE conversation_id = ${params.conversationId}
             AND resolved_at IS NULL
        `);
      } catch (err) {
        this.logger.warn(
          `No se pudo cerrar el tramo de ${params.conversationId}: ${(err as Error).message}`,
        );
      }
    }
    return conv;
  }

  /**
   * Sube el no-leído del operador de una conversación.
   *
   * Existe por el aviso de derivación (`D8`), que es un mensaje `system`:
   * `postMessage` **no toca ningún contador** para esos, porque un mensaje del
   * sistema no es de nadie. Pero un aviso sí está dirigido al operador, y sin
   * badge no lo vería nadie — que es exactamente lo que el aviso viene a
   * evitar.
   */
  async bumpUnreadForOperator(
    db: TenantDb,
    conversationId: string,
  ): Promise<void> {
    await db
      .update(crmConversations)
      .set({
        unreadForOperator: sql`${crmConversations.unreadForOperator} + 1`,
      })
      .where(eq(crmConversations.id, conversationId));
  }

  // ── Lado jugador (widget) ─────────────────────────────────────────────────

  /**
   * Conversación abierta del jugador (para el widget). FIND-ONLY: no crea nada
   * (así abrir el widget no genera conversaciones vacías; solo `message:send`
   * crea). Devuelve null si el jugador todavía no escribió nunca.
   */
  async findOpenConversationForUser(
    db: TenantDb,
    userId: string,
  ): Promise<CrmConversation | null> {
    const contact = (
      await db
        .select({ id: crmContacts.id })
        .from(crmContacts)
        .where(eq(crmContacts.userId, userId))
        .limit(1)
    )[0];
    if (!contact) return null;
    const open = (
      await db
        .select()
        .from(crmConversations)
        .where(
          and(
            eq(crmConversations.contactId, contact.id),
            ne(crmConversations.status, 'resolved'),
          ),
        )
        .orderBy(sql`${crmConversations.lastMessageAt} desc nulls last`)
        .limit(1)
    )[0];
    return open ?? null;
  }

  /** Resetea el no-leído del jugador (cuando abre/lee el widget). */
  async markReadForContact(
    db: TenantDb,
    conversationId: string,
  ): Promise<void> {
    await db
      .update(crmConversations)
      .set({ unreadForContact: 0 })
      .where(eq(crmConversations.id, conversationId));
  }
}
