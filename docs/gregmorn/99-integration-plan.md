# Gregmorn — 99 · Plan de integración

Estado y orden de trabajo. Se actualiza a medida que avanza.

## Estado general

| Fase | Estado |
|---|---|
| 0 · Intake y documentación | ✅ hecho |
| 1 · Settings y alta del proveedor | 🟡 **parcial** — claves hechas; el alta en los registries se pasó a las fases 4 y 6 (ver abajo) |
| 2 · Cliente y firma | ✅ hecho |
| 3 · Catálogo (sync) | ✅ hecho |
| 4 · Launch (`openGame`) | ⬜ |
| 5 · Callbacks de wallet | ⬜ **desbloqueado** — ver abajo |
| 6 · Panel (credenciales + estado) | ⬜ |
| 7 · Pruebas en Stage | ⬜ |

## Lo que bloquea

**Nada del lado del proveedor.** El 2026-08-28 contestaron las tres preguntas
abiertas (ver `00-intake.md`):

1. ~~Idempotencia del `rollback`~~ → **`cmd + transactionId` aprobado.** Era la
   crítica: si se elegía mal, los jugadores no recuperaban la plata de rondas
   anuladas y no se notaba hasta que pasaba. La Fase 5 queda desbloqueada.
2. ~~El `user_id`~~ → **es el `user.id` del `/auth/login`.** El cliente lo deriva
   solo; no hay que cargarlo.
3. ~~¿IP única?~~ → **sí**, y avisan antes de sumar servidores.

Queda un solo pendiente, y es **nuestro**:

- **La IP `3.78.156.229` no está en la allowlist de Cloudflare.** Sin eso los
  callbacks de Stage pueden comerse challenges del WAF. Es exactamente donde se
  trabó Forever. Bloquea la Fase 7 (pruebas), no escribir el código.

## Fases

### 1 · Settings y alta del proveedor — 🟡 parcial

- ✅ Claves `game_provider.gregmorn.*` en `tenant-settings.registry.ts` (lista en
  `00-intake.md`). Son las 8 previstas: los dos hosts, `login`, `password`,
  `secret_api_key`, `user_id`, `currency` y `win_max_amount`.
- ⬜ Fila en `game_providers` con `code = 'gregmorn'`. **No hace falta crearla a
  mano**: `GameProvidersService.ensureRow` la inserta (idempotente,
  `onConflictDoNothing`) a partir del `displayName` del backend registrado.
- ⬜ Alta en `game-provider.registry.ts` y `provider-backend.registry.ts`.
  **Movido a las fases 4 y 6**: los registries reciben instancias de
  `IGameProvider` / `IProviderBackend`, así que registrar antes de que existan
  esas clases obliga a stubbear `syncGames`/`testConnection`. Y como el alta del
  backend crea la fila, el proveedor aparecería en el panel con botones de sync y
  test que todavía no hacen nada.

### 2 · Cliente y firma — ✅ hecho

- ✅ `gregmorn-signer.ts`: `signGregmornBody` / `signGregmornRequest` /
  `verifyGregmornCallback`. HMAC-SHA256 hex sobre bytes crudos, comparación en
  tiempo constante (`timingSafeEqual`), lectura del header case-insensitive.
  **19 tests** en `gregmorn-signer.spec.ts`, incluido el del re-serializado.
- ✅ `gregmorn-client.ts`: `login()` (form-urlencoded), `getUserGames()` con
  Bearer y `openGame()` firmado. El `accessToken` se cachea por
  `host|login` hasta 30s antes de su `exp` (leído del JWT, sin verificarlo) y se
  re-loguea al vencer — no hay endpoint de refresh. Timeouts por operación y
  traducción del envelope `{ status: 'fail', ... }` a `GregmornApiError`.
- ✅ `gregmorn.types.ts` / `gregmorn.errors.ts` / `gregmorn.module.ts`. El módulo
  ya está importado en `GamesModule`.
- El `openGame` manda **siempre** `callbackUrl` explícito, y `user_id` sale de
  los settings: si no está cargado, `getSettings()` tira un `GregmornConfigError`
  que lo nombra. Es el bloqueo #2 de arriba, hecho visible en vez de silencioso.

### 3 · Catálogo — ✅ hecho

- ✅ `gregmorn-sync.service.ts`: una sola llamada a `getUserGames` por moneda (sin
  loop de vendors, a diferencia de Forever), upsert en lotes de 500 con
  `onConflictDoUpdate` y baja de los juegos que ya no vienen (`updated_at`
  anterior al inicio del sync).
- ✅ El `gameId` crudo (`integration:provider:game`) se guarda tal cual en
  `games.config.gregmorn.gameId` — es lo que espera `openGame`. El `games.code`
  interno se sanitiza porque los `:` rompen el ruteo del launch.
- ✅ Un juego con `isEnabled: false` entra **inactivo**, no se saltea: así no
  desaparece del historial.
- ✅ Dedupe por `code` antes del upsert: sin eso, un id repetido en el catálogo
  revienta el lote con *"ON CONFLICT cannot affect row a second time"*.
- ⚠️ **`category` es una heurística.** Su `GameCatalogItem` NO trae tipo de juego,
  solo el nombre del estudio (`provider`). Se matchea contra una lista de estudios
  de casino en vivo y **todo lo demás cae en `slots`**. Vale preguntarles si
  pueden exponer el tipo; mientras tanto, una categoría equivocada afecta el
  filtro del lobby, no el launch ni la plata, y se corrige sumando el estudio a
  `LIVE_CASINO_STUDIOS`.
- ⬜ El `last_sync_*` de `game_providers` lo escribe `GameProvidersService` al
  invocar el sync desde el panel — llega con la Fase 6.

### 4 · Launch

- `gregmorn-game-provider.ts` implementando `IGameProvider`.
- Mandar `callbackUrl` explícito en cada `openGame` en vez de depender de su panel.
- Resolver si hace falta mandar la `ip` del jugador (depende del estudio).

### 5 · Callbacks

- `gregmorn-callback.controller.ts`: un solo `POST /callback` que rutea por `cmd`.
  Leer `req.rawBody`, verificar firma **antes** de tocar la wallet.
- `gregmorn-callback.service.ts`:
  - `getBalance` → saldo confirmado. Ante duda, fallar; nunca inventar saldo.
  - `writeBet` → aplicar bet/win. Idempotente. Rechazar si no alcanza. Devolver el
    saldo **después** de aplicar.
  - `rollback` → devolver la apuesta una sola vez.
- **Parsear `bet` y `win` aceptando número y string.**
- Techo de sanidad del `win` con `win_max_amount` (E7).

### 6 · Panel

- Campos de credenciales en Ajustes → Proveedores de juego (`/games`), donde ya están
  los de Palace y Forever.
- Sección de estado del proveedor (sync, ping).

### 7 · Pruebas en Stage

- `openGame` en demo (`demo: "1"`) — no dispara callbacks, sirve para validar auth,
  firma y launch aislados.
- Después juego real, verificando el ciclo bet → win → rollback contra el ledger.
- Confirmar que `balance == Σ(wallet_transactions)` se mantiene (E2).

## Decisiones tomadas

- **Seamless, no transfer.** Ver README y `01-api-spec.md §3`.
- **`callbackUrl` explícito por request**, en vez de la config por moneda de su
  panel: menos estado del lado de ellos, y una cosa menos que se puede desincronizar.
- **La firma es el control principal; la IP es defensa en profundidad**, no
  reemplazo.
