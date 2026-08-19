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
- **Aggregator:** back office `backoffice.aicvgdbi.win`, Main API
  `https://api.aicvgdbi.win/api/casinoapi`. **Distinto de Palace** (otra API — ver
  `01-api-spec.md §4`).
- **Cuenta nuestra:** `redgardel` (agentCode) — rol **Operator**, **Seamless**, RTP 0%~0%,
  currency **USD**. Cuenta de **testeo**, creada 2026-07-30.

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

## Hechos clave (running list)

- **Modelo de wallet:** ✅ **SEAMLESS** — confirmado en el dashboard (tag "● Seamless"
  junto a la cuenta). Forever le pega a NUESTRA wallet por callbacks; somos la fuente de
  verdad del saldo. → Necesitamos el Callback API sí o sí.
- **Moneda:** ✅ **USD** (dashboard: "Balance: USD 0", selector USD). ⚠️ **Distinto de
  Palace (ARS)** — cada proveedor puede tener su currency. ⬜ falta confirmar si opera con
  centavos/decimales.
- **Estructura:** ✅ multi-nivel **Agent → sub-agents → users** con sistema de **Points**
  (dashboard: "Number of sub agents / users / circulation agents / concurrent agents",
  "Total points of all users"). Igual patrón que Palace.
- **Palanca de ganancia:** ✅ existe **RTP** por cuenta (dashboard: "RTP 0%~0%"), como
  Palace.
- **Balance del agente:** dos saldos — "Balance" y "Free balance" (crédito del agente
  con el aggregator).
- **Estado de la cuenta:** recién creada, todo en 0. ⬜ falta confirmar si está aprobada
  para operar (approved/unapproved) y si es sandbox o prod.
- **Menú del panel:** Dashboard · Profile · Error log · **Game control** · **Agent** ·
  **User** · **Report** · **API** (los 4 últimos con submenús desplegables).
- **Submenú API:** **API guide** · **Request signature** · **Signature test** ·
  **Test launch url**.
- **🔑 Autenticación por FIRMA (HMAC):** ⚠️ **diferencia grande con Palace.** Forever
  **firma los requests** ("Request signature" + "Signature test" en el menú). Palace
  usaba token plano sin firma. Hay que implementar el cómputo de la firma (algoritmo +
  secret + qué campos se firman) tanto para llamar su Main API como (probablemente) para
  validar/firmar los callbacks. → **`API guide` + `Request signature` son las próximas
  capturas críticas.**
- **API destilada:** ✅ tenemos el PDF "API Specification v1.0.3" (46 pág.) → destilado en
  [`01-api-spec.md`](01-api-spec.md). Lo esencial:
  - **Callback seamless = 2 endpoints** que implementamos nosotros: **`GetBalance`** y
    **`ChangeBalance`** (esta última con `txnType` **0=Debit/bet, 1=Credit/win, 2=Cancel**).
    Idempotencia por **`txnCode`**; Debit↔Credit se ligan por **`wagerId`**. **Timeout 2s.**
  - **Launch:** `GetGameUrl` (token+agentCode+userCode+vendorCode+gameCode+currency+channel
    desktop/mobile + lowRtp/highRtp + homeUrl) → `launchUrl`. Rate 6s/usuario, 10/min.
  - **Auth:** `token`+`agentCode` en el body **+ firma `X-Forever-Sig-*`** (private key +
    timestamp ms + nonce). SDKs C#/Node.js/PHP/JS para copiar la firma.
- **Catálogo:** `GetVendors` (Vendor) + `GetGameList` (VendorGame: gameCode/gameName/
  gameType/imageUrl). `gameType`: 1=Slot, 2=Live Casino. ⬜ cuántos hay (ver Game control).

> 🔎 **Hipótesis corregida:** el panel **se parece** a Palace en vocabulario, **pero la API
> es DISTINTA** — Forever es **otro aggregator**. No es copy-paste de Palace. Reusamos la
> **arquitectura** (seamless, burn/mint, launch por URL, mapping de usuario, idempotencia)
> pero el **adapter es nuevo**: firma de requests, callback unificado en `ChangeBalance`
> con `txnType`, currency USD, timeout 2s. Ver la tabla comparativa en `01-api-spec.md §4`.

## Índice de documentos

- [`00-intake.md`](00-intake.md) — cuestionario: qué datos faltan de Forever (con lo ya
  confirmado marcado ✅).
- [`01-api-spec.md`](01-api-spec.md) — **✅ API destilada de `en_0.pdf` (v1.0.3):** callback
  seamless (GetBalance/ChangeBalance), launch, catálogo, códigos, models. **Referencia canónica.**
- [`02-signing.md`](02-signing.md) — **✅ Firma Ed25519** (headers `X-Forever-Sig-*`,
  canónico, sign+verify) + inventario de credenciales (Profile). Contrato de auth.
- [`forever-packet-signer.js`](forever-packet-signer.js) — SDK oficial Node.js del panel
  (algoritmo de firma de referencia, sin secretos).
- [`api-spec-v1.0.3.pdf`](api-spec-v1.0.3.pdf) — PDF fuente.
- [`99-integration-plan.md`](99-integration-plan.md) — cómo se enchufa y **convive** con
  Palace (código + panel).

## Referencia: cómo documentamos Palace

Ver `docs/game-provider/` — mismo patrón. En particular:
- `docs/game-provider/README.md` — running list de hechos de Palace.
- `docs/game-provider/02-api-main.md` + `swagger-v4.json` — Main API.
- `docs/game-provider/03-callback-seamless.md` + `callback-example.php` — Callback API.
- `docs/game-provider/99-installation-plan.md` — plan de instalación (a calcar).
