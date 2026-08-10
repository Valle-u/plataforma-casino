-- Parte A del plan perfil/wallet (docs/21-plan-perfil-wallet.md):
-- perfil editable por el jugador. first_name/last_name son el desglose del
-- displayName (el service lo deriva al setearlos). language: solo 'es'
-- soportado por ahora; la columna queda lista para i18n por jugador.
ALTER TABLE "users" ADD COLUMN "first_name" text;
ALTER TABLE "users" ADD COLUMN "last_name" text;
ALTER TABLE "users" ADD COLUMN "language" text DEFAULT 'es' NOT NULL;
