-- 0118 · El cierre de una red independiente (CRM, D14 + D24).
--
-- ── Esta tabla es la frontera de una excepcion a la LEY R6 ──────────────────
--
-- R6 dice que el admin ve de una red independiente solo agregados, no el
-- detalle interno. D14 autoriza una excepcion: cuando un socio deja de operar,
-- sus contactos y conversaciones pasan a la bandeja central y el staff
-- —INCLUIDOS LOS EMPLEADOS— lee el historial completo.
--
-- Y D14 dice tambien de que depende que eso sea legitimo:
--
--   "El disparador es el CIERRE DE LA RED, no una decision discrecional.
--    Cerrar una red tiene que ser un evento explicito y auditado —quien y
--    cuando—, PORQUE ESE EVENTO ES LO UNICO QUE SEPARA LO PERMITIDO DE LO
--    PROHIBIDO."
--
-- Una fila aca ES ese evento. No registra algo que paso en otro lado: es lo que
-- hace que leer esas conversaciones este permitido.
--
-- ── Por que el UNIQUE, y por que no se puede deshacer ──────────────────────
--
-- Es D24, y sale directo de la advertencia de D14: "si el cierre se puede hacer
-- y deshacer sin registro, la excepcion se convierte en un interruptor para
-- leer la red de cualquiera".
--
-- Con reversa, un admin puede cerrar una red cinco minutos, leer anios de
-- conversaciones privadas y reabrir. Queda auditado — pero una auditoria solo
-- sirve si alguien la lee, y para entonces el daño ya esta hecho.
--
-- El UNIQUE sobre socio_user_id es lo que lo sostiene: NO HAY FORMA DE CERRAR
-- DOS VECES, asi que tampoco de abrir y cerrar. Un cierre por error se arregla
-- a mano en la base, que es friccion a proposito.
--
-- ── Por que RESTRICT y no CASCADE ─────────────────────────────────────────
--
-- Borrar al socio no puede llevarse la constancia de que su red se cerro. Sin
-- esa fila, las conversaciones que se movieron quedarian en la bandeja central
-- SIN NADA QUE EXPLIQUE por que esta permitido leerlas.
--
-- Aditiva: crea una tabla nueva y no toca ningun dato existente.
CREATE TABLE "crm_network_closures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"socio_user_id" uuid NOT NULL,
	"closed_by" uuid NOT NULL,
	"reason" text NOT NULL,
	"contacts_moved" integer DEFAULT 0 NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_network_closures_socio_user_id_unique" UNIQUE("socio_user_id")
);
--> statement-breakpoint
ALTER TABLE "crm_network_closures" ADD CONSTRAINT "crm_network_closures_socio_user_id_users_id_fk" FOREIGN KEY ("socio_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_network_closures" ADD CONSTRAINT "crm_network_closures_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
