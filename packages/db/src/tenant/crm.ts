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
 * Contacto unificado: un jugador registrado O un lead anónimo/externo. El
 * `phone` (E.164) es la llave de auto-merge (lead web + WhatsApp + jugador = 1).
 */
export const crmContacts = pgTable(
  'crm_contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** FK al jugador si ya se registró; null = lead anónimo/externo. */
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    displayName: text('display_name'),
    /** Teléfono normalizado E.164 — llave de merge para omnicanal. */
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
  }),
);

/**
 * Instancia de canal. Hoy una fila `web-livechat` por tenant; a futuro una por
 * número de WhatsApp, etc. `type` ∈ web-livechat|whatsapp|sms|telegram|email.
 */
export const crmChannels = pgTable('crm_channels', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: text('type').notNull(),
  config: jsonb('config').notNull().default({}),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

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
