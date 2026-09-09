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
    config: jsonb('config').notNull().default({}),
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
    /** Id externo del mensaje (ej. WhatsApp) para idempotencia. */
    channelMessageId: text('channel_message_id'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
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
