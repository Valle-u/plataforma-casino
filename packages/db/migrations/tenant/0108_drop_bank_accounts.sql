-- 0108 · Sacar `bank_accounts`, que quedo huerfana en produccion.
--
-- HISTORIA (importa para entender el `when` de esta migracion):
--
-- El 2026-08-31 se creo la tabla con una migracion que TAMBIEN se llamaba 0108
-- (`0108_bank_accounts.sql`, commit 9143c34, `when` = 1789300900000). La
-- funcionalidad estaba mal entendida y se revirtio entera (d2b3e60): el archivo
-- de migracion desaparecio del repo.
--
-- Pero revertir el archivo NO deshace lo que ya corrio. Entre medio, el commit
-- 707f86c se deployo a produccion (2026-08-31 19:04 UTC, `done`) y la API
-- arranca con `MIGRATE_ON_BOOT=1`, asi que en cada DB de tenant de produccion
-- quedaron DOS cosas:
--
--   1. La tabla `bank_accounts`, sin nada que la use.
--   2. Una fila en `drizzle.__drizzle_migrations` con
--      `created_at` = 1789300900000, apuntando a un archivo que ya no existe.
--
-- ⚠️ (2) ES LA PARTE PELIGROSA, y por eso esta migracion salta un numero.
--
-- El runner de drizzle aplica una migracion solo si
-- `max(created_at) en la DB < el "when" de la migracion`
-- (`drizzle-orm/pg-core/dialect.js`, metodo `migrate`). En produccion ese maximo
-- ya es 1789300900000. Como en este repo los `when` se asignan a mano de a
-- 100000, la SIGUIENTE migracion que alguien escribiera tomaria justo
-- 1789300900000 — igual, no mayor — y drizzle la **saltaria en silencio en
-- produccion** mientras se aplica normalmente en local y en cualquier DB nueva.
-- Schema drift mudo, y solo en la base que importa.
--
-- Por eso esta migracion usa `when` = 1789301000000: quema el hueco y deja el
-- maximo por encima del fantasma. De aca en adelante la secuencia sigue normal.
--
-- QUE HACE
--
-- Nada depende de esta tabla: no hay FKs entrantes (su unica FK era saliente,
-- `created_by -> users(id)`) y ningun codigo la referencia. Se puede borrar.
--
-- Pero la tabla estuvo viva ~1h en produccion con su pantalla en Configuracion,
-- y no hay forma de saber desde el repo si alguien llego a cargar una cuenta.
-- Por eso NO se borra a ciegas: si tiene filas se renombra en vez de borrarse.
--
-- Es deliberado que no falle nunca. Con `MIGRATE_ON_BOOT=1` una migracion que
-- explota **impide que arranque la API**: cambiar una limpieza cosmetica por una
-- caida de produccion seria un mal negocio.
DO $$
BEGIN
  -- En una DB que nunca corrio la 0108 vieja (local, tenants nuevos) no hay
  -- nada que hacer.
  IF to_regclass('bank_accounts') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM bank_accounts) THEN
    ALTER TABLE bank_accounts RENAME TO bank_accounts_huerfana_20260831;
    RAISE WARNING
      'bank_accounts tenia filas: se renombro a bank_accounts_huerfana_20260831 en vez de borrarla. Revisar el contenido y borrarla a mano.';
  ELSE
    DROP TABLE bank_accounts;
  END IF;
END
$$;
