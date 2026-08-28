# Gregmorn — 99 · Plan de integración

Estado y orden de trabajo. Se actualiza a medida que avanza.

## Estado general

| Fase | Estado |
|---|---|
| 0 · Intake y documentación | ✅ hecho |
| 1 · Settings y alta del proveedor | ⬜ |
| 2 · Cliente y firma | ⬜ |
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

### 1 · Settings y alta del proveedor

- Claves `game_provider.gregmorn.*` en `tenant-settings.registry.ts` (lista en
  `00-intake.md`).
- Fila en `game_providers` con `code = 'gregmorn'`.
- Alta en `game-provider.registry.ts` y `provider-backend.registry.ts`.

### 2 · Cliente y firma

- `gregmorn-signer.ts`: firmar y verificar HMAC-SHA256 hex sobre bytes crudos,
  comparación en tiempo constante. **Con tests** — espeja `forever-signer.spec.ts`.
- `gregmorn-client.ts`: `/auth/login` (form-urlencoded, ojo), cacheo del
  `accessToken` con su TTL corto, `getUserGames`, `openGame` firmado.

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
