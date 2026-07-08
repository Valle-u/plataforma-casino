-- 0062 · Intervención super-admin: permiso `users.intervene_independent`.
--
-- El ÚNICO cruce permitido hacia una sub-red INDEPENDIENTE (aislamiento E8/P3):
-- impersonar a un usuario que cae en una rama independiente exige este permiso
-- dedicado (separado de `users.impersonate`), motivo obligatorio y audit
-- severity critical. Solo admin_tenant, NO delegable.

INSERT INTO permissions (code, category, description, audit_required, is_delegatable)
VALUES (
  'users.intervene_independent',
  'users',
  'Intervenir (impersonate) en una sub-red INDEPENDIENTE — el único cruce permitido al aislamiento E8/P3. Solo admin, NO delegable, con motivo obligatorio + audit severity critical.',
  true,
  false
)
ON CONFLICT (code) DO NOTHING;

-- Otorgar al rol admin_tenant (como todos los permisos del catálogo).
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'users.intervene_independent'
FROM roles r
WHERE r.code = 'admin_tenant'
ON CONFLICT DO NOTHING;
