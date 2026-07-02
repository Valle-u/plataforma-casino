-- Capa 3 · Fase 1 (Bonus Definitions)
--
-- Segmenta la unicidad del `code` de bonus_definitions por owner
-- (created_by_user_id) para que dos socios independientes puedan tener
-- cada uno su propio 'welcome_basico' sin chocar.
--
-- Modelo: cada casino (admin del tenant + N socios independientes) es
-- un espacio de nombres separado. El admin gestiona sus definitions
-- con sus codes; cada indep gestiona las suyas. El grant ya bloquea
-- cross-network porque valida el funder.
--
-- El backfill es no-op (no hay filas huérfanas — la migración solo
-- reemplaza el índice único). Si alguna vez hay que "reintroducir"
-- global-uniqueness, se resuelve con un query manual, no con revert.

BEGIN;

DROP INDEX IF EXISTS bonus_definitions_code_uniq;

CREATE UNIQUE INDEX bonus_definitions_code_owner_uniq
  ON bonus_definitions (code, created_by_user_id);

COMMIT;
