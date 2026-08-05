-- Fase 3 (push notifications): infra de web-push.
--
--   1. Suma el canal 'web_push' al enum de notifications — el dispatcher
--      cron lo procesa como email/sms (envía a todas las suscripciones
--      del user).
--   2. Crea la tabla push_subscriptions: una fila por dispositivo
--      (endpoint único por tenant) con las claves de cifrado p256dh/auth
--      para enviar el mensaje cifrado contra el push service.

ALTER TYPE "public"."notification_channel" ADD VALUE 'web_push';--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"device_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint_unique" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");
