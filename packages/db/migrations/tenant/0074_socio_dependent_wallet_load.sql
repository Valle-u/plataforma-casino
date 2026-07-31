-- 0074 · R3 (cambio autorizado por el dueño 2026-07-31): el socio DEPENDIENTE
-- recupera `wallet.load`.
--
-- El dueño detectó que al entrar al panel de un socio directo no había botón
-- para cargarle fichas a los usuarios de su red. Tras consulta, autorizó
-- EXPLÍCITAMENTE cambiar R3: el socio dependiente SÍ carga fichas de SU wallet
-- a los jugadores de su red (canal de reventa). La 0059 le había sacado
-- `wallet.load` del rol (modelo "comercial puro"); esta migración lo devuelve
-- al rol socio SOLAMENTE (distribuidor y cajero dependientes siguen sin
-- mover plata — R3 intacto para ellos).
--
-- Los revoke-overrides de `wallet.load` ya fueron limpiados por la 0059
-- (paso 2), así que el rol alcanza para que el socio dependiente lo tenga
-- efectivo. Los socios INDEPENDIENTES además lo conservan por el cálculo
-- dinámico de EffectivePermissionsService (R4) — el rol no los rompe.

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'wallet.load'
FROM roles r
WHERE r.code = 'socio'
ON CONFLICT DO NOTHING;
