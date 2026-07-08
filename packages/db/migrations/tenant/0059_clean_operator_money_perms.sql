-- 0059 · Modelo LIMPIO de permisos de plata (LEYES R3/R4).
--
-- Invierte el mecanismo: en vez de "el rol trae los permisos de mover plata y
-- se los DENEGAMOS a la red dependiente" (0057/0058 + F1.1a), pasa a "el rol NO
-- los trae y la INDEPENDENCIA los otorga DINÁMICAMENTE". Así un socio dependiente
-- creado por el admin tampoco los tiene (cierra el hueco), y un solo mecanismo
-- coherente rige todo.
--
-- El otorgamiento a la sub-red independiente NO se persiste como override: lo
-- calcula EffectivePermissionsService en runtime (si el user o un ancestro es
-- is_independent_branch, suma los 7). Por eso esta migración SOLO tiene que
-- (1) sacar los 7 del rol y (2) limpiar los revoke-overrides viejos.
--
-- Los 7 permisos de MOVER plata de un operador:
--   wallet.load, wallet.unload,
--   deposits.approve, deposits.reject,
--   withdrawals.approve, withdrawals.reject, withdrawals.process
--
-- (Los `.view`/`.export` se quedan en el rol: ver la red es comercial, R2.)

-- 1) Sacar los 7 del rol socio / distribuidor / cajero.
DELETE FROM role_permissions rp
USING roles r
WHERE rp.role_id = r.id
  AND r.code IN ('socio', 'distribuidor', 'cajero')
  AND rp.permission_code IN (
    'wallet.load', 'wallet.unload',
    'deposits.approve', 'deposits.reject',
    'withdrawals.approve', 'withdrawals.reject', 'withdrawals.process'
  );

-- 2) Limpiar los `revoke`-overrides redundantes de esos 7 codes. En el modelo
--    limpio el rol ya no los trae, así que un `revoke` no tiene efecto para un
--    dependiente y solo estorbaría el cálculo dinámico de un independiente
--    (EffectivePermissionsService respeta un revoke explícito). Los backfills
--    0057/0058 metieron estos revokes en la red dependiente; ya no hacen falta.
DELETE FROM user_permission_overrides
WHERE effect = 'revoke'
  AND permission_code IN (
    'wallet.load', 'wallet.unload',
    'deposits.approve', 'deposits.reject',
    'withdrawals.approve', 'withdrawals.reject', 'withdrawals.process'
  );
