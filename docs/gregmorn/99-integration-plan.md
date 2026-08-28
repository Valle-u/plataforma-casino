# Gregmorn — 99 · Plan de integración

Estado y orden de trabajo. Se actualiza a medida que avanza.

## Estado general

| Fase | Estado |
|---|---|
| 0 · Intake y documentación | ✅ hecho |
| 1 · Settings y alta del proveedor | 🟡 **parcial** — claves hechas; el alta en los registries se pasó a las fases 4 y 6 (ver abajo) |
| 2 · Cliente y firma | ✅ hecho |
| 3 · Catálogo (sync) | ⬜ |
| 4 · Launch (`openGame`) | ⬜ |
| 5 · Callbacks de wallet | ⬜ **bloqueado en parte** — ver abajo |
| 6 · Panel (credenciales + estado) | ⬜ |
| 7 · Pruebas en Stage | ⬜ |

## Lo que bloquea

1. **La idempotencia del `rollback`** (trampa #1 del README). No se puede cerrar la
   Fase 5 sin definirlo: si se elige mal, los jugadores no recuperan la plata de
   rondas anuladas y no se nota hasta que pasa. Mientras no respondan, la
   implementación asume **`cmd + transactionId`**, que es correcta aunque después
   confirmen otra cosa.
2. **El `user_id`** falta. Sin él no se puede pedir el catálogo ni abrir un juego.
   Las fases 3 y 4 no se pueden probar contra Stage, aunque sí escribir.
3. **La IP `3.78.156.229` no está en la allowlist de Cloudflare.** Sin eso los
   callbacks de Stage pueden recibir challenges del WAF. Es exactamente donde se
   trabó Forever.

Nada de esto bloquea escribir el código: son bloqueos de **prueba**, no de
implementación.

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

### 3 · Catálogo

- `gregmorn-sync.service.ts`: traer `getUserGames` por moneda y volcar a `games` con
  `provider_code = 'gregmorn'`.
- Actualizar `last_sync_*` en `game_providers`.

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
