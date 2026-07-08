-- 0063 · Comisión — ventaneo por flip (§14.4, corte de comisión).
--
-- Delimitan el tramo DEPENDIENTE (comisionable) de un socio dentro de un
-- período. El engine solo cuenta game_rounds settled en
-- [commission_eligible_from, commission_eligible_until). NULL = sin límite por
-- ese lado. Al flipear: indep→dep setea from=flip, until=NULL; dep→indep setea
-- until=flip. Socios que nunca fliparon: ambos NULL → mes entero (si dependiente).

ALTER TABLE users ADD COLUMN IF NOT EXISTS commission_eligible_from timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS commission_eligible_until timestamptz;
