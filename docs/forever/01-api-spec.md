# 01 — Forever · API Specification (destilado de v1.0.3)

> Fuente: `en_0.pdf` ("API Specification v1.0.3", 46 pág.) que pasó el dueño (2026-08),
> + capturas del panel (`Request signature`, `Test launch url`). Este doc es nuestra
> **referencia canónica** — evita releer el PDF. Lo `⬜` es lo que falta confirmar.

---

## 0 — Overview (pág. 4)

- **API base URL:** ⬜ está en la sección **"Settings and Information"** del back office
  (falta esa captura). Panel/back office observado: `backoffice.aicvgdbi.win`.
- **Headers:** `Content-Type: application/json` en todos los requests.
- **Método:** **todos POST**. **Tiempo en UTC+0.**
- **Currency de nuestra cuenta:** **USD** (dashboard). Montos tipo `Decimal`.
  ⬜ confirmar si incluyen centavos (los ejemplos usan enteros: 1000, 2000).

### Autenticación (2 capas)
1. **En el body:** `token` (agent token) + `agentCode` (código de agente) en cada request.
2. **Firma HTTP (X-Forever-Sig-\*):** el panel ("Request signature") arma headers
   **`X-Forever-Sig-*`** a partir de: **Request JSON body + Agent code + Timestamp (ms) +
   Nonce + `Request sign private key`**. O sea firma con **clave privada** (esquema
   asimétrico tipo RSA/ECDSA, no HMAC simple). Hay **SDKs oficiales** para copiar las
   reglas de firma exactas: **C#, Node.js, PHP, JavaScript**. → **bajar el SDK de Node.js**
   es la vía más rápida para replicar la firma. ⬜ confirmar algoritmo exacto y de dónde
   sale el `private key` en el panel.

> ⚠️ **Diferencia clave con Palace:** Palace era token plano sin firma. Forever exige
> **firmar cada request** con clave privada + timestamp + nonce (anti-replay). Es más
> seguro, pero es una **capa de auth nueva** a implementar (y probablemente a **verificar**
> en los callbacks entrantes — ⬜ confirmar si el callback viene firmado).

---

## 1 — 🎯 Wallet Callback API (Seamless) — lo que NOSOTROS implementamos (pág. 38-41)

> Forever nos llama a NUESTRO endpoint. Son **2 callbacks**. **Timeout: responder en ≤ 2s.**
> Nosotros exponemos la URL (ellos la registran en Settings). ⬜ dónde se registra la URL.

### 1.1 `GetBalance` — leer saldo del jugador
- **Request** (Forever → nosotros): `{ method:"GetBalance", token, userCode, currencyCode }`
- **Response:** `{ status:0, msg:"SUCCESS", balance:<Decimal> }`
- Mapea a: leer `wallet.balance` del jugador identificado por `userCode`.

### 1.2 `ChangeBalance` — mover el saldo (bet / win / cancel / bonus / jackpot)
Se llama cuando el jugador **apuesta, gana, cancela, o recibe bono/jackpot**. "Simplemente
aplicá el `amount` según el `txnType`."

- **Request params:**
  | Campo | Tipo | Nota |
  |---|---|---|
  | `method` | String | `ChangeBalance` |
  | `token` | String | agent token |
  | `userCode` | String | nuestro user (site user code) |
  | `currencyCode` | String | USD |
  | `vendorCode` | String | proveedor del juego |
  | **`txnType`** | Int | **0 = Debit (bet), 1 = Credit (win), 2 = Cancel** |
  | **`wagerId`** | Long | ID de la jugada — **liga Debit ↔ Credit/Cancel** |
  | `detail` | String | opcional |
  | `pairCode` | String | opcional — diferencia pares múltiples |
  | **`txnCode`** | String | **código de transacción = idempotency key** |
  | **`amount`** | Decimal | monto a debitar/acreditar |
  | `gameCode` | String | opcional |
  | `gameRoundId` | String | opcional |
  | `createdOn` | DateTime | requerido |
  | `isFinished` | Boolean | requerido |
  | `isFreeRound` | Boolean | true si free round |
- **Response:** `{ status:0, msg:"SUCCESS", balance:<nuevo saldo> }` (⬜ confirmar campos exactos).
- **Idempotencia:** por **`txnCode`** (código 21 `DUPLICATE_REQUESTKEY` = pedido duplicado).
- **Reconciliación:** cada Debit debe tener su Credit o Cancel (mismo `wagerId`). Si no
  llega en **10 min**, ellos recomiendan un cron que consulte `GetWagerInfo`. Del lado
  nuestro: idempotencia + hold/burn como en Palace.

### Mapeo a nuestra economía (LEYES E1/E6 — igual que Palace, "Opción C")
- `txnType=0` (Debit/bet) → **burn** puro del wallet del jugador.
- `txnType=1` (Credit/win) → **mint** puro al wallet del jugador.
- `txnType=2` (Cancel) → **reversa** del debit/credit anterior (por `wagerId`/`txnCode`).
- Sin tope de premio (igual que Palace; con el mismo `win_max_amount` de sanidad).

---

## 2 — Operator API — lo que NOSOTROS llamamos (pág. 5-37)

> Todas POST, con auth (token+agentCode+firma). En **seamless** los endpoints marcados
> "(Transfer)" **NO se usan** (CreateUser/Deposit/Withdraw/WithdrawAll/GetUserInfo) — el
> saldo lo maneja nuestra wallet vía callback.

### 2.1 `GetGameUrl` — 🚀 lanzar un juego (pág. 5-7) — **el que sí usamos**
- **Request:** `{ method:"GetGameUrl", token, agentCode, userCode, vendorCode, gameCode,
  currencyCode, language, channel, nickname?, freeRounds?, customGameName?, homeUrl?,
  isDemo?, lowRtp?, highRtp?, betMultiplier? }`
  - `channel`: `"desktop"` o `"mobile"` → responsive.
  - `lowRtp`/`highRtp`: palanca de RTP (ej. `0.6`/`0.8`).
  - `homeUrl`: a dónde vuelve el jugador (nuestro return_url).
  - `isDemo`: modo demo.
- **Response:** `{ status:0, msg:"SUCCESS", launchUrl:"https://.../entry?JSESSIONID=..." }`
- Se abre en **iframe / redirect** (el panel tiene "Test launch url").
- **Rate limit:** **6s por usuario, 10 veces por minuto.**

### 2.2 Catálogo
- `GetVendors` → lista de **Vendor** `{ vendorCode, vendorName, gameType }`.
- `GetGameList` (por vendor) → lista de **VendorGame** `{ gameCode, gameName, gameType,
  imageUrl }`.
- `gameType`: **1 = Slot, 2 = Live Casino**.

### 2.3 Reportes / reconciliación
- `ReportByDate` (rango ≤ 5 min) y `ReportById` (`startWagerId`, `count`) → lista de **Wager**.
- `GetWagerInfo` / `GetWagerDetails` → detalle de una jugada (para `isFinished=false`).
- `GetWagerDetailUrl` → URL con el detalle visual de la jugada.
- **Wager model:** `{ userCode, vendorCode, gameType, gameCode, gameRoundId, wagerId,
  betAmount, payoutAmount, beforeBalance, afterBalance, detail, createdOn, modifiedOn,
  settlementOn, status }`.

### 2.4 Gestión de agente (probablemente no usamos en MVP)
- `GetAgentInfo`, `GetSubAgentBalances`, `DepositAgent`, `WithdrawAgent`, `CancelFreeRound`.

### 2.5 Rate limits entre requests (pág. 4)
ReportByDate 5s · ReportById 5s · GetWagerInfo 1s · GetVendors 1s · GetVendorGames 1s ·
GetAgentInfo 3s · GetUserInfo 3s · GetDetailUrl 1s · CreateUser 1s ·
**GetGameUrl 6s/usuario, 10/min** · Deposit/Withdraw/WithdrawAll 1s/usuario.

---

## 3 — Appendix

### 3.1 Response codes (pág. 44)
| Code | Message | |
|---|---|---|
| 0 | SUCCESS | ok |
| 1 | INTERNAL_ERROR | error interno |
| 2 | INVALID_ACTION | request mal formado |
| 3 | INVALID_AGENT | agente inválido |
| 4 | BLOCK_AGENT | agente bloqueado |
| 5 | INVALID_USER | usuario inválido |
| 6 | BLOCK_USER | usuario bloqueado |
| 7 | DUPLICATE_USER | usuario duplicado |
| 8 | INSUFFICIENT_MONEY | **saldo insuficiente** (→ nuestra respuesta al bet) |
| 12 | INVALID_VENDOR | vendor inválido |
| 13 | INVALID_PARAMETER | parámetro inválido |
| 14 | NETWORK_ERROR | error de red |
| 15 | MAINTENANCE | en mantenimiento |
| 18 | INVALID_WAGER | tx/wager inválido |
| 20 | INVALID_TIME | formato/rango de tiempo inválido |
| 21 | DUPLICATE_REQUESTKEY | **pedido duplicado** (idempotencia) |
| 22 | TIMEOUT_ERROR | timeout |

### 3.2 Models
- **User:** `{ userCode, balances: Map<String,Decimal> }`.
- **Wager:** ver 2.3.
- **Vendor:** `{ vendorCode, vendorName, gameType }`.
- **VendorGame:** `{ gameCode, gameName, gameType, imageUrl }`.

---

## 4 — Comparación rápida con Palace (para dimensionar el trabajo)

| Aspecto | Palace | Forever |
|---|---|---|
| Modelo | Seamless | Seamless ✅ igual |
| Auth requests (nosotros→ellos) | Bearer token plano | **Firma X-Forever-Sig (private key + ts + nonce)** ⚠️ nuevo |
| Callback (ellos→nosotros) | 6 commands (authenticate/balance/bet/win/cancel/status), header `Callback-Token` | **2 callbacks (GetBalance/ChangeBalance)**, `token` en body; txnType 0/1/2 ⚠️ distinto |
| Idempotencia | `trans_guid` | **`txnCode`** |
| Link debit↔credit | — | **`wagerId`** |
| Timeout callback | bet/balance 2s, resto 4s | **todo 2s** ⚠️ más estricto |
| Launch | game-url | `GetGameUrl` (muy parecido) |
| Currency | ARS | **USD** |
| gameType | — | 1=Slot, 2=Live |

**Conclusión:** **NO es el mismo aggregator que Palace** (la API es distinta). Reusamos la
**arquitectura** (seamless, burn/mint, launch por URL, mapping de usuario, idempotencia)
pero el **adapter de Forever es nuevo**: firma de requests, 2 callbacks unificados en
`ChangeBalance` con `txnType`, y currency USD.

---

## 5 — Pendientes concretos (⬜)
1. **API base URL** (sección "Settings and Information" del back office).
2. **Reglas exactas de la firma** (bajar SDK Node.js + captura de "Request signature") —
   algoritmo, orden de campos, de dónde sale el `private key`.
3. **¿El callback entrante viene firmado?** (validamos firma además del `token`?).
4. **Dónde se registra la Callback URL** (nuestra URL pública).
5. **Centavos sí/no** en `amount`.
6. **Response exacto de `ChangeBalance`** (¿devuelve `balance`? ¿`prevBalance`?).
7. Estado de la cuenta: **approved/unapproved**, sandbox o prod.
