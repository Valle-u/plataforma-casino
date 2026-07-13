# Proveedor de juegos — documentación de integración

> **Fuente:** capturas del panel del proveedor que va pasando el dueño (2026-07).
> Este directorio recopila TODO lo del proveedor + su API para tener dónde
> consultar. Se completa a medida que llegan más capturas. Lo marcado `⬜ (pendiente
> de captura)` todavía no se documentó.

## Identidad del proveedor
- **Marca del panel:** "Palace Casino" — Back Office.
- **Aggregator / dueño del sistema:** © **CASINO API Admin Corp**.
- **Producto/sub-marca visible:** "SLOTCITY" (sección del menú).
- **Cuenta actual (nuestra):** `redgardel` (@redgardel) — es una cuenta de tipo
  **Agent/operador** dentro del sistema del aggregator.

## Hechos clave (running list)
- **Modelo de wallet: SEAMLESS.** El menú API tiene "Callback API (Seamless)" →
  el proveedor llama a NUESTRA wallet por callbacks en tiempo real (bet/win/etc.),
  no un modelo transfer. **Esto define cómo integramos** (ver docs/17 + roadmap F5:
  wallet API expuesta al proveedor con HMAC/nonce/idempotencia).
- **Main API (nosotros → ellos):** ✅ spec completo en [`swagger-v4.json`](swagger-v4.json) + [`02-api-main.md`](02-api-main.md).
  - Base URL: `https://agent.goldslotpalase.com`, todos los endpoints **POST** bajo `/v4/...` (marca API: "Gold Palace Casino").
  - Auth: `Authorization: Bearer {API TOKEN}` (UUID, desde Settings). Envelope: `{code, message, data}` (code=0 OK).
  - **Somos un "Agent"** con Points/RTP/whitelist; cada jugador = un **"User"** (`user_code` int64, re-crear en cada login).
  - **RTP (winning rate)** = palanca de ganancia; se setea por agente o por-jugada (≤ del agente).
  - 21 endpoints: agent info/rtp, user create/info, game providers/games/game-url, online-games, bonus-call, freerounds, transactions (reconciliación), statistics.
  - Los `wallet/deposit|withdraw` son **"Only Transfer Mode"** → **no los usamos** (somos seamless).
- **Límites Main API:** máx **10 llamadas simultáneas/IP** (`SERVER_IS_BUSY 1018`), **IP whitelist** obligatoria (`IP_NOT_ALLOWED 1020`), queries en **UTC(0)**, **tx se borran a los 2 días** (persistir nosotros).
- **Callback API (Seamless, ellos → nuestra wallet):** ✅ spec completo en [`03-callback-seamless.md`](03-callback-seamless.md) + PHP de referencia en [`callback-example.php`](callback-example.php).
  - **Auth = shared token** (header `Callback-Token`), **NO HMAC/firma** → obliga a HTTPS. ✅ **Confirmado (2026-07): NO hay whitelist de IP para el callback** — solo se registra la callback URL en Settings.
  - 6 commands POST/JSON: `authenticate`, `balance`, `bet`, `win`, `cancel`, `status`. Respuesta `{result, status, data:{balance}}`.
  - Campo **`check`** = lista CSV de validaciones previas (21 user, 22 activo, 31 fondos, 41 idempotencia, 42/43 existe-tx).
  - **`trans_guid` = idempotency key.** Jugador identificado por `account` (= `name`/`user_code` del Main API).
  - **⏱️ Timeouts durísimos:** `bet`/`balance` ≤ **2s**, resto ≤ **4s**. `win`/`cancel` se **reintentan hasta 50 veces** → idempotencia a prueba de balas.
  - Flujo de alta: URL en Settings → implementar todo → testear → **pedir aprobación del agente** (arranca "Unapproved") → game testing.
- **Moneda:** ARS. ✅ **Confirmado por el proveedor (2026-07): los montos incluyen centavos.** Operar en centavos/bigint, NUNCA truncar (rompería el invariante del ledger).
- **Catálogo:** **17 proveedores / 2.148 juegos**.
- **Estructura jerárquica:** el sistema es multi-nivel (**Agent → sub-agents →
  Users**), con un sistema de **Points** ("My Point", "Sub(Total) Point"). Métricas
  separan **Slot** vs **Live**.
- **Estado de la cuenta:** todo en 0 (recién creada, nada conectado/jugado aún).

## Índice de documentos
- [`01-panel-overview.md`](01-panel-overview.md) — mapa del back office (menú + dashboard). ✅
- [`02-api-main.md`](02-api-main.md) — Main API completa (21 endpoints, schemas, códigos, límites). ✅
- [`swagger-v4.json`](swagger-v4.json) — spec crudo del proveedor (referencia canónica). ✅
- [`03-callback-seamless.md`](03-callback-seamless.md) — Callback API (Seamless): 6 commands, checks, timeouts, idempotencia, auth por token. ✅
- [`callback-example.php`](callback-example.php) — implementación PHP de referencia del proveedor (a replicar en NestJS). ✅
- `04-settings.md` — Settings (credenciales, secret, whitelist de IP, config). ⬜
- `05-games-providers.md` — lista de proveedores + juegos (codes, categorías). ⬜
- `06-agent-users.md` — modelo Agent/Users/Points del aggregator. ⬜
- `99-integration-plan.md` — cómo mapeamos todo esto a nuestra plataforma
  (adapter `IGameProvider` + wallet-callback API). ⬜ (lo armo cuando tengamos la API)

## Preguntas abiertas / a capturar
1. ~~**Main API**~~ ✅ capturado (doc 02 + swagger-v4.json).
2. ~~**Callback API (Seamless)**~~ ✅ capturado (doc 03 + callback-example.php).
3. **Settings** ⬜: dónde está el **API token** + el **CALLBACK_TOKEN**, y dónde se
   configura la **callback URL** (seamless). ✅ **Confirmado (2026-07): no hay whitelist
   de IP para el callback — solo registrar la URL.**
4. **Callback API Testing** ⬜: el tester (`/v4/agent/callback-test` lo dispara) +
   sus logs — clave para probar contra el túnel local sin jugar.
5. **Sandbox vs producción / estado del agente:** ¿"Approved" o "Unapproved"? (arranca sin aprobar).
6. ~~**Currency ARS:** ¿qué int es ARS en `agent.currency`?¿opera con decimales?~~
   ✅ **Confirmado (2026-07): los montos incluyen centavos.**
7. **Points del agente:** ¿cómo se fondea nuestro crédito con el aggregator?
8. **Launch:** iframe vs redirect, mobile, y semántica de `return_url`.
9. **Timezone del callback:** ¿UTC o Asia/Seoul? (el panel y los ejemplos difieren).
10. ~~**Modelo económico:** cómo mapear bet/win a nuestro mint/burn/transfer sin
    romper E1–E8 (decisión con el dueño; va al doc 99).~~
    ✅ **Decidido (2026-07-08): Opción C — mint/burn en el juego, premios sin tope,
    el responsable del retiro es la jerarquía existente. Ver doc 99.**
