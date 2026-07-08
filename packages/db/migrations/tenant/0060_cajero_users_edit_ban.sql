-- 0060 · Cajero: gestión de sus jugadores (users.edit + users.ban).
--
-- El rol cajero ya podía crear/resetear sus jugadores; le faltaba editar y
-- banear. Es GESTIÓN comercial (NO mueve plata), scopeada a su sub-red por el
-- ScopeGuard (el endpoint PATCH /tenant/users/:id lleva @ScopeTarget). Aplica a
-- cajeros dependientes e independientes por igual. Cierra el gap #2 de jerarquías.

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, v.code
FROM roles r
CROSS JOIN (VALUES ('users.edit'), ('users.ban')) AS v(code)
WHERE r.code = 'cajero'
ON CONFLICT DO NOTHING;
