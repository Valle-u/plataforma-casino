# 99 — Plan de integración · Forever (2º proveedor, convive con Palace)

> **Estado:** BORRADOR. La parte de **arquitectura/generalización** ya se puede
> planificar (no depende de datos de Forever). La parte **específica de Forever** está
> `⬜ pendiente del intake` (`00-intake.md`).
>
> **Filosofía (pedida por el dueño):** "de a poco, sin romper nada". Palace tiene que
> **seguir funcionando idéntico** en cada paso. Forever se suma; no se refactoriza
> Palace por gusto, solo lo mínimo para que el sistema sea multi-proveedor de verdad.
>
> **⚠️ Áreas de alta sensibilidad** que toca este plan (piden aprobación explícita antes
> de codear, por CLAUDE.md): `packages/db/wallet/*`, `packages/db/migrations/*`,
> `tenant-resolver/*`, el callback que mueve fichas.

---

## §0 — Diagnóstico: qué ya es multi-proveedor y qué está atado a Palace

Bueno saberlo: **la mitad ya es genérica**. El trabajo real es generalizar la otra mitad.

| Capa | Estado | Ubicación |
|------|--------|-----------|
| Tabla `game_providers` (estado operativo) | ✅ genérica por `code` | `packages/db/src/tenant/game-providers.ts` |
| Tabla `games.provider_code` | ✅ existe · ⚠️ default `'palace'` + cols `palace_provider_id`/`palace_game_symbol` | `games.ts:57,93,100` |
| Contrato `IGameProvider` | ✅ genérico | `providers/game-provider.interface.ts` |
| `game_provider_logs` | ✅ filtra por `providerCode` | `tenant/game-provider-logs.ts` |
| Controller admin genérico (`/tenant/game-providers/:code/...`) | ✅ existe | `games/game-providers.controller.ts` |
| Frontend `ProviderCard` (itera por `code`) | ✅ genérico | `apps/web/.../games/page.tsx` |
| **Registry DI** | ⚠️ inyecta `PalaceGameProvider` fijo | `providers/game-provider.registry.ts:26` |
| **`GameProvidersService`** | ⚠️ `KNOWN_PROVIDERS={palace}`, inyecta PalaceClient/Sync directo | `game-providers.service.ts:36,79,148,259,326,390` |
| **Control DB token** | ⚠️ una sola columna `palace_callback_token` | `control/tenants.ts:81` |
| **Settings de credenciales** | ⚠️ prefijo plano `palace.*` | `tenant-settings.registry.ts:147-160` |
| **Callback controller** | ⚠️ ruta/header/cache/env todo Palace | `palace-callback.controller.ts` |
| **Mapping de usuario** | ⚠️ `palaceUserCode`/`palaceAccount` en `users` | `tenant/users.ts:187-200` |
| **Ledger de callbacks** | ⚠️ tabla `palace-transactions` específica | `tenant/palace-transactions.ts` |
| **Frontend logs tab** | ⚠️ `code="palace"` hardcodeado | `games/page.tsx:92` + creds `palace.*` |

**Conclusión:** el "esqueleto" multi-proveedor existe (tabla de estado, contrato,
registry map, logs, controller genérico, cards del panel). Lo atado a Palace es: el
**cableado** (registry + service inyectan Palace directo), las **credenciales**
(`palace.*` plano), la **resolución de tenant del callback** (una columna), y las
**columnas/tablas específicas** (`palace_*` en games/users + `palace_transactions`).

---

## §1 — Estrategia de generalización (sin romper Palace)

La idea: en cada punto ⚠️, pasar de "asume Palace" a "resuelve por `provider_code`",
dejando Palace como el primer registrado. Ninguna de estas piezas cambia el
comportamiento de Palace; solo abren lugar para Forever.

### 1.1 Registry — registrar el segundo adapter
`providers/game-provider.registry.ts`: inyectar `ForeverGameProvider` en el constructor
y `this.providers.set(forever.code, forever)`. Cero riesgo (map por `code`).

### 1.2 `GameProvidersService` — resolver cliente/sync por `code`
Hoy inyecta `PalaceClient`/`PalaceSyncService` directo y `KNOWN_PROVIDERS={palace}`.
Generalizar a un pequeño registro `{ code → { displayName, client, sync } }` para que
`buildView` / `testConnection` / `runSync` / `diagnose` deleguen al proveedor correcto.
Palace queda como una entrada más. Es el refactor más grande pero es mecánico.

### 1.3 Settings — namespacing por proveedor
Las credenciales de Forever van con prefijo **`game_provider.forever.*`** (la
convención que el propio código de Palace dice que es la buena — ver
`palace-callback.controller.ts:80-82`):
`game_provider.forever.api_url`, `.api_token`, `.default_lang`, `.win_max_amount`,
`.callback_ip_mode`, `.callback_ip_allowlist`.
Palace se deja en `palace.*` (no lo movemos ahora para no tocar lo que anda; opcional
migrarlo a `game_provider.palace.*` más adelante, en un paso aparte y reversible).

### 1.4 Resolución de tenant en el callback (control DB) — el punto delicado
Forever seamless necesita, igual que Palace, resolver "qué tenant es" desde el token del
callback. Dos opciones:

- **Opción A (rápida, calca Palace):** agregar `tenants.forever_callback_token text`
  (nullable, unique) en la DB de control. Migración chica. Un callback controller propio
  de Forever (`/api/v1/game-provider/forever/callback`) con su `tokenCache`.
- **Opción B (prolija, escala):** tabla genérica en control DB
  `tenant_provider_tokens (tenant_id, provider_code, callback_token)` con unique en
  `(provider_code, callback_token)`. Un solo controller genérico
  `/api/v1/game-provider/:code/callback` resuelve tenant por `(code, token)`. Palace se
  migra a esta tabla en un paso posterior (o convive con su columna hasta migrarlo).

> **Recomendación:** **Opción A** para arrancar (menos riesgo, Palace intacto), con la
> **Opción B como norte** cuando haya un 3º proveedor. Esto lo decidís vos.
> ⚠️ Requiere migración en la DB de control (alta sensibilidad) → aprobación explícita.

> **Concreto para Forever (2026-08):** el callback llega a UNA URL (el "Site endpoint" del
> Profile ya apunta a `…railway.app/api/v1/game-provider/...`). Resolvemos el tenant por
> `agentCode` (`redgardel`) / `token` del callback, y **verificamos la firma Ed25519** con
> la `callback verify public key` de ese tenant (ver `02-signing.md §2`). O sea: la columna
> de la Opción A guarda el **agentCode/token de Forever**, y sumamos por-tenant la **public
> key de verificación** + la **private key de firma** (secreto) en `tenant_settings`.

### 1.5 Columnas/tablas específicas de Forever
- **Mapping de usuario:** Forever tendrá su propia identidad de jugador. En vez de
  agregar `forever_user_code`/`forever_account` a `users` (patrón sucio que se repite por
  proveedor), preferir una tabla genérica `user_provider_identities (user_id,
  provider_code, external_user_id, external_account)`. Palace puede migrarse después.
- **Datos del juego** (equivalente a `palace_provider_id`/`palace_game_symbol`): usar el
  **`games.config` jsonb** (ya existe y es libre) en lugar de columnas nuevas
  `forever_*`. El `ForeverGameProvider.launchGame` lee de `config`.
- **Ledger de callbacks:** evaluar una tabla genérica `provider_transactions
  (provider_code, trans_guid, ...)` en vez de un `forever_transactions` calcado. (O, si
  el modelo de Forever difiere, su propia tabla — se decide con el intake.)

### 1.6 Frontend
- `games/page.tsx`: sacar el `code="palace"` hardcodeado del tab de logs → selector de
  proveedor (Palace/Forever) o un tab por proveedor. Las cards ya iteran por `code`.
- `handleSaveCreds`: escribir las keys del `code` de la card (no `palace.*` fijo).
- Renombrar `palace-game-iframe.tsx` → componente de launch genérico (o uno por
  proveedor si el modo de launch difiere).

---

## §2 — Estructura del módulo Forever (calcada de `providers/palace/`)

```
apps/api/src/games/providers/forever/
  ├── forever.module.ts
  ├── forever-client.ts              — Main API client (Bloque 2 del intake)
  ├── forever.types.ts               — tipos request/response
  ├── forever.errors.ts              — errores tipados
  ├── forever-game-provider.ts       — implementa IGameProvider (launch/settle/rollback)
  ├── forever-callback.controller.ts — POST /api/v1/game-provider/forever/callback  (si seamless)
  ├── forever-callback.service.ts    — handler de bet/win/cancel (mueve wallet)  (si seamless)
  ├── forever-admin.controller.ts    — sync catálogo, etc.
  └── forever-sync.service.ts        — sync de proveedores/juegos → tabla games
```

Todo esto es **aditivo**: no toca los archivos de Palace. El wiring se hace en
`games.module.ts` (importar `ForeverModule`) y en el registry.

---

## §3 — Convivencia en el panel (decisión de producto — Bloque 8 del intake)

Hoy el panel tiene una sola sección **"Proveedores de juego"** (`/games`) con tabs
Proveedores / Juegos / Logs. La tabla `game_providers` ya soporta N filas. Opciones:

- **A — Una sección, varias cards:** en el tab "Proveedores" aparecen dos `ProviderCard`
  (Palace y Forever), cada una con su config/credenciales/estado. En "Juegos", filtro por
  proveedor. En "Logs", selector de proveedor. **Menos trabajo, todo junto.**
- **B — Secciones separadas en el menú:** "Palace" y "Forever" como items distintos del
  sidebar. Más separación visual, más navegación.

> ✅ **DECIDIDO (2026-08): Opción A** — una sección "Proveedores de juego", dos cards
> (Palace + Forever). **Lobby: juegos mezclados con filtro** por proveedor. Forever **se
> suma** (no reemplaza a Palace).

---

## §4 — Fases propuestas (arrancan cuando llegue el intake)

| Fase | Scope | Depende de |
|------|-------|-----------|
| **F0** | Refactor de generalización 1.1–1.3 (registry + service por `code` + settings namespaced). Palace sigue igual, tests verdes. | nada (se puede hacer ya) |
| **F1** | `ForeverClient` + `forever.module` + settings de Forever + card en el panel (sin callback aún). | Bloque 2 intake |
| **F2** | Resolución de tenant (1.4) + `ForeverCallbackController/Service` + wallet ops. **Alta sensibilidad.** | Bloque 3 intake + tu OK a la migración |
| **F3** | Sync de catálogo (`ForeverSyncService`) → juegos de Forever en el lobby, diferenciados. | Bloque 5 intake |
| **F4** | Launch flow (iframe/redirect) + player-side. | Bloque 5.3 intake |
| **F5** | Reconciliación + comisión del proveedor + tests E2E + cleanup. | Bloque 7 intake |

> **F0 se puede empezar sin datos de Forever** — es puro refactor interno que deja el
> sistema listo para enchufar cualquier proveedor. Si querés, arrancamos por ahí
> mientras juntás las capturas/manual de Forever.

---

## §5 — Riesgos y mitigación

| Riesgo | Mitigación |
|--------|-----------|
| Romper Palace al generalizar el service | Refactor mecánico + correr toda la suite de Palace (callback + admin) en cada paso; Palace = primera entrada del registro. |
| Migración en DB de control (token de Forever) | Columna nullable/unique aditiva (Opción A) o tabla nueva (B). No toca datos de Palace. Aprobación explícita antes. |
| Callback que mueve fichas (F2) | Idempotencia por `trans_guid` + UNIQUE en wallet + FOR UPDATE, igual que Palace. Alta sensibilidad → revisar contra LEYES E1/E4/E6. |
| Modelo económico distinto al de Palace | Se decide con el intake (Bloque 0/7) y se documenta acá antes de codear (como se hizo con Palace, Opción C). |
| Columnas `provider_*` proliferando | Preferir `config` jsonb + tablas genéricas por `provider_code` (1.5). |

---

## §6 — Antes de codear (checklist de arranque)

1. ⬜ Completar `00-intake.md` — mínimo: **modelo de wallet**, Main API, (si seamless)
   callback, centavos, launch.
2. ⬜ Decidir Opción A vs B para la resolución de tenant (§1.4).
3. ⬜ Decidir convivencia en el panel A vs B (§3).
4. ⬜ Tu OK para: la **migración en DB de control** y tocar el **callback de wallet** (F2).
5. ⬜ ¿Arrancamos F0 (refactor de generalización) ya, en paralelo a juntar los datos?
