-- F5 · Injections dirigidas al bankroll de un socio independiente.
--
-- Hasta acá, todo inject de capital/budget fondea a la Casa del tenant.
-- Con F5, un admin puede fondear directamente el bankroll de un socio indep
-- (ej.: aporte inicial del socio, o "adelanto" que el admin le carga).
--
-- Semántica de `operator_user_id`:
--   - NULL     → inject a la Casa del tenant (comportamiento default pre-F5).
--   - NOT NULL → user_id del socio indep dueño del bankroll receptor. La wallet
--                de destino del minteo pasa a ser el bankroll de ese operador.
--
-- Nullable para preservar el comportamiento de las filas históricas y del
-- flujo default. La resolución (Casa vs bankroll indep) la hace HouseService
-- en la misma transacción atómica que hoy hace el minteo + registro.

ALTER TABLE "house_capital_injections"
  ADD COLUMN "operator_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;

COMMENT ON COLUMN "house_capital_injections"."operator_user_id" IS
  'user_id del socio indep dueño del bankroll receptor. NULL = inject a la Casa del tenant (comportamiento default pre-F5).';

CREATE INDEX IF NOT EXISTS "house_capital_injections_operator_user_id_idx"
  ON "house_capital_injections" ("operator_user_id");
