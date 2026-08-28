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
| IP de ellos (para nuestra allowlist) | ✅ `3.78.156.229` — ⬜ **falta cargarla en Cloudflare** |
| `callbackUrl` por request en `openGame` | ✅ confirmado que se puede |
| login / password / secret key (Stage) | ✅ recibidas — ⬜ pendientes de cargar en `tenant_settings` |
| **`user_id`** | ⬜ **FALTA** — obligatorio en `openGame` y `getUserGames` |
| **Idempotencia del `rollback`** | ⬜ **SIN RESPUESTA** — ver §Trampas |
| ¿`3.78.156.229` es su única IP? | ⬜ preguntado, sin respuesta |

## Trampas (leer antes de codear la wallet)

1. **El `rollback` llega con el MISMO `transactionId` que el bet.** Su spec lo dice
   explícito: *"The rollback transaction matches the bet transaction (same
   transaction ID)"*. Si se usa crudo como `idempotency_key`, el rollback se ve como
   duplicado del bet y **se ignora en silencio**: el jugador nunca recupera la
   apuesta de una ronda anulada. Hay que namespacear con `cmd + transactionId`.
   **Se les preguntó y todavía no contestaron.**
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
| [`99-integration-plan.md`](99-integration-plan.md) | Plan por fases y estado. |
| [`openapi-v1.0.json`](openapi-v1.0.json) | Spec crudo, tal como lo mandaron. |
