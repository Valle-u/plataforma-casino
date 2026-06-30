-- Eliminación TOTAL del modelo viejo de comisiones: reglas globales por rol
-- (commission_rules) + comisión sobre el depósito (commission_payouts).
-- Reemplazado por las comisiones por red (NetWin) en commission_network_periods.
-- Ver docs/16-tesoreria.md §11.

DROP TABLE IF EXISTS "commission_payouts" CASCADE;
DROP TABLE IF EXISTS "commission_rules" CASCADE;
DROP TYPE IF EXISTS "commission_payout_status";
