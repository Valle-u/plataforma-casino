# Gregmorn — 01 · API spec (digerida)

Resumen operativo del [`openapi-v1.0.json`](openapi-v1.0.json). Ante cualquier duda,
manda el JSON.

## Hosts

| Host | Para qué |
|---|---|
| `https://office-api-dev.gregmorn.org` | Auth (`/auth/login`) y catálogo (`/users/.../getUserGames/...`). |
| `https://client-api-dev.gregmorn.org` | Abrir juego (`/games/openGame`). |
| `https://twalletvault.api.games-hub.net` | Transfer wallet. **No lo usamos.** |

Prod tiene hosts, credenciales y allowlists distintos.

---

## 1 · Nosotros → ellos

### `POST /auth/login` (office)

Devuelve el `accessToken` para pedir el catálogo.

- **Content-Type: `application/x-www-form-urlencoded`.** Mandar JSON da 400 o 401 —
  ellos lo marcan como error común.
- Body: `login`, `password`.
- Respuesta: `accessToken` (JWT), `refreshToken`, `user { id, login, role, currencies[] }`.
- **El `accessToken` tiene TTL corto.** Al expirar hay que volver a llamar. No hay
  endpoint de refresh documentado pese a que devuelven `refreshToken`.

> El `user.id` de esta respuesta **podría** ser el `user_id` que piden en el resto de
> los endpoints. Sin confirmar — ver `00-intake.md`.

### `GET /users/{user_id}/getUserGames/{currencyISO}` (office)

Catálogo de juegos habilitados para ese usuario y esa moneda.

- Auth: `Bearer {accessToken}`.
- Respuesta: array de `{ id, isEnabled, title, imageUrl, provider }`.
- El `id` viene con forma `integration:provider:game`
  (ej. `integration_a:provider_a:game_001`) y es lo que se manda como `gameId` al
  abrir el juego.

### `POST /games/openGame` (client)

Abre la sesión de juego. **No usa Bearer**: se autentica con `X-Signature`.

Campos obligatorios: `currency`, `demo`, `exitUrl`, `gameId`, `language`,
`player_login`, `user_id`.

Opcionales relevantes:
- **`callbackUrl`** — pisa el configurado en su panel. Confirmado que podemos usarlo
  siempre; nos evita depender de su config por moneda.
- `ip` — IP del jugador. Algunos estudios la exigen para reglas de jurisdicción o
  antifraude. Hay que preguntarles caso por caso.
- `freespinTotalBet`, `freespinCount`.

`demo: "1"` abre modo demo **sin callbacks de wallet**; `"0"` es juego real.

Respuesta OK: `content.game.url` (la URL a la que mandamos al jugador) y
`content.gameRes.sessionId`.

Error documentado: `409` con `{ status: "fail", error, code, message }`.

---

## 2 · Ellos → nosotros (seamless)

Los tres llegan por POST a nuestra callback URL, con `X-Signature`. El detalle de la
firma está en [`02-signing.md`](02-signing.md).

Contrato de respuesta, común a los tres:

```json
{ "balance": 2475, "currency": "ARS", "error": "", "login": "...", "status": "success" }
```

- **Aceptar:** HTTP 2xx + `status: "success"`.
- **Rechazar:** HTTP 400+ + `status: "fail"` con el motivo en `error`.

### `getBalance`

Body: `cmd`, `login`, `sessionid`.

Devolver el saldo solo cuando esté confirmado. **HTTP 400 significa "fail / retry":
ellos NO arrancan el spin y tienen prohibido usar un balance cacheado o por
defecto.** O sea: ante la duda, fallar es seguro; inventar un saldo no.

### `writeBet`

Body: `cmd`, `bet`, `win`, `login`, `sessionid`, `transactionId`, `round_finished`,
`info`; opcionales `gameId`, `roundId`.

- **`bet` y `win` pueden ser número O string.** Ellos avisan que algunos vendors
  (SL-Games, X-Games) mandan string.
- **Idempotencia por `transactionId`.** Si llega repetido y ya se aplicó: devolver
  HTTP 200 con el saldo actual y **no volver a aplicarlo**.
- **Si no alcanza el saldo, rechazar.** Ellos no reservan fondos ni usan `getBalance`
  para calcular. Encaja con nuestro `CHECK balance >= 0`.
- **El `balance` de la respuesta va después de aplicar la operación.**
- Puede venir `bet` y `win` en el mismo callback (algunos estudios).
- `info` es un JSON serializado como string, con el detalle del estudio.

### `rollback`

Body: `cmd`, `bet`, `win`, `login`, `sessionid`, `transactionId`, `round_finished`,
`info`, `gameId`.

- **El `transactionId` es el MISMO que el del bet original.** Ver la trampa #1 del
  README: si se usa crudo como clave de idempotencia, el rollback se descarta como
  duplicado y el jugador no recupera la plata.
- El monto a devolver es el `bet` original; `win` viene en 0.
- **Restaurar el saldo una sola vez.** Un rollback repetido tiene que devolver el
  estado actual sin volver a acreditar.

---

## 3 · Transfer wallet — descartado

`POST /apiIndividualWallet/` con `userCreate`, `userCash`, `userInfo`, más los
reportes `reportBet`, `sessionList`, `sessionLog`.

**No se integra.** Implicaría empujarles fichas con `userCash` y que el saldo del
jugador viva en la wallet de ellos, rompiendo **E1** (ficha = 1 peso, mint/burn puro)
y **E2** (`balance == Σ(wallet_transactions)`). Nuestro ledger tiene que seguir
siendo la fuente de verdad.

Se documenta acá solo para dejar asentado por qué se descartó.
