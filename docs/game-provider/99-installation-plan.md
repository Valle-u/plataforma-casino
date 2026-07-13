# 99 — Plan de Instalación · Palace Casino Integration

> **Estado:** Borrador para revisión del dueño.  
> **Decisions confirmadas con el dueño:** ver §0.  
> **Leyes que aplica:** E1 (mint/burn puro), E4 (idempotencia), P1-P3, W1-W6.

---

## §0 — Decisiones confirmadas

| # | Decisión | Elección |
|---|---|---|
| 1 | Multi-tenant config | **Por tenant** — cada tenant configura sus credenciales como `tenant_settings` |
| 2 | User mapping | **Columnas en `users`** — `palace_user_code` + `palace_account` |
| 3 | Coexistencia Mock vs Palace | **Solo Palace** — reemplazar mock games por Palace en el catálogo |
| 4 | URL del callback en dev | **Túnel** — ngrok/cloudflared para exponer localhost con HTTPS |
| 5 | Arquitectura de rounds | **Callback handler separado** — `PalaceCallbackService` opera wallet directamente |

### Modelo económico (Opción C — ya confirmada)

- `bet` callback → **burn puro** del wallet del jugador (no toca Casa/operador)
- `win` callback → **mint puro** al wallet del jugador
- `cancel` callback → reversa del burn/mint anterior
- Sin tope de premio (Max Win = 0 en Settings del proveedor)

---

## §1 — Sprints propuestos

| Sprint | Scope | Estimación |
|---|---|---|
| **P-1** | Schema + env + PalaceClient | ~2h |
| **P-2** | Callback endpoint + PalaceCallbackService | ~3h |
| **P-3** | Catálogo sync (providers + games) | ~1.5h |
| **P-4** | Launch flow (Main API game-url + frontend iframe) | ~2h |
| **P-5** | Testing con el panel del proveedor + fix bugs | ~2h |
| **P-6** | Remover mock + cleanup + tests E2E | ~1.5h |
| | **Total** | **~12h** (3-4 sesiones) |

---

## §2 — Sprint P-1: Schema + Env + PalaceClient

### 2.1 Schema changes (migration)

**Tabla `users` — 2 columnas nuevas:**
```sql
ALTER TABLE users ADD COLUMN palace_user_code bigint;
ALTER TABLE users ADD COLUMN palace_account   text;
-- INDEX en palace_account (hot path del callback: WHERE palace_account = $1)
```

> `palace_user_code` es `int64` (lo devuelve `user/create`).  
> `palace_account` es `text` 4-15 chars (el `name` que le pasamos a `user/create`).  
> Ambos `nullable` — sólo se setean cuando el user abre un juego Palace por primera vez.

**Tabla `games` — 2 columnas nuevas:**
```sql
ALTER TABLE games ADD COLUMN palace_provider_id  integer;
ALTER TABLE games ADD COLUMN palace_game_symbol   text;
```

> `palace_provider_id` = ID del provider en Palace (1-26).  
> `palace_game_symbol` = `game_code` del swagger (ej. `vs10emotiwins`).  
> Usados en `game/game-url` para construir el launch.

**Sin tablas nuevas.** Reusamos `game_sessions` + `game_rounds` existentes.

### 2.2 Tenant settings (registry)

Agregar al `TenantSettingsRegistry`:
```typescript
'palace.api_url':           z.string().url(),
'palace.api_token':         z.string().uuid(),
'palace.callback_token':    z.string().uuid(),
'palace.callback_url':     z.string().url(),   // nuestra URL pública
'palace.default_lang':     z.number().int().min(1).max(13).default(4), // 4 = ES
```

> **No en `.env`** — es config por tenant (decisión §0.1). Cada tenant setea sus credenciales desde `/admin/settings`.

### 2.3 PalaceClient (Main API client)

```
apps/api/src/games/providers/palace/
  ├── palace-client.ts          — HTTP client para Main API
  ├── palace-callback.service.ts — handler de callbacks (Sprint P-2)
  ├── palace-callback.controller.ts — endpoint POST /callback/palace
  ├── palace.errors.ts          — errores tipados
  └── palace.types.ts           — tipos de request/response
```

**`PalaceClient`** —封装 de `fetch` con:
- `agentInfo()` → GET `/v4/agent/info`
- `userCreate(name)` → POST `/v4/user/create`
- `userInfo(userCode)` → POST `/v4/user/info`
- `gameProviders(lang)` → POST `/v4/game/providers`
- `games(providerId, lang)` → POST `/v4/game/games`
- `allGames(lang)` → POST `/v4/game/all`
- `gameUrl(userCode, providerId, symbol, lang, rtp?)` → POST `/v4/game/game-url`
- `transactions(startTime, endTime, offset, limit)` → POST `/v4/game/transaction`

Cada método:
1. Lee settings del tenant (`palace.api_url`, `palace.api_token`)
2. `fetch` con `Authorization: Bearer {token}`
3. Parsea envelope `{ code, message, data }`
4. `code !== 0` → throw tipado (`PalaceTokenInvalidError`, `PalacePermissionError`, etc.)
5. Devuelve `data`

**Concurrencia:** pool de 8 slots (máximo 10 simultáneas por spec, dejamos margen).

---

## §3 — Sprint P-2: Callback endpoint + PalaceCallbackService

### 3.1 Endpoint

```
POST /api/v1/game-provider/palace/callback
```

> **Fuera del TenantResolver** — el callback NO manda `X-Tenant-Host`.  
> Resolvemos el tenant desde el `account` del callback.

### 3.2 Flujo del callback

```
Provider (Palace)
    │
    │  POST /callback/palace
    │  Header: Callback-Token: {token}
    │  Body: { command, data, check, timestamp }
    │
    ▼
PalaceCallbackController
    │
    │  1. Validar Callback-Token contra settings del tenant
    │     ⚠️ Problema: no sabemos qué tenant es antes de validar el token
    │
    │  2. Resolución de tenant:
    │     Opción A: el token es único por tenant → buscar en tenant_settings
    │                cuál tenant tiene ese callback_token → resolver
    │     Opción B: path param /callback/palace/:tenantSlug
    │
    │  3. Parsear command + data + check
    │
    │  4. Pasar a PalaceCallbackService.handle(db, command, data, checks)
    │
    │  5. Devolver { result: 0, status: 'OK', data: {...} }
    │
    ▼
Provider recibe response (≤2s para bet/balance)
```

### 3.3 Resolución de tenant (problema clave)

El callback del proveedor NO incluye el hostname ni ningún identificador de tenant. Solo manda:
- Header `Callback-Token` (UUID)
- Body con `command`, `data.account`, etc.

**Solución: query en `platform_control.tenant_settings`:**

Como el `callback_token` es único por tenant, podemos buscar en la DB de control cuál tenant tiene ese token:

```sql
SELECT t.id, t.slug, t.db_name 
FROM tenants t
JOIN tenant_settings ts ON ts.tenant_id = t.id
WHERE t.status = 'active'
  AND ts.key = 'palace.callback_token'
  AND ts.value = $1
LIMIT 1;
```

> ⚠️ Pero `tenant_settings` vive en la **DB de cada tenant**, no en la DB de control.  
> Necesitamos mover `palace.callback_token` a la **DB de control** o buscar en todas las DBs.  
>
> **Alternativa más simple:** agregar `palace_callback_token` como columna en la tabla `tenants` de la DB de control.

**Decisión propuesta:** agregar `tenants.palace_callback_token text` (nullable, unique) en la DB de control. El callback resuelve tenant con 1 query:
```sql
SELECT id, slug, db_name FROM tenants WHERE palace_callback_token = $1 AND status = 'active';
```

### 3.4 PalaceCallbackService

```typescript
class PalaceCallbackService {
  async handle(
    db: TenantDb,
    command: string,
    data: PalaceCallbackData,
    checks: number[],
  ): Promise<PalaceCallbackResponse>
}
```

**Commands:**

| Command | Qué hace | Wallet op | Response |
|---|---|---|---|
| `authenticate` | Valida user existe + activo | — | `{ account, balance }` |
| `balance` | Lee wallet.balance | — | `{ balance }` |
| `bet` | Debita wallet (burn puro) | `placeBetPalace(trans_guid, amount)` | `{ balance }` |
| `win` | Acredita wallet (mint puro) | `settleWinPalace(trans_guid, amount)` | `{ balance }` |
| `cancel` | Reversa bet o win anterior | `cancelPalace(cancel_trans_guid)` | `{ balance }` |
| `status` | Lee estado de la transacción | — | `{ account, trans_guid, trans_status }` |

**WalletService — nuevos métodos:**
```typescript
placeBetPalace(db, { walletId, account, transGuid, amount, gameCode, roundId, gameType })
settleWinPalace(db, { walletId, account, transGuid, amount, gameCode, roundId })
cancelPalace(db, { walletId, account, cancelTransGuid })
```

- Idempotency: `palace_bet:{transGuid}` / `palace_win:{transGuid}` / `palace_cancel:{cancelTransGuid}`
- Source: `palace_bet` / `palace_win` / `palace_cancel`
- Reference: `trans_guid` (para lookup en `status`)

### 3.5 Tabla `palace_transactions` (nueva)

Para soportar `status` y `cancel`, necesitamos una tabla espejo de `bet_casino`:

```sql
CREATE TABLE palace_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trans_guid text NOT NULL UNIQUE,        -- ID del proveedor (idempotencia)
  user_id uuid NOT NULL REFERENCES users(id),
  account text NOT NULL,                  -- account del callback
  game_code text,                         -- game_code del callback
  game_type text,                         -- slot/live/etc
  round_id text,                           -- round_id del callback
  sort text NOT NULL,                     -- BET | WIN | CANCEL
  amount numeric(20,2) NOT NULL,
  status text NOT NULL DEFAULT 'OK',       -- OK | CANCELED
  provider_id integer,
  type integer,                            -- type del callback (1=bet, 2=win, etc)
  request_timestamp timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

- `trans_guid` UNIQUE → idempotencia (check 41)
- `status` command busca por `trans_guid` → devuelve OK o CANCELED
- `cancel` command busca `cancel_trans_guid` → marca como CANCELED

### 3.6 Checks (validaciones previas)

| Check | NUESTRO mapeo |
|---|---|
| `21` | `SELECT id, status FROM users WHERE palace_account = $1` — si no existe → `result:21` |
| `22` | `status === 'active'` — sino → `result:22` |
| `31` | `wallet.balance >= amount` — sino → `result:31` + balance |
| `41` | `SELECT 1 FROM palace_transactions WHERE trans_guid = $1` — si existe → `result:41` + balance |
| `42` | `SELECT * FROM palace_transactions WHERE trans_guid = $1` — si NO existe → `result:42` |
| `43` | `SELECT * FROM palace_transactions WHERE trans_guid = $1` (cancel_trans_guid) — si NO existe → `result:43` |

### 3.7 Response codes

| Code | Meaning |
|---|---|
| `0` | OK |
| `100` | Callback-Token inválido |
| `21-43` | Check falló |
| `99` | Error interno |

---

## §4 — Sprint P-3: Catálogo sync

### 4.1 Script de sincronización

```
packages/db/src/scripts/sync-palace-games.ts
```

1. Lee settings del tenant (`palace.api_url`, `palace.api_token`, `palace.default_lang`)
2. `PalaceClient.allGames(lang)` → lista de 2.148 juegos
3. Para cada juego:
   - Mapea `category`: 'Slots' → 'slots', 'Live' → 'live', etc.
   - Upsert en `games` con:
     ```typescript
     {
       code: game.game_code,           // ej. 'vs10emotiwins'
       name: game.game_name,
       providerCode: 'palace',         // nuestro identificador del adapter
       category: mappedCategory,
       thumbnailUrl: game.game_image,
       shortDescription: game.locale_name,
       providerPalaceId: game.provider_id,  // nuevo campo
       providerPalaceSymbol: game.game_code,
       config: { rtp: 0.95 },  // default, ajustable por admin
       isActive: game.launch_enable,
     }
     ```
4. Marca como `is_active=false` los juegos que ya no vienen en el sync (soft-delete)

### 4.2 Providers sync

Script similar con `game/providers`:
```typescript
{
  code: 'pragmatic_play',
  name: 'Pragmatic Play',
  palaceProviderId: 1,
}
```

> Para MVP, los providers se guardan como metadata en `games.palace_provider_id`. No creamos tabla `providers` nueva — el campo basta para el launch.

### 4.3 Comando

```bash
pnpm --filter @casino/db db:sync-palace-games
```

Idempotente. Corre cuando se quiere actualizar el catálogo (ej. semanalmente).

---

## §5 — Sprint P-4: Launch flow

### 5.1 Backend

**`PalaceGameProvider` (implementa `IGameProvider`):**

```typescript
class PalaceGameProvider implements IGameProvider {
  readonly code = 'palace';

  async launchGame(params): Promise<LaunchResult> {
    // 1. Leer settings del tenant
    // 2. PalaceClient.userCreate(account) → provider_user_code
    //    - account = generar desde nuestro user.id (ej. 'u' + last8chars)
    //    - Si ya tiene palace_user_code, userCreate devuelve el mismo
    // 3. Actualizar users.palace_user_code + palace_account
    // 4. PalaceClient.gameUrl(user_code, provider_id, game_symbol, lang)
    // 5. Devolver { providerSessionId: UUID, launchUrl: game_url }
  }

  async settleRound(params): Promise<SettleResult> {
    // NO-OP para Palace — el provider settlea via callback
    // Este método solo se llama en el modo mock síncrono
    // Para Palace, el settlement llega por callback (PalaceCallbackService)
    throw new Error('PalaceGameProvider no soporta settleRound síncrono');
  }

  async rollback(params): Promise<void> {
    // NO-OP — Palace maneja sus propios rollbacks via cancel callback
  }
}
```

**GameSessionsService.createSession** sin cambios — ya llama `provider.launchGame`.

### 5.2 Frontend

**`/play/games/[code]/play/page.tsx`** — cambia de mock a iframe real:

```tsx
// En lugar del mini-slot mock, ahora es un iframe:
<iframe
  src={launchUrl}  // game_url del Palace
  className="w-full h-full"
  allow="fullscreen; autoplay; encrypted-media"
/>
```

**`use-game-session.ts`** — `useLaunchGame` ya existe:
1. `POST /games/code/:code/launch` → `{ sessionId, launchUrl }`
2. Feed `launchUrl` al `<iframe>`

**No hay `usePlaceBet`** — Palace maneja las apuestas dentro de su iframe. Los callbacks llegan al backend, el wallet se actualiza, y el frontend se entera via polling del `/tenant/wallet/me` o WebSocket (futuro).

### 5.3 Balance live

El frontend del player ya tiene el balance pill en el header (`useMyWallet`). Como Palace actualiza el wallet via callbacks, pill se refresca naturalmente con TanStack Query (staleTime 10s + invalidación manual).

> Sprint futuro: WebSocket para que el balance se actualice instantáneamente cuando llega un callback de win. Para MVP, 10s de polling es aceptable.

---

## §6 — Sprint P-5: Testing con el panel del proveedor

### 6.1 Setup túnel

```bash
# Dev
ngrok http 3000
# → https://xxxx.ngrok.io
```

Configurar en Settings del proveedor:
```
Callback URL: https://xxxx.ngrok.io/api/v1/game-provider/palace/callback
```
Tarda hasta 10 min en aplicarse.

### 6.2 Tests manuales (sección por sección del panel)

Seguir `05-callback-api-testing.md`:

1. **User Authentication** → verificar que nuestro callback responde `{ account, balance }`
2. **Balance Inquiry** → verificar `balance`
3. **Test Betting (success)** → verificar que el wallet debita
4. **Test Betting (failed)** → verificar `result:31` si saldo insuficiente
5. **Hit After Bet** → verificar que el wallet acredita el win
6. **Cancel** → verificar que el wallet reversa

### 6.3 Bugs esperados

- Timezone (UTC vs Seoul) en los timestamps
- Precisión de montos (centavos ARS)
- Edge cases de idempotencia (retries del proveedor)
- `account` mapeo (4-15 chars, regex `^[_a-zA-Z0-9]+$`)

---

## §7 — Sprint P-6: Cleanup + E2E

### 7.1 Remover mock

- **Mantener `MockGameProvider`** — sigue siendo útil para tests E2E del backend.
- **Desactivar mock games del seed** — comentar los 10 mock games en `tenant-seed.ts`.
- **No romper `IGameProvider` interface** — Palace es otra implementación, no un reemplazo del contrato.

### 7.2 Tests E2E

- **Backend:** test del callback endpoint con scenarios de testing del §6.
- **Playwright:** spec de launch real contra dev tenant (con túnel).

### 7.3 Registry

```typescript
// game-provider.registry.ts
constructor(
  mock: MockGameProvider,
  palace: PalaceGameProvider,  // nuevo
) {
  this.providers.set(mock.code, mock);
  this.providers.set(palace.code, palace);
}
```

---

## §8 — Flujo end-to-end (diagrama final)

```
Jugador en browser
    │
    │  1. Click "Jugar" en /play/lobby
    │     POST /games/code/:code/launch (Host: demo.localhost)
    │
    ▼
Nuestro Backend (NestJS)
    │
    │  2. GameSessionsService.createSession
    │     → PalaceGameProvider.launchGame
    │     → PalaceClient.userCreate(account)
    │     → PalaceClient.gameUrl(user_code, provider_id, symbol, lang)
    │     → Insert game_session
    │     → Return { sessionId, launchUrl }
    │
    ▼
Jugador en browser
    │
    │  3. Abre launchUrl en <iframe>
    │     (el juego corre en el server del proveedor)
    │
    ▼
Proveedor Palace (game server)
    │
    │  4. Jugador apuesta dentro del iframe
    │     → Palace envía callback "bet" a nuestra URL
    │
    ▼
Nuestro Backend
    │
    │  5. PalaceCallbackController recibe POST /callback/palace
    │     → Valida Callback-Token
    │     → Resuelve tenant
    │     → PalaceCallbackService.handle("bet", data, [21,22,41,31])
    │     → WalletService.placeBetPalace(trans_guid, amount)
    │     → Insert palace_transactions
    │     → Return { result:0, status:'OK', data:{ balance } }
    │
    ▼
Proveedor Palace
    │
    │  6. Resultado del spin
    │     → Palace envía callback "win" a nuestra URL
    │
    ▼
Nuestro Backend
    │
    │  7. PalaceCallbackService.handle("win", data, [21,22,41])
    │     → WalletService.settleWinPalace(trans_guid, amount)
    │     → Insert palace_transactions
    │     → Return { result:0, status:'OK', data:{ balance } }
    │
    ▼
Jugador ve resultado en el iframe
    + balance pill se actualiza via polling (10s) o WebSocket (futuro)
```

---

## §9 — Riesgos y mitigation

| Riesgo | Mitigación |
|---|---|
| **Latencia del callback >2s** | Mantener el handler síncrono + usar `SELECT FOR UPDATE` directo en wallet. Sin HTTP calls externas en el camino crítico. |
| **Retries (50 reintentos en win)** | Idempotencia vía UNIQUE en `palace_transactions.trans_guid` + `wallet_transactions.idempotency_key`. |
| **Tenant resolver en callback** | `tenants.palace_callback_token` en DB de control → 1 query. |
| **Precisión ARS (centavos)** | Guardar en `numeric(20,2)` + operar en centavos. NO usar `intval()`. |
| **Securidad del callback token** | HTTPS obligatorio. Token en DB de control (no env). Comparación por igualdad estricta. |
| **Provider offline** | Si `game-url` falla, el launch falla → frontend muestra mensaje "juego no disponible". |

---

## §10 — Lo que NO se hace en esta integración

- **WebSocket** para balance live (futuro)
- **Reconciliación automática** con `game/transaction` (futuro cron)
- **Bonus-call / free rounds** (Main API endpoints `/call_start`, `/freeround/start`) — futuro
- **Multi-provider** (otros agregators además de Palace) — futuro
- **Wagering tracking** para bonos sobre juegos Palace — futuro
- **IP whitelist** del proveedor — el proveedor No valida IP para Main API

---

## §11 — Antes de empezar a codear

1. ⚠️ **Confirmar con el proveedor:** ¿el timezone de los timestamps en callbacks es UTC o Asia/Seoul?
2. ⚠️ **Confirmar con el proveedor:** ARS ¿con o sin centavos?
3. ⚠️ **Confirmar con el dueño:** ¿está OK mover `palace.callback_token` a la DB de control?
4. ⚠️ **Confirmar con el dueño:** ¿está OK mantener MockGameProvider para tests pero sacarlo del lobby?

> Si todas son ✅, arrancamos por Sprint P-1.