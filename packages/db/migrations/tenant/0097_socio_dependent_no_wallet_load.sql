-- 0097 · R3 (cambio autorizado por el dueño 2026-08-19): el socio DEPENDIENTE
-- vuelve a ser "comercial puro" — NO carga fichas. Revierte la 0074.
--
-- Razón (dueño): toda la operativa de la red dependiente la manejan el admin y
-- sus empleados; no tiene sentido que el socio dependiente tenga fichas ni las
-- revenda. Se saca `wallet.load` del rol socio → queda igual que distribuidor y
-- cajero dependientes (sin mover plata).
--
-- Los socios INDEPENDIENTES conservan `wallet.load` por el cálculo dinámico de
-- EffectivePermissionsService (R4: si el user o un ancestro es
-- is_independent_branch, se suman los 7 permisos de plata). Sacarlo del rol NO
-- los afecta — solo cierra el canal para los dependientes.
DELETE FROM role_permissions rp
USING roles r
WHERE rp.role_id = r.id
  AND r.code = 'socio'
  AND rp.permission_code = 'wallet.load';
