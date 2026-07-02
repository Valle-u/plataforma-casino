-- Habilita 7 permisos operativos como delegables por override, para que las
-- planillas de empleado (docs internas — permission-templates.ts) queden
-- 100% funcionales sin caveats.
--
-- Estos codes estaban marcados solo-admin porque su blast radius no era
-- trivial (subir extracto bancario, exportar audit, crear definiciones de
-- bono, correr scan de antifraude). El admin sigue siendo el único que los
-- tiene POR DEFAULT (rol admin_tenant); esto solo habilita que pueda
-- otorgarlos por override a un empleado de confianza — que es exactamente
-- el flujo que las planillas necesitan.
--
-- Los 7 codes:
--   bank_tx.upload            — empleado banco: subir extracto entrante
--   audit.export              — empleado trazabilidad: export CSV de audit
--   bonuses.create_definition — empleado bonos: armar definiciones
--   bonuses.edit_definition   — empleado bonos: editar definiciones
--   fraud.view                — empleado antifraude: ver señales
--   fraud.review              — empleado antifraude: confirmar/descartar
--   fraud.run_scan            — empleado antifraude: correr scan on-demand

UPDATE permissions
SET is_delegatable = TRUE
WHERE code IN (
  'bank_tx.upload',
  'bank_tx.edit',
  'audit.export',
  'bonuses.create_definition',
  'bonuses.edit_definition',
  'fraud.view',
  'fraud.review',
  'fraud.run_scan'
);
