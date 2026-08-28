-- 0005 · Callback token del proveedor Gregmorn Hub (3er proveedor seamless).
--
-- El callback de Gregmorn NO trae ningun dato del que se pueda deducir el
-- tenant: ni token en el body (como Palace) ni agent code en un header (como
-- Forever). Lo que si tiene es que la callbackUrl se manda por request en cada
-- openGame, asi que el discriminador viaja en la URL:
--   POST /api/v1/game-provider/gregmorn/callback/:token
--
-- Se resuelve con WHERE gregmorn_callback_token = $1 y recien entonces se
-- verifica la firma HMAC con la secret_api_key de ESE tenant. El token no
-- autentica: solo elige de quien es la clave.
--
-- Aditiva: ADD COLUMN nullable, no toca ningun dato existente. Los tenants que
-- no usan Gregmorn quedan en NULL.
ALTER TABLE "tenants" ADD COLUMN "gregmorn_callback_token" text;--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_gregmorn_callback_token_unique" ON "tenants" USING btree ("gregmorn_callback_token");
