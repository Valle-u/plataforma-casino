# Forever — proveedor de juegos #2 (documentación de integración)

> **Estado:** intake abierto (2026-08). Segundo proveedor de juegos, **convive** con
> Palace (no lo reemplaza). Este directorio recopila TODO lo de Forever + su API,
> igual que hicimos con Palace en `docs/game-provider/`.
>
> **Fuente:** el dueño (Uriel) tiene el panel de control de Forever + su manual de
> uso; los va pasando por capturas/PDF. Lo marcado `⬜ (pendiente)` todavía no se
> documentó — se completa a medida que llegan datos.

## Identidad del proveedor

- **Marca:** Forever.
- **`provider_code` en nuestra plataforma:** `forever` (espeja `games.provider_code`
  y `game_providers.code`; el de Palace es `palace`).
- **`displayName` en el panel:** "Forever" (sección propia, diferenciada de Palace).
- **Aggregator / dueño del sistema:** ⬜ (pendiente — ver panel).
- **Cuenta nuestra (agent/operador):** ⬜ (pendiente).

## Por qué esto es más fácil que Palace

La plataforma **ya quedó preparada para multi-proveedor** cuando integramos Palace:

- Contrato `IGameProvider` + `GameProviderRegistry`
  (`apps/api/src/games/providers/`): se enchufa un adapter nuevo sin tocar el resto.
- Tabla `game_providers` (`packages/db/src/tenant/game-providers.ts`): una fila por
  proveedor, con `code` único, comisión propia (`commission_fee_pct`) y estado de
  sync/ping. Ya soporta convivencia.
- Tabla `games` con `provider_code`: cada juego sabe de qué proveedor es.

**El único obstáculo estructural** es que la resolución de tenant en el callback
*seamless* está hardcodeada a Palace: `tenants.palace_callback_token` en la DB de
control (`packages/db/src/control/tenants.ts:81`). Para Forever hay que generalizar
eso. Ver `99-integration-plan.md`.

## Hechos clave (running list) — ⬜ a completar con los datos de Forever

- **Modelo de wallet:** ⬜ ¿SEAMLESS (Forever llama a nuestra wallet por callbacks
  bet/win/etc. en tiempo real) o TRANSFER (movemos crédito con su Main API)? **Esto
  define toda la integración.**
- **Main API (nosotros → Forever):** ⬜ base URL, auth, endpoints, límites.
- **Callback API (Forever → nuestra wallet), si es seamless:** ⬜ auth, commands,
  idempotencia, timeouts.
- **Moneda / centavos:** ⬜.
- **Catálogo:** ⬜ cuántos proveedores/juegos, cómo se listan y se lanzan.
- **Estado de la cuenta:** ⬜ sandbox/prod, aprobada o no.

## Índice de documentos

- [`00-intake.md`](00-intake.md) — **cuestionario: qué datos necesito de Forever.** ← empezar acá.
- [`99-integration-plan.md`](99-integration-plan.md) — cómo se enchufa y **convive** con
  Palace (código + panel). ⬜ (se arma cuando tengamos los datos del intake).

## Referencia: cómo documentamos Palace

Ver `docs/game-provider/` — mismo patrón. En particular:
- `docs/game-provider/README.md` — running list de hechos de Palace.
- `docs/game-provider/02-api-main.md` + `swagger-v4.json` — Main API.
- `docs/game-provider/03-callback-seamless.md` + `callback-example.php` — Callback API.
- `docs/game-provider/99-installation-plan.md` — plan de instalación (a calcar).
