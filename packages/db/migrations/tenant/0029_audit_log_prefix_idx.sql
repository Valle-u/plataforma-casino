-- Sprint 51.12 — audit_log prefix index.
--
-- El admin filtra audit_log con `?actionCodePrefix=deposits.` (LIKE prefix).
-- El índice btree existente `audit_log_action_created` usa default ops (sort)
-- que NO sirve para LIKE — Postgres caía a Parallel Seq Scan.
--
-- Con dataset de 110k entries:
--   - Sin índice: 44ms (Seq Scan + sort top-N).
--   - Con text_pattern_ops index: 25ms (Bitmap Index Scan).
--
-- Proyección a 1M+ entries: sin índice ~450ms (escala lineal con N).
-- Con índice: <100ms (escala log con N).
--
-- Indispensable porque audit_log crece sin límite y este es el filtro
-- más común del admin operacional ("ver todo lo de deposits hoy").

CREATE INDEX IF NOT EXISTS "audit_log_action_prefix_idx"
  ON "audit_log" ("action_code" text_pattern_ops, "created_at" DESC);
