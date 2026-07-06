-- F1 · Sueldos por empleado en socios dependientes.
--
-- El admin fija un sueldo mensual (o pago único) por cada empleado que un
-- socio dep creó. Al momento del settle de comisiones (F1 socios-dep), este
-- monto se descuenta del NetWin del socio dep dueño de la rama del empleado.
--
-- Semántica:
--   - user_id: FK a users. PK (1 sueldo activo por user, se piensa como el
--     "sueldo actual"; para historial completo del cambio de sueldo, ver
--     audit_log entries con action 'employee_salaries.update').
--   - monthly_amount: numeric(20,2). 0 = sin sueldo. NOT NULL default '0'.
--   - currency: por ahora solo 'ARS' en la práctica; nos dejamos la puerta
--     abierta para tenants multimoneda. Idx para query eventual "todos los
--     que cobran en X".
--   - updated_by/updated_at: quién y cuándo fue el último cambio.
--   - notes: nota libre del admin (ej. "aumentado en junio", "sueldo neto").
--
-- La aplicación (F1 settle motor) debería filtrar solo los users que son
-- 'empleado' bajo un socio dep. Este schema no lo enforce — es responsabilidad
-- del service y del UI evitar seteos sobre users que no aplican.

CREATE TABLE "employee_salaries" (
  "user_id" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "monthly_amount" numeric(20,2) NOT NULL DEFAULT '0',
  "currency" text NOT NULL DEFAULT 'ARS',
  "updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "notes" text,
  CONSTRAINT "employee_salaries_amount_nonneg" CHECK ("monthly_amount" >= 0)
);

COMMENT ON TABLE "employee_salaries" IS
  'Sueldo mensual que el admin decidió pagar al empleado. Se descuenta del NetWin del socio dep dueño de la rama del empleado, al momento del settle de comisiones (F1 socios-dep).';

CREATE INDEX "employee_salaries_currency_idx" ON "employee_salaries" ("currency");
