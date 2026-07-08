-- 0061 · Socio + distribuidor: reparentar dentro de su red (users.change_hierarchy).
--
-- Un socio/distribuidor puede reorganizar su propia sub-red (mover un operador o
-- jugador a otro punto DE SU red). El endpoint PUT /tenant/user-hierarchy/:id/parent
-- valida el scope: tanto el hijo movido COMO el nuevo padre deben caer en la
-- sub-red del actor (assertScope, con bypass admin_tenant). El cajero NO lo recibe
-- (arma su cartera pero no reordena la estructura). Cierra la otra mitad del gap #2.

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'users.change_hierarchy'
FROM roles r
WHERE r.code IN ('socio', 'distribuidor')
ON CONFLICT DO NOTHING;
