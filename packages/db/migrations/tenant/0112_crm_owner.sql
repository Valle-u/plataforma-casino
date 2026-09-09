-- 0112 · Dueño del canal y dueño del contacto (CRM).
--
-- Implementa D1 y D6 de docs/crm/14-decisiones.md.
--
-- QUE RESUELVE
--
-- Hoy no hay forma de decir de QUIEN es un canal ni de quien es un contacto.
-- Con un solo canal (el widget web) no hacia falta: el ruteo lo resolvia la
-- jerarquia del jugador. Con WhatsApp y Telegram deja de alcanzar, porque un
-- numero pertenece a un panel concreto y lo que entra por ahi lo atiende ese
-- panel -- sepamos o no quien escribe.
--
--   D1  un canal pertenece a un panel, no al casino
--   D6  el contacto es de una bandeja: el mismo telefono tiene UNA FICHA POR
--       DUEÑO DE CANAL, y esas fichas no comparten conversaciones ni notas
--
-- NULL SIGNIFICA CENTRAL
--
-- Una sola columna nullable en vez de `owner_user_id` + `is_central`. Con dos
-- columnas se pueden escribir estados imposibles (is_central = true Y un dueño
-- puesto); con una, ese estado no se puede ni representar.
--
-- POR QUE NO HAY UNIQUE SOBRE crm_contacts.phone
--
-- Porque el mismo telefono existe A PROPOSITO en varias bandejas (D6). El
-- comentario viejo del schema decia que el telefono era "la llave de auto-merge
-- (lead web + WhatsApp + jugador = 1)": eso quedo ANULADO por D6 y nunca se
-- habia implementado. Si algun dia hace falta unicidad es por
-- (owner_user_id, phone), NUNCA por phone solo.
--
-- ADITIVA. Dos ADD COLUMN nullable, dos indices y un backfill. No se borra ni
-- se cambia el tipo de nada: con las columnas vacias todo sigue funcionando
-- igual que antes.

ALTER TABLE crm_channels
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE crm_contacts
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

-- BACKFILL del dueño de los contactos que ya existen.
--
-- Todos vienen del widget web, asi que la bandeja que hoy los atiende es la de
-- `crm_conversations.assigned_operator_id` -- que es exactamente lo que
-- `resolveAssignedOperator` escribio al crear la conversacion.
--
-- La traduccion a "dueño" no es directa: para la red central esa columna trae
-- el id del admin principal, y en el modelo nuevo central se representa con
-- NULL. Asi que un operador con rol `admin_tenant` o `empleado` -- los mismos
-- dos codigos que usa `CrmNetworkService.CENTRAL_ROLE_CODES` -- se mapea a
-- NULL, y cualquier otro se copia tal cual.
--
-- Cualquier otro operador es necesariamente de una red independiente: los
-- operadores de la red dependiente no tienen acceso al CRM (el guard los corta
-- con 403), asi que nunca aparecen en esta columna.
--
-- `DISTINCT ON (contact_id)` con la conversacion mas vieja: hoy hay un solo
-- canal, asi que en la practica hay una conversacion por contacto, pero si
-- hubiera dos el resultado tiene que ser determinista igual.
WITH bandeja AS (
  SELECT DISTINCT ON (c.contact_id)
         c.contact_id,
         c.assigned_operator_id
    FROM crm_conversations c
   WHERE c.assigned_operator_id IS NOT NULL
   ORDER BY c.contact_id, c.created_at
),
resuelto AS (
  SELECT b.contact_id,
         CASE
           WHEN EXISTS (
             SELECT 1
               FROM user_roles ur
               JOIN roles r ON r.id = ur.role_id
              WHERE ur.user_id = b.assigned_operator_id
                AND r.code IN ('admin_tenant', 'empleado')
           ) THEN NULL
           ELSE b.assigned_operator_id
         END AS owner_user_id
    FROM bandeja b
)
UPDATE crm_contacts ct
   SET owner_user_id = r.owner_user_id
  FROM resuelto r
 WHERE ct.id = r.contact_id
   AND r.owner_user_id IS NOT NULL;

-- El canal por el que entra un mensaje se lee en CADA mensaje entrante para
-- saber a que bandeja va. Parcial: los canales centrales tienen NULL y se
-- buscan por `IS NULL`, que este indice no cubre ni necesita cubrir.
CREATE INDEX IF NOT EXISTS crm_channels_owner_idx
  ON crm_channels (owner_user_id)
  WHERE owner_user_id IS NOT NULL;

-- La busqueda que hace D6 al llegar un mensaje: "el contacto de ESTA bandeja
-- con ESTE telefono". El orden importa -- (dueño, telefono) sirve para esa
-- consulta y tambien para listar la bandeja; (telefono, dueño) solo para la
-- primera.
CREATE INDEX IF NOT EXISTS crm_contacts_owner_phone_idx
  ON crm_contacts (owner_user_id, phone);
