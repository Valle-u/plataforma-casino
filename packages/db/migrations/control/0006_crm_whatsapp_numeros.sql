-- 0006 · El mapeo `phone_number_id -> tenant` que exige D23.
--
-- Meta configura UNA sola URL de callback por App, asi que todos los mensajes de
-- todos los socios caen en el mismo endpoint y lo unico que dice de quien es
-- cada uno es el `phone_number_id` que viene ADENTRO del payload. Para abrir la
-- base de un casino hay que saber cual es ANTES de poder abrirla, asi que este
-- mapeo no puede vivir en la base del tenant: seria necesitar la respuesta para
-- poder hacer la pregunta.
--
-- Es la unica excepcion que P4 permite (la DB de control), y el mismo patron que
-- ya usan los callbacks de proveedores, que tampoco resuelven el tenant por Host.
--
-- `phone_number_id` es UNICO A NIVEL GLOBAL a proposito: dos casinos no pueden
-- reclamar el mismo numero. Un numero apuntado al tenant equivocado manda la
-- conversacion de un jugador a la bandeja de otro casino — eso es P4 roto, del
-- lado peor. Con el unique, eso falla al escribir en vez de fallar al enrutar.
--
-- `channel_id` apunta a `crm_channels` de la base DE ESE TENANT, asi que no
-- puede haber FK: son dos bases distintas.
--
-- Aditiva: crea una tabla nueva y no toca ningun dato existente.
--
-- ⚠️ DOS COSAS QUE LA 0005 DEJO ROTAS, arregladas aca. Leer antes de generar
-- la proxima migracion de control.
--
-- 1. NO EXISTE `meta/0005_snapshot.json`. La 0005 se escribio a mano y quedo en
--    el journal, pero nunca se genero su snapshot, asi que drizzle-kit comparo
--    contra el estado de la 0004 y volvio a emitir `gregmorn_callback_token`
--    aca dentro. Correr eso contra una base que ya la tiene falla con "column
--    already exists" y traba las migraciones. Se saco a mano. El
--    `0006_snapshot.json` SI la incluye, asi que de aca en adelante sale bien.
--
-- 2. LA 0005 SE FECHO EN EL FUTURO (`when: 1789300500000`, ~2026-09-12).
--    `drizzle-kit migrate` saltea toda entrada del journal con `when` menor o
--    igual al ultimo `created_at` aplicado. O sea que **cualquier migracion de
--    control generada antes de esa fecha se saltea EN SILENCIO**: dice
--    "migrations applied successfully" y no crea nada. Paso exactamente eso con
--    esta migracion la primera vez, y con `MIGRATE_ON_BOOT=1` habria pasado
--    igual en produccion — la tabla no existiria y el webhook fallaria sin que
--    el deploy diera ningun error. El `when` de esta entrada se corrigio a mano
--    para que quede despues. **Verificar el journal al generar la proxima.**
CREATE TABLE "whatsapp_numbers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"phone_number_id" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"waba_id" text,
	"display_number" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_numbers_phone_number_id_unique" UNIQUE("phone_number_id")
);
--> statement-breakpoint
ALTER TABLE "whatsapp_numbers" ADD CONSTRAINT "whatsapp_numbers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- El webhook busca por numero activo en cada mensaje que entra. El unique de
-- arriba ya da un indice sobre `phone_number_id`; este cubre el listado por
-- casino, que es lo que va a pedir la pantalla de canales.
CREATE INDEX "whatsapp_numbers_tenant_idx" ON "whatsapp_numbers" USING btree ("tenant_id");
