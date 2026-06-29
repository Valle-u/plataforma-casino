-- Blindaje del núcleo económico — Parte B (tesorería), B-build-1.
--
-- Flag `is_system` en users: marca cuentas de sistema (la "Casa"/tesorería),
-- no humanas. El usuario Casa en sí se crea desde el seed (necesita hash de
-- password Argon2, no se puede en SQL). Ver docs/16-tesoreria.md.

ALTER TABLE "users" ADD COLUMN "is_system" boolean NOT NULL DEFAULT false;
