-- CRM + Livechat (propio) — Etapa 0: modelo de datos. Ver docs/22-crm-livechat.md.
-- 100% ADITIVA e idempotente: solo CREA tablas/índices nuevos `crm_*`. No toca
-- ni una tabla/columna existente. Las únicas referencias son FKs read-only a
-- `users`. El feature vive detrás del flag CRM_ENABLED (default OFF): estas
-- tablas pueden existir vacías sin ningún efecto hasta que se prenda el módulo.

-- Contacto unificado (jugador registrado O lead anónimo). `phone` = llave de merge.
CREATE TABLE IF NOT EXISTS "crm_contacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "display_name" text,
  "phone" text,
  "email" text,
  "is_lead" boolean NOT NULL DEFAULT true,
  "attributes" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "crm_contacts_phone_idx" ON "crm_contacts" ("phone");
CREATE INDEX IF NOT EXISTS "crm_contacts_user_idx" ON "crm_contacts" ("user_id");

-- Instancia de canal (web-livechat ahora; whatsapp/sms/telegram/email futuros).
CREATE TABLE IF NOT EXISTS "crm_channels" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "type" text NOT NULL,
  "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- Conversación (hilo continuo por contacto+canal) con estados por tramo.
CREATE TABLE IF NOT EXISTS "crm_conversations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "contact_id" uuid NOT NULL REFERENCES "crm_contacts"("id") ON DELETE cascade,
  "channel_id" uuid NOT NULL REFERENCES "crm_channels"("id") ON DELETE restrict,
  "assigned_operator_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "status" text NOT NULL DEFAULT 'open',
  "last_message_at" timestamptz,
  "unread_for_operator" integer NOT NULL DEFAULT 0,
  "unread_for_contact" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "crm_conversations_contact_idx" ON "crm_conversations" ("contact_id");
CREATE INDEX IF NOT EXISTS "crm_conversations_operator_idx" ON "crm_conversations" ("assigned_operator_id");
CREATE INDEX IF NOT EXISTS "crm_conversations_status_idx" ON "crm_conversations" ("status");

-- Mensaje normalizado (WS o webhook de canal externo).
CREATE TABLE IF NOT EXISTS "crm_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "conversation_id" uuid NOT NULL REFERENCES "crm_conversations"("id") ON DELETE cascade,
  "direction" text NOT NULL,
  "sender_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "body" text,
  "attachments" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "channel_message_id" text,
  "delivered_at" timestamptz,
  "read_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "crm_messages_conv_idx" ON "crm_messages" ("conversation_id", "created_at");

-- Nota interna privada sobre un contacto.
CREATE TABLE IF NOT EXISTS "crm_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "contact_id" uuid NOT NULL REFERENCES "crm_contacts"("id") ON DELETE cascade,
  "author_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "body" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "crm_notes_contact_idx" ON "crm_notes" ("contact_id");

-- Catálogo de tags del CRM (predefinidos por el tenant).
CREATE TABLE IF NOT EXISTS "crm_tags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "label" text NOT NULL,
  "color" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- M:N contacto ↔ tag.
CREATE TABLE IF NOT EXISTS "crm_contact_tags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "contact_id" uuid NOT NULL REFERENCES "crm_contacts"("id") ON DELETE cascade,
  "tag_id" uuid NOT NULL REFERENCES "crm_tags"("id") ON DELETE cascade,
  "assigned_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "crm_contact_tags_uniq" UNIQUE ("contact_id", "tag_id")
);
CREATE INDEX IF NOT EXISTS "crm_contact_tags_contact_idx" ON "crm_contact_tags" ("contact_id");

-- Plantillas de respuesta rápida (por tenant).
CREATE TABLE IF NOT EXISTS "crm_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "title" text NOT NULL,
  "body" text NOT NULL,
  "shortcut" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- Timeline del contacto: chat + eventos de plataforma mezclados.
CREATE TABLE IF NOT EXISTS "crm_timeline_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "contact_id" uuid NOT NULL REFERENCES "crm_contacts"("id") ON DELETE cascade,
  "type" text NOT NULL,
  "ref_id" uuid,
  "summary" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "occurred_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "crm_timeline_contact_idx" ON "crm_timeline_events" ("contact_id", "occurred_at");
