# Adenda docs/16 — Tesorería del socio independiente

> ⚠️ Alineado con docs/LEYES.md (2026-07-07). Ante duda, mandan las LEYES + docs/20-modelo-operativo.
>
> **Naming:** el mecanismo históricamente llamado "aporte / inyección de capital"
> es hoy el **fondeo / presupuesto de la Casa** (E3; ver `docs/16 §12`). Los
> identificadores de código que aparecen abajo (`house.inject_capital`,
> `house_capital_injections`, `POST /tenant/house/inject-*`) conservan su nombre
> hasta un refactor; leélos como "fondeo/presupuesto de la Casa". El **aislamiento
> del independiente** descrito en esta adenda no cambia.

**Fecha:** 2026-07 · Sesión Capa 3 · Fase 4
**Decisión:** El socio independiente NO tiene Casa formal. Su tesorería es su propia wallet + el historial de compras de fichas al tenant.

## Contexto

Durante la sesión "roles paso a paso" (2026-07), al abordar Capa 3 (autonomía del socio independiente sobre módulos previamente admin-only), surgió la pregunta: **¿el indep tiene su propia Casa / tesorería?**

Dos rutas posibles:

- **A · Una `__casa__` por socio indep** — múltiples usuarios `__casa__` por tenant, cada uno con su propio `house_capital_injections`, `betting_caps`, `wallet` de la Casa. Requiere migración `owner_user_id` en varias tablas + refactor de `HouseService.getHouseUserFor(actor)` + ajustes en consumers (`game-rounds`, `network-commissions`, `employee-correction`).

- **B · Modelo docs/17 (wallet-que-banca)** — el indep opera con SU propia wallet como techo absoluto de su banca. No hay Casa formal, no hay minteo. Su tesorería es un concepto reportable, no un módulo aparte.

## Decisión: **Ruta B**

Rationale del user (2026-07):

> "Un socio indep no necesita una tesorería, ya que el límite de su red son las fichas que él mismo compra. No haría falta porque no puede haber una fuga de fichas debido a que el límite está marcado por la wallet del socio, y esas fichas ya fueron pagadas."

Corroborado por `docs/16 §12` y `docs/17`:

- `docs/16 §12`: "la tesorería 1:1 aplica SOLO a TU entorno (red propia + socios dependientes, donde la Casa banca). Las fichas vendidas a socios INDEPENDIENTES salen de tu backing (las respalda el socio; vos cobraste el mayorista) y se cuentan APARTE."
- `docs/17`: modela al indep como OPERADOR con wallet-que-banca, no como dueño de una Casa aparte.

## Implicaciones prácticas

### Del lado del código

- `HouseService` sigue siendo **tenant-scoped** (una `__casa__` por tenant, gestionada por el admin).
- `HouseController` (`GET /tenant/house`, `POST /tenant/house/inject-*`, `GET /tenant/house/capital-injections`) queda **admin-only** de forma estructural:
  - `house.view` y `house.inject_capital` NO se agregan al `INDEPENDENT_BRANCH_AUTO_PERMISSIONS` de `branches.service.ts`.
  - No están en ninguna planilla del `permission-templates.ts`.
  - Si un admin decide por error otorgarlos por override individual, el permiso funciona — pero es una decisión explícita del admin, no un default de sistema.

### Del lado del user

El socio (dep + indep) tiene un endpoint **ya existente** que cumple el rol de "mi tesorería":

- `GET /tenant/branches/mine` — devuelve:
  - `walletBalance`: fichas actuales (su banca efectiva).
  - `bankAccount`, `pricePerUnit`, `isIndependent` — datos de la sucursal.
  - `totals.chipsSoldAllTime`, `totals.fiatAllTime` — cuántas fichas se le vendieron y por cuánto dinero.
  - `recentSales`: historial de las últimas N compras al tenant (fecha, monto, precio, quién ejecutó la venta).

El frontend ya tiene el nav item **"Mi sucursal"** (`/my-branch` — visible cuando el user tiene rol `socio`) donde este dato se renderiza.

## Consecuencia: no hay migración ni refactor pendientes en Capa 3

- No hay que agregar `owner_user_id` en `house_capital_injections`.
- No hay que refactorizar `HouseService.getHouseUserFor(actor)`.
- No hay que tocar `game-rounds`, `network-commissions`, `employee-correction`.
- No hay que crear un endpoint nuevo `/my-branch/treasury` porque `/branches/mine` ya lo cubre.

Los "riesgos globales" identificados en el survey de Capa 3 sobre tesorería (fuga por `listInjections` delegado, hybrid model inconsistente, dependencia de docs/17 I-4/I-5) **no aplican** en este modelo porque `house.*` nunca se delega al indep — el aislamiento es estructural.

## Si en el futuro se decide implementar Ruta A

Este documento queda como registro de la decisión previa. La Ruta A implicaría:

1. Nueva migración: `owner_user_id NOT NULL` en `house_capital_injections` (backfill = `__casa__` del tenant).
2. Refactor de `HouseService`: `getHouseUserFor(actor)` que resuelva la Casa correcta según el actor.
3. Nuevo permiso: `house.view_own` / `house.inject_capital_own` (scoped al owner).
4. Ajustar `game-rounds` (usar `resolveHouseWalletForPlayer`, que ya existe pero no se usa en el panel), `network-commissions` (verificar exclusión del indep no cascadea a otros side effects), `employee-correction` (revisar contraparte según el rol del empleado).
5. Tests e2e cubriendo dos independientes distintos que no se ven las inyecciones el uno al otro, admin ve todas, cross-consumers no rompen.

Nada de eso es urgente ni necesario para el modelo actual.
