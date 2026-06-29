-- Blindaje del núcleo económico — Parte B (tesorería), B-build-2.
--
-- chips_per_unit: fichas por unidad de la moneda del método de pago. Define el
-- ratio ficha↔plata en depósitos (emisión) y retiros (redención). Default 1
-- (1 ficha = 1 peso, moneda base del MVP). Ver docs/16-tesoreria.md §4-5.

ALTER TABLE "payment_methods" ADD COLUMN "chips_per_unit" numeric(14, 4) NOT NULL DEFAULT '1';
