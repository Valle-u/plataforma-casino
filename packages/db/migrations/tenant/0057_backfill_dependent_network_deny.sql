-- H1a-1 backfill (modelo docs/20): sacarle los perms económicos ("botones de
-- plata") a TODA la red de los socios DEPENDIENTES que ya existían.
--
-- Modelo centralizado: solo el admin (y sus empleados DIRECTOS) manejan plata.
-- Un socio dependiente y toda su red (distribuidores / cajeros / empleados que
-- cuelgan de él) son COMERCIALES: no aprueban depósitos/retiros, no corrigen,
-- no queman ni fondean. F1.1a ya aplica esto a los usuarios NUEVOS creados por
-- una rama dependiente; esta migración cubre a los que se crearon ANTES.
--
-- Target: cada socio con is_independent_branch != true, MÁS todos sus
-- descendientes (recursivo por user_hierarchy). Se EXCLUYE cualquiera que esté
-- en una sub-red independiente. Los empleados directos del admin NO cuelgan de
-- un socio → quedan afuera (son el staff que SÍ maneja plata). Los operadores
-- independientes quedan afuera (manejan su propia plata).
--
-- Inserta overrides `revoke` sobre los codes de la deny-list de F1
-- (DEPENDENT_BRANCH_EMPLOYEE_DENY_PERMISSIONS). El JOIN con `permissions`
-- garantiza que solo se usan codes que existen en el catálogo del tenant (evita
-- fallo por FK si algún `*_admin_network` no está). granted_by = NULL (backfill
-- de sistema). ON CONFLICT DO NOTHING: NO pisa overrides ya existentes (respeta
-- cualquier grant/revoke explícito previo).

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
       'H1a-1 backfill: perm económico bloqueado (red de socio dependiente, modelo docs/20).'
FROM targets t
CROSS JOIN permissions p
WHERE p.code IN (
  'deposits.approve', 'deposits.approve_admin_network',
  'deposits.reject', 'deposits.reject_admin_network',
  'withdrawals.approve', 'withdrawals.approve_admin_network',
  'withdrawals.reject', 'withdrawals.reject_admin_network',
  'withdrawals.process', 'withdrawals.process_admin_network',
  'wallet.correct', 'wallet.correct_admin_network',
  'wallet.burn', 'house.inject_capital'
)
ON CONFLICT (user_id, permission_code) DO NOTHING;
