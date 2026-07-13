# CONTEXTO COMPLETO — Integración Palace Casino (handoff)

Soy Uriel. Vengo trabajando una integración con Palace Casino como proveedor de juegos en una plataforma de casino multi-tenant. Esta conversación es continuación de sesiones anteriores. **Leé todo antes de tocar nada.**

---

## Stack

- Turborepo + pnpm · Next.js 15 + TS · NestJS 11 · PostgreSQL 17 (no 18) · Drizzle · Redis · Socket.io
- Monorepo: `apps/{api,web}` + `packages/{db,typescript-config,eslint-config}`
- Rama git: `redesign/casino-tango-neon-milonga`
- OS: Windows, PowerShell 5.1, PostgreSQL 17 en `C:\Program Files\PostgreSQL\17\bin\psql.exe`
- Usuario Postgres: `postgres` / password: `postgres`

## Docs obligatorias antes de trabajar

- `AGENTS.md` en la raíz — leer entero
- `docs/SESSION_LOG.md` — última entrada mia al final (2026-07-12)
- `docs/LEYES.md` — leyes de economía/roles/permisos
- `docs/game-provider/01` a `07` + `99-installation-plan.md` — doc de Palace Casino
- `docs/DEVLOG.md` — decisiones técnicas

## Credenciales dev

- **Super-admin (DB control):** `superadmin@plataforma-casino.local` / `dev-superadmin-2026`
- **Admin demo tenant:** `demo_admin` / `demo-pwd-2026` (Host: `demo.localhost`)
- **Tenant:** slug `demo`, DB `tenant_demo_dev`, host `demo.localhost`
- **Palace API:** URL `https://agent.goldslotpalase.com`, token `be54f7ba-5a61-40bd-acd7-4f787fde182b`, account `redgardel`, moneda ARS
- **Callback token del tenant demo:** `1ff995a6-de36-4d69-803e-ca82b3688ae6` (guardado en `tenants.palace_callback_token` en control DB)
- **ngrok:** está instalado en `C:\Users\Admin\Downloads\ngrok.exe`. Tunnel anterior: `https://visibly-evade-flattery.ngrok-free.dev` (re-levantar con `ngrok http 3000` — la URL gratuita puede cambiar)

## Cómo arrancar dev

```powershell
# 1. ngrok (para callbacks de Palace)
Start-Process -FilePath "C:\Users\Admin\Downloads\ngrok.exe" -ArgumentList "http","3000" -WindowStyle Hidden
Start-Sleep 3
# Verificar tunnel: Invoke-WebRequest http://localhost:4040/api/tunnels -UseBasicParsing

# 2. Rebuild si hubo cambios (ver warning sobre tsbuildinfo abajo)
Set-Location apps/api; Remove-Item -Force tsconfig.tsbuildinfo -ErrorAction SilentlyContinue; npx tsc

# 3. Start API
Start-Process -FilePath "node" -ArgumentList "dist\main.js" -WorkingDirectory "apps\api" -WindowStyle Hidden

# 4. Verificar
Invoke-WebRequest http://localhost:3000/health -UseBasicParsing
```

### ⚠️ Advertencias críticas

1. **Tool `bash` mata procesos hijos al terminar.** Cuando uses Start-Process, el proceso está vivo SOLO durante ese comando. La próxima llamada bash debería empezar con `Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force` y luego re-levantar.
2. **Build issue conocido:** `nest build` puede no emitir archivos si `tsconfig.tsbuildinfo` está stale. **Siempre** borrar `tsconfig.tsbuildinfo` y `dist/` antes de rebuild. Usar `npx tsc` directo (no `nest build`).
3. **`packages/db` build:** si tocás schema en `packages/db/src/`, hay que rebuild: `Set-Location packages/db; pnpm build`. Luego rebuild API.
4. **Migraciones tenant:** drizzle-kit generate tiene bugs con enums existentes. Aplicar manualmente con psql:
   ```powershell
   & "C:\Program Files\PostgreSQL\17\bin\psql.exe" -h localhost -U postgres -d tenant_demo_dev -f "<path-al.sql>"
   ```

## Multi-tenant: header requerido

Para cualquier request a la API desde localhost, hay que mandar `X-Tenant-Host: demo.localhost` en los headers. Sin eso, `TenantResolverMiddleware` devuelve 404.

## Estado actual del código

### Lo que está hecho y funcional

1. **PalaceModule completo** en `apps/api/src/games/providers/palace/`:
   - `palace-client.ts` — cliente HTTP Main API (agent info, user create, game providers, allGames, game-url)
   - `palace-callback.controller.ts` — endpoint `POST /api/v1/game-provider/palace/callback` (resuelve tenant por Callback-Token, no por Host)
   - `palace-callback.service.ts` — 6 commands (authenticate, balance, bet, win, cancel, status) + checks (21, 22, 31, 41, 42, 43)
   - `palace-game-provider.ts` — implementa `IGameProvider.launchGame()` (crea user Palace + pide game-url)
   - `palace-sync.service.ts` — sincroniza catálogo Palace → tabla `games` del tenant
   - `palace-admin.controller.ts` — `POST /tenant/games/palace/sync` (requiere JWT admin + permiso `games.edit`)

2. **Schema DB** (migración `0064_palace_integration.sql` + `0065_fix_palace_user_code_nullable.sql`):
   - `tenants.palace_callback_token` (text, unique) en control DB
   - `users.palace_account` (text, nullable) en tenant DB
   - `users.palace_user_code` (bigint, nullable — **NO bigserial**) en tenant DB
   - `games.palace_provider_id` (int) + `games.palace_game_symbol` (text) en tenant DB
   - `palace_transactions` (tabla nueva) en tenant DB

3. **WalletService** tiene métodos `placeBetExternal`, `settleWinExternal`, `cancelExternal` para callbacks Palace.

4. **Sync funciona** — probado: POST /tenant/games/palace/sync → 200 OK, 1989 juegos fetched, 1603 creados, 386 actualizados, 0 desactivados.

5. **Frontend fix** en `apps/web/app/play/lobby/page.tsx`:
   ```typescript
   function isPlayable(game: PlayerGame): boolean {
     return game.providerCode === 'mock' || game.providerCode === 'palace';
   }
   ```
   Antes era `game.code.startsWith('mock_')`. Palace games ahora aparecen clickeables (no "Próximamente").

6. **Callback authenticate funciona** — verificado: Palace llama callback `authenticate`, nuestro código responde `{ result:0, status:"OK", data:{account, balance} }`.

### Cambios NO commiteados (están en working tree)

- `apps/api/src/games/providers/palace/palace-game-provider.ts` — **fix crítico**: guardar `palace_account` en DB ANTES de llamar `userCreate` a Palace (porque Palace dispara callback `authenticate` inmediatamente y necesita encontrar el user).
- `apps/web/app/play/lobby/page.tsx` — función `isPlayable()` actualizada.
- `packages/db/src/tenant/users.ts` — `palaceUserCode` cambiado de `bigserial` a `bigint` (nullable).
- `packages/db/migrations/tenant/0065_fix_palace_user_code_nullable.sql` — migración SQL.
- `apps/api/src/games/games.controller.ts` — agregué `Logger`, `InternalServerErrorException` import, y error handling con log a archivo `C:\Users\Admin\AppData\Local\Temp\opencode\launch-errors.log` para debugging. **TODO: revertir el logging a archivo cuando se resuelva el bug.**
- `apps/api/src/games/providers/palace/palace-callback.controller.ts` — agregué log a archivo `C:\Users\Admin\AppData\Local\Temp\opencode\palace-callbacks.log` para debugging. **TODO: revertir cuando se resuelva.**

## EL BUG ACTUAL — donde nos quedamos

**Síntoma:** Al intentar lanzar un juego Palace desde el frontend (`POST /tenant/games/code/vswaysdogs/launch`), la API devuelve HTTP 500.

**Error exacto** (capturado via log temporal):
```
Palace API error code 2006: BALANCE_NOT_ENOUGH
  at PalaceClient.post → PalaceGameProvider.launchGame → game-url
```

El flujo es: `userCreate` OK → `game-url` falla con `code:2006 BALANCE_NOT_ENOUGH`.

### Lo que descubrimos

1. `userCreate` funciona (ahora que guardamos `palace_account` antes). Palace devuelve `{code:0, user_code:408501389, is_new_user:true}`.
2. **Pero `user/info` devuelve `USER_NOT_FOUND`** para ese mismo user_code inmediatamente después.
3. `game-url` devuelve `BALANCE_NOT_ENOUGH` **sin disparar callback `balance`** (el log de callbacks solo registra 1 callback: `authenticate`, que respondimos OK).
4. `agent/info` devuelve `balance: 0.0000` — el agent `redgardel` tiene 0 Points.

### Hipótesis principales (no confirmadas)

- **(A)** El agente `redgardel` está **"Unapproved"** en el panel de Palace (doc 03 §"Orden de desarrollo" paso 5: *"al terminar, el agente está 'Unapproved'; hay que contactar al manager para pasarlo a 'Approved'"*). Sin approval, Palace crea users pero no permite generar game URLs.
- **(B)** El modo del agent está mal configurado (debería ser **Seamless**, no Transfer). En Transfer mode, el balance vive del lado de Palace y `game-url` chequea balance interno (que es 0).
- **(C)** Hay que fondear el agent con Points (aunque en seamless la plata vive en nuestro callback, quizás Palace chequea igual `agent.balance > 0`).

### Lo que Uriel tiene que verificar en el panel de Palace (https://agent.goldslotpalase.com)

1. ¿El agent `redgardel` está Approved o Unapproved?
2. ¿El modo está en Seamless (no Transfer)?
3. ¿Hay que contactar al manager de Palace para approval?

## Pasos sugeridos para continuar

1. **Primero** hacer `git status` y `git diff` para ver todos los cambios no commiteados.
2. **Revertir el logging temporal** en `games.controller.ts` y `palace-callback.controller.ts` (los logs a archivo en `AppData\Local\Temp\opencode\`) — o dejarlos hasta que se resuelva el bug.
3. **Verificar panel de Palace** (approval + modo seamless) — esto es lo que falta para destrabar.
4. Una vez que `game-url` funcione, probar el flujo completo desde el frontend: click en juego → iframe con URL de Palace → Palace dispara callback `authenticate` → callback `bet` → callback `win` → callback `cancel` (si aplica).
5. **Commitear** los cambios cuando el flujo esté completo.

## Archivos clave relevantes

- `apps/api/src/games/providers/palace/palace-client.ts` — cliente HTTP Palace (Main API)
- `apps/api/src/games/providers/palace/palace-game-provider.ts` — launchGame (FIX: guardar palace_account antes de userCreate)
- `apps/api/src/games/providers/palace/palace-callback.service.ts` — handler de 6 commands
- `apps/api/src/games/providers/palace/palace-callback.controller.ts` — endpoint callback (tiene log temporal)
- `apps/api/src/games/providers/palace/palace-sync.service.ts` — sync catálogo
- `apps/api/src/games/providers/palace/palace.module.ts` — DI registrations
- `apps/api/src/games/providers/game-provider.registry.ts` — registry con mock + palace
- `apps/api/src/games/game-sessions.service.ts` — orquesta launch (provider.get + launchGame)
- `apps/api/src/games/games.controller.ts` — endpoint `/tenant/games/code/:code/launch` (tiene log temporal)
- `apps/api/src/wallet/wallet.service.ts` — placeBetExternal/settleWinExternal/cancelExternal
- `packages/db/src/tenant/users.ts` — schema (palaceUserCode = bigint nullable)
- `packages/db/migrations/tenant/0064_palace_integration.sql` — migración original Palace
- `packages/db/migrations/tenant/0065_fix_palace_user_code_nullable.sql` — fix bigint

## Postgres queries útiles

```sql
-- Control DB (platform_control)
SELECT slug, palace_callback_token FROM tenants WHERE palace_callback_token IS NOT NULL;
SELECT slug, name, status, db_name FROM tenants;

-- Tenant DB (tenant_demo_dev)
SELECT username, palace_account, palace_user_code FROM users WHERE username = 'demo_admin';
SELECT id, balance FROM wallets WHERE user_id = (SELECT id FROM users WHERE username = 'demo_admin');
-- Reset para re-test:
UPDATE users SET palace_account = NULL, palace_user_code = NULL WHERE username = 'demo_admin';
-- Fondear wallet:
UPDATE wallets SET balance = '1000.00' WHERE user_id = (SELECT id FROM users WHERE username = 'demo_admin');
-- Juegos Palace:
SELECT code, name, provider_code, palace_provider_id, palace_game_symbol, is_active FROM games WHERE provider_code = 'palace' LIMIT 5;
```

## Reglas

- **No commitear sin permiso explícito de Uriel.**
- **Modo enseñanza** es default (Uriel es estudiante de ingeniera en informática: explicar conceptos nuevos antes de usarlos).
- Código en inglés, documentación en español, mensajes de UI configurables.
- `any` prohibido en TS (salvo justificación expresa).
- Cada query/operación ocurre en contexto de un tenant. Nunca lógica que asuma "una sola DB".

## Cómo traer esto a una PC nueva

Este archivo ya está commiteado y pusheado al repo. En la PC de escritorio:

```powershell
# 1. Clonar el repo si no existe
git clone git@github.com:Valle-u/plataforma-casino.git
cd plataforma-casino

# 2. Si ya está clonado, traer los últimos cambios
git pull origin redesign/casino-tango-neon-milonga

# 3. Cambiar a la rama correcta
git checkout redesign/casino-tango-neon-milonga

# 4. Verificar que este archivo existe
type HANDOFF-CONTEXT.md
```

Listo. Ahora podés empezar a trabajar. Leé este archivo entero y después seguí con "Empezá por".

## Empezá por

`git status` y `git diff` para ver todos los cambios no commiteados que dejó la laptop. Después leé los docs relevantes y seguí con la verificación del panel de Palace.