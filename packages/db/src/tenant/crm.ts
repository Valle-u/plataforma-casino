/**
 * CRM + Livechat (propio) — schema de tenant. Ver `docs/22-crm-livechat.md`.
 *
 * Modelo CONTACT-CENTRIC y agnóstico del canal: el livechat web es el canal #1;
 * WhatsApp/SMS/etc. son canales futuros que alimentan las MISMAS tablas vía
 * adapters. Todo vive en la DB del tenant (aislamiento físico como el resto).
 *
 * ⚠️ ADITIVO Y AISLADO: estas tablas son 100% nuevas — no tocan ni referencian
 * de forma destructiva nada existente (solo FKs read-only a `users`). El feature
 * está detrás del flag `CRM_ENABLED` (default OFF en prod): las tablas pueden
 * existir vacías sin ningún efecto hasta que se prenda el módulo. Ver §10 del doc.
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * Contacto: un jugador registrado O un lead anónimo/externo.
 *
 * ⚠️ **El contacto es de una bandeja, no del casino.** Un mismo teléfono puede
 * tener MÁS DE UNA fila: una por dueño de canal. Si Juan le escribe al WhatsApp
 * de su cajero y también al del casino, son dos contactos distintos que pueden
 * apuntar al mismo `user_id` — lo que se comparte es el jugador, no la
 * conversación. Es la lectura estricta de la LEY R6: sin ficha compartida no hay
 * superficie por la que se filtre la operación de una red independiente.
 *
 * Por eso el `phone` **NO es llave de merge** y su índice no es único. Decisión
 * D6 en `docs/crm/14-decisiones.md`; si algún día hace falta unicidad, es por
 * (dueño, teléfono), nunca por teléfono solo.
 */
export const crmContacts = pgTable(
  'crm_contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * **De qué bandeja es esta ficha. `NULL` = central.**
     *
     * Es lo que hace cierto **D6**: el mismo teléfono tiene **una ficha por
     * dueño de canal**. Si Juan le escribe al WhatsApp de su cajero y también
     * al del casino, hay dos filas acá — que pueden apuntar al mismo `user_id`,
     * porque lo que se comparte es el **jugador**, no la conversación.
     *
     * Mismo criterio que `crm_channels.owner_user_id`, incluida la advertencia
     * sobre `set null`.
     */
    ownerUserId: uuid('owner_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** FK al jugador si ya se registró; null = lead anónimo/externo. */
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    displayName: text('display_name'),
    /**
     * Teléfono normalizado a E.164. Sirve para encontrar al jugador y vincularlo
     * solo (D4), NO para unir contactos entre bandejas (D6). Si matchea con más
     * de un jugador no se vincula ninguno: mostrar el nombre equivocado es peor
     * que no mostrar ninguno.
     */
    phone: text('phone'),
    email: text('email'),
    /** true hasta que se linkea a un `user_id`. */
    isLead: boolean('is_lead').notNull().default(true),
    /** Datos libres / segmentación futura. */
    attributes: jsonb('attributes').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    phoneIdx: index('crm_contacts_phone_idx').on(t.phone),
    userIdx: index('crm_contacts_user_idx').on(t.userId),
    /**
     * La búsqueda de D6 al llegar un mensaje: *el contacto de ESTA bandeja con
     * ESTE teléfono*. El orden importa — `(dueño, teléfono)` sirve para esa
     * consulta **y** para listar una bandeja; `(teléfono, dueño)` sólo para la
     * primera.
     *
     * No es `unique`: el mismo teléfono existe a propósito en varias bandejas.
     */
    ownerPhoneIdx: index('crm_contacts_owner_phone_idx').on(
      t.ownerUserId,
      t.phone,
    ),
  }),
);

/**
 * Instancia de canal. Hoy una fila `web-livechat` por tenant; a futuro una por
 * número de WhatsApp, etc. `type` ∈ web-livechat|whatsapp|sms|telegram|email.
 */
export const crmChannels = pgTable(
  'crm_channels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').notNull(),
    /**
     * **De qué panel es este canal. `NULL` = central** (del casino).
     *
     * Es la **LEY D1**: un número de WhatsApp o un bot de Telegram pertenece a
     * un panel concreto —el socio, un distribuidor, un cajero—, no al casino en
     * general. Y de acá sale casi todo lo demás: quién atiende lo que entra por
     * este canal (D2), de quién es un desconocido que escribe (D5), y de quién
     * cuelga un jugador que se da de alta desde acá (D9).
     *
     * Una sola columna nullable, no `owner_user_id` + `is_central`: con dos se
     * pueden escribir estados imposibles (central **y** con dueño); con una,
     * ese estado no se puede ni representar.
     *
     * ⚠️ `set null` significa que si se borrara el usuario dueño, **el canal
     * pasaría a ser central en silencio** — o sea, sus conversaciones a la
     * bandeja del staff. Hoy no es un riesgo real porque los usuarios **no se
     * borran**, se desactivan (`users.status`). Si algún día se agrega el
     * borrado duro, esto hay que revisarlo contra R6.
     */
    ownerUserId: uuid('owner_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /**
     * Configuración del canal, según el tipo.
     *
     * ⚠️ **El token del bot va acá y va CIFRADO** (**D20**,
     * `apps/api/src/common/secreto-cifrado.ts`). Es la credencial que deja
     * actuar **como** el bot, y por **D13** es del socio, no nuestra. Nunca
     * guardar el valor en claro.
     */
    config: jsonb('config').notNull().default({}),
    /**
     * Lo que el proveedor nos devuelve para probar que el mensaje es suyo.
     *
     * Telegram manda en cada update el `secret_token` que se le registró en
     * `setWebhook`, en el header `X-Telegram-Bot-Api-Secret-Token`. Es lo único
     * que distingue un update real de cualquiera que le pegue a la URL.
     *
     * ⚠️ **No confundir con el token del bot.** Éste sólo sirve para verificar
     * **quién nos escribe**: si se filtra, alguien puede mandarnos mensajes
     * falsos — no leer los reales ni escribir como el bot. Por eso va en su
     * propia columna y sin cifrar: se compara en cada request entrante y una
     * columna se lee sin desarmar un `jsonb`.
     */
    webhookSecret: text('webhook_secret'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    ownerIdx: index('crm_channels_owner_idx').on(t.ownerUserId),
  }),
);

/**
 * Lo que llegó de un canal externo, **tal cual, antes de interpretarlo**.
 *
 * ## Por qué existe
 *
 * El orden al recibir un webhook es: **guardar el crudo → responder 200 →
 * recién ahí procesar**. Si el proceso falla —o el contenedor se reinicia en el
 * medio— el mensaje no se perdió: quedó acá y se puede reprocesar.
 *
 * Sin esta tabla, un reinicio en el momento equivocado **hace desaparecer el
 * mensaje de una persona real**, y no queda rastro de que existió.
 *
 * Es además el único lugar donde se puede ver qué mandó el proveedor cuando
 * algo no cuadra: un `body` distinto al esperado no se puede depurar contra lo
 * que quedó interpretado.
 */
export const crmRawEvents = pgTable(
  'crm_raw_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * De qué canal entró.
     *
     * `restrict` y no `cascade`: borrar un canal no puede llevarse la evidencia
     * de lo que pasó por él.
     */
    channelId: uuid('channel_id')
      .notNull()
      .references(() => crmChannels.id, { onDelete: 'restrict' }),
    /**
     * El id del proveedor, para cortar duplicados **antes** de procesar.
     * Nullable porque no todo evento trae uno.
     */
    externalId: text('external_id'),
    /** El cuerpo entero, sin tocar. */
    payload: jsonb('payload').notNull(),
    /**
     * `NULL` = todavía no se procesó.
     *
     * Buscar los `NULL` viejos es como se detecta que algo se está trabando —
     * candidato natural a un renglón del parte diario.
     */
    processedAt: timestamp('processed_at', { withTimezone: true }),
    /** Por qué falló, si falló. Se guarda para poder reprocesar a mano. */
    error: text('error'),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pendientesIdx: index('crm_raw_events_pendientes_idx').on(t.receivedAt),
  }),
);

/**
 * Conversación (hilo CONTINUO por contacto y canal) con estados por tramo.
 * `status` ∈ open|pending|resolved. Asignada al operador directo del jugador.
 */
export const crmConversations = pgTable(
  'crm_conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => crmContacts.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => crmChannels.id, { onDelete: 'restrict' }),
    /** Operador directo asignado (parent inmediato del jugador). */
    assignedOperatorId: uuid('assigned_operator_id').references(
      () => users.id,
      { onDelete: 'set null' },
    ),
    status: text('status').notNull().default('open'),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    unreadForOperator: integer('unread_for_operator').notNull().default(0),
    unreadForContact: integer('unread_for_contact').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    contactIdx: index('crm_conversations_contact_idx').on(t.contactId),
    operatorIdx: index('crm_conversations_operator_idx').on(
      t.assignedOperatorId,
    ),
    statusIdx: index('crm_conversations_status_idx').on(t.status),
  }),
);

/**
 * Mensaje normalizado (venga de un WS o de un webhook de canal externo).
 * `direction` ∈ inbound (del contacto) | outbound (del operador) | system.
 */
export const crmMessages = pgTable(
  'crm_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => crmConversations.id, { onDelete: 'cascade' }),
    direction: text('direction').notNull(),
    /** Operador que lo mandó; null si es del contacto o del sistema. */
    senderUserId: uuid('sender_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    body: text('body'),
    /** Array de { storageKey, url, mime, sizeBytes }. */
    attachments: jsonb('attachments').notNull().default([]),
    /**
     * Id del mensaje en el proveedor. **Es la idempotencia.**
     *
     * Telegram y Meta **reintentan** si tardamos en responder o si respondemos
     * algo que no sea 200. Sin unicidad, un reintento crea el mensaje dos veces
     * y el operador ve al jugador escribiendo duplicado.
     *
     * ⚠️ Chequearlo desde el código **no alcanza**: dos reintentos simultáneos
     * pasan los dos el `SELECT` antes de que cualquiera inserte. Por eso hay un
     * **índice único parcial** en la base (migración `0113`), que es lo único
     * que no tiene carrera.
     *
     * Parcial porque los mensajes del widget web no tienen id externo y son
     * todos `NULL`.
     */
    channelMessageId: text('channel_message_id'),
    /**
     * Cuándo el proveedor **aceptó** el mensaje (migración `0114`).
     *
     * Sólo aplica a los canales externos. En el widget web queda `NULL`: ahí no
     * hay proveedor que acepte nada, el mensaje se emite por socket.io.
     */
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    /**
     * Por qué **no** llegó, tal como lo explicó el proveedor.
     *
     * Con `delivered_at` forman los tres estados posibles sin ambigüedad: los
     * dos en `NULL` es "no aplica o en camino", uno u otro seteado es aceptado
     * o fallado. Un booleano no podría distinguir "todavía no" de "falló", ni
     * decir la causa — y la causa es lo accionable: *bot was blocked by the
     * user* se resuelve pidiéndole a la persona que lo desbloquee,
     * *Unauthorized* revinculando el bot.
     */
    deliveryError: text('delivery_error'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    convIdx: index('crm_messages_conv_idx').on(t.conversationId, t.createdAt),
  }),
);

/** Nota interna privada sobre un contacto (no la ve el jugador). */
export const crmNotes = pgTable(
  'crm_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => crmContacts.id, { onDelete: 'cascade' }),
    /** Autor de la nota; nullable + set null para conservar la nota si se borra el user. */
    authorUserId: uuid('author_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    contactIdx: index('crm_notes_contact_idx').on(t.contactId),
  }),
);

/** Catálogo de tags del CRM, PREDEFINIDOS por el tenant (ej. VIP, en riesgo). */
export const crmTags = pgTable('crm_tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  label: text('label').notNull(),
  color: text('color'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** M:N contacto ↔ tag. */
export const crmContactTags = pgTable(
  'crm_contact_tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => crmContacts.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => crmTags.id, { onDelete: 'cascade' }),
    assignedBy: uuid('assigned_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniq: unique('crm_contact_tags_uniq').on(t.contactId, t.tagId),
    contactIdx: index('crm_contact_tags_contact_idx').on(t.contactId),
  }),
);

/** Plantilla de respuesta rápida, POR tenant. */
export const crmTemplates = pgTable('crm_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  /** Atajo tipeable (ej. "/deposito") para insertarla. */
  shortcut: text('shortcut'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Línea de tiempo del contacto: chat + eventos de plataforma mezclados
 * (registered|deposit|withdrawal|bonus|blocked|message|…). Se llena en Etapa 2
 * con listeners fire-and-forget desde los flujos existentes (nunca en su camino
 * crítico). `ref_id` apunta al recurso (deposit/withdrawal/message).
 */
export const crmTimelineEvents = pgTable(
  'crm_timeline_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => crmContacts.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    refId: uuid('ref_id'),
    summary: text('summary').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    contactIdx: index('crm_timeline_contact_idx').on(t.contactId, t.occurredAt),
  }),
);

/**
 * **El tramo**: la unidad con la que se mide la atención (migración `0115`).
 *
 * Va desde que alguien escribe estando la conversación resuelta hasta que se
 * vuelve a marcar resuelta. Existe porque por **D11** el hilo es eterno —el que
 * escribió en marzo y vuelve en septiembre es la misma conversación—, así que
 * medir sobre la conversación mide la antigüedad del cliente, no la atención.
 *
 * ## Se anota cuando pasa, no se deriva
 *
 * Es lo contrario de Circuitos (**D22**), y a propósito: la etapa de un contacto
 * es un **estado actual** que siempre se puede recalcular; un tramo es
 * **historia**. `crm_conversations.status` es una columna mutable sin historial,
 * así que mirando los mensajes no hay forma de saber dónde terminaba un tramo y
 * empezaba el siguiente.
 *
 * ⚠️ **No hay backfill.** Las conversaciones que ya existían no tienen tramos y
 * no se les pueden inventar: la medición arranca el día que se instaló.
 *
 * ## Quién lo abre y quién lo responde
 *
 * Lo abre un `inbound` o un `system` (los avisos de **D8** cuentan, igual que en
 * el parte diario). **No lo abre un `outbound`**: si el operador escribe
 * primero no hay espera que medir, y ese tramo bajaría la mediana de todos los
 * demás sin que nadie haya atendido mejor.
 *
 * `firstResponseAt` sólo lo marca un `outbound`: un aviso del sistema no es una
 * respuesta al jugador.
 */
export const crmConversationSegments = pgTable(
  'crm_conversation_segments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => crmConversations.id, { onDelete: 'cascade' }),
    /** Cuándo llegó el mensaje que abrió el tramo. */
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Cuándo contestó el operador por primera vez. NULL = nadie contestó. */
    firstResponseAt: timestamp('first_response_at', { withTimezone: true }),
    /** Cuándo se marcó resuelta. NULL = el tramo sigue abierto. */
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => ({
    convIdx: index('crm_segments_conv_idx').on(t.conversationId, t.startedAt),
  }),
);

// ⚠️ El índice que importa de verdad —`crm_segments_abierto_idx`, ÚNICO y
// PARCIAL sobre `conversation_id WHERE resolved_at IS NULL`— vive sólo en la
// migración `0115`: drizzle no expresa índices parciales. Es lo que garantiza
// **un tramo abierto por conversación**, y no es una optimización: sin él, dos
// mensajes simultáneos abren dos tramos y todas las medianas mienten en
// silencio. Si algún día se regenera el esquema desde el código, hay que
// volver a agregarlo a mano.

// ── Tipos inferidos (para el módulo de la API) ────────────────────────────
export type CrmContact = typeof crmContacts.$inferSelect;
export type NewCrmContact = typeof crmContacts.$inferInsert;
export type CrmChannel = typeof crmChannels.$inferSelect;
export type CrmConversation = typeof crmConversations.$inferSelect;
export type NewCrmConversation = typeof crmConversations.$inferInsert;
export type CrmMessage = typeof crmMessages.$inferSelect;
export type NewCrmMessage = typeof crmMessages.$inferInsert;
export type CrmNote = typeof crmNotes.$inferSelect;
export type CrmTag = typeof crmTags.$inferSelect;
export type CrmContactTag = typeof crmContactTags.$inferSelect;
export type CrmTemplate = typeof crmTemplates.$inferSelect;
export type CrmTimelineEvent = typeof crmTimelineEvents.$inferSelect;
export type CrmConversationSegment =
  typeof crmConversationSegments.$inferSelect;
export type CrmRawEvent = typeof crmRawEvents.$inferSelect;
export type NewCrmRawEvent = typeof crmRawEvents.$inferInsert;
