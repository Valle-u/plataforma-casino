-- Restringir el cupo mensual de correcciones a usuarios con rol 'empleado'
-- (docs/19). Antes de este cambio, cualquier user activo podía recibir cupo.
-- Se resetean a 0 los cupos legacy asignados a no-empleados.
--
-- La validación server-side (que solo permita futuros PATCH con target
-- empleado) se hace en el CorrectionController.setCap.

UPDATE users
SET employee_correction_cap_monthly = '0',
    updated_at = now()
WHERE employee_correction_cap_monthly > 0
  AND id NOT IN (
    SELECT ur.user_id
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE r.code = 'empleado'
  );
