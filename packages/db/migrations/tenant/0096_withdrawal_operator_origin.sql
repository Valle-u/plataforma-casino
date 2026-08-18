-- Retiro iniciado por un operador EN NOMBRE de un jugador (que no supo hacer
-- la solicitud self-service). NULL = self-service del jugador; set = user_id
-- del operador que lo inició. Permite distinguir el retiro manual del
-- self-service en reportes/UI sin cambiar la mecánica: sigue siendo un retiro
-- real (type 'withdrawal' + burn, E6). UUID raw sin FK (mismo patrón que
-- bank_transaction_id): la integridad la garantiza WithdrawalsService.
ALTER TABLE "withdrawals" ADD COLUMN "created_by_operator_id" uuid;
