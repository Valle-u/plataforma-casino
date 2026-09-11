-- 0119 · Permiso `crm.close_network` — cerrar la red de un socio (D14 + D24).
--
-- Hermano de `users.intervene_independent` (migracion 0062), y por la misma
-- razon: es un cruce hacia una red independiente que la LEY R6 prohibe en
-- general y que el dueño autorizo para un caso concreto.
--
-- La diferencia con el otro: `intervene_independent` deja INTERVENIR una red que
-- sigue operando; este deja LEER EL HISTORIAL de una que dejo de operar. El
-- primero se usa y se termina; este abre algo que ya no se cierra.
--
-- Por eso: solo admin_tenant, NO DELEGABLE, motivo obligatorio y auditado.
--
--   - No delegable porque un empleado no puede decidir abrir años de
--     conversaciones privadas de terceros. D14 le deja LEER lo que se abrio; no
--     le deja abrirlo.
--   - Motivo obligatorio porque dentro de un año es lo unico que va a explicar
--     por que el staff puede leer eso. "Se fue" y "lo echamos" habilitan lo
--     mismo y no significan lo mismo.
--
-- ⚠️ Y algo que este permiso NO da: tocar la plata de esa red. E8 y P3 siguen
-- intactos — cerrar una red es visibilidad del CRM y nada mas.

INSERT INTO permissions (code, category, description, audit_required, is_delegatable)
VALUES (
  'crm.close_network',
  'crm',
  'Cerrar la red de un socio independiente: sus contactos y conversaciones pasan a la bandeja central y el staff lee el historial completo (D14, excepcion autorizada a R6). IRREVERSIBLE. Solo admin, NO delegable, con motivo obligatorio.',
  true,
  false
)
ON CONFLICT (code) DO NOTHING;

-- Al rol admin_tenant, como todos los permisos del catalogo.
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'crm.close_network'
FROM roles r
WHERE r.code = 'admin_tenant'
ON CONFLICT DO NOTHING;
