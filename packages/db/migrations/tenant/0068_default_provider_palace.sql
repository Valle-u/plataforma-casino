-- 0068: Switch default provider from mock to Palace.
-- Sprint 56: MockGameProvider is removed. All games point to Palace.
-- Existing mock rows are migrated to Palace so the registry does not throw;
-- they still need palace_provider_id + palace_game_symbol to be playable.

ALTER TABLE "games"
  ALTER COLUMN "provider_code" SET DEFAULT 'palace';

UPDATE "games"
SET "provider_code" = 'palace'
WHERE "provider_code" = 'mock';
