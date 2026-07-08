-- 0058 · Backfill: sacarle wallet.load / wallet.unload a la red DEPENDIENTE.
--
-- LEY R3/P3 (docs/LEYES.md): los operadores de una red DEPENDIENTE son
-- comerciales puros — NO mueven fichas. Toda la plata central la manejan solo
-- el admin + sus empleados. El 0057 les revocó aprobar dep/retiros + correct +
-- burn + inject, pero se olvidó de wallet.load / wallet.unload: un cajero/socio
-- dependiente conservaba esos permisos por el rol y podía cargar/quitar fichas
-- de sus jugadores (drenar un balance, moverlo entre jugadores). Hallazgo de la
-- auditoría económica 2026-07, confirmado en vivo.
--
-- Esta migración es el gemelo del 0057 para los 4 codes nuevos (`wallet.load`,
-- `wallet.load_admin_network`, `wallet.unload`, `wallet.unload_admin_network`).
-- Cubre a los usuarios de red dependiente creados ANTES; los NUEVOS ya quedan
-- cubiertos por F1.1a (DEPENDENT_BRANCH_EMPLOYEE_DENY_PERMISSIONS en runtime).
--
-- Target: cada socio con is_independent_branch != true, MÁS todos sus
-- descendientes (recursivo por user_hierarchy), EXCLUYENDO la sub-red
-- independiente (los operadores independientes SÍ bancan su red, R4). Los
-- empleados directos del admin no cuelgan de un socio → quedan afuera (son el
-- staff que sí maneja plata). granted_by = NULL (backfill de sistema).
-- ON CONFLICT DO NOTHING: no pisa overrides previos.

WITH RECURSIVE
dep_socios AS (
  SELECT u.id
  FROM users u
  JOIN user_roles ur ON ur.user_id = u.id
  JOIN roles r ON r.id = ur.role_id
  WHERE r.code = 'socio'
    AND COALESCE(u.is_independent_branch, false) = false
),
indep_subtree AS (
  SELECT id AS uid FROM users WHERE COALESCE(is_independent_branch, false) = true
  UNION
  SELECT uh.user_id
  FROM user_hierarchy uh
  JOIN indep_subtree s ON uh.parent_user_id = s.uid
  WHERE uh.until IS NULL
),
dep_network AS (
  SELECT id AS uid FROM dep_socios
  UNION
  SELECT uh.user_id
  FROM user_hierarchy uh
  JOIN dep_network dn ON uh.parent_user_id = dn.uid
  WHERE uh.until IS NULL
),
targets AS (
  SELECT uid FROM dep_network
  WHERE uid NOT IN (SELECT uid FROM indep_subtree)
)
INSERT INTO user_permission_overrides
  (user_id, permission_code, effect, granted_by, granted_by_chain, reason)
SELECT t.uid, p.code, 'revoke', NULL, ARRAY[]::uuid[],
       'R3/P3 backfill: wallet.load/unload bloqueado (red de socio dependiente = comercial puro, no mueve fichas).'
FROM targets t
CROSS JOIN permissions p
WHERE p.code IN (
  'wallet.load', 'wallet.load_admin_network',
  'wallet.unload', 'wallet.unload_admin_network'
)
ON CONFLICT (user_id, permission_code) DO NOTHING;
