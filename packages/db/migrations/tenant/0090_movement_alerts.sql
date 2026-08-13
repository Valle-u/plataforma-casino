-- Movimientos sospechosos (fraude interno sobre el ledger). Tabla de alertas.
CREATE TYPE "movement_alert_severity" AS ENUM ('low', 'medium', 'high');
CREATE TYPE "movement_alert_status" AS ENUM ('suspected', 'confirmed', 'dismissed');

CREATE TABLE "movement_alerts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "rule" text NOT NULL,
  "actor_user_id" uuid,
  "subject_user_id" uuid,
  "amount" numeric(20, 2),
  "severity" "movement_alert_severity" DEFAULT 'medium' NOT NULL,
  "details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "period" text NOT NULL,
  "dedup_key" text NOT NULL,
  "status" "movement_alert_status" DEFAULT 'suspected' NOT NULL,
  "reviewed_by_user_id" uuid,
  "reviewed_at" timestamp with time zone,
  "detected_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "movement_alerts"
  ADD CONSTRAINT "movement_alerts_actor_user_id_fk"
  FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
ALTER TABLE "movement_alerts"
  ADD CONSTRAINT "movement_alerts_subject_user_id_fk"
  FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
ALTER TABLE "movement_alerts"
  ADD CONSTRAINT "movement_alerts_reviewed_by_user_id_fk"
  FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id");

CREATE UNIQUE INDEX "movement_alerts_dedup_uniq" ON "movement_alerts" ("dedup_key");
CREATE INDEX "movement_alerts_status_severity_idx" ON "movement_alerts" ("status", "severity");
CREATE INDEX "movement_alerts_actor_idx" ON "movement_alerts" ("actor_user_id");

-- Índice para atribuir movimientos por actor (las reglas filtran por created_by).
CREATE INDEX IF NOT EXISTS "wallet_tx_created_by_created" ON "wallet_transactions" ("created_by", "created_at");
