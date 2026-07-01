-- Cupo mensual del empleado para cargas manuales por corrección/bonificación/
-- reintegro. Ver docs/19-cupo-empleado.md.
--
-- Es un TECHO (no un stock): las fichas salen de la Casa; este número limita
-- cuánto puede mover un empleado por mes. Default 0 = el empleado NO puede
-- hacer cargas por corrección aunque tenga el permiso `wallet.correct`.
--
-- Se resetea implícitamente el 1° de cada mes vía cómputo de consumo (suma de
-- wallet_transactions con source='employee_correction' y created_at >= inicio
-- del mes UTC, filtradas por created_by = employee_id).

ALTER TABLE "users"
  ADD COLUMN "employee_correction_cap_monthly" numeric(20, 2) NOT NULL DEFAULT '0';

ALTER TABLE "users"
  ADD CONSTRAINT "users_correction_cap_nonneg"
  CHECK ("employee_correction_cap_monthly" >= 0);
