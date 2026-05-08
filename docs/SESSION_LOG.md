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
