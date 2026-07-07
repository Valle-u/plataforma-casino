-- Blindar house.inject_capital a SOLO-ADMIN: pasa a NO delegable.
--
-- Modelo operativo (docs/20): en el modelo centralizado, SOLO el admin (y sus
-- empleados) manejan la plata/presupuesto. `house.inject_capital` es la ÚNICA
-- operación que crea fichas de la nada (mint a la Casa o a un operador indep).
-- Que fuera delegable permitía que el admin se lo prestara a un empleado, que
-- entonces podía mintear sin tope. Alineado con la decisión del dueño
-- (2026-07-06): el botón de presupuesto es solo del admin.
--
-- Al marcarlo is_delegatable=FALSE, el override service
-- (permission-overrides.service.ts) rechaza cualquier intento de delegarlo.
-- El admin_tenant lo sigue teniendo (bypass por rol). NO revoca overrides
-- ya existentes (si alguno fue delegado antes) — la política aplica a partir
-- de acá; revocar los viejos es un paso aparte si emerge la necesidad.
--
-- Idempotente: UPDATE por code (correr dos veces es no-op).

UPDATE permissions
SET
  is_delegatable = FALSE,
  description = 'Fondear la Casa: aporte de capital atado a bank_tx (estricto) o presupuesto (docs/16 §12). SOLO admin — no delegable (crea fichas de la nada).'
WHERE code = 'house.inject_capital';
