-- F1 · Deducciones por costos operativos en comisión de socios dep.
--
-- El socio dependiente (isIndependentBranch=false) cobra su % sobre la NetWin
-- de su sub-red MENOS los costos operativos que le corresponden:
--   deductions = Σ(employee_salaries en la sub-red del socio dep)
--              + net_win * commissions.bank_cost_pct_of_netwin
--              + commissions.platform_cost_flat
--   final_commission = MAX(0, gross_commission - deductions)
--
-- El motor `computePeriod` deja los breakdowns persistidos por fila para que
-- el pago (settlePeriods) sea auditable y reproducible sin recalcular:
--
--   deductions_salaries      → sueldos consolidados de la sub-red.
--   deductions_bank_cost     → costo bancario proporcional (% × sub_net_win).
--   deductions_platform_cost → costo de plataforma flat (mensual).
--   final_commission         → lo que se LIQUIDA en C3 (>= 0).
--
-- El campo `payable` sigue existiendo (gross + carryover) para no romper la
-- semántica del carryover encadenado; se agrega `final_commission` que ES lo
-- que la Casa efectivamente transfiere/quema en settlePeriods.
--
-- Para socios INDEPENDIENTES o cualquier operador que no sea un socio dep,
-- las deducciones son 0 y final_commission = payable (baseline preservado).
--
-- Idempotente contra recomputes: computePeriod pisa la fila 'accrued' con los
-- nuevos breakdowns.

ALTER TABLE "commission_network_periods"
  ADD COLUMN "deductions_salaries" numeric(20, 2) NOT NULL DEFAULT '0';

ALTER TABLE "commission_network_periods"
  ADD COLUMN "deductions_bank_cost" numeric(20, 2) NOT NULL DEFAULT '0';

ALTER TABLE "commission_network_periods"
  ADD COLUMN "deductions_platform_cost" numeric(20, 2) NOT NULL DEFAULT '0';

ALTER TABLE "commission_network_periods"
  ADD COLUMN "final_commission" numeric(20, 2) NOT NULL DEFAULT '0';

ALTER TABLE "commission_network_periods"
  ADD CONSTRAINT "commission_network_periods_deductions_salaries_nonneg"
  CHECK ("deductions_salaries" >= 0);

ALTER TABLE "commission_network_periods"
  ADD CONSTRAINT "commission_network_periods_deductions_bank_cost_nonneg"
  CHECK ("deductions_bank_cost" >= 0);

ALTER TABLE "commission_network_periods"
  ADD CONSTRAINT "commission_network_periods_deductions_platform_cost_nonneg"
  CHECK ("deductions_platform_cost" >= 0);

ALTER TABLE "commission_network_periods"
  ADD CONSTRAINT "commission_network_periods_final_commission_nonneg"
  CHECK ("final_commission" >= 0);

COMMENT ON COLUMN "commission_network_periods"."deductions_salaries" IS
  'F1: sueldos consolidados de empleados en la sub-red del socio dep. 0 para socios indep u operadores sin deducciones aplicables.';

COMMENT ON COLUMN "commission_network_periods"."deductions_bank_cost" IS
  'F1: costo bancario proporcional al NetWin de la sub-red del socio dep (setting commissions.bank_cost_pct_of_netwin, default 0.01 = 1%).';

COMMENT ON COLUMN "commission_network_periods"."deductions_platform_cost" IS
  'F1: costo de plataforma flat mensual del socio dep (setting commissions.platform_cost_flat, default 0).';

COMMENT ON COLUMN "commission_network_periods"."final_commission" IS
  'F1: MAX(0, payable - (deductions_salaries + deductions_bank_cost + deductions_platform_cost)). Es lo que efectivamente se liquida en settlePeriods (C3). Para socios indep = payable.';
