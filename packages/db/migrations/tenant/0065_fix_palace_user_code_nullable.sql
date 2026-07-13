-- Fix: palace_user_code should be bigint nullable, not bigserial (auto-increment).
-- The user_code is assigned by Palace API, not by our DB sequence.
-- DROP NOT NULL y DROP DEFAULT; drop the sequence if exists.

ALTER TABLE "users" ALTER COLUMN "palace_user_code" DROP NOT NULL;
ALTER TABLE "users" ALTER COLUMN "palace_user_code" DROP DEFAULT;
DROP SEQUENCE IF EXISTS "users_palace_user_code_seq";