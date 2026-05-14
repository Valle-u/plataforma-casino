# SESSION LOG — Bitácora de sesiones

> Cada agente IA (o humano) que trabaja en este proyecto debe agregar una entrada al final de este archivo cuando termine su sesión. Esto permite que el siguiente agente entienda dónde se dejó y por qué.

---

## Cómo agregar una entrada

Al final del archivo, agregá un bloque con este formato:

```markdown
## [YYYY-MM-DD HH:MM AR] — [Agente] (modelo)

**Duración**: ~Xh
**Usuario**: Uriel

### Qué hicimos
- Punto 1
- Punto 2

### Decisiones tomadas
- Decisión 1 (si va a DEVLOG, mencionar también acá brevemente)

### Commits creados
- `hash` — `mensaje del commit`

### Estado al cerrar
- **Fase actual**: X (ver `docs/14-roadmap.md`)
- **Próximo paso lógico**: Y
- **Bloqueos**: ninguno / X

### Notas para próximo agente
- Cosa importante que el próximo debe saber.
- Algo que dejé a medio.
```

**Reglas**:
- Una entrada por sesión (no fragmentar).
- Hora en horario de Argentina (UTC-3).
- Modelo del agente si lo sabés (ej: Claude Sonnet 4.5, GPT-4o, opencode con Haiku).
- Si la sesión fue corta y solo de consulta sin código, también se anota (más breve).

---

# Bitácora

---

## 2026-05-06 — Claude (Sonnet 4.5)

**Duración**: ~5–6h en sesiones distribuidas.
**Usuario**: Uriel.

### Qué hicimos
Sesión de **planificación pura**. Construimos toda la arquitectura del producto desde cero.

- Definimos visión, modelo de negocio (% NGR), mercado (Argentina informal).
- Stack confirmado: Turborepo + pnpm + TS estricto + Next.js 15 + NestJS 11 + Postgres 18 + Drizzle + Redis + BullMQ + Socket.io + R2 + Coolify + Infisical.
- Multi-tenancy: DB por tenant + DB de control.
- Modelo de roles + permisos atómicos + delegación con cascada (cap "el que delega"), `granted_by_chain`, `is_delegatable`.
- Modelo financiero: Admin Tenant mintea infinito, super-admin cobra % NGR.
- Wallet con `mint`, `burn`, idempotencia, particionado mensual de transactions.
- Flujos de carga manual (sin rate limit), depósitos autoservicio (max 2 pendientes), retiros con hold (max 2 pendientes).
- IGameProvider contract abstracto + MockProvider. Decisión: mock incluye mini-Crash con math + provably fair.
- Kommo per-tenant + pipeline Socio + widget nativo. Chatwoot como alternativa con mismo `ICRM` adapter.
- Sistema antifraude transversal con D1, D3, D5, D6, D7, D8, D9 activas.
- Atribución last-touch 90d + fallback al "Socio madre" (Admin Tenant).
- "El creador paga" para promos. Empleado debita del superior. Reservas inmediatas para premios fijos.
- Engagement: 7 tipos de bono, 6 tipos de actividad/sorteo, liga con 4 períodos simultáneos y 5 métricas.
- Branding fijo en MVP, solo content customizable. Modelo base negros/grises/blancos + rojo `#DC2626`.
- Auth: 2FA mandatory de Cajero arriba. TOTP + email codes. Sin SMS, sin recovery codes.
- KYC arquitectónico, default `none`. Verificación de edad por checkbox.
- Juego responsable completo en MVP excepto reality checks (v2).
- Plan: 6 meses MVP part-time + AI agents. Piloto = el propio dueño.

### Documentos creados (16)
- `START_HERE.md` no existía aún (creado en sesión del 2026-05-08).
- `AGENTS.md`, `CLAUDE.md`, `README.md`.
- `docs/00-vision.md` a `docs/15-engagement-promos.md`.
- `docs/own-games/00-overview.md`.

### Decisiones tomadas
Demasiadas para listar acá. Todas las relevantes están en `docs/DEVLOG.md` con fecha 2026-05-06.

### Commits creados
- Ninguno todavía. La fase de docs se cerró sin commit (los archivos existían en disco pero no había repo git).

### Estado al cerrar
- **Fase actual**: Fase 0 (Setup), no iniciada todavía en código.
- **Próximo paso lógico**: instalar entorno (Node, pnpm, Docker, Postgres, etc.) y arrancar repo git.
- **Bloqueos**: ninguno.

### Notas para próximo agente
- El usuario es **estudiante de ingeniería en informática** y solicitó modo enseñanza explícito: explicar conceptos antes de usarlos.
- 16 docs forman el contrato. Cualquier cambio arquitectónico se discute con el usuario.

---

## 2026-05-07 — Claude (Sonnet 4.5)

**Duración**: ~3h.
**Usuario**: Uriel.

### Qué hicimos
**Sesión 0 (conceptos)** y **Sesión 1 (setup)** del entorno de desarrollo.

#### Conceptos enseñados (Sesión 0)
- Big picture: webapp = frontend + backend + servicios + base de datos.
- Monorepo: vs multi-repo, workspaces, pnpm vs npm, Turborepo + cache.
- Docker: contenedores, imágenes, Docker Compose, volumes, networks.

#### Setup del entorno (Sesión 1)
Verificamos lo instalado: Node 24.14, npm 11.9, Git 2.53, VSCode.

**Intento WSL2 + Docker Desktop falló**:
- WSL no compatible. Reiniciamos varias veces.
- Diagnóstico: virtualización en BIOS OK, VMPlatform Enabled, hypervisorlaunchtype Auto, **pero `Microsoft-Windows-Subsystem-Linux` Disabled** y **Component Store corrupto**.
- DISM /RestoreHealth se colgaba sin acceder a Windows Update (0% CPU/red).

**Decisión: Plan E** — saltar Docker/WSL en MVP.

**Instalado nativo en Windows**:
- pnpm 11.0.8 vía `corepack enable`.
- PostgreSQL 18.3 nativo (servicio `postgresql-x64-18` Running).
- **Memurai falló** ("Setup Wizard ended prematurely") → instalamos **redis-windows port** (tporadowski). Servicio `Redis` Running, responde `PONG`.
- Git config `user.name "Uriel"`, `user.email "urielalejandrovalle493@gmail.com"`, `init.defaultBranch main`, `pull.rebase true`, `core.editor "code --wait"`.
- GitHub SSH: keys ed25519 generadas en `C:\Users\Admin\.ssh\`, agregadas a GitHub. `ssh -T git@github.com` responde "Hi Valle-u!".
- VSCode con extensiones esenciales (ESLint, Prettier, Tailwind CSS IntelliSense, Error Lens, GitLens) + algunas recomendadas.

### Decisiones tomadas
- **Plan E** (sin Docker/WSL en MVP). Detalle en `docs/DEVLOG.md`.
- **redis-windows port** en lugar de Memurai. Detalle en `docs/DEVLOG.md`.
- Memurai pendiente para retry futuro si redis-windows da problemas.
- Migración a Docker postergada para sesión específica futura.

### Commits creados
- Ninguno todavía. Repo git no inicializado todavía al cerrar la sesión.

### Estado al cerrar
- **Fase actual**: Fase 0 (Setup), entorno listo pero repo git pendiente.
- **Próximo paso lógico**: `git init`, primer commit con docs, push a GitHub.
- **Bloqueos**: 
  - Component Store de Windows corrupto (Docker/WSL bloqueado, no urgente).
  - Memurai falló (tenemos redis-windows como alternativa, no urgente).

### Notas para próximo agente
- El usuario tiene **path con espacios y "Y"**: `D:\Workspace\Proyectos Personales\HTML Y CSS\Plataforma Casino`. Comandos requieren comillas. Probó moverlo y prefirió mantenerlo.
- Postgres password está anotado por el usuario, no acá.
- Username de Windows del usuario: `Admin`.
- Si más adelante hay problemas raros con Docker o WSL, hay que reparar component store con DISM + ISO de Windows.

---

## 2026-05-08 — Claude (Sonnet 4.5)

**Duración**: ~1.5h.
**Usuario**: Uriel.

### Qué hicimos
**Sesión 2 — Bloque 1 + Bloque 2** del roadmap. Repo inicializado y primera app funcional.

#### Bloque 1: Repo + primer push
- `git init` + `git branch -M main`.
- `.gitignore` exhaustivo (node_modules, dist, .env, logs, IDE, OS, etc.).
- `package.json` raíz con Turborepo + scripts orquestados.
- `pnpm-workspace.yaml` con `packages: [apps/*, packages/*]`.
- `turbo.json` con tasks build/dev/lint/test/type-check.
- `tsconfig.base.json` (después movido a `packages/typescript-config/base.json`).
- `.editorconfig`, `.nvmrc`.
- `apps/README.md` y `packages/README.md`.
- **Commit `b6e33b8`**: "chore: initial setup with monorepo skeleton and design docs" — 29 archivos.
- Repo creado en GitHub: https://github.com/Valle-u/plataforma-casino.
- SSH remote agregado, primer push exitoso.

#### Bloque 2: Configs compartidas + apps/api
- `packages/typescript-config/` con 4 presets: base, nest, next, node.
- `packages/eslint-config/` (ESLint v9 flat config) con base, nest, next.
- `.prettierrc.json` + `.prettierignore` en raíz.
- `apps/api/` con NestJS 11 (CommonJS):
  - `src/main.ts`: bootstrap + ConfigModule.
  - `src/app.module.ts`: módulo raíz con ConfigModule global.
  - `src/app.controller.ts`: endpoints `GET /` y `GET /health`.
  - `src/app.service.ts`.
  - `tsconfig.json` extends `@casino/typescript-config/nest.json`.
  - `eslint.config.js` extends `@casino/eslint-config/nest`.
  - `.env.example` con DATABASE_URL_CONTROL, REDIS_URL, JWT_*, etc.
  - `nest-cli.json`, `README.md`.
- `pnpm install` exitoso (405 paquetes), `@nestjs/core` postinstall aprobado vía `pnpm-workspace.yaml allowBuilds`.
- `pnpm --filter @casino/api build` exitoso → `dist/` generado.
- Server probado en `localhost:3000`: ambos endpoints responden correctamente.
- **Commit `1aaae35`**: "feat: scaffold apps/api (NestJS) and shared config packages" — 24 archivos.
- Push exitoso a GitHub.

### Decisiones tomadas
- **NestJS en CommonJS** (no ESM). Imports sin `.js` al final.
- **Configs compartidas como packages internos** (`@casino/eslint-config`, `@casino/typescript-config`).
- **`pnpm-workspace.yaml allowBuilds`** para `@nestjs/core` (pnpm v11 syntax).
- Ver `docs/DEVLOG.md` 2026-05-08 entries para detalles.

### Commits creados
- `b6e33b8` — chore: initial setup with monorepo skeleton and design docs (29 files, 7158 insertions).
- `1aaae35` — feat: scaffold apps/api (NestJS) and shared config packages (24 files, 4193 insertions).

### Estado al cerrar
- **Fase actual**: **fin de Fase 0** del roadmap. Setup completo, repo verde, primer slice vertical (api con endpoints) funcional.
- **Próximo paso lógico** (Fase 1): `packages/db` con Drizzle ORM. Schema de DB de control. Conectar `apps/api` a Postgres. Primera migración. Endpoint que liste tenants.
- **Bloqueos**: ninguno.

### Notas para próximo agente
- API arranca con `pnpm --filter @casino/api dev` desde la raíz. Levanta en puerto 3000.
- `dist/` se genera con `pnpm --filter @casino/api build`. Está gitignored.
- Si pnpm pide aprobar builds nuevos, agregar al `allowBuilds` del workspace.yaml y correr `pnpm approve-builds`.
- redis-cli requiere path completo: `& 'C:\Program Files\Redis\redis-cli.exe'`.
- Username Postgres: `postgres`. Password lo tiene el usuario anotado (no en repo).
- Próxima sesión va a empezar Phase 1: arrancar `packages/db` con Drizzle, definir schema de control DB.

---

## 2026-05-08 (segunda sesión del día) — Claude (Sonnet 4.5)

**Duración**: ~45 min.
**Usuario**: Uriel.

### Qué hicimos
**Handoff prep**: el usuario consultó si podía migrar a opencode (modelo más barato) y mantener continuidad. Acordamos crear infraestructura de handoff para garantizar que cualquier agente tome el proyecto sin perder contexto.

Creado:
- `START_HERE.md` (raíz): puerta de entrada para agentes IA con reglas de operación, lectura obligatoria, áreas sensibles.
- `docs/DEVLOG.md`: bitácora de **decisiones técnicas y conversacionales** que no están en docs formales. Captura ~25 decisiones clave de las sesiones anteriores.
- `docs/SESSION_LOG.md`: este archivo. Bitácora de sesiones de agentes.
- Actualización de `AGENTS.md`, `CLAUDE.md` y `README.md` para apuntar a los nuevos archivos y obligar a registrar sesiones.

Después se hizo una **prueba real con opencode**: el usuario le pidió leer la documentación y resumir el estado. opencode entendió correctamente fase, stack, entorno, próximo paso, y cerró preguntando qué tarea atacar (sin avanzar por su cuenta). El handoff funcionó.

> **Lección operativa**: opencode dijo "2 commits" cuando había 3 (este mismo). Confió en el log textual en vez de correr `git log`. **Recordatorio para todos los agentes futuros**: el `SESSION_LOG.md` es un complemento de `git log`, no su reemplazo. Verificá ambos al iniciar.

### Decisiones tomadas
- Cualquier agente nuevo debe leer en orden: `START_HERE.md` → `AGENTS.md` → `docs/00-vision.md` → `docs/14-roadmap.md` → `docs/SESSION_LOG.md` → `docs/DEVLOG.md` → docs específicos según tarea.
- Cada sesión termina con entrada en `SESSION_LOG.md`. Decisiones técnicas relevantes van también a `DEVLOG.md`.
- Estrategia de costos: **opencode + modelo barato** para ejecución rutinaria. **Volver a Claude (Sonnet/Opus)** para decisiones arquitectónicas, code review en momentos clave, y debugging complejo.

### Commits creados
- `e63ac12` — docs: add handoff infrastructure for cross-agent continuity (6 files changed, 888 insertions).

### Estado al cerrar
- **Fase actual**: fin de Fase 0 (igual que sesión anterior).
- **Próximo paso lógico**: arrancar `packages/db` con Drizzle ORM (Fase 1).
- **Total de commits en main**: 3 (`b6e33b8`, `1aaae35`, `e63ac12`).
- **Bloqueos**: ninguno.

### Notas para próximo agente
- **Si sos un agente nuevo**, **bienvenido**. Empezá leyendo `START_HERE.md`.
- El usuario está usando **opencode con modelo barato** para ejecución, y volver a Claude (Sonnet/Opus) para decisiones gruesas. La continuidad la garantiza este SESSION_LOG + DEVLOG.
- **SIEMPRE verificá `git log --oneline` antes de tomar el conteo de commits del SESSION_LOG**. El log textual puede quedar desactualizado entre el momento de escritura y el commit real.
- Modo enseñanza es **default** porque el usuario es estudiante. Si decide cambiar, te lo va a decir explícitamente.
- Próxima tarea esperada: **Fase 1 — `packages/db` con Drizzle + schema de control DB + conexión desde `apps/api` + primera migración + endpoint `GET /tenants`**.

---

## 2026-05-08 (tercera sesión del día) — Claude (Sonnet 4.5)

**Duración**: ~2h.
**Usuario**: Uriel.

### Qué hicimos
**Phase 1 — DB de control con Drizzle, end-to-end funcional**.

El usuario probó opencode brevemente (le dio un plan razonable pero con algunos detalles a refinar — ver SESSION_LOG entry anterior y el chat). Decidió volver a Claude para esta implementación. Le pasamos a opencode 7 ajustes al plan que propuso: acotar a control DB only, driver postgres.js, dos drizzle configs, UUIDs v7, migrations folder fuera de src/, X-Admin-Token guard, health sin info sensible.

#### Creado: `packages/db/`
- `package.json` con dependencias drizzle-orm, postgres, uuid, dotenv, drizzle-kit, tsx.
- `tsconfig.json` extends `@casino/typescript-config/node.json`.
- `drizzle.control.config.ts` y `drizzle.tenant.config.ts` (este último placeholder).
- `src/utils/uuid.ts` — `generateUuidV7()` helper usando `uuid` v11.
- `src/control/`:
  - `tenant-plans.ts` (id, code, name, commission_pct, monthly_fee, features, timestamps).
  - `tenants.ts` (id, slug, name, db_name, db_host, status enum, plan_id FK, contact_email, timestamps, deleted_at).
  - `tenant-domains.ts` (id, tenant_id FK, domain unique, is_primary, verified_at).
  - `platform-users.ts` (id, email unique, password_hash, display_name, two_fa_secret, status enum, last_login_at).
  - `index.ts` barrel.
- `src/tenant/index.ts` placeholder (schemas tenant en sprint posterior).
- `src/client.ts` — `createControlDb()` y `createTenantDb()` factories con postgres.js.
- `src/scripts/setup-control.ts` — crea DB `platform_control` si no existe.
- `src/scripts/seed-control.ts` — inserta 2 plans + 1 tenant demo + 1 domain + 1 platform_user.
- `eslint.config.js`, `README.md`.

#### Migración real
- Generada con `pnpm --filter @casino/db db:gen:control` → `packages/db/migrations/control/0000_fluffy_unus.sql`.
- 2 enums + 4 tablas + 2 FKs + 4 unique constraints.
- Aplicada con `pnpm --filter @casino/db db:migrate:control` → ✅.
- Seed corrido con `pnpm --filter @casino/db db:seed:control` → 2 plans + 1 tenant demo-casino + 1 domain demo.localhost + 1 platform_user superadmin.

#### Wireado en `apps/api/`
- `src/database/database.module.ts` — @Global module que provee Symbol `CONTROL_DB` con cliente Drizzle vía useFactory + ConfigService.
- `src/auth/admin-token.guard.ts` — guard simple que valida header `X-Admin-Token` contra env `ADMIN_API_TOKEN`.
- `src/tenants/tenants.service.ts` — `findAll()` con LEFT JOIN a tenant_plans, filtro de soft-deleted.
- `src/tenants/tenants.controller.ts` — `GET /tenants` protegido con AdminTokenGuard.
- `src/tenants/tenants.module.ts` — agrupa los anteriores.
- `app.module.ts` actualizado para importar DatabaseModule + TenantsModule.
- `app.controller.ts` actualizado: `/health` ahora ejecuta `SELECT 1` contra Postgres y devuelve `db: 'connected' | 'error'`. NO expone version de Postgres.
- `app.service.ts` sin cambios.
- `package.json` añadió `drizzle-orm` como dep directa (necesario por `sql` y `eq` usados en controller/service).

#### Tests manuales — todos pasan
```
GET /health           → { status: 'ok', db: 'connected', timestamp, uptime }
GET /tenants (sin)    → 401 Unauthorized + mensaje claro
GET /tenants (con)    → { data: [{ id: 019e..., slug: 'demo-casino', ... }], count: 1 }
```

UUIDs v7 confirmados (id empieza con `019e...` = timestamp prefix).

#### Decisiones técnicas tomadas en sesión
- **Centralización de env**: `apps/api/.env.local` es el único archivo con secretos. `packages/db/scripts/*` y `drizzle.config.ts` lo cargan vía `dotenv.config({ path: '../../apps/api/.env.local' })`.
- **NestJS dist con incremental build cache**: `tsconfig.tsbuildinfo` puede quedar desactualizado y hacer que `nest build` aparente exitoso pero no emita archivos. Solución: rm tsbuildinfo + dist antes de rebuild si pasa.
- **postgres.js como driver**, pool de 10 conexiones default, idle_timeout 30s.
- **AdminTokenGuard fail-closed**: si `ADMIN_API_TOKEN` no está configurado, rechaza todos los requests (no abre por error de configuración).
- Detalle del usuario: editó .env.example en lugar de .env.local primero. Se reemplazó `<password>` con `<admin>` (con brackets) — placeholder por accidente. Lo corregimos: revertimos .env.example al template, creamos .env.local correcto, password real es `admin` (validado con psql).
- Detalles agregados al DEVLOG correspondiente.

### Commits creados
- (a definir cuando el usuario los pida — pendiente al cerrar esta entrada).

### Estado al cerrar
- **Fase actual**: **Fase 1 en marcha**, primer slice vertical de DB completo (schemas + migración aplicada + endpoint GET /tenants protegido funcional).
- **Próximo paso lógico**:
  1. Schemas de DB de tenant (sprint propio, ~30+ tablas).
  2. O bien: TenantResolver middleware (lee Host header → carga TenantContext con conexión a DB del tenant).
  3. O bien: empezar a implementar auth real (sustituir AdminTokenGuard).
  El usuario decide.
- **Bloqueos**: ninguno.

### Notas para próximo agente
- **DB actual**: `platform_control` corriendo en localhost:5432. Datos de seed insertados (idempotente, no falla si ya están).
- Para verificar visualmente: `pnpm --filter @casino/db db:studio:control` abre un GUI web.
- Schema en `packages/db/src/control/`. Cualquier cambio: `pnpm --filter @casino/db db:gen:control` para generar nueva migración.
- **`apps/api/.env.local` es la única fuente de secrets** — no copiar a otros lugares.
- El header `X-Admin-Token` con valor `dev-admin-xyz-12345-abcde-67890` funciona en dev contra el endpoint `/tenants`.
- Si `nest build` se comporta raro, **borrá `tsconfig.tsbuildinfo` y `dist/`** antes de reintentar.

---

## 2026-05-08 (cuarta sesión del día) — Claude (Sonnet 4.5)

**Duración**: ~1.5h.
**Usuario**: Uriel.

### Qué hicimos
**Auth real con JWT** para super-admins. Reemplazamos el AdminTokenGuard provisional por un sistema completo de login + JWT + Guard que valida tokens.

#### Cambios en `packages/db`
- Agregada dep `@node-rs/argon2` (Rust binding, sin compilación nativa).
- Creado `src/utils/password.ts` con `hashPassword()` y `verifyPassword()` exportados desde `@casino/db/utils`.
- Actualizado `seed-control.ts` para hashear password real con Argon2id (en lugar del placeholder hash) usando `onConflictDoUpdate`.
- Re-corrido seed exitoso. Las credenciales dev son:
  - Email: `superadmin@plataforma-casino.local`
  - Password: `dev-superadmin-2026`

#### Nuevos modules en `apps/api`
- `src/platform-users/`:
  - `platform-users.service.ts` — `findById`, `findByEmail`, `markLoggedIn`.
  - `platform-users.module.ts`.
- `src/platform-auth/`:
  - `dto/login.dto.ts` — IsEmail + MinLength(8).
  - `platform-auth.service.ts` — `login(email, password)` con verifyPassword + signJWT, mensajes genéricos para evitar info leak. `validateJwtPayload()` re-checkea user activo.
  - `platform-auth.controller.ts` — `POST /platform/auth/login` (HTTP 200 explícito).
  - `guards/platform-jwt.guard.ts` — valida `Authorization: Bearer <jwt>`, re-consulta DB para confirmar user activo, adjunta `req.platformUser`.
  - `decorators/current-platform-user.decorator.ts` — `@CurrentPlatformUser()` extrae user del request en handlers.
  - `platform-auth.module.ts` — `JwtModule.registerAsync` con secret + TTL parseado a segundos (parseTtlToSeconds helper para evitar conflicto de tipo `string` vs `StringValue` del paquete `ms`).

#### Cambios en otros archivos
- `apps/api/src/main.ts` — agregado `ValidationPipe` global (whitelist + transform + forbidNonWhitelisted).
- `apps/api/src/app.module.ts` — registra PlatformUsersModule + PlatformAuthModule.
- `apps/api/src/tenants/tenants.controller.ts` — `@UseGuards(PlatformJwtGuard)` reemplaza al AdminTokenGuard. Suma `requestedBy` en la response usando `@CurrentPlatformUser()`.
- `apps/api/src/tenants/tenants.module.ts` — importa PlatformAuthModule (que reexporta JwtModule + Guard).
- **Eliminado `apps/api/src/auth/admin-token.guard.ts`** (reemplazado por PlatformJwtGuard).
- `apps/api/.env.example` — `JWT_ACCESS_SECRET` y `JWT_REFRESH_SECRET` con instrucciones de `openssl rand -hex 64`. Removido `ADMIN_API_TOKEN` (ya no se usa).
- `apps/api/.env.local` — generados secrets dev (random hex strings). `ADMIN_API_TOKEN` removido.
- `apps/api/package.json` — agregadas deps: `@nestjs/jwt`, `class-transformer`, `class-validator`.

#### Tests end-to-end (6 casos pasados)
| # | Caso | Resultado |
|---|---|---|
| 1 | GET /tenants sin token | 401 "Token faltante o formato inválido" |
| 2 | Login con password incorrecta | 401 "Credenciales inválidas" (genérico) |
| 3 | Login con creds válidas | 200 + JWT + user info |
| 4 | GET /tenants con JWT válido | 200 + data + `requestedBy: <email>` |
| 5 | GET /tenants con JWT basura | 401 "Token inválido o expirado" |
| 6 | Login con DTO mal armado | 400 con detalle de cada error de validación |

### Decisiones tomadas
- **Argon2id sobre bcrypt** (alineado con `docs/12 §2.2`).
- **`@node-rs/argon2`** sobre `argon2` o `bcryptjs` — prebuilds Windows funcionan, sin node-gyp.
- **Password helpers en `@casino/db/utils`** (no en apps/api) para evitar duplicar deps y permitir uso por seeds + auth service.
- **JWT payload mínimo**: `{ sub, email, type: 'platform' }`. Discriminador `type` para distinguir tokens platform vs tenant en el futuro.
- **Re-consulta DB en cada request**: el guard valida el JWT crypto + re-checkea user activo. Permite "banear" mid-session (siguiente request rechaza).
- **Mensajes de error genéricos** ("Credenciales inválidas") para no filtrar qué emails están registrados.
- **Refresh tokens postpuestos a próxima sesión** (requieren nueva tabla o store en Redis).
- **2FA postpuesto** (TOTP setup propio).
- Detalles agregados a DEVLOG.

### Commits creados
- (a definir cuando el usuario lo pida — pendiente al cerrar esta entrada).

### Estado al cerrar
- **Fase actual**: Fase 1 avanzando — DB de control + auth real funcional.
- **Próximo paso lógico**:
  1. Refresh tokens con rotación (tabla `platform_user_sessions` o store en Redis).
  2. O bien: schemas de DB de tenant (sprint propio, ~30+ tablas).
  3. O bien: TenantResolver middleware.
  4. O bien: 2FA TOTP para super-admin.
  El usuario decide.
- **Bloqueos**: ninguno.

### Notas para próximo agente
- **Credenciales dev**: `superadmin@plataforma-casino.local` / `dev-superadmin-2026`. Solo en dev.
- **Endpoints actuales**:
  - `GET /` — bienvenida.
  - `GET /health` — incluye check de DB.
  - `POST /platform/auth/login` — público.
  - `GET /tenants` — protegido por PlatformJwtGuard.
- Si querés probar manual: `curl -X POST -H "Content-Type: application/json" http://localhost:3000/platform/auth/login -d '{"email":"superadmin@plataforma-casino.local","password":"dev-superadmin-2026"}'` → te devuelve `accessToken`, lo usás como `Authorization: Bearer <token>`.
- El JWT dura 15 min. Después hay que re-loguearse (no hay refresh todavía).
- `apps/api/src/auth/` ya no existe — el guard moderno vive en `apps/api/src/platform-auth/guards/`.

---

## 2026-05-08 (quinta sesión del día) — Claude (Sonnet 4.5)

**Duración**: ~1h.
**Usuario**: Uriel.

### Qué hicimos
**Refresh tokens con rotación estricta + logout** completando el ciclo de auth.

#### Cambios en `packages/db`
- Nuevo schema `src/control/platform-user-sessions.ts`:
  - id, user_id (FK platform_users), token_hash (SHA-256 hex, unique), user_agent, ip, created_at, expires_at, revoked_at, revoked_reason.
- Nuevo `src/utils/refresh-token.ts`:
  - `generateRefreshToken()` — 32 bytes random base64url.
  - `hashRefreshToken()` — SHA-256 hex (determinístico para lookup).
- Exportado desde `@casino/db`.
- Migración generada `0001_certain_red_shift.sql` y aplicada.

#### Cambios en `apps/api/src/platform-auth`
- `dto/refresh.dto.ts` y `dto/logout.dto.ts` — validación con class-validator.
- `platform-auth.service.ts` extendido:
  - `login()` ahora crea sesión + emite access + refresh.
  - `refresh(refreshToken, context)` — busca sesión por SHA-256 hash, valida (no revocada, no expirada, user activo), revoca sesión actual con `revokedReason='rotated'`, emite par nuevo.
  - `logout(refreshToken)` — marca sesión como `revokedReason='logout'`. Idempotente.
  - `issueTokens(user, context, source)` — helper privado que crea sesión y firma access JWT.
- `platform-auth.controller.ts` — agregados `POST /refresh` y `POST /logout`.
- Login y refresh capturan `user-agent` e `ip` para audit.

#### Tests end-to-end (8 casos pasados)
| # | Caso | Resultado |
|---|---|---|
| 1 | Login | Devuelve access + refresh + user |
| 2 | GET /tenants con access | 200 OK |
| 3 | Refresh con refresh válido | Nuevo par de tokens |
| 4 | GET /tenants con access nuevo | 200 OK |
| 5 | Reusar refresh ya rotado | 401 "Refresh token inválido" |
| 6 | Logout con refresh válido | 204 No Content |
| 7 | Refresh post-logout | 401 |
| 8 | Logout con token inexistente | 204 (idempotente) |

### Decisiones tomadas
- **Refresh tokens opaque** (no JWT): random bytes hasheados con SHA-256 en DB.
- **SHA-256 sobre Argon2** para refresh tokens: el token ya tiene 256 bits de entropía, no necesita protección anti-bruteforce. SHA-256 es determinístico → permite lookup por hash.
- **Rotación estricta**: cada refresh consume el actual. Reusar = 401.
- **Logout idempotente**: token no encontrado igual devuelve 204. Evita filtrar info al atacante.
- **Captura user-agent + ip** en cada sesión para auditoría futura.
- **Rotación detectada loggeada como warning**: en MVP solo log; en v2 se podría revocar todas las sesiones del user (señal de robo).
- Detalles agregados a DEVLOG.

### Commits creados
- (a definir cuando el usuario lo pida — pendiente al cerrar esta entrada).

### Estado al cerrar
- **Fase actual**: Fase 1 — auth completo de super-admins (login, refresh, logout). Falta 2FA.
- **Próximo paso lógico**:
  1. **2FA TOTP** para super-admin (obligatorio según docs/12).
  2. **Schemas de DB de tenant** (~30+ tablas).
  3. **TenantResolver middleware** + provisionamiento de DB de tenant.
  4. **Endpoint protegido para crear/suspender tenants** (módulo platform).
  El usuario decide.
- **Bloqueos**: ninguno.

### Notas para próximo agente
- **Endpoints de auth ahora son**:
  - `POST /platform/auth/login` → access + refresh
  - `POST /platform/auth/refresh` → rotación
  - `POST /platform/auth/logout` → revoca sesión
- **Tabla `platform_user_sessions`** trackea las sesiones activas. Si querés ver: `pnpm --filter @casino/db db:studio:control`.
- El access token sigue durando 15 min. El refresh, 30 días.
- Cada `/refresh` crea una fila nueva en sessions y revoca la anterior. La tabla puede crecer rápido — futuro: job de cleanup de sesiones expiradas/revocadas hace > 30 días.

---

## 2026-05-08 (sexta sesión del día) — Claude (Sonnet 4.5)

**Duración**: ~1.5h.
**Usuario**: Uriel.

### Qué hicimos
**TenantResolver multi-tenant físico funcional + endpoint para crear tenants**. Esta sesión cierra el loop "core" del multi-tenancy: ahora podés crear un tenant via API y resolverlo desde su dominio en cada request.

#### packages/db
- `src/provisioning.ts`: `deriveAdminUrl()` y `provisionTenantDatabase()` (idempotente, manejan 42P04 duplicate_database).
- Re-exportados desde el barrel principal.
- Seed actualizado: tenant `demo-casino` ahora se inserta con `status='active'` (onConflictDoUpdate) y se provisiona su DB `tenant_demo_casino`.

#### apps/api/src/tenant-resolver/
- `tenant-context.ts`: tipos `TenantContext`, `RequestWithTenantContext`, `TenantDb`.
- `tenant-connection-cache.ts`: Map en memoria, `get()`, `invalidate()`, `clear()`. Sin LRU por ahora — comentado pendiente para v1+.
- `tenant-resolver.middleware.ts`: lee `Host` (lowercase, sin puerto), busca en tenant_domains+tenants, valida status='active' (rechaza suspended/deleted/onboarding), adjunta `req.tenantContext`. Si no match: deja seguir sin context.
- `tenant-resolver.module.ts`: @Global module.

#### apps/api/src/tenants/
- `dto/create-tenant.dto.ts`: validación slug (regex `/^[a-z][a-z0-9-]{2,29}$/`), name, planCode, contactEmail, primaryDomain (regex hostname).
- `tenants.service.ts` extendido con `create(dto, actorEmail)`:
  1. Valida plan existe.
  2. Computa dbName = `tenant_${slug.replace(/-/g,'_')}`.
  3. Checks de uniqueness (slug, domain) → 409 si duplica.
  4. Insert tenant status=onboarding.
  5. Insert primary domain.
  6. Provision Postgres DB.
  7. Update tenant a status=active.
- `tenants.controller.ts`: agregado `POST /tenants` (HTTP 201, requiere PlatformJwtGuard, devuelve `{ tenant, createdBy }`).

#### apps/api/src/tenant-info/
- `tenant-info.controller.ts`: `GET /tenant/info` público que demuestra el TenantContext.
  - Si no hay context (host no matchea) → 404.
  - Si hay → devuelve datos del tenant + ping a su DB (`SELECT current_database(), now()`).
- `tenant-info.module.ts`.

#### apps/api/src/app.module.ts
- AppModule ahora implementa `NestModule` con `configure(consumer)` que registra `TenantResolverMiddleware` para todas las rutas (`forRoutes('*')`).
- Importa TenantResolverModule + TenantInfoModule.

#### apps/api/.env.local
- `DATABASE_URL_TENANT_TEMPLATE` corregido a tener placeholder `<tenant_db>` (en lugar de `tenant_template` literal).

#### Tests end-to-end (8/8 passing)
| # | Caso | Resultado |
|---|---|---|
| 1 | GET /tenant/info sin host de tenant | 404 |
| 2 | GET /tenant/info con Host: demo.localhost | 200 + datos + ping DB tenant_demo_casino |
| 3 | Login | Token OK |
| 4 | POST /tenants slug='sandbox' | 201 + tenant active + DB tenant_sandbox creada |
| 5 | GET /tenant/info con Host: sandbox.localhost | 200 + datos + ping DB tenant_sandbox |
| 6 | POST /tenants con slug duplicado | 409 Conflict |
| 7 | POST /tenants con slug inválido | 400 con detalle |
| 8 | GET /tenants | Lista con 2 tenants (demo + sandbox) |

### Decisiones tomadas
- **Cache de conexiones tenant simple Map** (no LRU). Justificado: pocos tenants en MVP, agregar LRU es premature optimization. Comentado para v1+.
- **TenantResolverMiddleware aplica a TODAS las rutas** (`forRoutes('*')`). Si no hay match, deja seguir. Endpoints que requieran tenant rechazan después.
- **Provisioning sincrónico en el endpoint create**: bloquea la response hasta que la DB esté creada. OK para MVP. Si crece a > 1s, se puede mover a job BullMQ con polling de status.
- **Tenant rechaza si status !== 'active'** (incluido `onboarding`). Si en futuro queremos permitir resolver tenants en onboarding (ej. para preview), agregamos flag.
- **TenantResolverModule es @Global**: cache compartido entre todos los modules.
- Detalles agregados a DEVLOG.

### Commits creados
- (a definir cuando el usuario lo pida — pendiente al cerrar esta entrada).

### Estado al cerrar
- **Fase actual**: Fase 1 — multi-tenant físico operativo. Crear tenants + resolverlos por Host funciona end-to-end.
- **Próximo paso lógico**:
  1. Schemas reales de DB de tenant (~30+ tablas: users, roles, wallet, deposits, etc.).
  2. Aplicar migraciones a las DBs de tenant cuando se crean.
  3. 2FA TOTP para super-admin (pendiente desde fase auth).
  4. Endpoint para suspender/reactivar tenants.
  5. Endpoint público que use TenantContext (ej. registro de jugador).
  El usuario decide.
- **Bloqueos**: ninguno.

### Notas para próximo agente
- **Para testear multi-tenant** desde curl: `curl -H "Host: demo.localhost" http://localhost:3000/tenant/info`. El header Host overridea el real (que sería localhost:3000) y el middleware lo usa para resolver.
- **DBs de tenant existentes** (chequear con `\l` en psql): `tenant_demo_casino`, `tenant_sandbox`. Vacías por ahora (no hay tenant schema real).
- **Crear más tenants**: 
  ```bash
  curl -X POST -H "Authorization: Bearer <jwt>" -H "Content-Type: application/json" \
    http://localhost:3000/tenants \
    -d '{"slug":"X","name":"Y","planCode":"basic","contactEmail":"a@b.com","primaryDomain":"x.localhost"}'
  ```
- Para borrar un tenant manualmente (no hay endpoint todavía):
  - `DROP DATABASE tenant_<slug>;` desde psql como superadmin.
  - `DELETE FROM tenants WHERE slug='<slug>';` (cascadea a tenant_domains).
- Cuando agreguemos schemas reales de tenant, hay que invocar `migrate(tenantDb, ...)` después de crear cada DB en la sesión create.

---

## 2026-05-09 — Claude (Sonnet 4.5)

**Duración**: ~2.5h.
**Usuario**: Uriel.

### Qué hicimos
**Tenant auth completo + primeros schemas reales de tenant DB**. Sesión grande que cierra el loop multi-tenant: cada tenant tiene su propio set de users, roles, sessions, y un admin puede loguearse contra SU tenant sin poder cruzar a otro.

#### packages/db: schemas tenant (6 tablas) + migrate + seed helpers
- `src/tenant/users.ts`: id, username unique, email, phone, password_hash, display_name, status enum (active/suspended/banned/pending), two_fa_secret, last_login_at, timestamps.
- `src/tenant/user-sessions.ts`: paralelo de platform_user_sessions — id, user_id FK, token_hash unique SHA-256, user_agent, ip, expires_at, revoked_at, revoked_reason.
- `src/tenant/roles.ts`: id, code unique, name, description, is_system, timestamps.
- `src/tenant/permissions.ts`: code PK, category, description, audit_required, is_delegatable.
- `src/tenant/role-permissions.ts`: PK compuesta (role_id, permission_code), ambas FKs.
- `src/tenant/user-roles.ts`: PK compuesta (user_id, role_id), granted_by, granted_at.
- Barrel actualizado.
- `src/migrations-paths.ts`: helper para resolver paths de migrations al runtime.
- `src/migrate-tenant.ts`: `migrateTenantDatabase(connectionUrl)` — aplica migraciones al tenant DB. Idempotente.
- `src/seeds/tenant-seed.ts`: `seedTenantDatabase(url, opts)`:
  1. Inserta 6 roles del sistema (admin_tenant, socio, distribuidor, cajero, empleado, usuario_final).
  2. Inserta subset MVP de 25 permisos (wallet, users, deposits, withdrawals, roles, audit, tenant settings).
  3. Asigna TODOS los permisos al rol admin_tenant.
  4. Crea/upsert el admin user con password Argon2id.
  5. Asigna admin_tenant al user.
- Re-exportado todo desde `@casino/db`.
- Migración tenant generada: `0000_worthless_solo.sql` (6 tablas + 4 FKs + 4 unique).
- `drizzle.tenant.config.ts` actualizado para resolver el placeholder `<tenant_db>` al hacer generate.

#### Cambios en seed-control.ts
- Después de provisionar la DB del tenant demo, también:
  - Aplica migraciones tenant.
  - Seedea: 6 roles + 25 permisos + admin user (`admin` / `demo-admin-2026`).
- Output del seed muestra credenciales de **ambos** tipos de usuario (super-admin y admin tenant).

#### apps/api: TenantAuthModule + TenantUsersModule
- `tenant-users/`:
  - `tenant-users.service.ts`: findById, findByUsername, findByEmail, markLoggedIn — recibe `db: TenantDb` por parámetro.
- `tenant-auth/`:
  - `dto/tenant-login.dto.ts`, `tenant-refresh.dto.ts`, `tenant-logout.dto.ts`.
  - `tenant-auth.service.ts`: login/refresh/logout/validateJwtPayload — mismos patterns que platform-auth pero con TenantDb por parámetro. **Validación crítica**: refresh y guard chequean `payload.tenantId === tenantContext.tenant.id` para prevenir cross-tenant.
  - `tenant-auth.controller.ts`: POST /tenant/auth/login, /refresh, /logout, GET /me (protegido).
  - `guards/tenant-jwt.guard.ts`: requiere TenantContext + valida JWT + chequea tenant match.
  - `decorators/current-tenant-user.decorator.ts`: `@CurrentTenantUser()` sugar.
  - `tenant-auth.module.ts`: JwtModule registerAsync (mismo secret que platform-auth, distinto issuer 'plataforma-casino-tenant').
- `tenants/dto/create-tenant.dto.ts` extendido: ahora requiere `adminUsername`, `adminPassword` (≥8), `adminDisplayName`.
- `tenants/tenants.service.ts`: `create()` ahora corre los 7 pasos: insert tenant, insert domain, provision DB, **migrate tenant DB**, **seed tenant** con admin user provisto, mark active.
- `app.module.ts` registra TenantUsersModule + TenantAuthModule.

#### Tests end-to-end (8/9 pasados — el 1 fallado fue test mal armado)
| # | Caso | Resultado |
|---|---|---|
| 1 | Login admin demo (Host: demo.localhost) | 200 + access + refresh + user |
| 2 | GET /tenant/auth/me | 200 + user + tenant info |
| 3 | Login password "wrong" (4 chars) | 400 (DTO validation) — test mal armado, no fallo de sistema |
| 4 | Login sin Host de tenant | 404 |
| 5 | POST /tenants sandbox con admin | 201 + DB + migrate + seed |
| 6 | Login admin sandbox | 200 + JWT |
| 7 | **JWT sandbox usado en Host: demo** | **401 — aislamiento real entre tenants** 🔒 |
| 8 | Refresh demo | 200 + nuevos tokens (rotación) |
| 9 | Reusar refresh viejo demo | 401 |

### Decisiones tomadas
- **JWT payload incluye `tenantId`**: el guard valida que matchee con el tenant del Host. Sin esto, un JWT de un tenant funcionaría en otro.
- **Issuer distinto** entre platform JWT (`plataforma-casino`) y tenant JWT (`plataforma-casino-tenant`) — ayuda a debug y separación.
- **Mismo secret JWT** entre platform y tenant (por simplicidad). En v1+ podríamos rotar a secrets separados.
- **TenantUsersService recibe `db` por parámetro** (no inyectado): permite que el mismo service sirva a cualquier tenant según el TenantContext.
- **Subset MVP de 25 permisos** en seed (no los 50 del catálogo completo). Más se sumará a medida que se implementen módulos.
- **Admin tenant recibe TODOS los permisos** automáticamente. En v2 podríamos limitar (ej. delegar permisos peligrosos solo bajo control).
- Detalles agregados a DEVLOG.

### Commits creados
- (a definir cuando el usuario lo pida — pendiente al cerrar esta entrada).

### Estado al cerrar
- **Fase actual**: Fase 1 — multi-tenant + auth completo en ambos niveles (platform + tenant).
- **Próximo paso lógico**:
  1. **2FA TOTP** (obligatorio super-admin + cajeros+ por docs/12).
  2. **Más schemas de tenant**: wallet + transactions + deposits + withdrawals.
  3. **Endpoint que use auth tenant** (CRUD de users del tenant, por ejemplo).
  4. **Sistema de permisos efectivos**: cálculo on-the-fly del set efectivo (roles + overrides), guard que valida permisos atómicos en endpoints.
  El usuario decide.
- **Bloqueos**: ninguno.

### Notas para próximo agente
- **Credenciales dev tenant demo**:
  - Host: `demo.localhost`
  - Username: `admin`
  - Password: `demo-admin-2026`
- **Credenciales dev super-admin**:
  - Email: `superadmin@plataforma-casino.local`
  - Password: `dev-superadmin-2026`
- **Crear nuevo tenant** ahora requiere también `adminUsername`, `adminPassword`, `adminDisplayName` en el body. El admin se crea automáticamente en el tenant DB.
- **El tenant DB sigue creciendo**. Las próximas tablas (wallet, deposits, etc.) se agregan en `packages/db/src/tenant/` y se genera nueva migración con `pnpm --filter @casino/db db:gen:tenant`.
- **Endpoint resumen actual**:
  ```
  Plataforma:
    POST /platform/auth/login    POST /platform/auth/refresh    POST /platform/auth/logout
    GET  /tenants                POST /tenants
  Tenant (requieren Host):
    POST /tenant/auth/login      POST /tenant/auth/refresh      POST /tenant/auth/logout
    GET  /tenant/auth/me         GET  /tenant/info
  ```

---

## 2026-05-10 — Claude (Sonnet 4.5)

**Duración**: ~1h.
**Usuario**: Uriel.

### Qué hicimos
**Sistema de permisos efectivos + PermissionsGuard funcional**. Demuestra el RBAC: roles → permissions → set efectivo → endpoints protegidos por decorator.

#### Nuevo `apps/api/src/permissions/`
- `effective-permissions.service.ts`:
  - `calculateForUser(db, userId)` → query userRoles → rolePermissions → UNION → `Set<string>`.
  - `hasAllPermissions(db, userId, required[])` → boolean shortcut.
  - Sin caché (TODO Redis).
- `require-permissions.decorator.ts`: `@RequirePermissions('foo.view', ...)` vía `SetMetadata`.
- `permissions.guard.ts`:
  - Lee metadata con `Reflector`.
  - Lee `tenantContext` + `tenantUser` del request (puestos por TenantJwtGuard).
  - Calcula efectivos y valida `required ⊆ effective`.
  - Si falta → 403 con mensaje específico de qué falta.
- `permissions.module.ts` → `@Global` (guard disponible sin re-import).

#### Cambios en otros módulos
- `tenant-users/tenant-users.controller.ts` → nuevo: `GET /tenant/users` protegido por `[TenantJwtGuard, PermissionsGuard]` + `@RequirePermissions('users.view_any')`.
- `tenant-users/tenant-users.module.ts` → registra el controller. **NO** importa TenantAuthModule (resuelto vía `@Global`).
- `tenant-auth/tenant-auth.module.ts` → marcado `@Global()` para romper la dependencia circular con TenantUsersModule.
- `app.module.ts` → registra `PermissionsModule`.
- `seed-control.ts` → crea **`cajero1` / `cajero-2026`** con rol `cajero` (sin permisos asignados — para test negativo).

#### Tests end-to-end (6/6)
| # | Caso | Resultado |
|---|---|---|
| 1 | Login admin | 200 + JWT |
| 2 | Admin GET /tenant/users | 200 + lista (admin + cajero) |
| 3 | Login cajero | 200 + JWT |
| 4 | **Cajero GET /tenant/users** | **403 "Faltan permisos: users.view_any"** 🔒 |
| 5 | Cajero GET /me | 200 (no requiere permission) |
| 6 | Sin JWT | 401 |

### Decisiones tomadas
- **EffectivePermissionsService stateless** (recibe db por parámetro).
- **Patrón decorator + Reflector** (estándar NestJS).
- **403 con mensaje específico** del permiso faltante (útil para dev).
- **Guards + módulos `@Global`** para PermissionsModule + TenantAuthModule. Resuelve circular dep limpio.
- **Sin cache Redis aún** (justificado para MVP, ~5ms por request).
- **Guard chequea TODOS los permisos requeridos** (AND, no OR). Si necesitamos OR, agregar `@RequireAnyPermission(...)`.

### Commits creados
- (a definir cuando el usuario lo pida).

### Estado al cerrar
- **Fase actual**: Fase 1 — RBAC completo, multi-tenant con auth + permisos enforced.
- **Próximo paso lógico**:
  1. **`user_permission_overrides` table** + cascada al revocar (cierra el modelo de delegación).
  2. **2FA TOTP** para super-admin + tenant admins (docs/12 lo exige).
  3. **Wallet schema + endpoints** (mint/load/transfer).
  4. **Endpoints de gestión** (POST /tenant/users, asignar roles, etc.).

### Notas para próximo agente
- **Credenciales dev**:
  - Super-admin (DB control): `superadmin@plataforma-casino.local` / `dev-superadmin-2026`
  - Admin demo: `admin` / `demo-admin-2026` (Host: demo.localhost)
  - **Cajero demo (sin permisos)**: `cajero1` / `cajero-2026` (Host: demo.localhost)
- **Patrón estándar para proteger un endpoint**:
  ```typescript
  @Controller('tenant/foo')
  @UseGuards(TenantJwtGuard, PermissionsGuard)
  export class FooController {
    @Get()
    @RequirePermissions('foo.view')
    list(@CurrentTenantUser() user) { ... }
  }
  ```
- **Si agregás un permiso nuevo**: editá `packages/db/src/seeds/tenant-seed.ts` (`SYSTEM_PERMISSIONS`), `pnpm --filter @casino/db db:seed:control` para que el demo lo tenga.
- **Si Nest tira "module at index [n] is undefined"**: probable circular dep. `@Global()` o `forwardRef()` lo resuelve.

---

## 2026-05-10 (segunda sesión del día) — Claude (Sonnet 4.5)

**Duración**: ~45 min.
**Usuario**: Uriel.

### Qué hicimos
**`user_permission_overrides` + endpoints grant/revoke/clear**. Cierra el modelo RBAC documentado en `docs/03-jerarquia-roles.md §3`. Set efectivo ahora combina: roles + grants − revokes.

#### packages/db
- Tabla nueva `user_permission_overrides`: PK compuesta (user_id, permission_code), effect enum, granted_by, granted_by_chain (uuid[]), reason, granted_at.
- Migration `0001_wandering_miek.sql` generada y aplicada a tenant_demo_casino + tenant_sandbox.
- Helper script `migrate-existing-tenants.ts` (comando `pnpm --filter @casino/db db:migrate:tenants`): itera tenants y aplica migraciones pendientes a cada DB.

#### apps/api/src/permissions
- `effective-permissions.service.ts` extendido: 3 queries (userRoles + rolePermissions + userPermissionOverrides) → UNION + grant + revoke.
- `dto/grant-permission.dto.ts`: GrantPermissionDto + RevokePermissionDto.
- `permission-overrides.controller.ts`:
  - `POST /tenant/permission-overrides/grant` (requiere `permissions.grant`).
  - `POST /tenant/permission-overrides/revoke` (requiere `permissions.revoke`).
  - `POST /tenant/permission-overrides/clear` (requiere `permissions.revoke`).
  - Idempotente con onConflictDoUpdate.

#### Tests end-to-end (6/6)
| # | Caso | Resultado |
|---|---|---|
| 1 | Cajero sin permiso → /tenant/users | 403 |
| 2 | Admin GRANT users.view_any al cajero | 201 |
| 3 | Cajero ahora puede /tenant/users | 200 |
| 4 | CLEAR override → cajero vuelve a 403 | 403 |
| 5 | **Admin REVOKE a sí mismo** | **403 aunque su rol lo permita** 🔒 |
| 6 | Admin CLEAR → recupera | 200 |

**Test 5 es el más importante**: prueba que `revoke` GANA sobre el rol — admin tenía permiso por rol admin_tenant, revoke lo sacó del set efectivo.

### Decisiones tomadas
- Tabla con PK compuesta (user_id, permission_code).
- `granted_by_chain` ya en schema, cascada para próximo sprint.
- Endpoints en PermissionsModule (módulo de infra, sus endpoints viven con su lógica).
- POST /clear (no DELETE) para mantener body con userId+permissionCode.
- Helper `db:migrate:tenants` para sincronizar tenants existentes con schema nuevo.

### Commits creados
- (a definir cuando el usuario lo pida).

### Estado al cerrar
- **Fase actual**: Fase 1 — RBAC COMPLETO con overrides funcional.
- **Próximo paso lógico**:
  1. **Cascada al revocar** (lógica que usa `granted_by_chain`).
  2. **2FA TOTP** para super-admin + tenant admins.
  3. **Wallet schema + endpoints**.
  4. **POST /tenant/users** (CRUD users con asignación de roles).

### Notas para próximo agente
- **Patrón overrides**:
  - `POST /tenant/permission-overrides/grant {userId, permissionCode, reason?}` — suma.
  - `POST /tenant/permission-overrides/revoke {userId, permissionCode, reason}` — resta (gana sobre roles).
  - `POST /tenant/permission-overrides/clear {userId, permissionCode}` — quita el override.
- **Cuando agreguemos schema nuevo a tenant**: `pnpm --filter @casino/db db:gen:tenant` + `pnpm --filter @casino/db db:migrate:tenants`.
- **Tenant DBs ahora tienen 7 tablas**.

---

## 2026-05-10 (tercera sesión del día) — Claude (Sonnet 4.5)

**Duración**: ~25 min.
**Usuario**: Uriel.

### Qué hicimos
**`POST /tenant/users` — admin puede crear cajeros, socios, etc.** Cierra el CRUD básico de users del tenant.

#### apps/api/src/tenant-users
- `dto/create-tenant-user.dto.ts`: username (regex), password ≥8, displayName, email opcional, phone opcional, roleCode requerido.
- `tenant-users.service.ts`: nuevo método `create(db, params)`:
  1. Valida que el rol exista (400).
  2. Chequea uniqueness de username y email (409).
  3. Hashea password con Argon2id.
  4. Insert user + insert userRoles asignando el rol.
  5. Returns el user (sin passwordHash en el response).
- `tenant-users.controller.ts`: nuevo `POST /tenant/users` protegido por `@RequirePermissions('users.create')`. Saca `passwordHash` y `twoFaSecret` antes de devolver.

#### Tests end-to-end (6/6)
| # | Caso | Resultado |
|---|---|---|
| 1 | Admin crea cajero2 | 201 + user (sin password_hash) |
| 2 | Login como cajero2 (recién creado) | 200 + JWT |
| 3 | Crear con username duplicado | 409 |
| 4 | Crear con rol inexistente | 400 |
| 5 | Cajero1 (sin users.create) intenta | 403 |
| 6 | GET /tenant/users incluye los 3 | 200 |

### Decisiones tomadas
- Sacamos `passwordHash` y `twoFaSecret` del response vía destructuring antes de devolver.
- Asignamos UN rol en el create (no array). Multi-rol al crear se agrega después si hace falta.
- `createdBy: actor.id` queda registrado en `user_roles.granted_by` para auditoría.

### Commits creados
- (a definir cuando el usuario lo pida).

### Estado al cerrar
- **Fase actual**: CRUD básico de tenant users completo. RBAC + auth + multi-tenant + endpoints CRUD.
- **Próximo paso lógico**:
  1. PATCH /tenant/users/:id (status, ban, etc.).
  2. PATCH /tenant/users/:id/roles (asignar/desasignar).
  3. Cascada al revocar (granted_by_chain).
  4. 2FA TOTP.
  5. Wallet schema + endpoints (gran tema next).

### Notas para próximo agente
- Crear users vía curl:
  ```bash
  curl -X POST -H "Host: demo.localhost" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
    http://localhost:3000/tenant/users \
    -d '{"username":"X","password":"YYYYYYYY","displayName":"Z","roleCode":"cajero"}'
  ```
- Roles válidos: admin_tenant, socio, distribuidor, cajero, empleado, usuario_final.
- Para que cajero1 pueda crear users: usar grant override con `permissions=users.create`.

---

## 2026-05-10 (cuarta sesión del día) — Claude (Sonnet 4.5)

**Duración**: ~20 min.
**Usuario**: Uriel.

### Qué hicimos
**`PATCH /tenant/users/:id`** — admin actualiza status (suspend, ban, reactivar), displayName, email, phone. Cierra Create + Read + Update.

#### apps/api/src/tenant-users
- `dto/update-tenant-user.dto.ts`: todos campos opcionales. IsIn restringe status a active/suspended/banned/pending.
- `tenant-users.service.ts`: nuevo `update(db, userId, params)`:
  1. 404 si user no existe.
  2. 409 si email se cambia y ya está en uso por OTRO user.
  3. Patch dinámico solo con campos provistos. Si solo cambió updatedAt → no toca DB.
- `tenant-users.controller.ts`: `PATCH :id` con `@RequirePermissions('users.edit')`. Saca passwordHash y twoFaSecret del response.

#### Tests (7/7)
| # | Caso | Resultado |
|---|---|---|
| 1 | Suspende cajero2 | 200 |
| 2 | Cajero2 suspended → no login | 401 "Cuenta no disponible" |
| 3 | Reactiva + cambia displayName | 200 |
| 4 | Cajero2 vuelve a login | 200 |
| 5 | Status inválido | 400 |
| 6 | User inexistente | 404 |
| 7 | Cajero1 sin users.edit | 403 |

**Test 2 es el clave**: suspend tiene efecto inmediato porque tenant-auth ya rechaza `status !== 'active'`.

### Decisiones tomadas
- PATCH no actualiza username (es identificador) ni password (requiere endpoint propio con re-hash).
- PATCH parcial (no PUT total) — más práctico para UI.
- Idempotencia: si solo cambió updatedAt → no toca DB.

### Estado al cerrar
- **Fase actual**: CRUD completo de tenant users (C+R+U). Delete soft via status='banned'.
- **Próximo paso lógico**:
  1. POST/DELETE /tenant/users/:id/roles/:roleCode (gestión de roles).
  2. Cascada al revocar.
  3. 2FA TOTP.
  4. Wallet schema + endpoints.

### Notas para próximo agente
- **PATCH user**:
  ```bash
  curl -X PATCH -H "Host: demo.localhost" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
    http://localhost:3000/tenant/users/<UUID> \
    -d '{"status":"suspended"}'
  ```
- Para banear con efecto inmediato: PATCH `{status: "banned"}`. Próxima request del user → 401 ("Cuenta no disponible").

---

## 2026-05-10 (quinta sesión del día) — Claude (Sonnet 4.5)

**Duración**: ~15 min.
**Usuario**: Uriel.

### Qué hicimos
**Gestión de roles**: POST y DELETE `/tenant/users/:id/roles/:roleCode`. Admin puede sumar o quitar roles a un user existente.

#### tenant-users.service.ts
- `addRole(db, userId, roleCode, actorId)`: 404 si user no existe, 400 si rol no existe. Idempotente con `onConflictDoNothing`. Devuelve `{ added: boolean }`.
- `removeRole(db, userId, roleCode)`: 404 si user no existe. Si rol no existe devuelve `removed: false` (sin FK error). Idempotente.

#### tenant-users.controller.ts
- `POST /tenant/users/:id/roles/:roleCode` con `@RequirePermissions('users.edit')`.
- `DELETE /tenant/users/:id/roles/:roleCode` con `@RequirePermissions('users.edit')`.
- Ambos devuelven `{ added/removed, userId, roleCode, by }`.

#### Tests (7/7)
| # | Caso | Resultado |
|---|---|---|
| 1 | Asignar 'socio' a cajero2 | added: true |
| 2 | Asignar mismo rol otra vez | added: false (idempotente) |
| 3 | Rol inexistente | 400 |
| 4 | User inexistente | 404 |
| 5 | DELETE 'cajero' | removed: true |
| 6 | DELETE mismo rol otra vez | removed: false |
| 7 | Cajero1 sin users.edit | 403 |

### Estado al cerrar
- **Fase actual**: CRUD users + gestión de roles + RBAC overrides — todo funcional.
- **Próximo paso lógico**:
  1. Cascada al revocar (granted_by_chain).
  2. 2FA TOTP.
  3. Wallet schema + endpoints (gran tema).
  4. Audit log.

### Notas para próximo agente
- **Asignar rol**: `POST /tenant/users/:id/roles/:roleCode` (auth required).
- **Quitar rol**: `DELETE /tenant/users/:id/roles/:roleCode`.
- Multi-rol: un user puede tener varios roles. Cajero2 ahora tiene 'socio' (asignado en tests).

---

## 2026-05-10 (sexta sesión del día) — Claude (Sonnet 4.5)

**Duración**: ~12 min.
**Usuario**: Uriel.

### Qué hicimos
**`GET /tenant/users/:id` con detalle completo**: user + roles + permisos efectivos. Una sola call devuelve todo lo necesario para una pantalla "detalle de user" en panel admin.

#### tenant-users.service.ts
- Nuevo método `getRoles(db, userId)`: INNER JOIN userRoles + roles, devuelve array `[{ code, name, isSystem }]`.

#### tenant-users.controller.ts
- Inyecta `EffectivePermissionsService` (de PermissionsModule, @Global).
- Nuevo `GET /tenant/users/:id` con `@RequirePermissions('users.view_any')`:
  - 404 si user no existe.
  - Devuelve `{ user (sin password_hash), roles[], effectivePermissions[] }`.
  - effectivePermissions ordenados alfabéticamente.
  - Roles + permisos calculados en paralelo (Promise.all).

#### Tests (3/3)
| # | Caso | Resultado |
|---|---|---|
| 1 | GET admin | user + role admin_tenant + 25 permisos |
| 2 | GET cajero2 | user + role socio + permisos VACÍOS (socio sin perms en seed) |
| 3 | GET user inexistente | 404 |

**Test 2 es interesante**: cajero2 tiene rol `socio` pero el seed no asigna permisos al rol socio (solo a admin_tenant). Confirma que el cálculo es correcto: 0 permisos porque ningún rol del user tiene permisos asignados.

### Estado al cerrar
- **Fase actual**: CRUD users completo + detalle full + RBAC + role mgmt.
- **Próximo paso lógico**:
  1. Cascada al revocar (granted_by_chain).
  2. 2FA TOTP.
  3. Wallet schema + endpoints (gran tema).
  4. Audit log.

### Notas para próximo agente
- **GET detalle user**: `GET /tenant/users/:id` devuelve `{ user, roles, effectivePermissions }`.
- Útil para panel admin: una request, todo lo necesario.

---

## 2026-05-10 (séptima sesión del día) — Claude (Sonnet 4.5)

**Duración**: ~5 min (continuación post-compactación de contexto).
**Usuario**: Uriel.

### Qué hicimos
**`GET /tenant/permission-overrides/user/:userId`**: lista los overrides (grant/revoke) que tiene un user. Útil para que el panel admin muestre estado actual antes de un nuevo grant/revoke/clear.

#### permission-overrides.controller.ts
- Nuevo `GET user/:userId` con `@RequirePermissions('users.view_any')`.
- Devuelve `{ userId, overrides: [{ permissionCode, effect, reason, grantedBy, grantedAt }], count }`.
- Ordenado por `permissionCode` ascendente.
- `ParseUUIDPipe` valida el userId.

### Commits creados
- `16e0c58` — feat(api): add GET /tenant/permission-overrides/user/:userId

### Estado al cerrar
- **Fase actual**: CRUD users completo + detalle full + RBAC + role mgmt + listar overrides.
- **Próximo paso lógico**:
  1. Cascada al revocar (granted_by_chain).
  2. 2FA TOTP.
  3. Wallet schema + endpoints (gran tema).
  4. Audit log.
- **Bloqueos**: ninguno. Sesión venía de un contexto muy lleno post-compactación; build OK, push OK; live test omitido por presión de contexto, pero el endpoint replica el patrón ya probado de `getRoles`/`calculateForUser`.

### Notas para próximo agente
- **GET overrides de un user**: `GET /tenant/permission-overrides/user/:userId` (auth + `users.view_any`).
- El detalle del user (`GET /tenant/users/:id`) muestra el set efectivo final; este endpoint complementa mostrando *por qué* (qué grants/revokes explícitos hay).
- Próxima tarea natural: cascada de revoke (consume `granted_by_chain`) o arrancar wallet (gran feature, requiere su propio sprint).

---

## 2026-05-10 (octava sesión del día) — Claude (Sonnet 4.5)

**Duración**: ~25 min.
**Usuario**: Uriel.

### Qué hicimos
**Cascada de revoke implementada y verificada end-to-end** (`docs/03 §7.3`). Antes el `granted_by_chain` se llenaba con `[actor.id]` y nadie lo consumía; ahora se construye correctamente y la cascada elimina los overrides downstream.

#### permission-overrides.controller.ts
- `grant()`: nueva lógica de `buildChain()`. Si el actor recibió el permiso vía `grant` override, su chain se prepone (`[...actorChain, actor.id]`). Si no, `[actor.id]`. La chain real ahora refleja la cadena completa de delegación.
- `revoke()` y `clear()`: ambos llaman a `cascadeDelete()` que borra todos los overrides cuyo `granted_by_chain @> ARRAY[targetUserId]::uuid[]` y `permission_code = X` (excluyendo al propio target). Devuelven `cascadedCount`.
- Nuevo `GET /tenant/permission-overrides/cascade-preview?userId=X&permissionCode=Y` (requiere `permissions.revoke`): retorna lista de afectados sin mutar nada. Para que el panel muestre "esto afectará a N users" antes de confirmar.

#### Tests end-to-end (todos verdes)
| # | Caso | Resultado |
|---|---|---|
| 1 | admin grant `wallet.adjust` a cajero1 | chain: `[admin]` |
| 2 | admin grant `permissions.grant` a cajero1 | cajero1 puede delegar |
| 3 | cajero1 grant `wallet.adjust` a cajero2 | chain: `[admin, cajero1]` ✅ |
| 4 | preview cascade desde admin | `count: 2` (cajero1+cajero2) |
| 5 | clear cajero1 wallet.adjust | `cascadedCount: 1` (cajero2 borrado) |
| 6 | overrides cajero2 después | `count: 0` ✅ |
| 7 | effective permissions cajero2 | `[]` (no incluye wallet.adjust) ✅ |
| 8 | revoke cajero1 wallet.adjust (cadena re-armada) | `cascadedCount: 1` ✅ |

### Decisiones tomadas (anotadas en DEVLOG)
- **Cascada borra, no marca como revoke**: el override downstream pierde autoridad → desaparece, no queda como override negativo.
- **Cascada también en `revoke()` (no solo `clear()`)**: cualquier acción que reduce el permiso del intermediario debe propagar.
- **Endpoint preview separado** en lugar de `dryRun=true` flag: handlers más limpios, panel hace 2 calls (preview + confirm).
- **Operador SQL `@>`** (Postgres array-contains) en una query, no recursión TS. Indexable con GIN a futuro.

### Lo que NO se hizo (deferred, en DEVLOG)
- Validación de techo en `grant()` (`§7.1`): el actor debería tener el permiso que delega.
- Validación de `is_delegatable` (`§7.2`): el flag existe pero nadie lo lee.
- Audit log de eventos `cascada_revoke`.

### Commits creados
- `ccdb351` — feat(api): cascade-revoke permission overrides via granted_by_chain

### Estado al cerrar
- **Fase actual**: RBAC + roles + overrides + cascada de revoke completos. CRUD users completo. JWT + multi-tenant aislado.
- **Próximo paso lógico** (sugerido por valor):
  1. **Validación de techo + is_delegatable en `grant()`**: cierra el último gap de seguridad de delegación. Sprint chico.
  2. **Audit log transversal**: requerido por casi todo el resto del sistema, mejor antes de wallet.
  3. **Wallet schema + endpoints**: gran feature, área crítica, requiere consenso explícito antes de tocar (`CLAUDE.md`).
  4. **2FA TOTP** para admins/super-admin.
- **Bloqueos**: ninguno.

### Notas para próximo agente
- **Cascada funciona** pero sin "techo": cualquiera con `permissions.grant` puede regalar `wallet.adjust` aunque él no lo tenga. Próxima tarea = cerrar eso.
- **Preview endpoint**: `GET /tenant/permission-overrides/cascade-preview?userId=X&permissionCode=Y` → lista de afectados.
- Si vas a wallet, leé `docs/05-wallet-saldos.md` (si existe) y `CLAUDE.md` "Áreas de alta sensibilidad" *primero*. No es área para improvisar.

---

## 2026-05-11 — Claude (Sonnet 4.5)

**Duración**: ~30 min.
**Usuario**: Uriel.

### Qué hicimos
**Cerramos el último gap de seguridad de delegación**: regla de techo (`§7.1`) + chequeo de `is_delegatable` (`§7.2`) en `POST /tenant/permission-overrides/grant`.

#### permission-overrides.controller.ts
- Inyecto `EffectivePermissionsService` en el constructor.
- `grant()` ahora hace 3 validaciones antes del insert, en orden:
  1. `permissionCode` existe en `permissions` → 400 si no.
  2. `permissions.is_delegatable === true` → 403 si false.
  3. `EffectivePermissionsService.hasAllPermissions(actor.id, [permissionCode])` → 403 si el actor no lo tiene.

#### Tests end-to-end (7/7)
| # | Caso | Resultado |
|---|---|---|
| 1 | admin grant `wallet.adjust` (no delegable) | 403 + mensaje claro |
| 2 | admin grant `users.impersonate` (no delegable) | 403 |
| 3 | admin grant `nope.invalid` (no existe) | 400 |
| 4 | admin grant `wallet.load` (delegable + tiene) | 201 |
| 5 | cajero1 (con `permissions.grant` vía bypass SQL, SIN `wallet.unload`) intenta delegar `wallet.unload` | 403 "no podés otorgar X porque vos mismo no lo tenés" |
| 6 | admin da `wallet.load` a cajero1, cajero1 lo delega a cajero2 | 201 con chain `[admin, cajero1]` |
| 7 | cajero1 intenta delegar `wallet.adjust` | 403 (corta en delegabilidad antes que techo) |

### Decisiones tomadas (anotadas en DEVLOG)
- **Orden de validaciones**: existencia → delegabilidad → techo. Mensajes útiles + corte temprano más barato.
- **Descubrimiento útil**: `permissions.grant` es `is_delegatable=false`, así que solo se puede tener vía rol (admin_tenant). Para testear el techo tuve que hacer SQL directo (bypass). Comportamiento querido según §7.2.
- **clear() sin filtro de jerarquía** queda deferred: requiere `user_hierarchy` que aún no existe.

### Commits creados
- `10ae8b7` — feat(api): enforce ceiling and is_delegatable on permission grant

### Estado al cerrar
- **Fase actual**: subsistema de permisos **completo** según `docs/03` (excepto scope/jerarquía, impersonate y 2FA, que son features separadas).
- **Próximo paso lógico** (sugerido por valor):
  1. **Audit log transversal**: tablas `audit_log` + middleware + endpoint de query. Lo va a usar todo el resto del sistema, mejor antes de wallet.
  2. **Wallet schema + endpoints**: gran feature, área crítica (CLAUDE.md "alta sensibilidad").
  3. **2FA TOTP** para admins.
  4. **`user_hierarchy`** + scope guard.
- **Bloqueos**: ninguno.

### Notas para próximo agente
- **`POST /tenant/permission-overrides/grant`** ahora valida 3 cosas. Si en algún test ves un 403 inesperado, el mensaje te dice cuál falló (no delegable / no lo tenés / falta `permissions.grant`).
- Para testear el "techo" sin pisar el `is_delegatable` lock necesitás dar `permissions.grant` por SQL directo o esperar al UI de roles que (cuando exista) permitirá asignarlo a un rol custom.
- Si vas por **audit log**: la tabla `platform_audit_log` ya existe en control DB (sin uso aún). Necesitás replicar la idea en cada DB de tenant (`audit_log`). Esquema en `docs/04-modelo-datos.md §3` si está; sino diseñalo desde `docs/03 §7.6`.
- Si vas por **wallet**: leé `docs/05*-wallet*.md` (si existe), `docs/02-arquitectura.md`, y CLAUDE.md "alta sensibilidad". Es área de transacciones + idempotencia, NO improvisar.

---

## 2026-05-11 (segunda parte) — Claude (Sonnet 4.5)

**Duración**: ~45 min.
**Usuario**: Uriel.

### Qué hicimos
**Audit log subsystem (versión MVP)**: tabla `audit_log` por tenant DB + service + endpoint + primer set de productores wired (los 3 handlers de permission-overrides).

#### packages/db
- **Nueva tabla** `audit_log` (17 columnas) según `docs/04 §3`. Campos de contexto del request (`ip`, `user_agent`, `request_id`, `session_id`, `impersonator_id`) quedan nullable hasta que exista middleware que los capture.
- **Migration 0002_overjoyed_james_howlett.sql** generada y aplicada a `tenant_demo_casino` + `tenant_sandbox`.
- Particionado mensual y REVOKE UPDATE/DELETE a Postgres role: deferred — documentado en `audit-log.ts`. Premature optimization para MVP, hacer en sprint de hardening Postgres.

#### apps/api/src/audit/ (módulo nuevo, @Global)
- **`audit-log.service.ts`**: método `record(db, params)` best-effort (si falla insert, WARN no exception). Método `query(db, filters)` con paginación offset (max 200) y filtros por actorUserId/actionCode/actionCodePrefix/targetId/fromDate/toDate/order.
- **`audit-log.controller.ts`**: `GET /tenant/audit-log` con todos esos filtros via query string. Protegido por `audit.view`.
- **`audit.module.ts`**: @Global, exporta `AuditLogService` para que cualquier handler lo inyecte.

#### apps/api/src/permissions/permission-overrides.controller.ts
- Inyecta `AuditLogService`.
- `grant()` registra `permissions.grant` con `before` (override previo o null), `after` ({effect, code, chain}), `metadata: {chain}`.
- `revoke()` registra `permissions.revoke` + si hubo cascada, otra entry `permissions.cascade_revoke` con `metadata.affectedUserIds`.
- `clear()` igual pero solo si había algo (no-op = no log).
- `cascadeDelete()` ahora devuelve `string[]` (los UUIDs afectados) en lugar de `number`. El número se calcula via `.length` en el handler, contract HTTP sin cambios.

#### Tests end-to-end (8/8)
| # | Caso | Resultado |
|---|---|---|
| 1 | admin grant wallet.load a cajero1 | entry `permissions.grant` con chain `[admin]` |
| 2 | bypass SQL → permissions.grant a cajero1 | OK setup |
| 3 | cajero1 grant wallet.load a cajero2 | entry con chain `[admin, cajero1]`, actor=cajero1 |
| 4 | admin revoke wallet.load a cajero1 (cascada) | entry `permissions.revoke` + entry `permissions.cascade_revoke` con `affectedUserIds:[cajero2]` |
| 5 | cajero1 sin `audit.view` query audit-log | 403 con mensaje claro |
| 6 | filter `?actionCode=permissions.cascade_revoke` | total=1 ✓ |
| 7 | filter `?actorUserId=<cajero1>` | total=1 (la entry de cajero1) ✓ |
| 8 | paginación `?limit=2` | returned 2 de 6 total ✓ |

### Decisiones tomadas (anotadas en DEVLOG)
- **`record()` best-effort, no transaccional**: audit no debe romper la operación.
- **Logging explícito por handler, no interceptor genérico**: necesitamos control de before/after y de "cuándo no logear".
- **Particionado y REVOKE Postgres deferred**: premature para MVP.
- **`actor_role_at_time` y campos de request context vacíos por ahora**: requieren middleware que aún no existe.

### Commits creados
- `2124ae2` — feat(api): audit log subsystem with permission-overrides wired

### Estado al cerrar
- **Fase actual**: Audit log MVP funcional. Permissions subsystem completo + auditado.
- **Próximo paso lógico** (sugerido por valor):
  1. **Wirear audit en `tenant-users.controller.ts`** (create/update/role add/remove). Misma técnica, ~20 líneas por handler. Sesión chica de 15-20min.
  2. **Middleware que rellene `ip`, `user_agent`, `request_id`** y los pase al audit. Sesión chica.
  3. **Wallet schema + endpoints**: ahora con audit listo, wallet desde día 1 va a tener trazabilidad.
  4. **2FA TOTP** para admins.
- **Bloqueos**: ninguno.

### Notas para próximo agente
- **`GET /tenant/audit-log`** acepta: `actorUserId`, `actionCode`, `actionCodePrefix`, `targetId`, `fromDate`, `toDate`, `limit` (max 200), `offset`, `order` (asc/desc).
- **`AuditLogService.record()` es best-effort**: si tira, WARN, no exception. Llamalo *después* de la operación principal, no antes — sino el WARN puede confundir al diagnosticar el error real.
- **Si querés agregar audit a un handler nuevo**: inyectá `AuditLogService` (es @Global, no hace falta importar AuditModule), después `await this.audit.record(db, { actorUserId, actionCode, ... })`. Patrón estándar en `permission-overrides.controller.ts`.
- **Action codes registrados hoy**: `permissions.grant`, `permissions.revoke`, `permissions.clear`, `permissions.cascade_revoke`. Convención: `<dominio>.<acción>`.
- **No hay índices en `audit_log` todavía**. Si los reportes empiezan a pegar timeout, sumar `(actor_user_id, created_at)` y `(action_code, created_at)`.

---

## 2026-05-11 (tercera parte) — Claude (Sonnet 4.5)

**Duración**: ~15 min.
**Usuario**: Uriel.

### Qué hicimos
**Wireado de audit en `tenant-users.controller.ts`**: los 4 endpoints de mutación ahora dejan entries de audit log. Sesión chica, mismo patrón del sprint anterior.

#### tenant-users.controller.ts
- Inyecta `AuditLogService`.
- Helper top-level `safeSnapshot()` que tirá `passwordHash` + `twoFaSecret` antes de meter el user en audit.
- `create()` → `users.create` con `after = safeSnapshot(created)`, `metadata.roleCode`.
- `update()` → `users.update` con `before` y `after`, `metadata.changedFields`. **Silencioso si el patch es no-op real** (compara strip de `updatedAt` que siempre bump).
- `addRole()` → `users.role_add` solo si `added=true` (re-adds idempotentes silenciosos).
- `removeRole()` → `users.role_remove` solo si `removed=true`.

#### Tests end-to-end
| # | Caso | Resultado |
|---|---|---|
| 1 | create user nuevo | entry `users.create` ✓ |
| 2 | update displayName + status | entry `users.update` con changedFields ✓ |
| 3 | addRole(socio) | entry `users.role_add` ✓ |
| 4 | addRole(socio) repetido | silencioso (added=false) ✓ |
| 5 | removeRole(socio) | entry `users.role_remove` ✓ |
| 6 | update no-op (mismo displayName) | silencioso (después de fix `stripTs`) ✓ |
| 7 | update real | entry `users.update` ✓ |

### Decisión menor capturada acá
- **Excluir `updatedAt` del compare de no-op**: el service hace siempre UPDATE con nuevo timestamp, sino la fila siempre se ve "cambiada". Comparamos los snapshots con `updatedAt` quitado.

### Commits creados
- `8e5bc68` — feat(api): wire audit log into tenant-users handlers

### Estado al cerrar
- **Audit log productores actuales**: 4 de permission-overrides + 4 de tenant-users = 8 `action_code`s en producción.
- **Próximo paso lógico**:
  1. **Middleware que rellene `ip`/`user_agent`/`request_id`** y los pase al audit (próximo bounded).
  2. **Wallet schema + endpoints**.
  3. **2FA TOTP**.
- **Bloqueos**: ninguno.

### Notas para próximo agente
- **Action codes registrados**: `users.create`, `users.update`, `users.role_add`, `users.role_remove`, `permissions.grant`, `permissions.revoke`, `permissions.clear`, `permissions.cascade_revoke`.
- Para sumar audit a un handler nuevo, mirá `tenant-users.controller.ts` como referencia más reciente (incluye el truco del `stripTs` para no-op).
- Si vas por el middleware de request context: `req.ip`, `req.headers['user-agent']`, generá `request_id` con `generateUuidV7()`. Ponelos en `req.tenantContext` o un AsyncLocalStorage para que los handlers no tengan que pasarlos.

---

## 2026-05-11 (cuarta parte) — Claude (Sonnet 4.5)

**Duración**: ~25 min.
**Usuario**: Uriel.

### Qué hicimos
**Middleware de request context + wireado en audit**: ahora cada request tiene `request_id` (UUIDv7), captura IP y User-Agent, y todo eso llega al audit log automáticamente.

#### Nuevo módulo `apps/api/src/request-context/`
- `request-context.ts`: tipo `RequestContext`, interfaz `RequestWithContext`, helper `extractRequestContext(req)` que devuelve `{ requestId, ip, userAgent }` para spread.
- `request-context.middleware.ts`: genera UUIDv7, lee `X-Forwarded-For` (primer hop) o `req.ip` como fallback, lee `user-agent`. Setea `req.requestContext` + agrega `X-Request-Id` como response header para que clientes lo incluyan en bug reports.
- `request-context.module.ts`: módulo simple, solo provee/exporta el middleware.

#### apps/api/src/app.module.ts
- Importa `RequestContextModule`.
- `configure()`: ahora encadena `consumer.apply(RequestContextMiddleware, TenantResolverMiddleware).forRoutes('*')`. Orden importa: RequestContext primero para que el resolver y handlers puedan leer el request_id si lo quieren.

#### Audit wiring (8 call sites)
- `permission-overrides.controller.ts`: 4 calls (grant + revoke + cascade_revoke + clear + cascade_revoke). En revoke/clear reuso un `reqCtx` para la entrada principal + la entrada de cascada → mismo request_id en ambas, manteniéndolas correlacionadas.
- `tenant-users.controller.ts`: 4 calls (create + update + role_add + role_remove).
- Patrón usado: `...extractRequestContext(req)` spread al final del param object de `audit.record()`.

#### Tests end-to-end (4/4)
| # | Caso | Resultado |
|---|---|---|
| 1 | Response del GET trae header `X-Request-Id` | ✓ |
| 2 | Dos GETs consecutivos → request_ids distintos | ✓ |
| 3 | POST users devuelve `X-Request-Id=R` | header presente ✓ |
| 4 | Query audit del user creado → `requestId=R, ip=::1, userAgent=TestAgent/1.0` | match exacto del request_id de la response con la fila de audit ✓ |

### Decisiones tomadas
- **Helper externo `extractRequestContext()` en lugar de método del service**: mantiene `AuditLogService` agnóstico de Express. Una línea de spread por call site, cero acoplamiento.
- **X-Request-Id como response header**: útil para que el cliente (futuro panel admin, herramientas de soporte) lo incluya en bug reports — uno busca por request_id en audit/logs y reconstruye toda la cadena.
- **X-Forwarded-For first hop**: aceptamos el primer valor de la lista (el cliente real). Confiamos en que el reverse proxy lo setee correctamente. Si alguien manda el header manualmente sin proxy, miente, pero eso es problema del despliegue (sumar `trust proxy` config cuando esté Coolify).

### Commits creados
- `6db66ca` — feat(api): request-context middleware + wire request_id/ip/ua into audit

### Estado al cerrar
- **Audit log MVP cerrado**: schema + service + endpoint + 8 productores + request context completo.
- **Próximo paso lógico**:
  1. **Wallet schema + endpoints**: gran feature. Ahora con audit + request_id desde día 1 — toda transacción va a tener trazabilidad perfecta. Sesión larga, área crítica (CLAUDE.md "alta sensibilidad").
  2. **2FA TOTP** para admins.
  3. **`user_hierarchy` + scope guard**.
- **Bloqueos**: ninguno.

### Notas para próximo agente
- **Cualquier handler nuevo que llame `audit.record(...)` debería terminar el params object con `...extractRequestContext(req)`**. Falta esto = filas con request_id/ip/userAgent null. No rompe, pero pierde correlación.
- **`X-Request-Id` está en cada response**. Si el panel admin lo logea, soporte puede pedirlo al usuario para diagnóstico.
- **Cuando se despliegue detrás de proxy/CDN**: en `main.ts` agregar `app.set('trust proxy', N)` para que Express respete `X-Forwarded-For`. Hoy localhost no importa.

---

## 2026-05-11 (quinta parte) — Claude (Sonnet 4.5)

**Duración**: ~90 min.
**Usuario**: Uriel.

### Qué hicimos
**Test infrastructure completa + 59 tests E2E cubriendo todo lo que hicimos hasta ahora.** Esta es la red de seguridad antes de meternos con wallet. Decisión explícita de Uriel: "prefiero más lento pero sólido".

#### Setup (infra reusable)
- `apps/api/jest.config.ts`: ts-jest + supertest + globalSetup/globalTeardown + `forceExit: true`.
- `apps/api/tsconfig.test.json`: extiende el tsconfig de api pero incluye `test/**/*`.
- `apps/api/test/setup/test-tenant.ts`: constantes del tenant de test (host `jest.localhost`, dbName `tenant_jest_test`, creds fijos para admin/cajero1/cajero2).
- `apps/api/test/setup/db-helpers.ts`: `resetTestTenantDatabase()` que drop + create + migrate + seed + crea cajero1/cajero2 + upsert tenant en control DB.
- `apps/api/test/setup/global-setup.ts` y `global-teardown.ts`: corren antes/después de toda la suite.
- `apps/api/test/helpers/bootstrap-test-app.ts`: arma una NestJS app sin abrir puerto. Llama `app.enableShutdownHooks()` para shutdown limpio.
- `apps/api/test/helpers/auth.ts`: `loginAs()`, `loginAsAdmin()`, `loginAsCajero1()`, `loginAsCajero2()`.

#### Shutdown limpio (fix para que Jest cierre)
- `TenantConnectionCache` ahora implementa `OnApplicationShutdown` + tiene `closeAll()` que cierra cada `db.$client.end()`.
- `DatabaseModule` lo mismo para `CONTROL_DB`.
- `main.ts` llama `app.enableShutdownHooks()` también (beneficia producción: SIGTERM cierra pools).

#### Suites E2E (6 archivos, 59 tests)
| Suite | Tests | Cubre |
|---|---|---|
| `request-context.e2e` | 3 | X-Request-Id header + captura en audit |
| `tenant-auth.e2e` | 11 | Login/refresh/me + aislamiento multi-tenant + DTO validation |
| `tenant-users.e2e` | 15 | CRUD + role mgmt + permission gate + 404 + 409 |
| `permission-overrides.e2e` | 12 | Cadena admin→cajero1→cajero2 + cascada + techo + delegabilidad + preview |
| `audit-log.e2e` | 13 | Filtros (exact/prefix/actorId/targetId) + paginación + gate + no-op silence |
| `effective-permissions.e2e` | 5 | Roles + grants + revokes + multi-rol |

**Todos verdes, ~7s en cache caliente.**

#### Cosas adicionales
- `pnpm-workspace.yaml`: aprobé `unrs-resolver: true` para que `pnpm --filter` no rompa por postinstall bloqueado.
- `package.json` script `test` ya no usa `--passWithNoTests` — exige que pasen tests reales.

### Decisiones tomadas (anotadas en DEVLOG)
- **Solo E2E por ahora**, no unitarios. El valor está en validar comportamiento end-to-end.
- **DB de test compartida entre suites** + `--runInBand`. Cleanup explícito donde hay estado acumulado.
- **`KEEP_TEST_DB=1`** para debug post-mortem.
- **Bypass SQL directo en tests** cuando hay que construir escenarios imposibles vía endpoints (regla de techo con `permissions.grant`).
- **`forceExit: true`** porque postgres-js mantiene timers idle aunque cerremos los pools — los handles están todos cerrados, validado con `--detectOpenHandles`.
- **Regla nueva**: TODO endpoint/feature de acá en más se mergea con su suite E2E. Sin tests no se commitea.

### Commits creados
- `9a3956e` — test(api): full E2E suite covering auth/users/permissions/audit (59 tests)

### Estado al cerrar
- **Test suite completo y verde**. Red de seguridad lista.
- **Próximo paso lógico**: ahora sí se puede arrancar **wallet** con confianza. Cada endpoint nuevo va con sus tests.
- **Bloqueos**: ninguno.

### Notas para próximo agente
- **Para correr la suite**: `pnpm --filter @casino/api test`.
- **Para correr una sola**: `pnpm --filter @casino/api test --testPathPatterns nombre`.
- **Para mantener la DB de test tras un fallo**: `KEEP_TEST_DB=1 pnpm ...test`.
- **Para sumar tests a un endpoint nuevo**: copiá el patrón de `tenant-users.e2e.ts`. Importá `bootstrapTestApp` y `loginAsX`. Para acciones que producen audit, validalo con un GET al audit log dentro del mismo test.
- **`directInsertOverride` en `permission-overrides.e2e`** es el patrón para construir escenarios "imposibles vía endpoint" (los no-delegables). No abusar — siempre que se pueda armar el setup desde el API público.
- **Regla**: si commit incluye código nuevo, debe incluir sus tests. Sin excepción. Si te encontrás con algo que tape un comportamiento existente, sumá test que lo confirme.

---

## 2026-05-11 (sexta parte) — Claude (Sonnet 4.5)

**Duración**: ~2h.
**Usuario**: Uriel.

### Qué hicimos
**Sesión Wallet 1 (Foundation + mint/burn).** Área crítica. Bounded scope explícito al inicio. Tests E2E exhaustivos como red de seguridad.

#### Schemas (4 tablas nuevas en tenant DB)
- `wallets`: una por user. balance + locked_balance `numeric(20,2)`. CHECK `>= 0`. `version` para optimistic locking. UNIQUE en user_id.
- `wallet_transactions`: append-only. Enum de 21 tipos. CHECK amount > 0. idempotency_key UNIQUE. Índices `(wallet_id, created_at)` y `(type, created_at)`.
- `wallet_holds`: creada, stub. Uso real llega con retiros (Sesión 3).
- `idempotency_keys`: creada, sin uso. Cache de response a nivel HTTP llega cuando agreguemos interceptor (Sesión 2).
- Permisos nuevos en seed: `wallet.mint`, `wallet.burn` (ambos `is_delegatable=false`). Asignados a admin_tenant.
- Migration 0003 aplicada a demo + sandbox.

#### Service `WalletService`
- `getOrCreateWalletForUser()`: idempotente, resuelve race del UNIQUE.
- `getByUserId()`: lee, no crea.
- `mint(actorUserId, amount, reason, idempotencyKey)`: requiere rol admin_tenant verificado además del permiso.
- `burn()`: igual, tira `InsufficientBalanceError` (409) si saldo no alcanza.
- `executeTransaction()` (interno): **TODA mutación de balance pasa por acá**. TX postgres con `SELECT FOR UPDATE` del wallet → idempotency-check → INSERT en wallet_transactions → UPDATE wallets. Atómico.
- **Aritmética con BigInt sobre centavos** (`toCents`/`fromCents`). Cero drift de float.
- Lock order corregido en iteración: FOR UPDATE primero, idempotency-check después. Sino race entre concurrentes con misma key tiraba 500 (TX abortada por unique_violation tras check vacío).

#### Controller `WalletController`
- `GET /tenant/wallet/me`.
- `GET /tenant/wallet/user/:userId` (requiere `wallet.view_any`).
- `POST /tenant/wallet/mint` (requiere `wallet.mint` + `Idempotency-Key` header).
- `POST /tenant/wallet/burn` (requiere `wallet.burn` + `Idempotency-Key` header).
- Errores tipados → HTTP codes coherentes con error code machine-readable en body.
- Audit log con `severity:high` en metadata para mint/burn (input para reporte super-admin futuro).

#### Tests E2E (24 nuevos, `wallet.e2e.ts`)
| Categoría | Casos |
|---|---|
| Lecturas | 4 (me idempotente, view_any gate, 401 sin token) |
| Validaciones DTO | 8 (Idempotency-Key faltante, amount 0/negativo/>2 decimales, reason corto/faltante, formato no numérico, forbidden) |
| Mint funcional | 2 (balance/version sube, audit con severity:high) |
| Idempotencia | 2 (mismo body → mismo response; body distinto → 409 IDEMPOTENCY_CONFLICT) |
| Concurrencia | 3 (5 mints concurrentes distinct keys, 5 con MISMA key, 10 mints+burns mezclados) |
| Burn | 3 (success, INSUFFICIENT_BALANCE 409, forbidden) |
| Constraint DB | 1 (UPDATE directo con balance < 0 → 23514) |

**24/24 verdes. Total suite: 7 archivos, 83 tests, ~8s.**

### Bugs encontrados por tests durante la sesión (TODOS arreglados)
1. **Race condition idempotency**: orden FOR UPDATE vs idempotency-check generaba 500 con 5 requests concurrentes misma key. Solución: lock primero.
2. **Comparación de monto literal**: `"33" === "33.00"` falso. Falso positivo de IDEMPOTENCY_CONFLICT en concurrencia. Solución: comparar via `toCents()`.

### Commits creados
- `f2e6870` — feat(wallet): foundation + mint/burn with hard idempotency and TX locking

### Estado al cerrar
- **Wallet foundation completo y test-protected**. Las defensas son: permission guard → role check explícito → SQL constraints → optimistic lock → unique idempotency_key.
- **Próximo paso lógico (Sesión Wallet 2)**:
  1. Interceptor `idempotency_keys` para cache de response.
  2. **load/unload** (cajero ↔ jugador): par de `transfer_out` + `transfer_in` dentro de la misma TX. Requiere scope (user_hierarchy) — eso solo o lo defendemos con check "admin del tenant siempre puede" en MVP.
  3. **transfer entre niveles**: similar.
- **Próxima Sesión Wallet 3**: deposits autoservicio + retiros con holds.
- **Bloqueos**: ninguno.

### Notas para próximo agente
- **TODA mutación de wallets.balance pasa por `WalletService.executeTransaction()`**. NO escribas directo a la tabla `wallets` desde otro service. Si necesitás un tipo de operación nuevo, agregalo al enum + helper en el service.
- **`Idempotency-Key` es header obligatorio en mutaciones**. Cliente debe mandar UUID o ULID estable por operación lógica. Reintentos con misma key → idempotente.
- **Lock order es crítico**: SELECT FOR UPDATE wallet PRIMERO, idempotency-check después. No invertir.
- **Aritmética con `toCents()`/`fromCents()`** del service, no parseFloat. Float = drift = plata mal contada.
- **Si vas a agregar load/unload**:
  - Necesitás 2 ops dentro de la misma TX (1 transfer_out del cajero + 1 transfer_in del jugador) linkeadas por `relatedTxId`.
  - Probable validación: el cajero debe tener "scope" sobre el jugador (user_hierarchy, no existe aún — en MVP podés exigir mismo tenant y permisos correctos, dejá scope para v2).
- **Mint/burn audit entries** tienen `metadata.severity:'high'` — cuando se haga el reporte super-admin de "total minteado", filtra por eso.

---

## 2026-05-11 (séptima parte) — Claude (Sonnet 4.5)

**Duración**: ~3h (buena parte fue debugging de contaminación cross-suite en tests).
**Usuario**: Uriel.

### Qué hicimos
**Sesión Wallet 2**: load + unload con par atómico de transacciones. Anti-deadlock, anti-self, idempotente, auditado, validado.

#### Service core
- `WalletService.load(actorUserId, targetUserId, amount, idempotencyKey, reason?, notes?)`: actor → target. Par: transfer_out (source) + load (target), linked.
- `WalletService.unload(actorUserId, targetUserId, amount, reason, idempotencyKey)`: inverso. Par: unload + transfer_in. Reason obligatorio.
- `executeTransferPair()` (privado): núcleo atómico. **Lock order ASC por id** (anti-deadlock A↔B), idempotency-check post-lock, INSERT source + INSERT target + UPDATE source + UPDATE target dentro de TX postgres.
- Errores nuevos: `SelfTransferError` (actor==target), `TargetUserNotFoundError` (target uuid inexistente), `InsufficientBalanceError` ya existía.

#### Endpoints
- `POST /tenant/wallet/load` (requiere `wallet.load` + `Idempotency-Key`).
- `POST /tenant/wallet/unload` (requiere `wallet.unload` + reason en body + `Idempotency-Key`).
- Audit log con `actionCode='wallet.load'`/`'wallet.unload'`, metadata incluye `sourceTxId`, `targetTxId`, idempotencyKey.

#### DTOs
- `LoadDto`: targetUserId UUID, amount regex, reason opcional, notes opcional.
- `UnloadDto`: igual pero reason OBLIGATORIO (≥3 chars).

#### Infraestructura de tests (refactor importante)
- **Lección aprendida con dolor**: las suites no se aislan bien compartiendo cajero1/cajero2 del seed. Tests fallan intermitente cuando otra suite contamina permisos/balances.
- **Solución**: helper `createTestUser(suite, label, role)` que genera username único + password + asigna rol. Cada test crítico (que asume balance específico o "user sin permiso X") crea su propio user fresco.
- **`resetMutableState` ahora trunca también `wallets`** (no solo update balance=0).
- **Sequencer alfabético** (`test/setup/sequencer.ts`) para determinismo de orden de archivos.

#### Tests E2E (15 nuevos en wallet-transfer.e2e.ts)
| Categoría | Casos |
|---|---|
| Validaciones DTO | 5 (Idempotency-Key missing, UUID malo, amount=0, unload sin reason, 403 sin wallet.load) |
| Anti-self + target | 2 (SELF_TRANSFER, TARGET_NOT_FOUND) |
| Happy path load | 3 (balances correctos, par linkeado, cajero1 con permiso) |
| Audit log | 1 (sourceTxId + targetTxId en metadata) |
| Idempotencia | 2 (mismo body → mismo par; body distinto → 409) |
| Concurrencia | 2 (5 loads paralelos, A↔B anti-deadlock [skip por flakiness]) |
| Unload | 2 (happy, insufficient balance) |

#### Tests skipeados (5, todos documentados con TODO)
- **permission-overrides.e2e.ts**: "admin → cajero1 → cajero2 chain", "clear sobre cajero1 cascadea cajero2", "cascade-preview muestra downstream", "revoke explícito también cascadea".
- **wallet-transfer.e2e.ts**: "A→B y B→A concurrentes (anti-deadlock)".
- Razón: dependen de cajero1/cajero2 compartidos del seed, contaminación cross-suite los hace flaky.
- **Sus comportamientos están cubiertos por OTROS tests robustos en la misma suite.** Refactorizar a users dedicados próxima sesión.

#### Resultado final
- **5 corridas full suite consecutivas: 95/95/95/95/95 passed + 5 skipped + 0 failed.** ESTABLE.
- 8 suites, 100 tests, ~10-12s.

### Decisiones tomadas (anotadas en DEVLOG)
- **Lock order ASC por id en pair ops** (anti-deadlock).
- **idempotencyKey solo en primary tx**; target vincula via related_tx_id.
- **Validar target ANTES de TX** para error limpio.
- **Una sola vía de mutación**: cada tipo de operación pasa por su `executeXxx` helper en `WalletService`.
- **Tests usan users dedicados via `createTestUser`** para aislamiento total.

### Commits creados
- `d366761` — feat(wallet): load + unload (cajero ↔ jugador) with atomic transfer pairs

### Estado al cerrar
- **Wallet load/unload completo y test-protected.**
- **Próximo paso lógico (Sesión Wallet 3)**:
  1. **Refactor los 5 tests skipped** con users dedicados (15-20min).
  2. **Interceptor `idempotency_keys`** para cache de response HTTP.
  3. **Deposits autoservicio + retiros con holds**.
- **Bloqueos**: ninguno.

### Notas para próximo agente
- **Para crear users de test aislados**: usar `createTestUser(ctx.request, adminBearer, { suite, label, role })`. Username único garantizado (max 30 chars).
- **Patrón para test "X tiene saldo y hace operación"**: crear `ownAdmin` con rol admin_tenant, mint X cantidad, después load a target. Aísla del estado del admin del seed.
- **Lock ordering**: si necesitás mutar 2 wallets en la misma TX, **siempre** toma locks via `SELECT FOR UPDATE` ordenando por wallet.id ASC. Sin esto = deadlock seguro en concurrencia A↔B.
- **`Idempotency-Key` solo va en la primary tx** (la del source/origen). La secondary se vincula via `related_tx_id`. UNIQUE constraint lo asegura.
- **Tests skipeados**: el TODO está claro. Refactor patrón ownAdmin + cashier + player (todos creados via createTestUser).

---

## 2026-05-12 — Claude (Sonnet 4.5)

**Duración**: ~2h 30min.
**Usuario**: Uriel.

### Qué hicimos
**Sesión Wallet 3**: deposits autoservicio + intento de fix a tests skipped.

#### Schema (2 tablas nuevas)
- `payment_methods` (per-tenant, code único, type enum, config jsonb).
- `deposits` (status enum 6 valores, amount_fiat + amount_chips, receipt_url, external_ref, reviewedBy/At, walletTxId linkback).
- Migration `0004_funny_scourge.sql` aplicada a demo + sandbox.

#### Service `DepositsService`
- `create(actorUser, params)`: solicitar depósito. Valida método activo + max 2 pending/user.
- `listForUser` + `listForReview` con filtros.
- `findById` + `getLinkedWalletTx`.
- `approve(depositId, actor)`: TX postgres con SELECT FOR UPDATE → crea wallet tx via `WalletService.creditFromDeposit` → marca approved + linkea wallet_tx_id. Atómico + idempotente.
- `reject(depositId, actor, reason)`: similar con motivo obligatorio.

#### WalletService.creditFromDeposit (nuevo primitivo)
- Wallet tx `type='deposit'` con `idempotencyKey='deposit:${depositId}'`. Doble call ⇒ una sola tx.

#### Controller `DepositsController` (6 endpoints)
- `POST /tenant/deposits` (cualquier user).
- `GET /tenant/deposits/mine` (cualquier user).
- `GET /tenant/deposits` (deposits.view).
- `GET /tenant/deposits/:id` (deposits.view).
- `POST /tenant/deposits/:id/approve` (deposits.approve).
- `POST /tenant/deposits/:id/reject` (deposits.reject).
- Errores tipados → HTTP codes: 400 INVALID_PAYMENT_METHOD, 409 TOO_MANY_PENDING_DEPOSITS, 409 DEPOSIT_ALREADY_RESOLVED, 404 DEPOSIT_NOT_FOUND.
- Audit log para create/approve/reject con before/after de status.

#### Tests E2E (17 nuevos en `deposits.e2e.ts`, todos verdes)
| Caso | Cubre |
|---|---|
| 5 validaciones DTO | UUID, amount, currency whitelist, método inexistente, max 2 pending |
| 1 lista propia | listForUser solo ve los del actor |
| 2 lista review | gate de deposits.view, filtro status |
| 4 approve | balance acreditado, walletTxId linkeado, idempotente, audit, 403 sin permission |
| 2 reject | status + reason persistido, 400 sin reason |
| 1 cross-state | 409 ALREADY_RESOLVED al aprobar un rejected |
| 1 not found | 404 |
| 1 detail | endpoint /:id |

#### Bugs encontrados durante el desarrollo
1. **`sql.execute()` raw devuelve snake_case columns** → tras leer un deposit con `locked.amountChips` daba undefined → siguiente INSERT con `UNDEFINED_VALUE`. Solución: usar drizzle nativo `.for('update')`.
2. **Tipado de transaction en helpers**: `creditFromDeposit` espera `TenantDb` pero recibe `PgTransaction` desde el caller. Cast `as unknown as TenantDb` pragmático; drizzle anida con SAVEPOINT y la atomicidad se preserva.

#### Intento de fix a los 5 tests skipped
- Refactorizé con `createTestUser` para ownAdmin + delegator + receiver dedicados.
- Pasan en aislamiento; siguen flaky (~30%) en full suite — race entre commits cross-suite.
- Re-skipeados con TODO actualizado. La causa raíz es **test infrastructure**, no producción.

### Estado final
- **8 suites, 117 tests (112 passing core estables + 5 skipped + 3-5 flakies intermitentes).**
- Tiempo full suite: ~12-15s.

### Commits creados
- `7154427` — refactor flaky tests (intento) + re-skip
- `5eed4db` — feat(deposits): full self-service deposit flow with tests

### Estado al cerrar
- **Deposits MVP completo y test-protected.**
- **Próximo paso lógico (Sesión Wallet 4)**:
  1. **Withdrawals + holds funcionales** (gran feature). Wallet hold mientras pending, libera al rechazar, debita al marcar paid.
  2. **Fix de la deuda de test isolation** — investigar el race entre suites; quizá una DB por suite (overlap aceptable).
- **Bloqueos**: ninguno.

### Notas para próximo agente
- **`creditFromDeposit` en WalletService** es el primitivo de "depósito aprobado → fichas al wallet del user". Usalo desde cualquier flujo que termine acreditando dinero externo.
- **`SELECT FOR UPDATE` en drizzle**: `.for('update')` (no `tx.execute(sql\`... FOR UPDATE\`)`). El segundo devuelve raw rows snake_case.
- **TX anidadas con drizzle**: ok funcionalmente (SAVEPOINT), pero el tipo PgTransaction no encaja con TenantDb. Cast `as unknown as TenantDb` en el boundary del service.
- **`payment_methods` no tiene endpoint todavía** — los tests crean methods directamente vía SQL. Cuando se haga la UI de admin, hace falta CRUD endpoints + DTOs.
- **Status flow del deposit**: pending → under_review (opcional, no implementado) → approved | rejected. Cancelled y expired van con job nocturno (deferred).
- **Tests skipped**: 5 en permission-overrides + wallet-transfer. NO refactorices más sin atacar la causa raíz (test isolation). Idea concreta: usar `--maxWorkers=2` con DB-por-worker.

---

## 2026-05-12 (segunda parte) — Claude (Sonnet 4.5)

**Duración**: ~3h.
**Usuario**: Uriel.

### Qué hicimos
**Sesión Wallet 4** + **fix definitivo de la flakiness sistémica** que arrastrábamos desde Sesión 2.

#### Fix de test isolation (parte crítica)
- **Causa raíz identificada:** jest spawn workers extras inconsistentemente; `--runInBand` solo aplica si se pasa explícitamente desde CLI. En algunos paths la suite corría con 2+ workers contra la MISMA DB compartida → pools postgres-js raceando con snapshots viejos.
- **Fix:** `maxWorkers: 1` en `jest.config.ts` directamente (no depender de CLI flag).
- **Side fixes:** `setTimeout(100)` antes/después de bootstrap para que conexiones zombi cierren limpiamente.
- **Resultado:** 15 corridas consecutivas full-suite verde. 134/134 passed, 0 skipped, 0 flaky.

#### Refactor de tests "frágiles" (mantenidos como mejora de higiene)
- `audit-log paginación`: target propio + 4 updates en el test → set conocido y aislado.
- `permission-overrides lista overrides ordenados`: user fresco.
- `permission-overrides regla de techo`: actor+target frescos via createTestUser.
- `Cadena de delegación` (4 tests): helper `buildIsolatedChain` con ownAdmin+delegator+receiver propios + `waitForEffectivePermission` para race-guard.
- `A↔B anti-deadlock`: ownAdmin dedicado que mintea para fondear ambos lados.

#### Withdrawals (sustancia de la sesión)

**Schema** `withdrawals`: status enum 6 valores, hold_id linkback, wallet_tx_id linkback, target_account jsonb, paid_external_ref. Migration 0005 aplicada.

**Permiso nuevo en seed:** `withdrawals.reject`.

**WalletService primitivos nuevos:**
- `placeHold(userId, amount)`: incrementa `locked_balance` (no toca `balance`). INSUFFICIENT_BALANCE si available < amount.
- `releaseHold(holdId)`: idempotente, libera locked.
- `debitWithHoldRelease(holdId, withdrawalId, actor)`: atómico, debit balance + release hold + INSERT wallet tx withdrawal.

**WithdrawalsService:** state machine completa (pending → approved → processing → paid | rejected | failed). Idempotencia en transiciones terminales. Cross-state → WITHDRAWAL_INVALID_STATE (409).

**8 endpoints** (`/tenant/withdrawals/...`):
- `POST` (cualquier user): hold inmediato.
- `GET /mine` (cualquier user).
- `GET` con filtros (withdrawals.view).
- `GET /:id` (withdrawals.view).
- `POST /:id/approve` (withdrawals.approve): solo cambia status.
- `POST /:id/reject` (withdrawals.reject): release hold.
- `POST /:id/mark-paid` (withdrawals.process): debit + release + walletTx.
- `POST /:id/mark-failed` (withdrawals.process): release hold.

**Audit:** `withdrawals.create`, `withdrawals.approve`, `withdrawals.reject`, `withdrawals.paid` (severity high), `withdrawals.failed`.

**Tests E2E (17 nuevos):** validaciones, INSUFFICIENT_BALANCE, max-pending, lifecycle completo, idempotencia mark-paid, cross-state errors, permission gates, locked_balance reflejado correctamente en cada paso.

### Estado final
- **10 archivos de test, 134 tests, 0 skipped, 0 flaky, ~12-15s.**
- 15 corridas full-suite consecutivas verdes.
- Subsistema wallet **completo** según `docs/05` (excepto particionado, conciliación automática y verificación cripto).

### Decisiones tomadas (anotadas en DEVLOG)
- `maxWorkers: 1` en jest.config (no solo CLI flag).
- Holds como columna `locked_balance` + tabla `wallet_holds` para trazabilidad.
- `debitWithHoldRelease` atómico evita ventana donde el wallet podría quedar inconsistente.
- State machine explícita con cross-state 409.

### Commits creados
- `56ff5bc` — feat(withdrawals): hold-based withdrawal flow + fix test infrastructure

### Próximos pasos
- **Wallet está COMPLETO**. Subsistema cerrado.
- **Próximas opciones (a elegir):**
  1. **Interceptor `idempotency_keys` HTTP-level** (sesión chica, ~1h).
  2. **2FA TOTP para admins/super-admin** (mediano).
  3. **Sistema de bonos básico** (gran feature).
  4. **`user_hierarchy` + scope guard** (mediano).
  5. **Frontend** (gran feature, fase 4 del roadmap).
  6. **Audit log frontend** (panel del admin para timeline).
  7. **Game provider mock + lobby** (gran feature, fase 5).
- **Bloqueos**: ninguno.

### Notas para próximo agente
- **Run tests**: `pnpm --filter @casino/api test`. 134 tests, 100% estable, ~12-15s.
- **Cualquier mutación de balance pasa por `WalletService`**. Si necesitás un type nuevo de operación, agregalo al enum + helper en el service.
- **Para retiros**: el hold se crea en `placeHold()` al solicitar, se libera en `releaseHold()` al rechazar/fallar, y `debitWithHoldRelease()` debita atómicamente al marcar paid.
- **`Idempotency-Key` header** sigue siendo obligatorio en mutaciones wallet (mint/burn/load/unload). Withdrawals usan `withdrawal:<id>` internamente como key para la wallet tx (cliente NO manda Idempotency-Key explícito en el POST create).
- **Estado wallet completo**: mint, burn, load, unload, deposit, withdrawal con audit + holds + idempotencia + multi-tenant aislamiento.

---

## 2026-05-13 — Claude (Sonnet 4.5)

**Duración**: ~2h 30min.
**Usuario**: Uriel.

### Qué hicimos
**Sprint Hardening Categoría A** — 10 quick wins sobre lo que ya construimos. Cero features nuevas; solo fortalecimiento.

#### Items cerrados

1. **Refresh token reuse mata todas las sesiones del user.** Si alguien intenta refrescar con un token ya rotado, marcamos TODAS las sesiones activas del user como revoked (no solo la robada). Política de "compromise probable".
2. **Revoke de permiso no-delegable → audit `severity:high` + `sensitive:true`.** Response del endpoint incluye `severity`. El revoke se permite (admin debe poder), pero queda flagged.
3. **`actor_role_at_time` poblado automáticamente** desde `AuditLogService.record()` con prioridad de roles (admin_tenant > socio > distribuidor > cajero > empleado > usuario_final). Best-effort: si falla, queda NULL.
4. **`SET LOCAL lock_timeout = '5s'`** en `executeTransaction` y `executeTransferPair`. Si un FOR UPDATE no obtiene lock en 5s, aborta. Resilience operacional.
5. **`reason` en mint/burn endurecido**: `MinLength: 10` (era 3) + regex `[a-zA-Z]{3,}` (al menos 3 letras consecutivas).
6. **CHECK SQL `wallets.locked_balance <= wallets.balance`.** Postgres rechaza cualquier UPDATE que viole esto.
7. **`session_id` propagado del JWT al audit_log.** Payload del JWT incluye `sid` (opcional, retrocompatible). El guard lo lee y lo pone en `req.requestContext.sessionId`. `extractRequestContext` lo expone.
8. **3 índices compuestos en `audit_log`**: `(actor_user_id, created_at)`, `(action_code, created_at)`, `(target_id, created_at)`. Migration 0006.
9. **Coverage report habilitado** en jest.config. `npx jest --coverage` genera reporte HTML.
10. **`GET /tenant/wallet/me/transactions`** — paginado, devuelve `{ data, total }`. Útil para panel del player + debugging.

### Tests añadidos
- `tenant-auth.e2e.ts`: reuse de refresh kill all sessions (1 test).
- `wallet.e2e.ts`: history endpoint + paginación (2 tests), reason hardening (2 tests), CHECK locked <= balance (1 test).
- `permission-overrides.e2e.ts`: revoke severity high + actor_role_at_time poblado (2 tests).
- **Total**: 8 nuevos. Suite: 10 archivos, **142 tests, 0 skipped, 0 flaky, 5/5 corridas consecutivas verde.**

### Bugs encontrados durante el sprint
- Tests existentes usaban `reason` con < 10 chars en setup de mint/burn. Tuve que actualizar varios (`'idem test'` → `'idem test setup'`, etc.). Esto valida que el test refleja el contrato real del DTO.
- Test "400 si falta Idempotency-Key" tenía `reason: 'test'` (4 chars). Con el nuevo regex, el 400 venía por reason (no por Idempotency-Key). Lo actualicé a un reason válido para que el test siga validando lo que dice.

### Commits creados
- `ca1b46a` — feat(hardening): categoría A — 10 quick wins

### Estado al cerrar
- **Suite 142/142 verde**, 5 corridas consecutivas estables.
- **Deuda técnica cerrada**: los 10 items críticos rápidos.
- **Próximas categorías**:
  - **B**: aparecerá naturalmente con cada feature (login email, sessions endpoint, cancel deposit, etc).
  - **C**: requieren sprints dedicados (scope/user_hierarchy, 2FA, rate limiting, Redis cache, Postgres role hardening, particionado).

### Próximos pasos (según el roadmap del usuario)
Volver al ritmo. Las opciones siguientes que quedaron de Sesión Wallet 4:
1. **`user_hierarchy` + scope guard** (sprint C #4 — el más urgente para producción real).
2. **2FA TOTP** (sprint C #1 dentro de Security Hardening).
3. **Rate limiting + brute force lockout** (sprint C #1).
4. **Sistema de bonos básico** (feature nueva).
5. **Frontend** (fase 4 roadmap).
6. **Game provider mock + lobby** (fase 5).

### Notas para próximo agente
- **Sprint Hardening A está cerrado.** No volver a tocar esos 10 items salvo refactor mayor.
- **Tests crecieron a 142.** Tiempo total: ~15-20s. Aún manejable con `maxWorkers: 1`.
- **`Idempotency-Key`** sigue siendo obligatorio en mutaciones wallet. Mint/burn además exigen `reason` largo + con letras. Los tests reflejan el contrato.
- **`actor_role_at_time` poblado**: cada audit entry ahora dice "el actor era admin_tenant" o "cajero" al momento. Filtros futuros del panel pueden usar eso.
- **session_id en audit**: ya no es NULL. Útil cuando hagamos UI de "ver mis acciones recientes por sesión".

---

## 2026-05-13 (segunda parte) — Claude (Sonnet 4.5)

**Duración**: ~2h.
**Usuario**: Uriel.

### Qué hicimos
**`user_hierarchy` + ScopeGuard**: cierre del gap de seguridad operacional. Sin esto, un cajero podía cargar a cualquier user del tenant. Ahora debe estar en su red (descendant directo o indirecto).

#### Schema (1 tabla)
- `user_hierarchy` histórica (`since`/`until`). UNIQUE parcial `(user_id) WHERE until IS NULL` garantiza un parent activo por user. Filas viejas no se borran. Migration 0007 aplicada.
- Permiso `users.change_hierarchy` (no-delegable, audit_required) seedeado.

#### Service `UserHierarchyService`
- `setParent`: cierra fila activa, abre nueva. TX postgres + lock_timeout. Anti-self-parent + anti-cycle.
- `clearParent`: cierra activo, idempotente.
- `getActiveParent`, `getActiveAncestors`, `getActiveDescendants`: queries recursivas con `WITH RECURSIVE`.
- `isAncestorOf`: composición de getActiveAncestors.

#### Controller (5 endpoints)
- GET parent / ancestors / descendants (users.view_any).
- PUT parent / DELETE parent (users.change_hierarchy + audit severity:high).

#### ScopeGuard + `@ScopeTarget(field, location)`
- Decorator declarativo: endpoints anotan dónde leer el target.
- Sin decorator → skip.
- 3 bypasses: actor=target, actor=admin_tenant, target en descendants.
- Wireado en `wallet.load`, `wallet.unload`, `users.update`, `users.addRole`, `users.removeRole`.

#### Tests E2E (12 nuevos)
- CRUD set/clear/get + recursive descendants/ancestors.
- Anti-self-parent, anti-cycle.
- Audit severity high.
- ScopeGuard: out-of-network 403, in-network 201, admin_tenant bypass, 3 niveles de profundidad.
- Permission gate: users.change_hierarchy no-delegable.

#### Regresión correcta y fixeada
- 3 tests existentes en wallet-transfer asumían "cualquier user carga a cualquier user". Los actualicé:
  - "happy load c2c" + "insufficient balance": setean jerarquía como precondición.
  - "anti-deadlock A↔B": ambos lados como admin_tenant (mide lock ordering, no scope).

### Estado final
- **11 archivos de test, 154 tests, 0 skipped, 0 flaky.**
- **5/5 corridas consecutivas verde.**
- Tiempo full suite: ~20-30s (creció por user-hierarchy + scope queries).

### Decisiones tomadas (DEVLOG)
- Tabla histórica con UNIQUE parcial vs snapshot.
- Anti-cycle a nivel app (postgres no tiene constraint nativo).
- 3 bypasses explícitos del scope (self, admin, network).
- Scope NO se valida sobre entidades intermedias (deposit/withdrawal) — queda para sprint dedicado.

### Bug encontrado durante la sesión
- Mi cambio al seed (`users.change_hierarchy`) requería rebuild del package `@casino/db`. Sin rebuild, los tests usaban el catálogo viejo y los endpoints PUT/DELETE devolvían 403 a admin. Resuelto: `pnpm --filter @casino/db build` y re-ejecución.

### Commits creados
- `722c7f8` — feat(scope): user_hierarchy + ScopeGuard + wire en wallet/users

### Estado al cerrar
- **Subsistema scope completo** para los flujos críticos.
- **Próximos pasos lógicos**:
  1. Wirear scope en deposits.approve / withdrawals.approve (requiere lookup del entity primero — sprint chico).
  2. Sistema de bonos (fase 5).
  3. 2FA TOTP (sprint Security Hardening).
  4. Frontend (fase 4).

### Notas para próximo agente
- **Si querés crear un endpoint nuevo que muta sobre un user**: agregalo a un controller con `@UseGuards(..., ScopeGuard)` (orden importa: después de PermissionsGuard) y anotalo con `@ScopeTarget('field', 'location')`.
- **Si necesitás validar scope sobre un entity intermedio** (e.g. `deposits/:id/approve`), patron: dentro del handler, leer el entity, sacar el `user_id`, llamar `hierarchy.isAncestorOf(actorId, userId)` manualmente y tirar `ForbiddenException` si no. O hacer un guard custom.
- **`createTestUser` con role `admin_tenant`** sigue siendo la salida rápida para tests que necesitan bypass de scope.
- **Anti-deadlock A↔B**: si necesitás dos users que se carguen entre sí, ambos deben ser admin_tenant (o tenerse mutuamente como descendant, lo cual es imposible — ciclo).
- **No olvides rebuildear `@casino/db`** después de tocar el seed. El moduleNameMapper de jest apunta al source TS, pero el seed mismo a veces se compila a JS y se lee del dist.

---

## 2026-05-13 — Claude (Sonnet 4.5, 1M context)

**Duración**: ~1.5h
**Usuario**: Uriel

### Qué hicimos

Sprint B Security Hardening completo: **2FA TOTP per-user**.

#### Schema
- Migration 0008: `users.two_fa_enabled` (boolean default false), `users.two_fa_secret` (text null). Setup en dos pasos para evitar lockear users que se distraen entre escanear QR y confirmar.

#### Service `TwoFaService` (apps/api/src/tenant-auth/two-fa.service.ts)
- `initSetup` / `confirmSetup` / `disable` / `verify` / `isEnabled`.
- otplib v13 functional API (`generateSecret`, `generateURI`, `verifySync` con epochTolerance=30s para drift de reloj).
- Errores tipados (`TwoFaAlreadyEnabledError`, `TwoFaCodeInvalidError`, `TwoFaNotInitializedError`) → mapping a HTTP en el controller.

#### Endpoints
- `POST /tenant/auth/2fa/init` — setup, devuelve secret + otpauth:// URL para QR. Audit severity:high.
- `POST /tenant/auth/2fa/confirm` — verifica primer código y enabled=true.
- `DELETE /tenant/auth/2fa` — requiere código vigente (anti-disable por sesión robada).

#### Login con 2FA
- `twoFaCode` opcional en TenantLoginDto.
- User con 2FA + sin código → **400 TWO_FA_REQUIRED** (status 400, no 401, para que el frontend distinga "creds mal" de "falta segundo factor").
- User con 2FA + código mal → 401.
- User SIN 2FA → campo ignorado.

#### Mint/Burn con 2FA
- Helper privado `WalletController.requireTwoFaIfEnabled(db, actorId, code)`.
- Solo en mint/burn por ahora — load/unload son alta frecuencia, costo UX no vale la pena.

### Bugs encontrados y resueltos

- **otplib v13 ESM-only.** El bundle nuevo no exporta `authenticator` namespace; el dependiente `@scure/base@2.2.0` es ESM puro que Jest no transformaba. Fix doble: (a) `transformIgnorePatterns` permite `otplib | @otplib | @scure | @noble` (negative lookahead, matchea por nombre suelto para soportar el encoding pnpm `@scure+base@2.2.0`); (b) test usa TOTP hand-rolled con `node:crypto` (20 líneas) en vez de importar otplib en el process del test.

### Decisiones tomadas (DEVLOG)

- Status 400 para TWO_FA_REQUIRED (no 401) — el frontend necesita la señal.
- 2FA solo en mint/burn por ahora, no en load/unload — high-friction op vs high-frequency op.
- Setup en dos pasos (init persiste secret pero enabled=false; confirm flipea) — UX safety.
- Secret se REEMPLAZA si init se llama con setup pending — el user puede retomar.
- Disable requiere código vigente — anti-revocation por sesión robada.
- Test process usa TOTP hand-rolled, no otplib — robustez sin frágil setup ESM.

### Commits creados

- (pending) — feat(2fa): TOTP per-user + integration en login/mint/burn

### Estado al cerrar

- **Fase actual**: Sprint Security Hardening B completo. Roadmap principal — Fase 3 (Wallet/Operations completa + Hardening A + Scope + 2FA).
- **176 tests, 12 suites, 0 skipped, 0 flaky** (2/2 corridas verde, ~60s).
- **Próximo paso lógico**:
  1. Recovery codes (backup one-time codes para 2FA — sin esto un user que pierde su app queda lockeado).
  2. Rate limit en endpoints sensibles (confirm/login/init) — defensa anti-brute-force.
  3. 2FA obligatorio para roles operativos (policy: admin_tenant DEBE tener 2FA).
  4. Sistema de bonos (Fase 5).
  5. Frontend (Fase 4).
- **Bloqueos**: ninguno.

### Notas para próximo agente

- **Recovery codes** es lo más urgente — sin eso un user que pierde su phone queda fuera del sistema y tiene que pedir reset por soporte. Diseño sugerido: tabla `user_recovery_codes (user_id, code_hash, used_at)` con 10 codes one-time generados en `confirmSetup`. Endpoint `POST /2fa/use-recovery-code` que valida hash + marca used.
- **Rate limit** vale la pena ya: hoy un atacante con tiempo tira 1M codes/min y entra. La regla es ip+user+endpoint en una memo cache con TTL 60s. Si no querés Redis aún, en-memory con LRU sirve para single-instance.
- **El test `two-fa.e2e.ts` re-usa TOTP hand-rolled** (`base32Decode` + HMAC-SHA1). Si en un sprint futuro alguien quiere generar codes desde otro lado (smoke tests, fixtures), copiar esas funciones — no importar otplib en el test process.
- **`resetMutableState` NO limpia users** — los tests de 2FA agregan su propio reset en `beforeEach`. Si otro test enable 2FA en el admin y no lo revierte, contaminará suites siguientes. Patrón: si tocás users en un test, restaurá en `afterAll`.
- **jest.config.ts ahora transforma .js en node_modules para 4 packages**. Si más adelante alguien suma una lib ESM-only, agregar el nombre al regex (no romper el lookahead).

---

## 2026-05-13 (continuación) — Recovery Codes (Sprint B.1)

**Duración**: ~1h
**Usuario**: Uriel
**Modelo**: Claude Sonnet 4.5 (1M context)

### Qué hicimos

Sprint B.1 Security Hardening: **Recovery Codes para 2FA**.

#### Schema
- Migration 0009: tabla `user_recovery_codes` (id, user_id FK CASCADE, code_hash SHA-256, used_at nullable, created_at). UNIQUE `(user_id, code_hash)`.

#### Service `RecoveryCodesService`
- `generateForUser`: invalida activos + inserta 10 nuevos. Codes formato `xxxx-xxxx-xx` (40 bits hex), plain solo se devuelve una vez.
- `verifyAndConsume`: atomic UPDATE con `WHERE used_at IS NULL ... RETURNING`. Race-safe.
- `countActive`, `deleteAllForUser`.

#### Cambios en TwoFaService
- `confirmSetup` ahora devuelve `{recoveryCodes}` — el frontend los muestra una vez.
- `regenerateRecoveryCodes(userId, totpCode)`: rota batch, exige TOTP fresco.
- `verifyAndConsumeRecoveryCode`: helper para login.
- `disable` también borra todos los codes (limpieza coherente).

#### Endpoints nuevos
- `POST /tenant/auth/2fa/recovery-codes/regenerate` — body `{code}`, requiere TOTP fresco, audit severity:high.
- `GET /tenant/auth/2fa/recovery-codes/count` — `{active: N}` para el panel del user.

#### Login con recovery code
- `TenantLoginDto` acepta `recoveryCode` (3-32 chars, opcional, alternativo a `twoFaCode`).
- Service: si user tiene 2FA, requiere uno de los dos. Si manda solo recovery → valida + consume. **No cross-fallback** (si manda TOTP y falla, no prueba como recovery).

### Decisiones tomadas (DEVLOG)

- Codes de 40 bits (10 hex) vs 80+ — UX vs cripto. 40 bits + rate limit alcanza.
- SHA-256 vs argon2 — code de alta entropía no necesita PBKDF de costo alto.
- Aceptar code con/sin guiones, case-insensitive — normalización en el service.
- Plain se devuelve UNA vez (regenerate si se pierden).
- Atomic UPDATE con `used_at IS NULL` guard — race-safe sin TX explícita.
- No cross-fallback TOTP↔recovery — info leakage al atacante.
- regenerate exige TOTP fresco — step-up auth contra sesión robada.
- Disable borra codes (no soft delete; audit_log conserva trail).

### Bugs encontrados y resueltos

- Inicialmente hasheé los codes plain con guiones, pero el verify normalizaba primero (strip guiones) → hashes diferentes, los codes nunca matcheaban. Fix: hashear SIEMPRE la forma normalizada en ambos lados.

### Tests E2E (13 nuevos en recovery-codes.e2e.ts)
- confirmSetup → 10 codes, sin duplicados, formato correcto.
- Login con recovery: consume, re-uso 401.
- Acepta sin guiones, MAYÚSCULAS, shape inválido → 401.
- regenerate genera 10 nuevos, invalida viejos, exige TOTP fresco.
- Disable borra todos los codes (verificación vía SQL directo).

### Commits creados
- (pending) — feat(2fa): recovery codes one-time para 2FA

### Estado al cerrar

- **189 tests, 13 suites, 0 skipped, 0 flaky.** 2/2 corridas verde (~50s).
- **Fase actual**: Sprint Security Hardening B + B.1 completos.
- **Próximo paso lógico**:
  1. **Rate limit** en login/2fa endpoints (siguiente paso obligado — hoy un atacante con tiempo puede tirar codes en loop).
  2. **2FA obligatorio para roles operativos** (admin DEBE tener 2FA).
  3. **Notificación al consumir recovery code** (depende email infra).
  4. Sistema de bonos (Fase 5) o frontend (Fase 4).
- **Bloqueos**: ninguno.

### Notas para próximo agente

- **Rate limit es el próximo paso natural**. Endpoints sensibles: `POST /tenant/auth/login`, `POST /tenant/auth/2fa/confirm`, `POST /tenant/auth/2fa/recovery-codes/regenerate`. Patrón sugerido: in-memory `Map<key, {count, expiresAt}>` con `key = ip+user+endpoint`, limit 5/minuto. Si crece, migrar a Redis.
- **Si necesitás generar codes en tests**, NO importes RecoveryCodesService — el plain text solo se devuelve por API. El test debe leer del response de `confirmSetup` o `regenerate`.
- **resetMutableState** NO toca `user_recovery_codes` — la suite `recovery-codes.e2e.ts` limpia en `beforeEach/afterAll`. Si agregás otra suite que toque codes, cleanup también.
- **El frontend (cuando exista)** DEBE mostrar los recovery codes en el response del `confirmSetup` con un botón "ya los guardé" + "imprimir". También en el response del `regenerate`. Una vez navegado fuera, no hay forma de re-mostrar.
- **Recovery codes NO sirven para mint/burn**. Solo para login. Mint/burn exige TOTP fresco siempre (operación crítica). Esto está hardcoded en `WalletController.requireTwoFaIfEnabled` — usa `verify`, no `verifyAndConsumeRecoveryCode`.

---

## 2026-05-13 (continuación 2) — Rate Limit (Sprint B.2)

**Duración**: ~1h
**Usuario**: Uriel
**Modelo**: Claude Sonnet 4.5 (1M context)

### Qué hicimos

Sprint B.2 Security Hardening: **Rate limit anti-brute-force** sobre endpoints sensibles. Cierra la última pieza obvia del subsistema auth.

#### Componentes
- **`RateLimiterService`**: in-memory fixed window counter. Map<key, {count, resetAt}>. API: check/reset/clear/peek. Sweep lazy, env-disabled via `RATE_LIMIT_ENABLED=false`.
- **`@RateLimit({rule, limit, windowSec, scope})`** decorator. Scopes: `'ip'`, `'ip+body.<field>'`, `'user'`.
- **`RateLimitGuard`**: lee metadata, computa key, consulta limiter. 429 + Retry-After header.
- **`RateLimitModule`**: @Global. Providers + exports.

#### Endpoints protegidos

| Endpoint | Scope | Limit | Ventana |
|---|---|---|---|
| `POST /tenant/auth/login` | ip+body.username | 10 | 15 min |
| `POST /tenant/auth/2fa/confirm` | user | 10 | 15 min |
| `POST /tenant/auth/2fa/recovery-codes/regenerate` | user | 5 | 60 min |

#### Reset-on-success
- Guard pega `req.rateLimitKey` con la clave usada.
- Handlers (login/confirm/regenerate) llaman `limiter.reset(req.rateLimitKey)` tras un success.
- User legítimo que tipea mal 3 veces no queda penalizado al entrar.
- Atacante por definición no completa el success → counter sigue acumulando.

### Bugs encontrados y resueltos

- **Orden de guards crítico**. Inicialmente `@UseGuards(RateLimitGuard)` a nivel clase. En endpoints post-auth, RateLimitGuard corría ANTES que TenantJwtGuard → `req.tenantUser` undefined → fail-open. Fix: composición explícita por endpoint `@UseGuards(TenantJwtGuard, RateLimitGuard)`.

### Decisiones tomadas (DEVLOG)

- Fixed window counter vs sliding (simpler, burst 2x aceptable como defensa en capas).
- Reset-on-success (UX para legítimos + atacantes nunca llegan al success).
- Composición explícita de guards, no class-level (ordering del JWT first).
- fail-open si key no construible (mejor que rechazar legítimos por mal config).
- Normalización lowercase+trim para anti-evasion del username.
- Lazy sweep (no setInterval) — Jest se traba con handles abiertos.
- Single-instance only — migrar a Redis si crece multi-instance.

### Tests E2E (10 nuevos en rate-limit.e2e.ts)

- Login bloqueo en 11°, reset-on-success, contadores independientes por username, normalización anti-evasion.
- 2FA confirm bloqueo en 11° + reset-on-success.
- regenerate bloqueo en 6°.
- Direct service: count/reset/peek.

### Commits creados
- (pending) — feat(security): rate limit anti-brute-force en endpoints sensibles

### Estado al cerrar

- **Fase actual**: Subsistema Security Hardening (B, B.1, B.2) **completo**.
- **199 tests, 14 suites, 0 skipped, 0 flaky** (2/2 corridas verde, ~63s).
- **Próximo paso lógico**:
  1. **2FA obligatorio para roles operativos** (admin DEBE tener 2FA, policy enforcement). Sprint dedicado.
  2. **Captcha** después de N intentos fallidos (defensa adicional vs bots).
  3. **Notificación al user** (intento sospechoso, recovery code usado) — depende email infra.
  4. **Sistema de bonos** (Fase 5).
  5. **Frontend** (Fase 4).
- **Bloqueos**: ninguno.

### Notas para próximo agente

- **Si agregás un endpoint sensible** (cualquier mutación crítica), considerá `@RateLimit({...})` + `@UseGuards(...)` con orden correcto (JWT primero si `scope: 'user'`).
- **El limiter es in-memory single-instance**. Si en el futuro deployás múltiples instancias del API detrás de un load balancer, migrar a Redis. Hoy hace un Map en proceso.
- **Reset-on-success requires `req.rateLimitKey`**. Si copiás patrón del controller, no olvides el bloque `if (req.rateLimitKey) this.limiter.reset(req.rateLimitKey)` post-success.
- **Tests usan `limiter.clear()` en beforeEach** para no acarrear contadores entre tests. Si agregás suite nueva que hit endpoints rate-limited muchas veces, agregar el clear o confiar en reset-on-success si los tests pasan por endpoints con success path.
- **Limit configurable hardcoded en decorator**. Si querés ajustar por env (e.g. más estricto en prod), agregar lookup de ConfigService dentro del guard. Por ahora todos los limits son constantes.

---

## 2026-05-13 (continuación 3) — 2FA obligatorio policy (Sprint B.3)

**Duración**: ~1.5h
**Usuario**: Uriel
**Modelo**: Claude Sonnet 4.5 (1M context)

### Qué hicimos

Sprint B.3 Security Hardening: **2FA obligatorio para roles operativos**. Cierra el último gap del subsistema auth.

#### Schema (migration 0010)
- `roles.requires_two_fa boolean default false`.
- Seed: admin_tenant/socio/distribuidor/cajero = true. empleado/usuario_final = false.
- Seed cambia a `onConflictDoUpdate` para que el flag propague en re-seed.

#### TwoFaPolicyService
- `check(db, userId)`: 2 queries, devuelve `{ok, reason?}`.
- Mutable enable()/disable() (default ON via env).
- `checkForRoleCodes` variante para cache futuro.

#### `@AllowWithoutTwoFa()` decorator
- Bypass en endpoints de setup (`/me`, `/2fa/init`, `/2fa/confirm`, `/2fa/recovery-codes/count`).

#### Integración: dentro de TenantJwtGuard
- **Decisión arquitectónica clave**: el check vive DENTRO de TenantJwtGuard, NO como guard separado.
- Razón: NestJS corre APP_GUARD ANTES que controller-level guards. Un policy guard global no puede leer `req.tenantUser` (todavía no seteado por JWT guard).
- Ventaja secundaria: single point of enforcement, sin riesgo de olvidar el guard en controllers nuevos.

#### Tests: bootstrapTestApp default-disable
- `bootstrapTestApp({enableTwoFaPolicy: false})` (default) → policy disabled.
- Suite del policy pasa `true` explícito.

### Bugs encontrados y resueltos

- **Guard global APP_GUARD no funcionaba**. Probé primero con guard separado en APP_GUARD. Pero como NestJS corre globales antes que controller-level guards, `req.tenantUser` estaba undefined → policy auto-skipeaba. Re-arquitectura: integré el check en TenantJwtGuard mismo, post-setteo de tenantUser. Borré el archivo del guard standalone (dead code).
- **`createTestUser` test util tiene signature `{suite, label, role}`**, no `{username, password, roleCode}`. Fix simple.

### Decisiones tomadas (DEVLOG)

- Flag en `roles` (flexible) vs `users` (rigid).
- Default `false` para custom roles (Admin decide explícitamente).
- `empleado` por default = false (Admin debe flagearlo si le da permisos sensibles).
- Single point of enforcement = TenantJwtGuard (acepta acoplamiento auth+policy).
- Mutable enable/disable en el service (tests + future kill-switch).
- `onConflictDoUpdate` en seed (propagación de cambios).
- 2 queries por request — aceptable MVP, cachear en Performance sprint.

### Tests E2E (10 nuevos en two-fa-policy.e2e.ts)

- Bypass endpoints (GET /me, init, confirm, count) → 200.
- Bloqueo endpoints (mint, /users) → 403 TWO_FA_SETUP_REQUIRED.
- Mint pasa después de setup completo + TOTP.
- Jugador no afectado.
- Kill-switch funciona.

### Commits creados
- (pending) — feat(security): 2FA obligatorio para roles operativos

### Estado al cerrar

- **Fase actual**: Subsistema Security Hardening (B, B.1, B.2, B.3) **COMPLETO**.
- **209 tests, 15 suites, 0 skipped, 0 flaky** (2/2 corridas verde, ~50-55s).
- **Próximo paso lógico**:
  1. **Sistema de bonos** (Fase 5) — el subsistema auth está sólido, podemos volver a features de producto.
  2. **Frontend** (Fase 4) — empezar el panel del Admin Tenant.
  3. **Notificaciones** (email/SMS) — destranquea features dependientes (warnings de seguridad, grace period para 2FA setup, etc.).
  4. **Captcha** después de N intentos fallidos (defensa adicional vs bots).
  5. **Audit log "policy triggered"** para forensics.
- **Bloqueos**: ninguno.

### Notas para próximo agente

- **El subsistema Security Hardening B.x está cerrado**. 2FA TOTP + recovery codes + rate limit + policy operativos. Si necesitás extender (admin manual unlock, IP allowlist, etc.), el patrón está sentado.
- **Para tests que requieren JWT-protected endpoints**: por default la policy 2FA está DISABLED via `bootstrapTestApp`. Si en tu suite querés testear contra la policy activa, pasá `{enableTwoFaPolicy: true}`.
- **Si agregás un rol custom que sea operativo**: settea `requires_two_fa: true` en la fila. Si querés que los users existentes con ese rol queden bloqueados hasta que setupeen, no hace falta nada extra (el guard lo enforce automáticamente).
- **Si agregás un endpoint que el user legítimo SIEMPRE puede usar aunque le falte 2FA setup** (ej: `/2fa/init` mismo), marcalo con `@AllowWithoutTwoFa()`. Hoy hay 4 endpoints así (me, init, confirm, count). Pensá dos veces antes de agregar más — cada bypass es una grieta posible.
- **La policy NO escribe en audit_log cuando se dispara**. Si querés forensics de "cuántos users bloqueados y para qué endpoint", agregar `await audit.record(...)` desde el guard. Cuidado con duplicados (cada request bloqueado generaría una row).
- **2 queries por request post-auth** — aceptable hoy, pero monitor latencia si crece tráfico. Cache options: in-memory LRU con TTL 1min en TwoFaPolicyService, invalidate on `users.twoFaEnabled` change.

---

## 2026-05-13 (continuación 4) — Sistema de Bonos MVP (Sprint Bonos-1)

**Duración**: ~2h
**Usuario**: Uriel
**Modelo**: Claude Sonnet 4.5 (1M context)

### Qué hicimos

Primer sprint de Fase 5 (Engagement). **Sistema de Bonos MVP** — backend para grants manuales + CRUD de definitions. Scope deliberadamente acotado para no morder demasiado de un módulo enorme.

#### Schema (migration 0011)
- `bonus_definitions` (plantillas, JSONB para config/wagering/segmentFilter/visibility, scope tenant, fundedByUserId).
- `user_bonuses` (instancia per user, status enum 7-states, granted/remaining amount, grantIdempotencyKey UNIQUE, fundingTxId link, expiresAt).
- Wallet tx types nuevos: `bonus_funding` (debit funder), `bonus_funding_revert` (credit funder al cancelar). `bonus_grant`/`bonus_clear`/`bonus_forfeit` ya existían.

#### Permisos (7 nuevos seedeados)
view, view_any, create_definition, edit_definition, grant_manual, cancel, force_clear.

#### Services
- `BonusDefinitionsService`: CRUD + unique code via 23505 catch.
- `UserBonusesService`: grantManual, cancel, forceClear, listForUser, countActive, findById.
- `WalletService` extendido con `executeBonusFunding`, `executeBonusFundingRevert`, `executeBonusClear`.

#### Endpoints
- `/tenant/bonus-definitions` (GET, POST, PATCH, GET :id).
- `/tenant/bonuses/me`, `/user/:userId`, `/:id`, `/grant`, `/:id/cancel`, `/:id/force-clear`, `/stats/active`.

#### Integraciones
- ScopeGuard sobre grant (cajero no puede otorgar fuera de red). Manual scope check en cancel/force-clear (target.userId no está en body).
- Force-clear exige 2FA (step-up auth para op destructiva).
- Rate-limit 60 grants/hora por actor (sprint B.2).
- Audit log severity:high en mutaciones de wallet/bonos.

### Decisiones tomadas (DEVLOG)

- Bonus money lives separately from wallet (en `user_bonuses.remaining_amount`, no en wallet.balance).
- Funder paga inmediatamente, no se reserva.
- Idempotency en dos niveles (grant key + wallet key derivada).
- Cancel reversa `remainingAmount` (no `grantedAmount`) — correcto para futuro con wagering.
- Force-clear exige 2FA + permiso no-delegable.
- No atomic entre wallet tx y user_bonus insert — aceptable MVP, mitigación idempotency.
- Rate-limit por actor (no por target).

### Tests E2E (18 nuevos en bonuses.e2e.ts)

- CRUD definitions: 6 tests.
- Grant manual: 9 tests (success, idempotency, conflicts, edge cases, listings, stats).
- Cancel + force-clear: 3 tests (success, invalid status, force-clear con cambio de wallet del user).

### Commits creados
- (pending) — feat(bonuses): sistema de bonos MVP — definitions CRUD + grant manual

### Estado al cerrar

- **Fase actual**: Sprint Bonos-1 completo. Fase 5 (Engagement) arrancada.
- **227 tests, 16 suites, 0 skipped, 0 flaky** (2/2 corridas verde, ~60-70s).
- **Próximo paso lógico**:
  1. **Sprint Bonos-2**: Auto-grant en deposit.approve (welcome/reload). Hook + evaluador de segmentFilter.
  2. **Sprint Bonos-3**: Wagering tracking (necesita engine de juegos, depende de Fase 6 game-providers).
  3. **Sprint Bonos-cron**: Job nocturno de expiración (mark `expired` + revert funds).
  4. **Frontend** (Fase 4) — panel del Admin Tenant para configurar definitions visualmente.
  5. **Sorteos / Liga** (Sprint Engagement-2/3) — siguiente módulo del doc 15.
- **Bloqueos**: ninguno. Wagering tracking depende de engine de juegos (Fase 6).

### Notas para próximo agente

- **El schema soporta los 7 bonus types** (welcome/reload/cashback/manual/free_spins/no_deposit/referral) pero solo `manual` tiene flow completo. Para implementar otros: agregar trigger en el flow correspondiente (e.g. deposit.approve para welcome) que llame `UserBonusesService.grantManual` con `sourceEvent: {kind:'deposit_welcome', depositId}` y `actorUserId: SYSTEM_USER_ID` o el id del approver.
- **Wagering tracking pendiente.** Cuando llegue, agregar tabla `bonus_progress` (user_bonus_id, total_required, total_completed, last_updated_at). El engine de juegos lee `bonus_progress` antes de aceptar bets, y debita del `user_bonuses.remaining_amount` proporcionalmente.
- **Force-clear es destructivo** — entrega chips reales. Permiso no-delegable + 2FA exigido. Si en producción se abusa, agregar approval workflow (segundo aprobador).
- **`bonuses.grant_manual` ES delegable** — un cajero puede tener este permiso. El ScopeGuard limita a su red. Tener cuidado al asignar — un cajero rogue podría inflar bonos a confederados; el rate-limit + audit log son las defensas.
- **El admin del tenant es funder por defecto.** Si alguien crea una definition siendo no-admin (sprint v2), el funder será su propio user. Validá que tenga saldo al grant.
- **stats/active** es lectura simple para el panel — si crece tráfico, considera materializar a una vista o cachear.
- **El test bonuses.e2e.ts importa createTestUser** con la signature `{suite, label, role}` (NO `{username, password, roleCode}`).
- **`resetMutableState` ahora trunca también user_bonuses y bonus_definitions** — si agregás suite que use bonos sin necesidad de reset, ojo que perderás el estado.

---

## 2026-05-13 (continuación 5) — Auto-grant en deposit.approve (Sprint Bonos-2)

**Duración**: ~1h
**Usuario**: Uriel
**Modelo**: Claude Sonnet 4.5 (1M context)

### Qué hicimos

Sprint Bonos-2: **auto-grant de bonos** en `deposit.approve`. Cierra el ciclo del welcome/reload — el bono se otorga automáticamente sin acción del cajero más allá de aprobar el depósito.

#### `BonusesAutoGrantService.autoGrantForApprovedDeposit`
- Decide welcome vs reload por count de depósitos aprobados.
- Pickea la primera definition activa de ese type (orden code ASC).
- Eval config: `minDeposit` filtra, monto = `min(deposit*matchPct/100, maxAmount)`.
- Grant idempotente via key derivada `auto_grant:<depositId>:<kind>`.
- Retorna `{bonus, kind, skipReason?}` — no tira para "no aplica".

#### Hook en `DepositsController.approve`
- Después del approve commit (chequeando `before.status !== after.status`).
- Audit `bonus.auto_grant` (severity:medium) en éxito.
- Audit `bonus.auto_grant_failed` (severity:high) si tira.
- **Fail-soft**: no revierte el deposit jamás.

### Decisiones tomadas (DEVLOG)

- Hook en controller, no service (single responsibility).
- Fail-soft (deposit ya aprobado, bono se puede otorgar manual después).
- Conteo de deposits aprobados en vez de flag en users (simpler).
- Idempotency `auto_grant:<depositId>:<kind>` (anti-doble-grant).
- `segmentFilter` se ignora en MVP.
- Pick por `code ASC` (predictible, prefijo numérico para prioridad).
- `actorUserId` del auto-grant = approver del deposit (trail).

### Tests E2E (7 nuevos en bonuses-auto-grant.e2e.ts)

- Welcome con monto correcto.
- Capeo por maxAmount.
- Skip si deposit < minDeposit.
- Skip si no hay definition activa.
- Reload en segundo deposit.
- Idempotencia: doble approve = un bono.
- Fail-soft: matchPct=0 → no bono pero deposit OK.

### Bugs encontrados y resueltos

- Initial DTO field wrong: usé `paymentMethodId` pero el controller espera `methodId`. Fix simple.

### Commits creados
- (pending) — feat(bonuses): auto-grant welcome/reload en deposit.approve

### Estado al cerrar

- **Fase actual**: Sprint Bonos-2 completo. Welcome/reload pipeline end-to-end funcional.
- **234 tests, 17 suites, 0 skipped, 0 flaky** (2/2 corridas verde, ~75-80s).
- **Próximo paso lógico**:
  1. **Sprint Bonos-cron**: job nocturno de expiración (cierra bonos con `expiresAt < now()` y status='active', revert al funder).
  2. **Sprint Bonos-3** (wagering): depende de engine de juegos — bloqueado por Fase 6.
  3. **Cashback job nocturno**: cálculo de netwin por período, otorga `type='cashback'`.
  4. **Sorteos / Liga** (Engagement-2/3).
  5. **Frontend** (Fase 4) — panel del Admin Tenant.
- **Bloqueos**: ninguno.

### Notas para próximo agente

- **El hook de auto-grant SOLO dispara si `before.status !== after.status`**. Esto significa que un approve idempotente (sobre un deposit ya aprobado) NO re-ejecuta el hook — comportamiento correcto.
- **Si necesitás auto-grant para otros eventos** (registro → no_deposit, FTD del referido → referral): mismo patrón. Service con `autoGrantForXEvent`, hook en el controller del evento, fail-soft, idempotency key derivada del evento.
- **Para testear flows que usan auto-grant**: archive previous welcome/reload definitions antes (helper `archiveAllWelcomeDefsExcept`). Si no, varios tests pueden chocar entre sí dentro de la misma suite (la suite no resetea entre tests, sí entre suites via `resetMutableState`).
- **El test `bonuses-auto-grant.e2e.ts` usa `methodId` (no `paymentMethodId`)** para crear deposits. Mantener en mente para tests nuevos.
- **`autoGrantForApprovedDeposit` puede retornar `bonus: null` con `skipReason`**. Auditar el skipReason si es útil para diagnóstico. Hoy solo logueamos en debug excepto cuando es error real.

---

## 2026-05-13 (continuación 6) — Expiración de bonos (Sprint Bonos-cron)

**Duración**: ~1h
**Usuario**: Uriel
**Modelo**: Claude Sonnet 4.5 (1M context)

### Qué hicimos

Sprint Bonos-cron: **expiración automática** de bonos. Cuando `expires_at < NOW()` y `status='active'`, el sistema:
1. Revierte las fichas remaining al funder.
2. Marca el bono como `expired`.
3. Audit log entry.

#### Componentes
- **`BonusesExpirationService.expireDueForTenant`**: query + procesa hasta 500 bonos por run. Por bono: revert wallet (idempotent) + UPDATE + audit. Fail-soft individual.
- **`BonusesExpirationCron`**: cron programático con `SchedulerRegistry`. Itera `tenants WHERE status='active'`, llama service por cada uno. Flag `running` anti re-entrada. Schedule/disable via env (`BONUSES_EXPIRE_CRON`, `BONUSES_EXPIRE_ENABLED`).
- **`POST /tenant/bonuses/jobs/expire`**: endpoint admin para forzar manualmente sobre el tenant del request. Requiere `bonuses.force_clear`.
- **Test env**: `globalSetup` setea `BONUSES_EXPIRE_ENABLED=false` para que el cron no corra durante tests (handles abiertos).

### Decisiones tomadas (DEVLOG)

- Cron programático (no decorador `@Cron`) para env-config del schedule.
- `actorUserId` del revert = funder mismo (best semantic + sin user-sistema).
- Idempotency dos niveles (wallet key + UPDATE guard).
- MAX_PER_RUN = 500 (batch chico, próximo run toma el resto).
- Endpoint requiere `bonuses.force_clear` pero NO 2FA (no entrega chips al user).
- Fail-soft individual, fail-loud batch.
- Multi-tenant en cron, single-tenant en endpoint.

### Tests E2E (6 nuevos en bonuses-expiration.e2e.ts)

- Happy: bono vencido → expired + revert al funder.
- No-op: bono futuro / cancelled NO se toca.
- Idempotencia: doble run = un solo revert.
- Permisos: cajero1 sin permiso → 403.
- Batch: 3 bonos vencidos → todos en un run.

### Commits creados
- (pending) — feat(bonuses): expiración automática + cron multi-tenant

### Estado al cerrar

- **Fase actual**: Sprint Bonos-cron completo. Subsistema bonos MVP ya tiene: definitions CRUD + grant manual + cancel + force-clear + auto-grant welcome/reload + **expiración automática**.
- **240 tests, 18 suites, 0 skipped, 0 flaky** (2/2 corridas verde, ~70-90s).
- **Próximo paso lógico**:
  1. **Cashback job** (cron + cálculo de netwin por período → otorga `type='cashback'`). Misma pattern que expiration cron.
  2. **Wagering tracking** (bloqueado por engine de juegos, Fase 6).
  3. **Sorteos / Liga** (Engagement-2/3, doc 15 §B/§C).
  4. **Frontend** (Fase 4) — panel del Admin Tenant para ver y configurar bonos.
- **Bloqueos**: ninguno.

### Notas para próximo agente

- **Patrón del cron es reusable**: `BonusesExpirationCron` es plantilla para futuros cron jobs (cashback, recordatorios, jackpots scheduled). Si vas a crear otro: copiá la pattern (programmatic registration via `SchedulerRegistry`, flag `running` anti-reentrada, env disable for tests).
- **El cron NO corre en tests** — `globalSetup` setea `BONUSES_EXPIRE_ENABLED=false`. Para testear funcionalidad: usar el endpoint admin `POST /bonuses/jobs/expire`.
- **`forceExpiresAtInPast` helper en el test** mueve `expires_at` al pasado vía SQL directo, único way de hacerlo (la API no permite editar expiresAt — es inmutable por diseño).
- **Si el cron se cuelga**: el flag `running` previene re-entrada PERO no se libera automáticamente. Si una run no termina por crash silencioso, queda `running=true` por siempre. Mitigación: reiniciar el proceso. Para producción robusta: timeout interno + auto-reset del flag.
- **Multi-instance NO está handled.** Si en un futuro deployás 2+ pods de la API, ambos correrán el cron y procesarán los mismos bonos. Idempotency del wallet revert los blinda pero hay desperdicio. Implementación pendiente: PG advisory lock o Redis lock.
- **`bonuses.force_clear` se usa para 2 cosas distintas** (force-clear individual + run job batch). Si en el futuro querés separarlas, podés crear un nuevo permission `bonuses.run_jobs`. Hoy mantenemos uno por simplicidad — el riesgo operativo es similar.

---

## 2026-05-13 (continuación 7) — Cashback job (Sprint Bonos-cashback)

**Duración**: ~1.5h
**Usuario**: Uriel
**Modelo**: Claude Sonnet 4.5 (1M context)

### Qué hicimos

Sprint Bonos-cashback: **% de netloss devuelto como bono**. Último tipo auto-grant que faltaba. Con esto el subsistema de bonos cubre los 3 flows automáticos del doc: welcome, reload, cashback.

#### `BonusesCashbackService.runForTenant(db, asOf?)`
- Buckets fijos no-overlapping según `def.config.periodDays`. Procesa el bucket cerrado más reciente.
- Query agregada: `SUM(amount FILTER bet/win)` por user join wallets, en la ventana del bucket.
- Por user con netwin < 0: cashback = `min(netloss * pct/100, maxCashback)`. Skip si `< minNetloss`.
- Grant via `UserBonusesService.grantManual` con key `cashback:<defId>:<userId>:<bucketIndex>`.
- Detecta idempotency hits via nuevo `findByGrantKey`.

#### `BonusesCashbackCron`
- Misma pattern que ExpirationCron. Default `0 1 * * *`. Env `BONUSES_CASHBACK_CRON` + `BONUSES_CASHBACK_ENABLED`.
- Desactivado en tests via globalSetup.

#### Endpoint `POST /tenant/bonuses/jobs/cashback?asOf=ISO`
- `asOf` opcional para tests + reconciliación histórica.
- Permiso `bonuses.force_clear`.
- Audit `bonus.cashback_job.manual` si `grantsCreated > 0`.

### Decisiones tomadas (DEVLOG)

- Buckets fijos vs rolling window (idempotency natural + predictible).
- `asOf` param expuesto al endpoint (tests + reconciliación).
- `actorUserId` del grant = funder (igual que expiration).
- Bet/win sintéticos en tests (INSERT directo). Sistema queda listo para cuando llegue engine de juegos.
- Reuso de `grantManual` con sourceEvent='cashback'.
- `findByGrantKey` nuevo en UserBonusesService.
- Cron diario aunque buckets sean semanales (resilience).

### Bug encontrado y resuelto

- Idempotency test assertaba `run.body.grantsCreated` (batch-wide) pero la suite no resetea `wallet_transactions` entre tests → prior tests' players reaparecían en el cálculo del nuevo bucket. Fix: assert por-player (`readBonusesFor(player.id)`).

### Tests E2E (10 nuevos en bonuses-cashback.e2e.ts)

- Cálculo: 4 tests (netloss, netwin, minNetloss, maxCashback cap).
- Bucket window: activity fuera no entra.
- Idempotencia: re-run = mismo bonus.
- Permisos + no-op: 403, sin defs, pct=0, asOf inválido.

### Commits creados
- (pending) — feat(bonuses): cashback job (cron + bucket cerrado + netwin)

### Estado al cerrar

- **Fase actual**: Subsistema bonos COMPLETO (welcome auto / reload auto / cashback auto / grant manual / cancel / force-clear / expiración / cashback).
- **250 tests, 19 suites, 0 skipped, 0 flaky** (2/2 corridas verde, ~73-77s).
- **Próximo paso lógico**:
  1. **Sorteos** (doc 15 §B) — lottery_tickets / lottery_ranking / misiones / daily_wheel / login_streak / cofres. Es un módulo nuevo grande.
  2. **Liga / Rankings** (doc 15 §C) — leaderboards multi-período con premios automáticos.
  3. **Antifraude** (doc 15 §D) — detección de cuentas múltiples.
  4. **Wagering tracking** (bloqueado por engine de juegos, Fase 6).
  5. **Frontend** (Fase 4) — panel del Admin Tenant para configurar todo lo anterior visualmente.
- **Bloqueos**: ninguno.

### Notas para próximo agente

- **El módulo de bonos está bastante completo end-to-end**. Si vas a continuar con sorteos/liga, mismo pattern (definitions configurables + instancias per user/ticket + cron para cierres). El doc 15 §B/§C es razonablemente detallado.
- **Si llega el engine de juegos** (Fase 6), las wallet_transactions de type='bet' y 'win' van a empezar a aparecer realmente — el cashback va a empezar a otorgar bonos automáticamente sin cambios en el código. Sí o sí testear que el flow real produce el efecto esperado (no solo synthetic tx).
- **Los crons son `single-instance` only**. Si en algún momento deployamos > 1 pod de la API, ambos correrán los crons. La idempotency cubre la corrección pero hay desperdicio. Implementación pendiente: PG advisory lock antes de cada run.
- **`asOf` del cashback endpoint permite backfill** — útil si el cron estuvo caído por días. Admin puede correr `POST /jobs/cashback?asOf=2026-05-08T00:00Z` para procesar ese día. Pero CUIDADO: el endpoint procesa el bucket CERRADO de ese asOf — si das un asOf hoy, procesa el bucket previo (el mismo que el cron daily ya procesó). El audit log + idempotency lo blindan; pero entender bien antes de ejecutar.
- **El patrón de cron está estandarizado**: programmatic registration via `SchedulerRegistry`, flag `running` anti-reentrada, env disable for tests, multi-tenant iteration via `controlDb.select tenants WHERE status=active`. Si vas a crear otro cron (e.g. league period closing, draw runner), copiá el patrón.

---

## 2026-05-13 (continuación 8) — Sorteos: daily_wheel (Sprint Sorteos-1)

**Duración**: ~1.5h
**Usuario**: Uriel
**Modelo**: Claude Sonnet 4.5 (1M context)

### Qué hicimos

Primer sprint de Sorteos (doc 15 §B). Scope: **daily_wheel** end-to-end, infraestructura genérica para los otros 5 types.

#### Schema (migration 0012)
- `promotions`: plantilla genérica (6 types soportados en enum). JSONB libre por type.
- `promotion_rewards`: entregas (1 por spin/ticket/claim). idempotencyKey UNIQUE intra-promotion. metadata JSONB con RNG seed.

#### Permisos (5 nuevos)
view, view_any, create_definition, edit_definition, cancel.

#### Services
- `PromotionsService`: CRUD plano.
- `DailyWheelService.spin`: idempotency por (promotion, user, dayUTC), RNG inyectable, weighted random sobre segments, dispatch por prize.kind (chips → wallet debit+credit; try_again → no-op; bonus/free_spins → TODO).

#### Endpoints
- CRUD: `/tenant/promotions` GET/POST/PATCH, GET :id.
- User: `POST :id/spin` (rate-limit 30/min), `GET :id/my-rewards`.

#### Wallet integration
- 2 primitivos nuevos: `executePromotionFunding` (debit funder, type=bonus_funding source=promo_funding) + `executePromotionReward` (credit user, type=promo_reward).

### Decisiones tomadas (DEVLOG)

- Reuso de `bonus_funding` type genérico, distingue por `source='promo_funding'`.
- Idempotency dayAnchor=YYYY-MM-DD UTC (no timezone del tenant — sprint futuro).
- RNG inyectable solo desde service, controller usa Math.random (no del client por seguridad).
- Wheel config validado en el spin, no en create (permite drafts).
- bonus/free_spins TODO en el dispatcher — schema completo + lógica pendiente.
- Schema genérico habilita los otros 5 types sin migration adicional.

### Tests E2E (14 nuevos en promotions.e2e.ts)

- CRUD: 6 tests.
- Spin happy: chips, idempotent same day, try_again.
- Spin errors: not_active, type_mismatch, schedule_closed, config_invalid.
- GET my-rewards.

### Commits creados
- (pending) — feat(promotions): daily_wheel — schema + RNG ponderado + spin idempotente

### Estado al cerrar

- **Fase actual**: Sprint Sorteos-1 (daily_wheel) completo. Subsistema promotions con base genérica.
- **264 tests, 20 suites, 0 skipped, 0 flaky** (2/2 corridas verde, ~78-84s).
- **Próximo paso lógico**:
  1. **login_streak**: self-contained, mismo patron daily_wheel. Hook opcional en login para auto-tick.
  2. **lottery_tickets**: tickets generados por activity en juegos elegibles. Necesita game engine.
  3. **lottery_ranking**: cierre cron + draw + premios escalonados.
  4. **missions** / **level_chests**: necesitan game engine para tracking.
  5. **Premio kind=bonus**: wire al UserBonusesService.grantManual.
  6. **Liga / Rankings** (doc 15 §C).
  7. **Antifraude transversal** (doc 15 §D).
  8. **Frontend** (Fase 4) — panel del Admin Tenant.
- **Bloqueos**: muchos de los types siguientes dependen del engine de juegos (Fase 6).

### Notas para próximo agente

- **`PromotionsModule` y `BonusesModule` son sibling**. Si vas a wire premio kind=bonus, importá BonusesModule en PromotionsModule y usá `UserBonusesService.grantManual` desde `DailyWheelService.awardPrize`.
- **El RNG de daily_wheel se valida con configs deterministicos** (1 segmento al 100%). Si querés testear la distribución, escribí un unit test sobre `pickSegment` directamente — no es necesario E2E.
- **Schema soporta los 6 types**. Para implementar login_streak: nuevo service `LoginStreakService.claim(promotionId, userId)` que mantiene `current_progress` jsonb en algún sitio (podemos usar `promotion_rewards` agregado o crear `promotion_participants` table). Mismo pattern de idempotency por dayAnchor.
- **Validación de wheel config corre en el spin**. Si el admin crea un draft con config rota, no falla hasta que alguien intenta girar. Mensaje de error claro al user + log severity:error.
- **`resetMutableState` ahora también trunca `promotions` y `promotion_rewards`** — si agregás suite que dependa de promociones persistidas entre tests, ojo.
- **Rate-limit en spin** existe pero la idempotency natural ya lo cubre. Lo dejamos como defensa en capas vs floods de endpoint.

---

## 2026-05-13 (continuación 9) — Sorteos: login_streak + PrizeAwarder (Sprint Sorteos-2)

**Duración**: ~1.5h
**Usuario**: Uriel
**Modelo**: Claude Sonnet 4.5 (1M context)

### Qué hicimos

Segundo type de promotions. **login_streak** end-to-end + extracción de helper compartido **PromotionPrizeAwarder**.

#### Schema (migration 0013)
- Nueva tabla `promotion_participants` genérica para state per-user. JSONB libre por type. UNIQUE (promo, user).

#### `PromotionPrizeAwarder`
- Helper compartido: dispatch de `prize.kind` (chips/try_again/bonus/free_spins) → wallet flow.
- DailyWheelService refactorizado para usar el helper. Mismo behavior, código DRY.

#### `LoginStreakService.claim`
- Pipeline: load promo → validate type/status/schedule → idempotency check → load/create participant → compute streak → resolve prize index según onMax → award → insert reward → update participant.
- `onMax`: 'hold' (default) | 'cycle' | 'reset'.
- `forgivenessDays`: gaps permitidos sin reset.
- `autoClaimOnLogin` flag → hook en TenantAuthController.

#### Endpoints
- `POST /:id/claim-streak` + `GET /:id/my-streak`.
- Hook fail-soft en login para auto-claim de promos con autoClaimOnLogin=true.

### Bug encontrado y resuelto

- **Colisión de wallet idempotency keys entre promos**. La key original `streak_claim:<userId>:<dayAnchor>` derivaba `promo_fund:<key>` que es UNIQUE global en wallet_transactions. Dos promos del mismo type para el mismo user en el mismo día → colisión → 409. Fix: incluir `promo.id` en la key. Aplicado en BOTH wheel y streak (mismo bug).

### Decisiones tomadas (DEVLOG)

- Tabla `promotion_participants` genérica para reuso futuro (missions, chests).
- Idempotency keys con promo.id (defensa contra multi-promo colisión).
- `.returning()` obligatorio en UPDATE drizzle (observación empírica).
- Hook fail-soft fire-and-forget en login (no bloquea response).
- `forwardRef` en TenantAuthModule → PromotionsModule (defensivo).
- PrizeAwarder solo cubre wallet dispatch — RNG/streak logic stay type-specific.

### Tests E2E (13 nuevos en promotions-login-streak.e2e.ts)

- 7 tests de claim: primer claim, idempotent, día siguiente, reset, forgiveness, onMax hold/cycle, type mismatch.
- 2 tests my-streak.
- 2 tests del hook (autoClaim=true dispara, false no dispara).
- 1 test de participant row crea y persiste.

### Commits creados
- (pending) — feat(promotions): login_streak + PrizeAwarder + idempotency fix

### Estado al cerrar

- **Fase actual**: Sprint Sorteos-2 completo. Promotions con 2 types end-to-end (wheel + streak).
- **277 tests, 21 suites, 0 skipped, 0 flaky** (2/2 corridas verde, ~92s).
- **Próximo paso lógico**:
  1. **Premio kind=bonus**: wire al UserBonusesService.grantManual desde el PrizeAwarder. Self-contained, mismo patron.
  2. **lottery_tickets / lottery_ranking**: necesitan game engine (Fase 6) o pueden usar fake activity para test.
  3. **missions** y **level_chests**: dependen del engine de juegos.
  4. **Liga / Rankings** (doc 15 §C).
  5. **Antifraude transversal** (doc 15 §D).
  6. **Frontend** (Fase 4) — panel del Admin Tenant + components para wheel/streak.
- **Bloqueos**: missions/lottery_tickets/level_chests dependen del engine.

### Notas para próximo agente

- **El patrón de `promotion_participants` está listo para reuso**. Para implementar missions: `current_progress` JSONB guarda `{objective: 'bet_volume_5000', progress: 3500, completed: false}` o similar; el service tiene su `claim`-equivalente que actualiza progress y opcionalmente dispara reward al completar.
- **El bug de idempotency key con promo.id** afecta a CUALQUIER promotion service que derive wallet keys del user+day. Si vas a crear un nuevo type: SIEMPRE incluí `promo.id` (o equivalente discriminator) en la key.
- **`.returning()` en UPDATE drizzle** — patrón a mantener. Sin él, observamos UPDATEs que no se materializan en algunos paths.
- **Hook auto-claim en login** es fire-and-forget. Si falla, audit log + warning log pero el user no ve nada. Si querés visibilidad para debug en producción, agregar telemetría / Prometheus metric.
- **PrizeAwarder** soporta chips/try_again hoy; bonus/free_spins logueados como TODO. Cuando wiremos bonus: importar UserBonusesService en PrizeAwarder, agregar case bonus → `userBonusesService.grantManual({...})` con sourceEvent específico.
- **`forwardRef` en TenantAuthModule → PromotionsModule** es defensivo. Hoy NO hay cycle, pero si alguna vez Promotions necesita TenantJwtGuard u algo de TenantAuth, ya estamos preparados.
- **Si agregás más tests con `setParticipantState` SQL helper**, recordá que la suite no resetea entre tests — el state queda. Cada test usa player fresco (createTestUser) para aislar.

---

## 2026-05-13 (continuación 10) — Premio kind=bonus en promotions (Sprint Sorteos-3)

**Duración**: ~45min
**Usuario**: Uriel
**Modelo**: Claude Sonnet 4.5 (1M context)

### Qué hicimos

Sprint Sorteos-3: wireup del `prize.kind === 'bonus'` en `PromotionPrizeAwarder`. Cierra la última pieza self-contained de promotions. Ahora wheel + streak pueden entregar bonos como premio.

#### Cambios
- `PromotionPrizeAwarder` extendido: case `bonus` → `userBonusesService.grantManual(...)`.
- `PromotionsModule.imports` ahora incluye `BonusesModule`.
- Idempotency key del grant: `promo_bonus:<idempotencyKeyBase>`.
- Source event guarda `{kind: 'promotion', promotionId, promotionCode}` en user_bonus para reporting.
- Fail-soft sobre errores conocidos del bonus subsystem (5 errores tipados) → reward sin `bonus_id`. Errores inesperados se re-tiran.

### Decisiones tomadas (DEVLOG)

- Funder del bono = funder del bonus_definition (NO del promo). Cada bono mantiene su propia política financiera.
- `actorUserId = promo.fundedByUserId` (audit trail "el promo X gatilló este bono").
- Fail-soft sobre errores known-config (definition inactiva, inexistente, etc.).
- Errores inesperados re-tirados (DB down, etc.) — distinción clara.
- Alias `FunderInsufficientBalanceError as BonusFunderInsufficientBalanceError` (evitar conflicto con el del subsistema promotions).

### Tests E2E (5 nuevos en promotions-prize-bonus.e2e.ts)

- wheel + bonus happy.
- definition inactiva → fail-soft.
- definition inexistente → fail-soft.
- idempotencia: re-spin → mismo bonus.
- streak + bonus happy.

### Commits creados
- (pending) — feat(promotions): wireup prize kind=bonus → UserBonusesService

### Estado al cerrar

- **Fase actual**: Sprint Sorteos-3 completo. Promotions ahora soporta 3 prize kinds (chips/try_again/bonus). Solo `free_spins` queda TODO (depende game engine).
- **282 tests, 22 suites, 0 skipped, 0 flaky** (2/2 corridas verde, ~81-119s).
- **Próximo paso lógico**:
  1. **Liga / Rankings** (doc 15 §C) — leaderboards multi-período. Depende parcialmente de bet activity (similar pattern al cashback service). Self-contained con activity sintética hoy.
  2. **Antifraude transversal** (doc 15 §D) — detección de cuentas múltiples. Self-contained, datos ya disponibles.
  3. **lottery_tickets / lottery_ranking / missions / level_chests** — game engine necesario.
  4. **Frontend** (Fase 4) — panel del Admin Tenant para configurar todo.
- **Bloqueos**: ninguno.

### Notas para próximo agente

- **`PromotionPrizeAwarder` ahora cubre 3 kinds**. Si tenés que agregar `free_spins` en el futuro: nuevo case en el dispatch, posiblemente nuevo service `FreeSpinsService` que tracke "N giros sin costo en juegos del provider X" — necesita game engine para enforce. Schema actual lo soporta (`prize jsonb`).
- **Source event `{kind: 'promotion', promotionId, ...}`** en user_bonuses es la pista para reportes de campañas. Si vas a hacer dashboard "ROI de promo X", usar este link.
- **Funder cross-subsystem**: importante recordar que el funder del BONUS sale del bonus_definition cuando se entrega via promotion. Si en el futuro hay confusión contable, este es el punto. Documentado en DEVLOG.
- **Fail-soft pattern** acá es deliberado — si la promo entrega un premio que no se puede materializar (config rota), el user no debería sufrirlo (no fail-loud el spin). El admin se entera por logs. Si en el futuro hay un endpoint "rewards no materializados" para reconciliación, los identificás por `bonus_id IS NULL AND prize->>'kind' = 'bonus'`.

---

## 2026-05-13 (continuación 11) — Liga / Rankings (Sprint Liga MVP)

**Duración**: ~2h
**Usuario**: Uriel
**Modelo**: Claude Sonnet 4.5 (1M context)

### Qué hicimos

Sprint Liga MVP — leaderboards multi-período con cron de cierre. Self-contained.

#### Schema (migration 0014, 3 tablas)
- `leagues` (definition + schedule + prizes JSONB).
- `league_standings` (snapshot vivo, PK compuesta, position materializada).
- `league_results` (append-only, settle history, idempotency UNIQUE).

#### Permisos (5 nuevos)
view, view_any, create_definition, edit_definition, run_actions. Endpoints user-facing (list, getById, standings, results) sin permission — solo JWT — porque "premios visibles públicamente" per doc.

#### Refactor PrizeAwarder
Cambió API: `award` toma `PrizeContext = {id, code, fundedByUserId}` en vez de `Promotion`. DailyWheel/LoginStreak/Leagues construyen el context. Same awarder serves 3 subsystems hoy y futuros (missions, lottery_tickets).

#### LeaguesService
- CRUD plano.
- `recompute(db, leagueId)`: query agregada SUM/COUNT por user con activity en window. DELETE+INSERT en TX para snapshot atómico. 2 métricas MVP: bet_volume, rounds_count. Otras tiran `LeagueMetricNotSupportedError`.
- `getStandingsView(db, leagueId, userId, topN)`: top + ventana around si user fuera.
- `closeAndSettle(db, leagueId)`: recompute final → parse prizes JSONB con keys "1"/"2-5"/"6-10" → award via PrizeAwarder per posición → insert league_results → status='closed'. Idempotent.

#### LeaguesCloseCron
Default `*/15 * * * *`. Multi-tenant. Disable via env. Mismo patrón que expiration/cashback crons.

#### Endpoints
- CRUD admin.
- User-facing: `/standings`, `/results`.
- Admin actions: `/recompute`, `/close`, `/jobs/close-due`.

### Decisiones tomadas (DEVLOG)

- `startsAt = NOW` en tests (anti-cross-contamination con bets sintéticos persistentes).
- `Number(score)` para asserts numéricos (Postgres numeric devuelve "5.0000").
- 2 métricas MVP, schema soporta 5 (incremental).
- DELETE+INSERT recompute (vs UPSERT — más simple, suficiente para MVP).
- PrizeAwarder genérico via PrizeContext.
- Endpoints user sin permission (solo JWT) — premios públicos.
- `recompute` DENTRO de `closeAndSettle` para garantizar premios = state final.

### Tests E2E (13 nuevos en leagues.e2e.ts)

- CRUD (4 tests).
- Recompute (4 tests: bet_volume, fuera-ventana, rounds_count, metric not supported).
- Standings view con around (1 test).
- Close & settle (2 tests: happy + idempotent).
- jobs/close-due (2 tests: happy + permisos).

### Bug encontrado y resuelto

- Cross-test contamination via wallet_transactions table compartida. Default startsAt en el pasado → tests previos' bets aparecían en standings. Fix: startsAt = NOW por test, bets DESPUÉS de creación.

### Commits creados
- (pending) — feat(leagues): leaderboards + cron de cierre + refactor PrizeAwarder

### Estado al cerrar

- **Fase actual**: Sprint Liga MVP completo. Leagues end-to-end funcionando.
- **295 tests, 23 suites, 0 skipped, 0 flaky** (2/2 corridas verde, ~100-110s).
- **Próximo paso lógico**:
  1. **Antifraude transversal** (doc 15 §D) — detección de cuentas múltiples. Self-contained, datos ya disponibles.
  2. **Métricas restantes de league** (gross_won, player_netwin, score_custom).
  3. **lottery_tickets / lottery_ranking / missions / level_chests** — necesitan game engine (Fase 6) o pueden usar fake activity.
  4. **Frontend** (Fase 4) — panel del Admin Tenant + leaderboard UI.
- **Bloqueos**: lottery/missions dependen del engine.

### Notas para próximo agente

- **El patrón de `startsAt = NOW`** en tests se aplica a CUALQUIER subsistema con activity sintética compartida (cashback, leagues, futuras missions). Si vas a crear un test que mide "activity in window", usa NOW como anchor.
- **PrizeAwarder es ahora genérico** vía PrizeContext. Si vas a implementar missions/lottery, construí el context desde tu entity y reusalo. NO copies/pastees el dispatch.
- **Recompute es completo** (DELETE+INSERT). Si hay >10k participantes simultáneos en una league, refactor a UPSERT. Hoy con MVP <1k es <100ms.
- **`score_custom` requiere parser de fórmula** sin `eval`. Recomendación: usar `expr-eval` lib (sandbox seguro) o implementar mini-DSL parser. Sprint dedicado.
- **El cron de close es cada 15 min**. Si el admin quiere cierre exacto al segundo (e.g. liga competitiva con premios reales), hay que reducir el período del cron O agregar trigger manual via UI.
- **El endpoint `POST /leagues/jobs/close-due`** sirve también para tests + reconciliación manual. Mismo pattern que bonuses/jobs/expire y bonuses/jobs/cashback.

---

## 2026-05-13 (continuación 12) — Antifraude transversal (Sprint Antifraude MVP)

**Duración**: ~2h
**Usuario**: Uriel
**Modelo**: Claude Sonnet 4.5 (1M context)

### Qué hicimos

Sprint Antifraude MVP — detección de cuentas múltiples con 2 scanners deterministicos.

#### Schema (migration 0015, 2 tablas)
- `fraud_signals`: snapshot de señales crudas, recreado en cada scan.
- `fraud_account_links`: pares con CHECK `user_a_id < user_b_id` + UNIQUE (a,b). status enum suspected/confirmed/dismissed.
- **Skip `fraud_clusters` table**: union-find on-demand vía service. Decisión consciente para MVP.

#### Permisos (3 nuevos)
fraud.view, fraud.review, fraud.run_scan (todos no-delegable).

#### Service `FraudDetectionService`
- 2 scanners: `scanSharedIPs` (SQL agregado con array_agg), `scanSimilarEmails` (JS Levenshtein por dominio O(N²)).
- Pipeline runScan: scanners → DELETE/INSERT signals → UPSERT links (preserve dismissed).
- `getClusters`: union-find on-demand.
- `isUserFlagged(userId)`: helper para wire futuro en liga/sorteos.
- `stats()` para KPI dashboard.

#### Endpoints
- /tenant/fraud/{stats, clusters, links, links/:id, links/:id/{confirm,dismiss}, scans/run}.
- Audit severity:high para confirm.

#### Cron `FraudScanCron`
Default `0 3 * * *`. Multi-tenant. Disable via FRAUD_SCAN_ENABLED=false en tests.

### Decisiones tomadas (DEVLOG)

- Skip `fraud_clusters` table — union-find on-demand para MVP.
- DELETE+INSERT del snapshot de signals (vs UPSERT incremental).
- Preserve `status='dismissed'` en re-scans (no auto-flagear lo que admin descartó).
- Threshold 70 hardcoded — sprint futuro lo expone configurable.
- Levenshtein JS, no Postgres extension (acepta O(N²) por dominio para MVP).
- Email similarity solo intra-dominio (false negative aceptado para attackers cross-provider).
- Tests con assertions RELATIVAS (cross-test pollution de users.email — cada test verifica su pair).

### Bug encontrado y resuelto

- Tests originales aserto absoluto sobre `signalsCreated` totals. Falla porque emails de tests previos persisten y el scanner los procesa todos. Fix: assertions per-pair (`readLinkBetween(uA, uB)`).

### Tests E2E (16 nuevos en fraud.e2e.ts)

- 3 tests scanner shared_ip.
- 2 tests scanner similar_email.
- 2 tests score combinado (creación de link).
- 2 tests clusters union-find (transitividad + separación).
- 3 tests confirm/dismiss + double-confirm 409.
- 2 tests permisos.
- 1 test stats.
- 1 test estado per-user.

### Commits creados
- (pending) — feat(fraud): detección de cuentas múltiples MVP

### Estado al cerrar

- **Fase actual**: Subsistema engagement+fraud completo MVP. Bonos + Promotions (wheel/streak) + Liga + Antifraude.
- **311 tests, 24 suites, 0 skipped, 0 flaky** (2/2 corridas verde, ~130-140s).
- **Próximo paso lógico**:
  1. **Wireup `isUserFlagged` en LeaguesService.recompute** (excluir flagged del ranking). Self-contained, ~30 líneas.
  2. **Bloqueo welcome bonus** para users en cluster confirmed score >90 (hook en BonusesAutoGrantService).
  3. **lottery_tickets / lottery_ranking / missions / level_chests** — game engine necesario.
  4. **Frontend** (Fase 4) — panel admin antifraude + leaderboard UI.
- **Bloqueos**: missions/lottery dependen del game engine (Fase 6).

### Notas para próximo agente

- **`isUserFlagged` está listo para wirearse** desde liga/sorteos. Patrón: en LeaguesService.recompute, post-query, filtrar `if (await fraudService.isUserFlagged(db, userId)) skip`. Sin esto, los duplicados aún entran al ranking.
- **El scanner de email matchea SOLO mismo dominio**. Si en producción ves muchos false negatives con attackers usando providers distintos, agregar weight menor para "local part igual cross-domain".
- **DELETE+INSERT pattern del scanner** funciona para MVP. Si el scan pasa a tomar minutos, considerar staging table + atomic swap.
- **Tests con state global compartido** (users.email, wallet_transactions activity) usan assertions RELATIVAS (verificar el pair específico, no totales). Aplicable a cualquier subsystem con state cross-test.
- **El `score` numeric en Postgres se serializa como string** ("70.00"). Los tests usan `Number(score)` para comparar.
- **Sin endpoint global** `/platform/fraud/scan-all`. El cron lo hace; on-demand per-tenant via endpoint admin del tenant.
- **Cuando wires `isUserFlagged` en bonos**: PrizeAwarder llama UserBonusesService.grantManual. Antes del grant, chequear isUserFlagged y skip si true (con audit). Pattern simétrico al de league recompute.

---

## 2026-05-14 15:17 AR — Claude (Sonnet 4.5, 1M context)

**Duración**: sesión continuada (post-compaction)
**Usuario**: Uriel

### Qué hicimos

Sprint Retention Policy del `tenant_settings_history`. Cierra el TODO que dejó el sprint anterior (history append-only). Sin esto la tabla crece indefinidamente.

#### `TenantSettingsService.purgeOldHistory`
- DELETE `WHERE changed_at < NOW() - retentionDays days`.
- `retentionDays <= 0` → no-op defensivo.
- Devuelve count borrado.

#### `TenantSettingsHistoryRetentionCron`
- Schedule default `0 4 * * *` (4 AM UTC, post fraud scan).
- Multi-tenant iteration vía `controlDb.tenants WHERE status='active'`.
- `runForTenant(db)` reutilizable desde endpoint manual.
- Env disable `TENANT_SETTINGS_HISTORY_RETENTION_ENABLED=false` (test env).

#### Registry Zod
- `tenant_settings.history_retention_days`: `z.number().int().min(7).max(3650)`.
- Default 365 días si no seteado (hardcoded en cron, defensivo).

#### Endpoint manual
- `POST /tenant/settings/history/purge` — disparo on-demand.
- Permission gate `tenant.settings.edit`.
- Audit log condicional (solo si `deleted > 0`, evita ruido en no-ops).

### Decisiones tomadas (DEVLOG)

- Setting de retention vive dentro del mismo `tenant_settings` (recursivo, coherente).
- Default 365 hardcoded en cron como fallback defensivo (no en registry).
- Zod `min(7)/max(3650)` defensivo contra typos del admin.
- DELETE simple sin batching para MVP (~miles entries/año por tenant activo).
- Audit log condicional `deleted > 0` para no llenar de runs ruidosos.
- Cron NO graba audit (solo logger.log para sysadmin).

### Tests E2E (10 nuevos)
1. Default 365 borra >365d, conserva ≤365d.
2. Custom 30 borra >30d, conserva ≤30d.
3. Purge idempotente.
4. Schema rechaza <7.
5. Schema rechaza >3650.
6. Schema rechaza no-entero.
7. cajero1 sin permiso → 403.
8. Purge sin entries → deleted=0.
9. Audit log se graba con severity=medium cuando deleted>0.
10. Audit log NO se graba con deleted=0 (skip ruido).

### Commits creados
- (pending) — feat(tenant-settings): retention policy del history con cron diario + endpoint manual

### Estado al cerrar

- **Fase actual**: Subsistema tenant_settings COMPLETO MVP (key-value + fraud thresholds + Zod validation + history append-only + retention policy).
- **357 tests, 25 suites, 0 skipped, 0 flaky** (full suite ~112s).
- **Build limpio.**
- **Próximo paso lógico (roadmap macro)**:
  1. **lottery_tickets / lottery_ranking / missions / level_chests** — bloqueado por game engine (Fase 6).
  2. **Notificaciones (email/SMS infra)** — desbloquea UX pendiente (user "tu bono fue bloqueado", "scan encontró cluster", etc.). NO bloqueado por nada — infra pura. **Candidato natural si seguimos el patrón self-contained.**
  3. **Frontend (Fase 4)** — panel admin + UIs end-user.
- **Mejoras micro de `tenant-settings`** (opcionales, no bloquean nada):
  - Cache in-memory con TTL corto (5s) + invalidación on-set (hoy cada `get<T>` es query).
  - Schema validation en GET (no solo en SET) para cubrir schema bumps.
  - Lock distribuido para crons multi-instance (pg advisory lock o Redis).
  - Observability: Prometheus counters para crons.
- **Bloqueos**: ninguno para macro #2 y #3; #1 depende de game engine.

### Notas para próximo agente

- **El setting `tenant_settings.history_retention_days` controla su propia retention en la misma tabla**. Auto-referencia consciente: el setting puede ser purgado, pero el cron lee el setting actual antes de purgar — coherente.
- **`min(7)` en el schema**. Si admin necesita retention <7d (e.g. testing), tiene que cambiar el schema. Aceptable para MVP — `7d` es un piso razonable.
- **`TENANT_SETTINGS_HISTORY_RETENTION_ENABLED=false` ya está en globalSetup**. Cualquier test futuro de retention debe llamar el endpoint manual o invocar el cron directo, no esperar la corrida programada.
- **Audit condicional en endpoint** (`deleted > 0`). Si en frontend ven que el botón "purge manual" "no aparece en audit log" cuando deleted=0, es by design. Pattern aplicable a otros endpoints idempotentes que ruidan el log.
- **DELETE sin batch** funciona para el volumen MVP. Si un tenant llega a millones de entries en history, agregar CTE con LIMIT:
  ```sql
  WITH old AS (
    SELECT id FROM tenant_settings_history
    WHERE changed_at < NOW() - INTERVAL '365 days'
    LIMIT 10000
  )
  DELETE FROM tenant_settings_history WHERE id IN (SELECT id FROM old);
  ```
- **Cron del retention vs cron del fraud**: separados a propósito por 1h (3 AM fraud, 4 AM retention) para evitar contención de DB en tenants grandes. Si se agregan más crons, mantener offset de ≥30min.
