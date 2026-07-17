-- 0067: Add bonus_definition_id to deposits table for user-selected bonus on deposit.

ALTER TABLE "deposits"
  ADD COLUMN "bonus_definition_id" uuid;

-- Optional FK to bonus_definitions (NOT enforced at DB level to avoid
-- circular complexity with bonus_definitions referencing users).
-- The application layer validates the reference.
