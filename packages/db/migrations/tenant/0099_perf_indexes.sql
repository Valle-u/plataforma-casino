-- Índices de performance (auditoría de arquitectura, Tier 1).
-- Aditivo: solo agrega índices, no toca datos ni estructura. Idempotente.

-- 1) user_hierarchy: hot path del ScopeGuard. Las traversales descendentes
--    (WITH RECURSIVE) filtran `parent_user_id = X AND until IS NULL`. Sin índice
--    cada nivel hacía seq scan. Parcial (solo relaciones activas) → chico y exacto.
CREATE INDEX IF NOT EXISTS "user_hierarchy_parent_active"
  ON "user_hierarchy" ("parent_user_id")
  WHERE "until" IS NULL;

-- 2) game_rounds: reporting de netwin/GGR/comisiones. Filtran `status='settled'`
--    + rango de `settled_at` (WalletStatsService.netwinFor, network-commissions).
--    Sin índice hacían seq scan + sort de la tabla de mayor volumen.
CREATE INDEX IF NOT EXISTS "game_rounds_status_settled"
  ON "game_rounds" ("status", "settled_at");
