-- 0120 · El Telegram de cada operador, para avisarle (CRM 4.5, D25).
--
-- Tapa el hueco que D16 y D17 dejan juntos, y que D16 escribio de frente:
--
--   03:14  Juan escribe.
--          -> Juan no recibe nada     (D17: sin respuestas automaticas)
--          -> Perez no se entera      (D16: solo el panel, y esta cerrado)
--   09:20  Perez abre el panel y recien ahi existe el mensaje.
--
-- Seis horas en las que ninguna de las dos partes tiene señal de nada. Y si
-- Perez no abre el panel en dos dias, nadie en el sistema lo sabe: por D10 el
-- socio tampoco lo ve.
--
-- ── Por que hace falta un codigo ───────────────────────────────────────────
--
-- No es una decision nuestra: UN BOT DE TELEGRAM SOLO PUEDE HABLARLE A QUIEN LE
-- ESCRIBIO A EL. No hay forma de que inicie la conversacion. Asi que el operador
-- saca un codigo del panel, le manda `/start <codigo>` al bot de alertas, y
-- recien ahi tenemos su `chat_id`.
--
-- El codigo lleva el SLUG DEL CASINO adentro (`demo-A3F9K2`) porque el bot de
-- alertas es uno solo para toda la plataforma: al llegar un `/start` hay que
-- saber de que casino es ANTES de poder abrir su base. Es el mismo problema que
-- D23 con WhatsApp, resuelto mas barato — el codigo es efimero y lo tipea una
-- persona, asi que no justifica una tabla en la DB de control.
--
-- El codigo VENCE a proposito: uno eterno tirado en un chat o en una captura
-- sigue sirviendo para desviar los avisos de ese operador a otro Telegram.
--
-- Aditiva: crea una tabla nueva y no toca ningun dato existente.
CREATE TABLE "crm_operator_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"chat_id" text,
	"link_code" text,
	"link_code_expires_at" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"linked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_operator_alerts_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "crm_operator_alerts" ADD CONSTRAINT "crm_operator_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- El webhook busca por codigo en cada `/start`. Parcial: los codigos ya usados
-- quedan en NULL y no tienen por que ocupar lugar en el indice.
CREATE UNIQUE INDEX "crm_operator_alerts_link_code_idx" ON "crm_operator_alerts" USING btree ("link_code") WHERE "link_code" IS NOT NULL;
