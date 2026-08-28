# Gregmorn — 99 · Plan de integración

Estado y orden de trabajo. Se actualiza a medida que avanza.

## Estado general

| Fase | Estado |
|---|---|
| 0 · Intake y documentación | ✅ hecho |
| 1 · Settings y alta del proveedor | 🟡 **parcial** — claves hechas; el alta en los registries se pasó a las fases 4 y 6 (ver abajo) |
| 2 · Cliente y firma | ✅ hecho |
| 3 · Catálogo (sync) | ✅ hecho |
| 4 · Launch (`openGame`) | ✅ hecho |
| 5 · Callbacks de wallet | ✅ hecho |
| 6 · Panel (credenciales + estado) | ✅ hecho |
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

Con las fases 1 a 6 cerradas, **el código está completo**. Lo único que falta
para la Fase 7 son dos cosas nuestras, ninguna de código:

1. **La IP `3.78.156.229` no está en la allowlist de Cloudflare.** Sin eso los
   callbacks de Stage pueden comerse challenges del WAF. Es exactamente donde se
   trabó Forever.
2. **Las credenciales de Stage no están cargadas.** Van por el panel (Ajustes →
   Proveedores de juego → Gregmorn Hub), y después hay que apretar una vez
   "Activar callbacks". Nunca por chat ni por código.

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

### 4 · Launch — ✅ hecho

- ✅ `gregmorn-game-provider.ts` implementando `IGameProvider`, **ya registrado
  en `GameProviderRegistry`**. El e2e de games levanta la app entera, así que el
  DI está verificado, no solo tipado.
- ✅ `player_login` = nuestro `users.username`. Es el mismo valor que va a llegar
  en el campo `login` de los tres callbacks, así que es la clave con la que la
  Fase 5 va a resolver al jugador. Mismo criterio que Forever.
- ✅ `gameId` = el id CRUDO de `config.gregmorn.gameId`, no el `games.code`
  sanitizado. Confundirlos da un 409 de ellos.
- ✅ `callbackUrl` explícito en cada request.
- ✅ Siempre `demo: false`. El modo demo no dispara callbacks y sirve solo para
  validar auth/firma/launch aislados en Stage (Fase 7); el lifecycle de sesión de
  la plataforma no lo expone.
- ✅ 7 tests en `gregmorn-game-provider.spec.ts`, incluidos los dos que
  garantizan que **no se abre el juego** si falta `callback_url` o `exit_url`.
- ⬜ Resolver si hace falta mandar la `ip` del jugador (depende del estudio). El
  cliente ya acepta el campo; falta preguntarles para qué estudios es
  obligatorio.
- ✅ **`isPlayable` del lobby del jugador** (`apps/web/app/play/lobby/page.tsx`).
  Se descubrió probando en prod: el catálogo sincronizó perfecto pero **los 2979
  juegos salían como "Próximamente"**. Esa función es una **lista blanca por
  `provider_code`** y todo lo que no esté enumerado devuelve `false`. Registrar
  el proveedor en los registries del backend no alcanza. Para Gregmorn se chequea
  que exista `config.gregmorn.gameId`, que es el dato sin el cual el launch no
  puede armarse.

> ⚠️ **Para el próximo proveedor:** acordarse de `isPlayable`. Es el único lugar
> del frontend que decide si un juego se puede abrir, no tiene default
> permisivo, y el síntoma (catálogo OK, todo "Próximamente") no apunta solo a
> él.

**Tres settings nuevos**, porque no existía forma de saber estos datos:

| Clave | Para qué |
|---|---|
| `game_provider.gregmorn.callback_url` | La que se manda en cada `openGame`. Sin esto el juego real no puede leer ni mover saldo. |
| `game_provider.gregmorn.exit_url` | A dónde vuelve el jugador al cerrar. Obligatorio en su API. |
| `game_provider.gregmorn.language` | ISO corto del launch. Default `es`. |

> ⚠️ **Pendiente de diseño para la Fase 5:** cómo resuelve el callback a QUÉ
> tenant pertenece. Palace usa un token por tenant y Forever el `agent_code`;
> Gregmorn no tiene equivalente. Como el `callbackUrl` se manda por request, lo
> natural es meter un discriminador de tenant en esa URL (path o query) y que el
> setting `callback_url` de cada tenant lo lleve. Definirlo ANTES de escribir el
> controller.

### 5 · Callbacks — ✅ hecho

**Ruta:** `POST /api/v1/game-provider/gregmorn/callback/:token`

**Resolución de tenant.** Gregmorn no manda nada de lo que se pueda deducir el
tenant: ni token en el body (Palace) ni agent code en un header (Forever). Como
la `callbackUrl` va por request, el discriminador viaja en la URL. Columna nueva
`tenants.gregmorn_callback_token` (migración de control `0005`). **El token no
autentica** — solo elige de quién es la `secret_api_key`; lo que autentica es la
firma.

Orden del controller, y no se puede alterar: resolver tenant → verificar HMAC
sobre `req.rawBody` → recién ahí tocar la wallet.

**Idempotencia.** Tabla `gregmorn_transactions` (migración de tenant `0104`), con
`idempotency_key = '<cmd>:<transactionId>'` UNIQUE. **No** el `transaction_id`
crudo: es la trampa #1. Las claves del wallet van namespaceadas aparte
(`gregmorn:writeBet:bet:…`, `:win:…`, `gregmorn:rollback:…`) porque un writeBet
puede traer bet y win a la vez y cada pata necesita su propia idempotencia.

**Los tres comandos:**
- `getBalance` → saldo jugable = (balance − locked) + bonus. Sin jugador se
  responde **fail**, nunca 0: inventar saldo está prohibido por su doc.
- `writeBet` → bet a burn (bonus-first) y/o win a mint con techo E7. Devuelve el
  saldo **después** de aplicar. Fondos insuficientes → fail.
- `rollback` → devuelve la apuesta una sola vez, y **por el monto que realmente
  cobramos** (el de `gregmorn_transactions`), no por el que dice el callback. Si
  no existe el bet original responde fail para que reintenten: acreditar sería
  mintear de la nada.

**Montos** parseados aceptando número y string; **no parseable = rechazo**, nunca
0 implícito. Un 0 silencioso es plata perdida o regalada.

**Reporting:** cada `writeBet` sincroniza `game_rounds` (best-effort) para que
netwin, GGR, RTP y comisiones cuenten las jugadas de Gregmorn. Más simple que el
de Forever: bet y win vienen juntos, así que el round se resuelve en una sola
escritura en vez de ligar dos patas por `wagerId`.

**Tests:** 17 e2e contra DB real (`gregmorn-callback.e2e.ts`), incluido el de la
trampa #1 — un rollback con el mismo `transactionId` que el bet tiene que
devolver la plata. También: firma inválida, token desconocido, monto no
parseable, saldo insuficiente y win sobre el tope, todos verificando que **el
saldo no se movió**.

### 6 · Panel — ✅ hecho

- ✅ `gregmorn-provider-backend.ts` (`IProviderBackend`), **registrado en
  `ProviderBackendRegistry`**. Ese alta es lo que hace aparecer a Gregmorn en el
  panel: `GameProvidersService.ensureRow` crea la fila de `game_providers` a
  partir de su `displayName` ("Gregmorn Hub").
- ✅ Campos de credenciales en Ajustes → Proveedores de juego (`/games`), con el
  mismo descriptor `CRED_SCHEMAS` que Palace y Forever: los dos hosts, exit URL,
  moneda, idioma, usuario, contraseña y secret key. Los tres últimos son
  `secret`: no se muestran una vez guardados.
- ✅ Botón **"Activar callbacks"**: genera el token opaco, lo guarda en
  `tenants.gregmorn_callback_token` y arma la `callback_url` con el token
  adentro, dejándola guardada como setting. La URL se muestra para que el dueño
  la vea, pero no tiene que hacer nada con ella.
  - **El token no se rota si ya existe.** Regenerarlo dejaría ciegos a los juegos
    abiertos en ese momento: sus callbacks apuntarían a una URL que ya no
    resuelve ningún tenant.
  - La base de la URL sale del propio request (`x-forwarded-proto` / `-host`,
    con fallback a `host`), porque el panel le pega a la misma API que va a
    recibir los callbacks. No hace falta configurar la URL pública en ningún lado.
- ✅ `testConnection` usa `/auth/login`: Gregmorn no tiene un endpoint liviano
  tipo `GetAgentInfo`, y si el login responde entonces el host, el usuario y la
  contraseña están bien.
- ✅ `diagnoseExtra` con 5 chequeos: host de launch, credenciales, secret key,
  callback URL y exit URL.
- ✅ El resumen del sync en el panel entiende la forma de Gregmorn (juegos,
  deshabilitados por el proveedor, dados de baja) además de las de Palace y
  Forever.

> El hook `useActivateForeverCallback` pasó a llamarse
> `useActivateProviderCallback`: ahora lo usan los dos proveedores y devuelve el
> `agentCode` de Forever o la `callbackUrl` de Gregmorn según cuál se active.

### 7 · Pruebas en Stage

- `openGame` en demo (`demo: "1"`) — no dispara callbacks, sirve para validar auth,
  firma y launch aislados.
- Después juego real, verificando el ciclo bet → win → rollback contra el ledger.
- Confirmar que `balance == Σ(wallet_transactions)` se mantiene (E2).

## Decisiones tomadas

- **Seamless, no transfer.** Ver README y `01-api-spec.md §3`.
- ~~**`callbackUrl` explícito por request**, en vez de la config por moneda de su
  panel.~~ **REVERTIDO el 2026-08-28 a pedido del proveedor.**

  Su sistema **ignora** el campo `callbackUrl` del `openGame` y usa únicamente la
  URL configurada en el panel de ellos, pese a que el 2026-08-28 habían
  confirmado por escrito que el override por request funcionaba. Se comprobó
  capturando el request literal: el campo salía correcto en cada llamada, ellos
  respondían `HTTP 200 success`, y no llegaba ni un callback en ~15 sesiones.

  Nos pidieron explícitamente dejar de mandarlo. El envío quedó detrás del
  setting `game_provider.gregmorn.send_callback_url`, **default `false`**, para
  poder volver a probarlo sin tocar código cuando su equipo lo arregle.

  **Consecuencia:** dependemos de la configuración por moneda de su panel, que es
  exactamente lo que esta decisión buscaba evitar. La URL con token hay que
  dársela a ellos para que la carguen; si la cargan mal o la pierden, los
  callbacks se caen sin aviso. Por eso también existe el fallback sin token.
- **La firma es el control principal; la IP es defensa en profundidad**, no
  reemplazo.
