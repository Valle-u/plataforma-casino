# 02 · Main API (saliente: nosotros → proveedor)

> Spec completo capturado del swagger v4 (2026-07). API que NOSOTROS consumimos
> del aggregator. El JSON crudo está en [`swagger-v4.json`](swagger-v4.json).
> El sentido inverso (ellos → nuestra wallet) es la
> [Callback API (Seamless)](03-callback-seamless.md).

## Identidad
- **Nombre:** "Agent API Documentation" · **v4** · **OpenAPI 3.0.4**.
- **Base URL:** `https://agent.goldslotpalase.com`
- **Prefijo de rutas:** `/v4/...` · **todos los endpoints son POST**.
- **Swagger:** `https://agent.goldslotpalase.com/swagger/v4/swagger.json` (403 sin token).
- **Postman:** `https://documenter.getpostman.com/view/48334995/2sBXitCng1`

## Autenticación
| Header | Value |
|---|---|
| `Authorization` | `Bearer {API TOKEN}` (UUID, ej. `ed45553e-1702-4342-a70d-09bf7ff7f568` = **ejemplo del doc, no el real**) |
| `Accept` | `application/json` |
| `Content-Type` | `application/json` |

- Token en **Settings / info del admin**. `securityScheme = Bearer (http, bearerFormat "Custom")`.
- 🔒 El token real va en env/secreto (`GAME_PROVIDER_API_TOKEN`), **nunca en git**.

## Envelope de respuesta (TODAS las respuestas)
```jsonc
{ "code": 0, "message": null, "data": { /* payload del endpoint */ } }
```
- `code == 0` → OK. Cualquier otro → error (ver tabla de códigos abajo).
- Hay que chequear `code` SIEMPRE, no solo el HTTP 200.

## Modelo mental (clave para el mapeo a nuestra plataforma)
- **Nosotros = un "Agent"** (`redgardel`) con un pool de **Points** (`balance`),
  una **currency**, un **RTP** (winning rate global) y una **whitelist** de IPs.
- **Cada jugador nuestro = un "User"** del proveedor, identificado por un
  **`user_code`** (int64) que se obtiene creándolo.
- ⚠️ **El `user_code` NO es estable entre modos.** El doc dice: al pasar de
  Transfer↔Seamless el user_code viejo deja de servir; **recomiendan llamar a
  `user/create` en cada login del jugador** y usar el code devuelto (es
  idempotente: si ya existe, devuelve el mismo user). → En nuestra integración,
  guardamos el `user_code` por jugador pero lo re-obtenemos en login.
- **RTP (winning rate):** se setea a nivel agente (aplica a todos los users), y
  se puede pisar por-jugada en `game-url.rtp` — **debe ser ≤ RTP del agente**.
  `rtp: 0` = usar el del agente. Esto es la palanca de "cuánto devuelve la
  máquina" — nuestra ganancia (GGR) sale de acá.

## ⚠️ Seamless vs Transfer — qué usamos y qué NO
Los endpoints `3.User Wallet` (`/v4/wallet/deposit`, `/withdraw`, `/withdraw-all`)
están marcados **"Only Transfer Mode"**. Nosotros somos **SEAMLESS**, así que:
- ❌ **NO** usamos esos 3 endpoints. En seamless el balance del jugador vive en
  NUESTRA wallet y el proveedor la consulta/debita por callbacks en tiempo real
  (ver doc 03).
- ✅ Sí usamos: agent/*, user/create, user/info, game/*, statistics, transaction.

## Catálogo de endpoints (por tag)

### 1 · Agent Account
| POST | Qué hace | Req → Data |
|---|---|---|
| `/v4/agent/info` | Info del agente (name, currency, **balance=Points**, rtp, **whitelist**). | — → `_AgentInfo` |
| `/v4/agent/rtp` | Cambiar RTP global del agente. | `{rtp}` → base |
| `/v4/agent/callback-test` | Dispara un test del callback (seamless). | — → base |

### 2 · User Account
| POST | Qué hace | Req → Data |
|---|---|---|
| `/v4/user/create` | Crea (o devuelve si existe) el user. name 2-50 `^[_a-zA-Z0-9]+$`. | `{name}` → `{user_code, is_new_user}` |
| `/v4/user/info` | Balance/nombre del user. Otro agente → `PERMISSION_ERROR`. | `{user_code}` → `{name, balance}` |

### 3 · User Wallet — **SOLO Transfer (no lo usamos)**
`deposit` / `withdraw` (`{user_code, amount}`), `withdraw-all` (`{user_code}`).
En transfer, depositar al user descuenta Points del agente y viceversa.

### 4 · Game Details
| POST | Qué hace | Req → Data |
|---|---|---|
| `/v4/game/providers` | Proveedores asignados al agente. | `{lang}` → `_Provider[]` |
| `/v4/game/games` | Juegos de un provider. `category` = 'Slots'\|'Live'. | `{provider_id, lang}` → `_Game[]` |
| `/v4/game/all` | Todos los juegos de una. | — → `_Game[]` |

`_Game`: `game_code` (= **game_symbol** para launch), `game_name`, `locale_name`,
`game_image`(+`_narrow`), `launch_enable`, `category`, `reg_date`.

### 5 · Game Launch
| POST | Qué hace | Req → Data |
|---|---|---|
| `/v4/game/game-url` | **Launch.** URL de acceso al juego (**válida 10 min, un solo uso**). | `{user_code, provider_id, game_symbol, lang, return_url?, rtp?}` → `{game_url}` |
| `/v4/game/online-games` | Juegos activos (últimos 30 min); da `gplay_id`. | — → `_OnlineGame[]` |
| `/v4/game/call_config` | Config bonus-call (`call_min`). | — → `{call_min}` |
| `/v4/game/call_start` | Iniciar bonus-call sobre un `gplay_id`. | `{gplay_id, set_point, type, memo?}` → `{call_id}` |
| `/v4/game/call_cancel` | Cancelar bonus-call por `call_id`. | `{call_id}` → base |
| `/v4/game/freeround/start` | Free rounds a un user. | `{user_code, provider_id, game_code, bet, rounds, expirationDate}` → base |
| `/v4/game/freeround/cancel` | Cancelar free rounds. | `{fr_id}` → base |

**Flujo de launch (seamless):** `user/create` → (`game/providers` + `game/games`
para el catálogo) → `game/game-url` → abrir `game_url` en iframe/redirect →
el proveedor pega los bet/win a NUESTRO callback.

### 6 · Game Transaction (reconciliación)
| POST | Qué hace | Req |
|---|---|---|
| `/v4/game/transaction` | Buscar tx por rango de tiempo (UTC). | `{start_time, end_time, offset, limit≤2000}` |
| `/v4/game/transaction-id` | Buscar tx desde un `last_id` (cursor). | `{last_id, limit≤2000}` |
| `/v4/game/round-details` | URL con el detalle de una ronda (≤30 días). | `{user_code, round_id, provider_id?, game_code?}` |

`_Transaction`: `trans_id`, `user_code`, `round_id`, `trans_type`, `provider_*`,
`game_*`, `category`, `prebalance`, `trans_amount`, `balance`, `regdate`, `time_stamp`.
⚠️ **Las transacciones se borran a los 2 días** (carga del server) → hay que
pollear y **persistirlas de nuestro lado**. Delay mínimo **30s** entre requests
del mismo cursor.

### 7 · Statistics
`/v4/statistics/user` — `{start_time, end_time, offset, limit}` → por user:
`slot_bet/win`, `live_bet/win`, `mini_bet/win` (paginado).

## Tipos de transacción
`1 Bet` · `2 Win` (siempre, aun 0) · `4 Deposit` · `8 Withdraw` · `16 BetCancel`
(revierte un Bet fallido, devuelve el importe) · `32 BonusCall` (win por bonus-call).

## Bonus-call (cómo afecta la plata)
Se aplica a un juego en curso (no live). El importe **sale de los Points del
agente**, se paga al user como win, y **se le acredita de vuelta al agente** →
neto 0 para el agente, solo se refleja como win del user. No afecta el RTP global.
En seamless, en el callback de win viene `call_id` (0 si es tx normal).

## Códigos de respuesta (los que importan)
`0 OK` · `1 UNDER_MAINTENANCE` · `1002 VALIDATION_ERROR` · `1007 TOKEN_NOT_FOUND` ·
`1009 TOKEN_INVALID` · `1010 PERMISSION_ERROR` · `1012 PARAMETERS_INVALID` ·
`1015 CALLBACK_ERROR` (revisar el error log del callback) · `1018 SERVER_IS_BUSY` ·
`1020 IP_NOT_ALLOWED` · `2001 AGENT_NOT_FOUND` · `2002 USER_NOT_FOUND` ·
`2003 GAME_NOT_FOUND` · `2005 POINT_NOT_ENOUGH` (Points del agente) ·
`2006 BALANCE_NOT_ENOUGH` (balance del user) · `2007 PROVIDER_NOT_FOUND` ·
`2013 ROUND_NOT_FOUND` · `2014 CURRENCY_NOT_SUPPORTED`. (Lista completa en el JSON.)

## Límites y reglas operativas
- **Concurrencia:** máx **10 llamadas simultáneas por IP** → `SERVER_IS_BUSY(1018)`.
  Hay que esperar a que termine la anterior (⇒ pool/limiter de nuestro lado).
- **IP whitelist:** si la IP no está permitida → `IP_NOT_ALLOWED(1020)`. El agente
  tiene un array `whitelist` (config en Settings — ver doc 04). **Nuestra IP de
  salida (hosting) debe estar whitelisteada.**
- **Timezone:** todas las queries de tiempo en **UTC(0)**.
- **Retención de tx:** 2 días → persistir nosotros.
- **Idiomas:** 1=EN, 4=ES, 6=PT (relevantes). providers/games aceptan lang 1-6;
  game-url acepta 1-13.

## Cómo mapea a nuestra plataforma (para el doc 99)
- Nuestro backend = el **Agent** (un solo token con el aggregator). La jerarquía
  socio/distribuidor/cajero es NUESTRA, transparente para el proveedor.
- Por cada jugador → un **User** del proveedor (`user/create` en login).
- **Fichas del jugador = balance seamless** que servimos por callback (doc 03).
- **GGR/ganancia** sale del RTP + del neto bet−win, que reconciliamos por
  `game/transaction` y cruzamos contra nuestro ledger.

## Preguntas abiertas para esta sección
1. ¿La `currency` del agente (int, ej `2`) qué valor es para **ARS**? (confirmar en agent/info real).
2. ¿Cómo se fondean los **Points del agente** (nuestro crédito con el aggregator)? ¿prepago?
3. ¿El `game_url` se abre en iframe embebido o redirect full-page? ¿mobile?
4. ¿`return_url` es a dónde vuelve el jugador al cerrar el juego?
