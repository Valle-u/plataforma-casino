-- Diseño por socio independiente (Etapa 1).
-- Tabla partner_branding: cada socio independiente puede tener su propia versión
-- visual del casino. `config` = misma forma que el design.config del tenant
-- (colors/texts/brand/slides). Un socio = un diseño (UNIQUE en owner_user_id).
-- Aditiva: si un socio no tiene fila acá, su red ve el diseño default del tenant.

CREATE TABLE IF NOT EXISTS "partner_branding" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_user_id" uuid NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE cascade,
  "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
