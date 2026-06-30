-- Comisiones por red (modelo operativo) — C1: config.
--
-- commission_rate por usuario: el % de la NetWin de su sub-red que este usuario
-- gana, fijado por su padre directo (markup: este% <= el del padre). Default 0.
-- Ver docs/16-tesoreria.md §11.

ALTER TABLE "users" ADD COLUMN "commission_rate" numeric(5, 2) NOT NULL DEFAULT '0';
