# 03 · Callback API (Seamless) — entrante: proveedor → NUESTRA wallet

> Captura 3 (2026-07). Es **la API que NOSOTROS exponemos** y que el proveedor
> llama en tiempo real durante el juego (auth/balance/bet/win/cancel/status).
> El código PHP de referencia del proveedor está en
> [`callback-example.php`](callback-example.php) (guardarlo tal cual: es la
> implementación canónica a replicar en NestJS).

## ⚠️ Cómo autentican (¡NO es HMAC!)
- El proveedor manda un header **`Callback-Token: <CALLBACK_TOKEN>`** en cada
  request. Nosotros comparamos por **igualdad** contra nuestro token guardado.
- Si no coincide → respondemos `{ "result": 100, "status": "ERROR" }`.
- **No hay firma/HMAC ni nonce.** El token es un bearer plano → **obliga a**:
  - **HTTPS** siempre (el token viaja en el header).
  - **IP whitelist** del lado del proveedor (Main API ya exige whitelist).
  - Guardar el `CALLBACK_TOKEN` como secreto (`GAME_PROVIDER_CALLBACK_TOKEN`),
    nunca en git. (Ejemplo del doc: `eadd5a04-4720-4a10-ae60-b11cd01cc3aa` — NO real.)

## Orden de desarrollo (6 pasos, del panel)
1. **Callback URL Setting** — se configura en **[Settings]** (nuestra URL pública).
2. **Check API Examples** — implementar **TODAS** las funciones ("You are
   responsible for any non-implementation").
3. **Callback API Development** — construir el endpoint (reglas abajo).
4. **Callback API Testing** — usar la página de testing (doc 04), paso a paso.
   Con datos virtuales (no hacen falta points).
5. **Agent Approval Request** — al terminar, el agente está **"Unapproved"**;
   hay que contactar al manager para pasarlo a **Approved**.
6. **Game Testing** — recién ahí se prueba el juego real vía Main API.

## Reglas del endpoint (obligatorias)
- **Método:** `POST`. **Body:** JSON. **Respuesta:** JSON.
- **Headers que recibimos:** `Callback-Token`, `Accept: application/json`,
  `Content-Type: application/json`.
- **⏱️ Timeouts (CRÍTICO):**
  - Commands **`bet`** y **`balance`** → responder en **≤ 2 segundos**.
  - Los demás commands → **≤ 4 segundos**.
  - ⇒ El endpoint debe ser **síncrono y rapidísimo** (debitar/acreditar la wallet
    en la misma request). Está en el camino crítico del juego.
- **Timezone:** el panel dice **Korea (Asia/Seoul)** para el servicio, pero los
  campos `timestamp`/`time_stamp` de los ejemplos vienen en **UTC** (epoch). Tratar
  los epoch como UTC; ⚠️ confirmar en testing cómo interpretan las fechas.
- **Retries del proveedor** (por eso la **idempotencia es obligatoria**):
  - Acreditación (`win`, `cancel`): **1ª vez + 50 reintentos** cada 2-4 s hasta OK.
  - Confirmación (`balance`): 1ª vez + **3 reintentos**.
  - Débito (`bet`): 1ª vez + **si falla, mandan un `cancel`** ("forward cancellation").
- **`cancel` se dispara cuando** el request original dio **timeout** o **HTTP 500**.
- **Tipos:** strings entre comillas simples; **el `balance` de la respuesta debe
  ser numérico** (el ejemplo lo trata como `int`). Los montos vienen como
  **DECIMAL(18,2)**. ⚠️ En KRW hacen `intval()`; **para ARS NO debemos truncar
  decimales** — mantener centavos (ver "Riesgos" abajo).

## El modelo `command` + `check`
Cada callback trae un `command` (qué hacer) y un `check` (lista CSV de validaciones
a correr **antes** de procesar). Si un check falla, respondemos
`{ result: <nro_del_check>, status: "ERROR", data: { balance } }` y cortamos.

**Checks:**
| check | Valida | Si falla → result |
|---|---|---|
| `21` | La cuenta (`account`) existe. | `21` |
| `22` | El usuario está **Active**. | `22` |
| `31` | Balance ≥ `amount` (fondos para apostar). | `31` (+balance) |
| `41` | El `trans_guid` **NO** fue procesado (idempotencia). | `41` (+balance) |
| `42` | El `trans_guid` **existe** (para `status`). | `42` (+balance) |
| `43` | El `cancel_trans_guid` existe (para `cancel`). | `43` (+balance) |

> 🔑 El check `41` es exactamente nuestra **idempotencia por key**: cada
> `trans_guid` se guarda; si llega repetido, NO reprocesar, devolver el balance
> actual. Igual que el `wallet_tx_idempotency_key` que ya tenemos.

## Los 6 commands (request → response)
Todas las respuestas OK son `{ "result": 0, "status": "OK", "data": {...} }`.
El `account` es el identificador del jugador (string, 4-15, = el `name` que le
dimos en `user/create` de la Main API).

### 1) `authenticate` — al abrir el juego
```jsonc
// req
{ "command":"authenticate", "data":{ "account":"test1234" }, "timestamp":"...", "check":"21" }
// res
{ "result":0, "status":"OK", "data":{ "account":"test1234", "balance":12000 } }
```

### 2) `balance` — consultar saldo (check "21,22")
```jsonc
// req  { "command":"balance", "data":{ "account":"test1234" }, ... }
// res  { "result":0, "status":"OK", "data":{ "balance":12000 } }
```

### 3) `bet` — apuesta (check "21,22,41,31"); descuenta saldo
```jsonc
// req
{ "command":"bet", "data":{
    "gplay_id":"8949111", "account":"test1234",
    "trans_guid":"403001468-1-vs10emotiwins-336097135023-1771772046312",
    "time_stamp":1771772046312, "round_id":"336097135023",
    "provider_id":1, "game_code":"vs10emotiwins", "game_type":"slot",
    "amount":0.9, "type":1 }, "timestamp":"1771772046", "check":"21,22,41,31" }
// res  { "result":0, "status":"OK", "data":{ "balance":12000 } }  // balance = DESPUÉS del débito
```

### 4) `win` — resultado (hit o miss, check "21,22,41"); acredita saldo
```jsonc
// req  { "command":"win", "data":{ ...igual que bet..., "amount":1000, "type":2 }, ... }
// res  { "result":0, "status":"OK", "data":{ "balance":12000 } }
```
- ⚠️ **Siempre llega un `win`, aun cuando `amount=0`** (pérdida). Con `amount>0`
  se acredita; con `0` solo se registra la tx (no cambia balance).

### 5) `cancel` — revierte un bet o win (check "21,22,41,43"); trae `cancel_trans_guid`
```jsonc
// req  { "command":"cancel", "data":{ ..., "cancel_trans_guid":"<guid original>",
//         "amount":1000, "type":16 }, ... }
// res  { "result":0, "status":"OK", "data":{ "balance":12000 } }
```
- Si el original era **BET** → se **devuelve** el importe (+balance).
- Si el original era **WIN** → se **resta** el importe (−balance).
- Se marca la tx original como `CANCEL` (no re-cancelar si ya lo está).

### 6) `status` — consulta el estado de una tx (check "21,42")
```jsonc
// req  { "command":"status", "data":{ "account":"test1234", "trans_guid":"..." }, ... }
// res  { "result":0, "status":"OK", "data":{ "account":"...", "trans_guid":"...", "trans_status":"OK"|"CANCELED" } }
```

## Códigos de `result` en NUESTRA respuesta
- `0` + `status:"OK"` → procesado.
- `100` → `Callback-Token` inválido.
- `21|22|31|41|42|43` → falló ese check (devolver también `data.balance`).
- `99` → error interno de procesamiento (DB, etc.).

## Mapeo a nuestra plataforma (para el doc 99)
- **`account` (callback) = `name` del user (Main API) = un jugador nuestro.**
  Guardamos `provider_user_code` (int64) y `provider_account` (string) por jugador.
  Mantener el name en **4-15 alfanumérico** (intersección de ambas reglas).
- **`balance` = saldo de fichas del jugador en NUESTRA wallet.** El callback
  debita/acredita nuestra wallet en la misma transacción y devuelve el saldo nuevo.
- **`trans_guid` = idempotency key.** Reusar el patrón `wallet_tx_idempotency_key`.
  Necesitamos una tabla `provider_bets` (trans_guid PK, account, round_id, game_code,
  type BET/WIN/CANCEL, amount, status, created_at) — espejo de `bet_casino`.
- **`bet`/`win`/`cancel` → wallet debit/credit** vía nuestro WalletService, dentro
  de una tx atómica con FOR UPDATE (igual que el resto de la wallet).
- Área **ALTA SENSIBILIDAD** (`packages/db/wallet/*`): preguntar antes de tocar.

## Riesgos / decisiones a tomar (⚠️ economía)
1. **Precisión de moneda (ARS con centavos).** Los montos son DECIMAL(18,2) y el
   ejemplo hace `intval()`. Si truncamos, perdemos/creamos centavos → rompe el
   invariante del ledger. **Decisión:** guardar y operar en la mínima unidad
   (centavos como bigint), NO `intval`. Confirmar con el proveedor si ARS opera
   con o sin decimales en su lado.
2. **Fuente de las fichas.** En seamless el balance del jugador es NUESTRO
   circulante. ¿El bet quema/mueve fichas a la Casa y el win las mintea? Hay que
   mapear bet/win a nuestro modelo mint/burn/transfer **sin romper E1–E8**. Esto
   toca la LEY económica → diseñarlo en el doc 99 y validarlo con el dueño.
3. **Comisiones/GGR.** El neto bet−win por jugador alimenta el `subNetWin` que ya
   usa el motor de comisiones diferencial. Cruzar callbacks vs `game/transaction`.
4. **Latencia.** bet/balance en ≤2s ⇒ el hosting debe tener baja latencia al
   proveedor (Asia). Refuerza usar un **staging/VPS con IP fija whitelisteada**,
   no localhost.
5. **Idempotencia bajo 50 reintentos.** El win se reintenta hasta 50 veces →
   nuestra idempotencia tiene que ser a prueba de balas (unique constraint + upsert).

## Preguntas abiertas
1. ¿El `timestamp`/`time_stamp` es UTC o Asia/Seoul? (el panel dice Seoul, los
   ejemplos parecen UTC epoch).
2. ¿ARS opera con decimales del lado del proveedor o redondean a entero?
3. ¿Hay un command de `rollback` masivo o solo el `cancel` individual?
4. ¿`game_type` qué valores toma además de `slot`/`live`/`baccarat`/`poker`?
5. ¿Qué pasa si respondemos `result:41` (ya procesado) a un `win` reintentado —
   les alcanza con el balance para conciliar?
