# Gregmorn Hub — proveedor de juegos #3 (documentación de integración)

> **Estado:** intake abierto (2026-08-28). Tercer proveedor, **convive** con Palace
> y Forever (no reemplaza a ninguno). Mismo criterio que `docs/game-provider/`
> (Palace) y `docs/forever/`: cada proveedor tiene su carpeta, no se mezclan.
>
> **Fuente:** ellos mandaron el sitio de documentación (`https://docs.gregmorn.org/`)
> y su OpenAPI. El spec crudo está en [`openapi-v1.0.json`](openapi-v1.0.json) — es
> la fuente de verdad. **No usar el PDF que circuló**: viene truncado y le falta
> justo el webhook `rollback` (ver §Trampas).

## Identidad del proveedor

- **Marca:** Gregmorn Hub.
- **`provider_code` en nuestra plataforma:** `gregmorn` (espeja `games.provider_code`
  y `game_providers.code`; los otros son `palace` y `forever`).
- **Contacto:** `GH_Support_Dave`. Empresa suiza, se habla en inglés.
- **Aggregator:** revende varios estudios (los ejemplos del spec mencionan PG Soft,
  Evolution). El `gameId` viene con forma `integration:provider:game`, ej.
  `integration_a:provider_a:game_001`.
- **Cuenta nuestra:** login `MiamiHub`. Credenciales de **Stage**.
- **Back office (Stage):** `https://office-dev.gamble-hub.net/login`, con el
  mismo login y password de integración. ⚠️ **Ojo con el dominio**: el panel vive
  en `gamble-hub.net`, no en `gregmorn.org` — que es el que aparece en toda la
  documentación de la API. Ahí se ve el **saldo de nuestro hall** y su historial.

## ⚠️ El saldo del hall: la falla que no genera ningún error

Además del saldo de cada jugador —que vive en nuestra base— existe **el saldo de
nuestra cuenta con Gregmorn**. Si se agota, **el casino deja de aceptar apuestas
sin producir un solo error**: los juegos abren, muestran `CRÉDITO 0,00`, no llega
ningún callback, y nuestra API contesta 200 a todo.

Pasó el 2026-09-01 y se tardó **18 horas** en detectarlo, porque se descubrió por
la queja de un jugador. El análisis inicial llegó a atribuirle la falla al
proveedor; fueron ellos mismos quienes encontraron la causa. Ver la corrección al
inicio de [`97-analisis-incidente-2026-09-01.md`](97-analisis-incidente-2026-09-01.md).

**Cómo se vigila:**

| | |
|---|---|
| **Por API** | ❌ **imposible** — no hay endpoint. Su OpenAPI expone sólo `auth/login`, `games/openGame`, `getUserGames` y el `apiIndividualWallet` que no usamos |
| **Por panel** | ✅ el back office de arriba. Es el único lugar donde se ve el número |
| **Alerta propia** | ✅ `GamesHealthCron` avisa por Telegram cuando hay aperturas de juego y **ninguna** apuesta. Llega a los ~40 min, no antes |

La alerta es un indicador **tardío**: avisa cuando los jugadores ya no pueden
jugar. **Antes de abrir a producción, mirar el panel de Prod y cargar con
margen.**

## Hechos clave

- **Modelo de wallet: SEAMLESS.** Ellos llaman a NUESTRA wallet (`getBalance`,
  `writeBet`, `rollback`) firmando con `X-Signature`. Igual que Palace y Forever.
  - Ofrecen también un modelo **Transfer** (`POST /apiIndividualWallet/` con
    `userCreate` / `userCash` / `userInfo`). **NO se usa**: implicaría empujarles
    fichas y que la plata viva en su wallet, lo que rompe **E1 y E2** de
    `docs/LEYES.md` — el balance dejaría de ser `Σ(wallet_transactions)` y nuestro
    ledger dejaría de ser la fuente de verdad.
- **Firma: HMAC-SHA256, hex, sobre los bytes crudos del body.** Más simple que el
  Ed25519 de Forever. Ver [`02-signing.md`](02-signing.md).
- **Soportan ARS** — confirmado por Dave el 2026-08-28. Era el bloqueante: su
  documentación solo muestra USD/EUR y los callback URLs se configuran **por
  moneda**.
- **Dos entornos separados** (Stage y Prod) con logins, secret keys e IP allowlists
  distintos. Arrancar en Stage; pasar a Prod solo tras aceptación.
- **Dos hosts distintos** según la operación:
  - `office-api-dev.gregmorn.org` → auth y catálogo.
  - `client-api-dev.gregmorn.org` → abrir juego.

## Estado del intake

| Dato | Estado |
|---|---|
| Soporte de ARS | ✅ confirmado |
| Callback URL nuestra | ✅ enviada — `https://api.miamihub.vip/api/v1/game-provider/gregmorn/callback` |
| IP nuestra (para su allowlist) | ✅ enviada — `147.93.32.111` |
| IP de ellos (para nuestra allowlist) | ✅ `18.184.217.6` (Stage, cargada) · `3.78.156.229` (Prod) — ⬜ **sumar la de Prod al migrar** |
| `callbackUrl` por request en `openGame` | ✅ confirmado que se puede |
| login / password / secret key (Stage) | ✅ recibidas — ⬜ pendientes de cargar en `tenant_settings` |
| **`user_id`** | ✅ **es el `user.id` del `/auth/login`** — no se carga a mano |
| **Idempotencia del `rollback`** | ✅ **`cmd + transactionId` aprobado por ellos** |
| ¿`3.78.156.229` es su única IP? | ✅ sí, y avisan antes de sumar otras |
| **RTP** | ✅ Stage = **95** para todos · Prod configurable (75–96) sólo en SL-games, Nova, X-games y Slot7Zon — ⬜ **falta el default del resto** y si lo seteamos nosotros. Ver [`98` §6](98-pendientes-proveedor.md) |
| **Saldo del hall** | ✅ se ve en el back office (arriba) — ❌ **no hay API**. Ver la sección de arriba |
| **Setup de producción** | ⬜ **preguntado el 2026-09-02, sin respuesta.** Es el bloqueante para lanzar |

## Trampas (leer antes de codear la wallet)

1. **El `rollback` llega con el MISMO `transactionId` que el bet.** Su spec lo dice
   explícito: *"The rollback transaction matches the bet transaction (same
   transaction ID)"*. Si se usa crudo como `idempotency_key`, el rollback se ve como
   duplicado del bet y **se ignora en silencio**: el jugador nunca recupera la
   apuesta de una ronda anulada. Hay que namespacear con `cmd + transactionId`.
   **✅ Confirmado por ellos el 2026-08-28** ("Yes, you can do it this way"), tras
   consultarlo con su equipo de desarrollo. Sigue siendo la trampa #1 de este
   proveedor: quien toque la wallet tiene que saber por qué la clave lleva el `cmd`.
2. **`bet` y `win` pueden venir número O string.** Ellos avisan: *"SL-Games and
   X-Games vendors are using STRING value type"*. Asumir número es un bug de plata
   silencioso.
3. **`getBalance` con HTTP 400 no es saldo 0.** Prohíben explícitamente usar un
   balance cacheado o por defecto, y no se debe arrancar el spin.
4. **El `balance` de la respuesta va DESPUÉS de aplicar la operación**, no antes.
5. **Fondos insuficientes → rechazar el `writeBet`.** Ellos no reservan ni calculan
   fondos con `getBalance`. Encaja con nuestro `CHECK balance >= 0`.
6. **El login es `application/x-www-form-urlencoded`, no JSON.** Lo marcan como
   error común; mandar JSON da 400 o 401.
7. **El PDF de su documentación está truncado** y corta antes del `rollback`. Quien
   se guíe por el PDF no ve la trampa #1. Usar el `openapi-v1.0.json`.

## Qué juega a favor

- **`rawBody: true` ya está activo globalmente** (`apps/api/src/main.ts`) y el
  controller de Forever ya verifica firmas sobre el body crudo. El HMAC de Gregmorn
  necesita exactamente eso, así que no hay que tocar el bootstrap.
- **`transactionId` como clave de idempotencia mapea 1:1** con nuestro
  `idempotency_key UNIQUE` (E2), y la regla de "duplicado → devolvé 200 con el saldo
  actual sin re-aplicar" es lo que nuestra wallet ya hace.
- **La plataforma ya es multi-proveedor** desde Palace: contrato `IGameProvider` +
  `GameProviderRegistry`, tabla `game_providers`, credenciales por tenant en
  `tenant_settings`. Se enchufa un adapter sin tocar el resto.

## Índice

| Archivo | Contenido |
|---|---|
| [`00-intake.md`](00-intake.md) | Qué nos mandaron, qué falta, dónde van las credenciales. |
| [`01-api-spec.md`](01-api-spec.md) | Los endpoints digeridos: auth, catálogo, launch y los 3 webhooks. |
| [`02-signing.md`](02-signing.md) | El esquema de firma HMAC-SHA256. |
| [`98-pendientes-proveedor.md`](98-pendientes-proveedor.md) | Preguntas abiertas con ellos + borrador del mensaje. |
| [`99-integration-plan.md`](99-integration-plan.md) | Plan por fases y estado. |
| [`openapi-v1.0.json`](openapi-v1.0.json) | Spec crudo, tal como lo mandaron. |
