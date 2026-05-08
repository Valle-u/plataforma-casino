# DEVLOG — Decisiones técnicas y de producto

> Este archivo captura **decisiones tomadas en conversación** que no están (o todavía no están) en los docs formales. Es el "por qué" detrás de muchas elecciones arquitectónicas.

## Cómo agregar una entrada

Cuando un agente (o el dueño) tome una decisión técnica que vale la pena recordar:

```markdown
## [YYYY-MM-DD] — [tema corto]

**Contexto**: por qué surge la decisión.
**Opciones consideradas**: A, B, C.
**Decisión**: cuál ganó.
**Razón**: por qué.
**Implicaciones**: qué cambia en el código / docs.
**Alternativa abierta**: si la decisión es reversible o no.
```

Las entradas se agregan **al final del archivo** (orden cronológico).

---

# Decisiones del proyecto

---

## 2026-05-06 — Multi-tenancy: DB por tenant + DB de control

**Contexto**: el proyecto vende a múltiples operadores. ¿Cómo aislar datos?

**Opciones consideradas**:
- A) Shared DB con `tenant_id` en cada tabla + Row-Level Security.
- B) Schema por tenant.
- C) DB por tenant + DB de control para registro y super-admin.

**Decisión**: **C** (DB por tenant + DB de control).

**Razón**: Aislamiento total, portabilidad por cliente (si se va, le exportás su DB), backups y compliance independientes, blast radius mínimo. El costo (gestionar migraciones contra N DBs) se resuelve con un runner que itera sobre el registro de tenants.

**Implicaciones**: Tenant Resolver middleware + Pool de pools con LRU + runner de migraciones. Documentado en `docs/02-arquitectura.md §4` y `docs/04-modelo-datos.md §1`.

---

## 2026-05-06 — TypeScript estricto en todo el monorepo

**Contexto**: lenguaje + estilo del proyecto.

**Decisión**: **TypeScript estricto, `any` prohibido salvo justificación en comentario**.

**Razón**: Refactors seguros, tipos compartidos front/back vía `@casino/types`, mejor DX para agentes IA (entienden mejor código tipado), bugs de wallet en compile time en lugar de producción.

**Implicaciones**: ESLint regla `@typescript-eslint/no-explicit-any: error` en `packages/eslint-config/base.js`. Toda la documentación lo asume.

---

## 2026-05-06 — ORM: Drizzle sobre Prisma

**Contexto**: necesitamos ORM para TypeScript + Postgres con muchas queries de reporting (NGR, comisiones, atribución).

**Opciones consideradas**:
- A) Prisma — más popular, mejor DX inicial.
- B) Drizzle — más cercano a SQL, mejor performance en queries complejas.

**Decisión**: **Drizzle**.

**Razón**: Vamos a tener queries complejas de NGR/GGR/atribución/conciliación. Drizzle nos deja escribir SQL casi crudo con tipos exactos. Prisma abstrae demasiado y limita.

**Implicaciones**: Documentado en `docs/02-arquitectura.md §2.5`. Migraciones SQL-first.

---

## 2026-05-06 — Colas: BullMQ sobre RabbitMQ

**Contexto**: necesitamos un sistema de colas para jobs (notifications, reconciliación, cierres de período, webhooks).

**Decisión**: **BullMQ** (sobre Redis).

**Razón**: Suficiente para MVP y v1, ya tenemos Redis para cache, menos overhead operacional que correr RabbitMQ por separado. Si en v2 necesitamos colas más robustas (priorización compleja, fan-out), migramos.

**Implicaciones**: Workers embebidos en backend NestJS en MVP. Procesos separados a partir de v1. Documentado en `docs/13-escalabilidad.md §7`.

---

## 2026-05-06 — RBAC + permisos atómicos con delegación cascada

**Contexto**: necesitamos un modelo de permisos flexible para que el Admin Tenant configure todo y los Socios delegen a sus subordinados.

**Decisión**: **Híbrido RBAC + permisos atómicos por usuario** con cascada al revocar.

**Razones**:
- Cada permiso atómico (`wallet.load`, `deposits.approve`, etc.) puede activarse/desactivarse por usuario sobre los defaults del rol.
- "Nadie puede otorgar lo que no tiene" → regla de techo enforced en backend.
- `granted_by_chain` (uuid[]) en cada override permite revocar en cascada cuando se quita un permiso al "padre" en la cadena.
- Permisos `is_delegatable=false` para acciones reservadas al Admin Tenant (mint, branding, kyc.review, etc.).

**Implicaciones**: Documentado en `docs/03-jerarquia-roles.md §7`. Tabla `user_permission_overrides` con `granted_by_chain` en `docs/04-modelo-datos.md`.

---

## 2026-05-06 — Admin Tenant tiene mint infinito; super-admin cobra sobre NGR

**Contexto**: ¿quién crea fichas? ¿cómo cobra el super-admin?

**Decisión**: **El Admin Tenant es el único que puede crear fichas (`mint`)**. Tiene mint infinito. El super-admin cobra **% NGR** (Net Gaming Revenue = GGR − bonos − fees del provider).

**Razón**: Las fichas son una unidad contable interna. La conversión a fiat es responsabilidad del operador (banco, cripto). Si el Admin Tenant intenta inflar bonos para suprimir NGR y pagar menos comisión, **paga más en payouts reales que lo que ahorra**: el sistema se autodefiende.

**Implicaciones**: 
- Solo rol `admin_tenant` puede ejecutar `mint`/`burn`. 2FA + `reason` obligatorio + audit log severidad alta.
- Reporte automático al super-admin: total minteado por período por tenant. Anomalías levantan alerta.
- Documentado en `docs/04-modelo-datos.md §5.bis` y `docs/05-flujos-fichas.md §8.bis`.

---

## 2026-05-06 — Modelo "el creador paga" para promos

**Contexto**: ¿quién paga las fichas de bonos, sorteos, jackpots propios, premios de liga?

**Opciones consideradas**:
- A) Siempre el tenant.
- B) Quien crea la promo paga de su saldo.

**Decisión**: **B (el creador paga)**.

**Razón**: Alinea incentivos. Si un Socio activa un bono en su link, las fichas salen de su saldo. Esto **elimina el ataque de bonus farming**: un Socio creando cuentas falsas se saca fichas a sí mismo. Auto-castigo perfecto.

**Implicaciones**:
- Tabla `promo_fund_reservations` para holds de premios fijos (sorteos, liga).
- Cobro al entregar para bonos eventuales (welcome, FTD, cashback).
- Reverso al funder original si la promo se cancela.
- Empleados sin saldo propio: debita del superior delegante.
- Reglas automáticas (cashback) tienen `is_active` toggleable, financiadas por quien configuró la regla (Admin Tenant en general).
- Documentado en `docs/15-engagement-promos.md §0`.

---

## 2026-05-06 — Defensas antifraude de referidos: D1, D3, D5, D6, D7, D8, D9

**Contexto**: el Socio puede tener incentivos para hacer trampa con referidos. Análisis honesto: con "el creador paga" + revenue share (no CPA), el ataque "ingenuo" de auto-referido **no es rentable**. Pero hay ataques más sutiles.

**Defensas activadas en MVP**:
- **D1**: Bloqueo por device/IP compartida (atribución se invalida).
- **D3**: Bonos al referido condicionales (no immediate, requieren FTD real + apuesta mínima).
- **D5**: Rate limit de referidos nuevos (10/hora por Socio default).
- **D6**: Bono al referente solo tras FTD via depósito autoservicio (no carga manual).
- **D7**: Panel "Socios sospechosos" con drill-down.
- **D8**: Métricas de calidad de tráfico (retention 7/30/90, LTV, NGR/referido).
- **D9**: Aprobación manual de payouts grandes (umbral configurable).

**Defensas disponibles pero off por default**:
- **D2**: Hold period de 30 días sobre comisiones.
- **D4**: KYC liviano sobre umbral.

**Razón**: D2 y D4 agregan fricción; con el modelo "creador paga" + el resto de defensas, no son críticas. Configurable encenderlas si crece el riesgo.

**Implicaciones**: Documentado en `docs/09-publicidad-referidos.md §8`.

---

## 2026-05-06 — Atribución last-touch + fallback al "Socio madre" (Admin Tenant)

**Contexto**: ¿qué pasa con usuarios que llegan sin código de referido?

**Decisión**: **Last-touch attribution, ventana 90 días, fallback a Admin Tenant**.

**Razón**: Last-touch es lo más simple y justo (el último que cerró se queda con el usuario). 90 días es estándar de la industria. Si no hay touch ni código manual, el usuario va al "Socio madre" = Admin Tenant: todo el tráfico orgánico se atribuye al tenant directamente.

**Implicaciones**: Tabla `referral_attributions` con `is_socio_madre` flag. Documentado en `docs/09-publicidad-referidos.md §3`.

---

## 2026-05-06 — Sin MLM en MVP

**Contexto**: ¿soportamos comisión multi-nivel (Socio capta otro Socio y gana % del %)?

**Decisión**: **No en MVP. Abierto a v2 si el negocio lo pide.**

**Razón**: MLM piramidal tiene riesgos legales/tributarios serios en muchas jurisdicciones, especialmente en gambling. Mejor empezar simple, evaluar después.

**Implicaciones**: Documentado en `docs/09-publicidad-referidos.md §4`.

---

## 2026-05-06 — Kommo per-tenant + pipeline propio del Socio

**Contexto**: integración CRM + livechat.

**Decisiones**:
- **Cada tenant trae su propia cuenta de Kommo** (no compartida con otros tenants).
- **Pipeline propio del Socio dentro del Kommo del tenant** (default).
- **Opción extra**: un Socio puede conectar su propio Kommo si tiene permiso especial `crm.connect_own`.
- **Widget de chat**: nativo nuestro (no iframe de Kommo) para mantener branding del tenant.
- **Plan recomendado**: Kommo Advanced.
- **Alternativa**: Chatwoot (open source, gratis, mismo `ICRM` adapter).
- **MVP**: solo livechat + atención. CRM de marketing (segmentos + Salesbot) → v2.

**Implicaciones**: Documentado en `docs/08-integracion-kommo.md`.

---

## 2026-05-06 — MVP con mock provider que incluye mini-Crash con math + provably fair

**Contexto**: ¿qué tan rico hacemos el mock provider del MVP?

**Opciones**:
- A) Mock simple, números random. Crash propio empieza de cero post-MVP.
- B) Mock incluye un mini-Crash con math real (RTP 99%) + provably fair completo. +1-2 semanas en MVP.

**Decisión**: **B**.

**Razón**: El usuario es estudiante y quiere aprender. Implementar provably fair y math durante MVP le enseña los conceptos. Cuando llegue v1 (Crash propio "real"), no empezamos de cero — extendemos lo que ya hay.

**Implicaciones**: 
- `apps/rgs` se crea en MVP (servicio Node.js separado).
- Mini-Crash en producción si está ready (el flag `ENABLE_MOCK_SLOTS` los apaga, pero el Crash queda).
- Documentado en `docs/07-integracion-aggregator.md §13`, `docs/14-roadmap.md §8`, `docs/own-games/00-overview.md §3`.

---

## 2026-05-06 — Game provider externo: post-MVP (o nunca)

**Contexto**: tier 1 providers (Pragmatic, Evolution) no integran a operadores no licenciados. Tier 2 son cuestionables.

**Decisión**: **No contratar provider externo en MVP**. En v1+, evaluar tier 2 como complemento, pero **catálogo principal = juegos propios**.

**Razón**: Construir juegos propios da independencia, 100% del revenue, diferenciación al vender la plataforma, y skill propio. Es mucho laburo, pero es el camino limpio.

**Implicaciones**: 
- `IGameProvider` contract listo en MVP para enchufar providers cuando se quiera.
- v1: Crash completo. v1.5: Mines/Plinko. v2: primer slot. v3+: catálogo expandido.
- Documentado en `docs/07-integracion-aggregator.md`, `docs/own-games/00-overview.md`, `docs/14-roadmap.md §11`.

---

## 2026-05-06 — Branding fijo en MVP (solo content customizable por tenant)

**Contexto**: ¿qué tanto puede personalizar cada tenant?

**Decisión MVP**: 
- **Identidad visual compartida** entre todos los tenants. Paleta + tipografía + layout = fijos.
- **Tenant solo customiza contenido**: logo, banners, hero, copys de UI puntuales, imágenes de promo, dominio, email templates, estructura del lobby.
- **No editable**: colores, tipografía, idioma libre, CSS custom.

**Razón**: Acelera implementación. Garantiza que todos los tenants se vean profesionales. Reduce soporte ("mis colores se ven mal"). En v2 se abre paleta/tipografía si un cliente top lo pide.

**Modelo base**: paleta negros/grises/blancos + **rojo `#DC2626`** como accent (en lugar del dorado de Mega Mooney Maker que sirvió de referencia estructural).

**Implicaciones**: Documentado en `docs/11-personalizacion.md`.

---

## 2026-05-06 — Default oscuro + i18n-ready, idioma `es-AR` MVP

**Contexto**: tema visual y idiomas.

**Decisiones**:
- **Default oscuro** en sitio jugador y panel. Switch a claro habilitable por tenant.
- **i18n-ready desde MVP** (preparar arquitectura para múltiples locales).
- **Solo `es-AR` en MVP**. Otros idiomas → v2.

**Implicaciones**: `next-intl` o similar. Strings en archivos por locale. Documentado en `docs/10-panel-control.md §2.4`.

---

## 2026-05-06 — Auth: 2FA mandatory de Cajero arriba; jugador opcional

**Contexto**: política de 2FA.

**Decisiones**:
- **Super-Admin, Admin Tenant, Socio, Distribuidor, Cajero, Empleado**: 2FA **obligatorio**.
- **Jugador**: opcional.
- **Métodos**: TOTP + email codes como fallback. **Sin SMS** (caro + vulnerable a SIM swap). **Sin recovery codes**.
- **Recovery 2FA**: por nivel (jugador → email; cajero → superior; admin tenant → super-admin canal externo).

**Razón**: Operadores manejan plata real. Comprometer una cuenta de cajero o admin = robo significativo. Jugador con 2FA opcional reduce fricción.

**Implicaciones**: Documentado en `docs/12-seguridad-compliance.md §4`.

---

## 2026-05-06 — KYC arquitectónico, default `none` en MVP

**Contexto**: ¿pedimos verificación de identidad?

**Decisión**: 
- **3 niveles soportados** por arquitectura: `none`, `basic` (email + phone), `full` (DNI + selfie + comprobante de domicilio con revisión manual).
- **Default MVP**: `none` (Argentina informal, sin licencia).
- **Verificación de edad**: solo checkbox al registrarse (sin DNI salvo `full` activado).
- **Cuándo se exige (configurable)**: at_signup / before_first_deposit / before_first_withdrawal / over_threshold.

**Razón**: La arquitectura tiene que soportar KYC para el día que llegue regulación o un tenant lo pida. Pero MVP arranca sin fricción.

**Implicaciones**: Documentado en `docs/12-seguridad-compliance.md §5`.

---

## 2026-05-06 — Juego responsable completo en MVP (sin reality checks)

**Decisión**: en MVP activamos:
- Auto-exclusión (1d / 1sem / 1mes / 6m / permanente, no reversible hasta vencer).
- Límites de depósito (diario / semanal / mensual configurable por jugador).
- Límites de apuesta por round.
- Límites de pérdida en período (auto-exclusión temporal si se alcanza).
- Cool-off period (configurable).
- Verificación de edad (checkbox).

**v2**: Reality checks (popup cada N min con stats de sesión).

**Razón**: Aunque no estamos regulados, son fáciles de implementar y nos protegen reputacionalmente. Reality checks agregan trabajo en frontend que podemos postergar.

**Implicaciones**: Documentado en `docs/12-seguridad-compliance.md §6`.

---

## 2026-05-06 — Rate limits ajustados: max-pending en lugar de hourly

**Contexto**: rate limiting de operaciones financieras del usuario.

**Decisión**:
- **Cargar fichas (cajero)**: **sin rate limit**. El saldo del cajero es el constraint natural.
- **Solicitar depósito**: **infinitos por hora**, pero **máximo 2 pendientes simultáneos** (configurable, default 2).
- **Solicitar retiro**: **infinitos por hora**, pero **máximo 2 pendientes simultáneos** (configurable, default 2).
- **Búsqueda en panel**: 15/usuario/min.
- **Login**: 5 intentos / IP / 15 min.

**Razón**: UX más natural que límite por hora. Si el jugador legítimamente quiere depositar 5 veces en una hora, debería poder. La defensa es contra spam de pendientes.

**Implicaciones**: Documentado en `docs/12-seguridad-compliance.md §9-10` y `docs/06-flujos-pagos.md`.

---

## 2026-05-06 — 6 meses MVP part-time + AI agents + piloto = el propio dueño

**Contexto**: timeline y modelo de validación.

**Decisiones**:
- **6 meses para MVP** part-time (15-20 hs/sem).
- **Solo + AI agents** (Claude Code, opencode, Cursor).
- **Free tiers / open source / self-hosted** (presupuesto mínimo).
- **Piloto = el propio dueño** (testing funcional, no validación de product-market fit).
- **Sin sitio comercial en MVP**. Privado hasta beta.

**Implicaciones**: Documentado en `docs/14-roadmap.md`.

---

## 2026-05-07 — Plan E adoptado: skip Docker/WSL en MVP

**Contexto**: durante setup Sesión 1, el Component Store de Windows resultó estar corrupto. WSL2 no terminaba de instalarse. DISM /RestoreHealth se colgaba sin acceso a Windows Update.

**Diagnóstico**:
- Virtualización en BIOS: ON.
- VirtualMachinePlatform: Enabled.
- hypervisorlaunchtype: Auto.
- Microsoft-Windows-Subsystem-Linux: Disabled.
- Component Store: corrupto.
- DISM: 0% CPU/red — no llegaba a WU.

**Opciones consideradas**:
- A) Reparar component store con DISM + ISO de Windows (1-2h, sin garantías).
- B) In-place upgrade de Windows (1-2h, "bomba nuclear suave").
- C) Reset Windows (30 min + reconfigurar todo).
- D) Saltarse Docker/WSL en MVP, instalar Postgres + Redis nativos (Plan E).

**Decisión**: **D (Plan E)**.

**Razón**: El usuario perdió varias horas peleando con Windows. El propósito de Docker es no ensuciar la PC, pero como ya hay tema con Windows, el costo de "ensuciar" un poco es bajo. Cuando tenga tiempo de arreglar Windows, migra a Docker en una sesión separada.

**Implicaciones**:
- Postgres 18 instalado nativo (puerto 5432, password personal).
- Redis: **redis-windows port** (https://github.com/tporadowski/redis/releases) en lugar de Memurai (Memurai falló al instalar). Servicio `Redis` en `Get-Service`. CLI en `C:\Program Files\Redis\redis-cli.exe` (no en PATH).
- Documentado en `docs/14-roadmap.md` Fase 0 implicit (decisiones de implementación). Migración a Docker pendiente para sesión específica futura.

---

## 2026-05-07 — Memurai descartado, redis-windows como alternativa

**Contexto**: necesitamos Redis-compatible en Windows.

**Intento original**: Memurai for Valkey - Windows. Falló con "Setup Wizard ended prematurely" (probablemente VC++ Redistributable u otra dependency).

**Alternativa elegida**: **redis-windows** (port comunitario tporadowski).

**Razón**: Instalador `.msi` directo, sin formularios, instalación limpia. Versión Redis 5.x — suficiente para nuestro caso (BullMQ y cache funcionan).

**Implicaciones**:
- CLI con path completo: `& 'C:\Program Files\Redis\redis-cli.exe' ping`.
- Cuando llegue producción Linux, usaremos Valkey o Redis "verdadero".
- Memurai pendiente para retry futuro si redis-windows da problemas.

---

## 2026-05-07 — pnpm via Corepack (no instalación standalone)

**Contexto**: Node 24 ya trae Corepack que gestiona pnpm/yarn.

**Decisión**: **Habilitar pnpm via `corepack enable`** (PowerShell admin).

**Razón**: No necesita instalación separada. Node 24 viene con Corepack. Versión 11.0.8.

---

## 2026-05-08 — apps/api con NestJS 11 en CommonJS (no ESM)

**Contexto**: ¿NestJS con CommonJS o ESM?

**Decisión**: **CommonJS**.

**Razón**: Default oficial de NestJS CLI. Mejor compatibilidad con plugins/decoradores de NestJS. ESM en NestJS funciona pero requiere flags y workarounds. Para MVP, simple gana.

**Implicaciones**:
- Imports SIN `.js` al final (`import { AppModule } from './app.module'`).
- `tsconfig.json` extends `@casino/typescript-config/nest.json` con `module: CommonJS`.

---

## 2026-05-08 — Configs compartidas como packages internos

**Contexto**: ¿cómo compartir configs (eslint, typescript, prettier) entre apps?

**Decisión**: 
- **`packages/typescript-config`**: 4 presets (`base.json`, `nest.json`, `next.json`, `node.json`).
- **`packages/eslint-config`**: 3 configs flat (ESLint v9) — `base.js`, `nest.js`, `next.js`.
- **`.prettierrc.json` + `.prettierignore`** en raíz (no como package porque es config simple).

**Razón**: Configs como packages internas escalan mejor. Cada app extends su preset y agrega lo propio. Cambio en config compartida → propaga a todas las apps. Probaod con apps/api funcional.

**Implicaciones**:
- Apps consumen vía `"@casino/typescript-config": "workspace:*"` y `"@casino/eslint-config": "workspace:*"`.
- ESLint v9 flat config (no más `.eslintrc.json`).
- Prettier 3 con singleQuote, trailingComma all, printWidth 100.

---

## 2026-05-08 — pnpm v11 onlyBuiltDependencies → allowBuilds

**Contexto**: pnpm v10+ bloquea postinstall scripts por seguridad.

**Decisión**: **Permitir `@nestjs/core`** (necesita postinstall) en `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  '@nestjs/core': true
```

**Razón**: NestJS necesita postinstall para opencollective banner. No es malicioso. Cualquier paquete nuevo con postinstall se evalúa caso por caso (`pnpm approve-builds`).

---

## 2026-05-08 — Centralización de env en apps/api/.env.local

**Contexto**: scripts de `packages/db/` (drizzle-kit, setup, seed) necesitan acceso a `DATABASE_URL_CONTROL`. Inicialmente cada package importaba `dotenv/config` que solo lee `.env` desde el cwd actual.

**Opciones consideradas**:
- A) Cada package tiene su propio `.env.local`.
- B) `.env.local` único en raíz del repo.
- C) `.env.local` único en `apps/api/`, otros packages lo cargan con path explícito.

**Decisión**: **C**.

**Razón**: 
- En MVP solo `apps/api` necesita env vars para runtime.
- Los scripts de `packages/db` son dev-time tooling — pueden cargar el archivo con path absoluto.
- Evita duplicar secrets en múltiples archivos.
- Cuando agreguemos `apps/web` o `apps/panel` que necesiten env propias, podemos abrir un `.env.local` adicional en su carpeta.

**Implicaciones**:
- `packages/db/scripts/*.ts` y `drizzle.*.config.ts` cargan con:
  ```ts
  loadEnv({ path: path.resolve(process.cwd(), '../../apps/api/.env.local') });
  ```
- `process.cwd()` cuando pnpm corre con `--filter @casino/db` = `packages/db/`. Path relativo correcto.
- `.env.local` está gitignored. `.env.example` se mantiene como template público.

---

## 2026-05-08 — postgres.js como driver de Postgres

**Contexto**: Drizzle soporta múltiples drivers (postgres.js, node-postgres, neon, etc.). Hay que elegir uno.

**Decisión**: **`postgres` (postgres.js)**.

**Razón**:
- Más rápido que `pg` (node-postgres) en benchmarks comunes.
- Mejor integrado con Drizzle (los tipos fluyen sin overhead).
- API más moderna (template literals, async iterators).
- Menos dependencias transitivas.

**Implicaciones**:
- `packages/db/src/client.ts` factory con `postgres()` + `drizzle()`.
- Pool default 10 conexiones, idle_timeout 30s, connect_timeout 10s.
- Para producción será necesario tunear estos valores (más conexiones, ssl: 'require').

---

## 2026-05-08 — AdminTokenGuard fail-closed para endpoints administrativos

**Contexto**: el endpoint `GET /tenants` debe estar protegido. Auth real (JWT + permisos `platform.*`) llega en Fase 1.5+. Necesitamos algo en el medio.

**Opciones**:
- A) Endpoint público hasta que llegue auth real.
- B) Auth básica HTTP.
- C) Token simple en header validado contra env var (`X-Admin-Token`).

**Decisión**: **C**.

**Razón**:
- A es agujero de seguridad incluso en dev (filtración de info de tenants).
- B requiere user/password — overengineering para algo provisional.
- C es zero-effort y cubre el caso. Cuando llegue JWT, se reemplaza por un AuthGuard real.

**Implicaciones**:
- `apps/api/src/auth/admin-token.guard.ts` lee `X-Admin-Token` y compara con `process.env.ADMIN_API_TOKEN`.
- **Fail-closed**: si la env var no está configurada en el server, el guard rechaza todos los requests. Mejor 401 que dejar abierto por error de config.
- Documentado en `.env.example` con instrucciones de generar string random.

---

## 2026-05-08 — UUIDs v7 generados en TypeScript con uuid v11

**Contexto**: `docs/04-modelo-datos.md §4` exige UUIDs v7 para PKs. Postgres no tiene función nativa.

**Decisión**: **Generar en TS con paquete `uuid` v11+** (que incluye `v7` import).

**Razón**: 
- Cero dependencia de extensiones de Postgres (algunas hosting providers no las permiten).
- Control total desde código.
- Compatible con cualquier driver/ORM.

**Implicaciones**:
- `packages/db/src/utils/uuid.ts` exporta `generateUuidV7()`.
- Schemas Drizzle usan `.$defaultFn(() => generateUuidV7())` en columnas `id`.
- IDs generados confirmados con prefijo timestamp (`019e...`) en seed test.

---

## 2026-05-08 — `.env.example` debe quedar como template, edits van en `.env.local`

**Contexto**: durante setup, el usuario editó `.env.example` directamente con un placeholder fake (`<admin>` en lugar de `admin`).

**Lección operativa**: 
- `.env.example` es template público (commiteado).
- `.env.local` es el archivo real con credenciales (gitignored).
- Si un agente ve cambios en `.env.example` con valores que parecen secretos, debe revertir a placeholders y crear `.env.local` aparte.
- `<` y `>` son caracteres de placeholder, no parte del valor.

**Patrón recomendado** al instruir al usuario:
1. Crear archivo `.env.local` desde cero (no editar el `.example`).
2. Mostrarle el contenido exacto que debe poner.
3. Explicar que `<X>` significa "reemplazá esto", no "tipealo literal".

---

## 2026-05-08 — `nest build` con incremental cache puede no emitir archivos

**Contexto**: tras agregar nuevos modules (database, auth, tenants), el primer `nest build` retornaba exit 0 pero solo emitía algunos archivos en `dist/`.

**Diagnóstico**: el `tsconfig.tsbuildinfo` cacheado pensaba que todo estaba al día (porque no hubo cambios en archivos previamente compilados), pero el `dist/` estaba parcialmente borrado/inconsistente.

**Solución**: 
```bash
rm -f apps/api/tsconfig.tsbuildinfo
rm -rf apps/api/dist
pnpm --filter @casino/api build
```

**Lección para agentes futuros**: si `nest build` o `tsc` retornan 0 pero `dist/` no tiene los archivos esperados, **el primer paso de troubleshooting es borrar `tsbuildinfo` y `dist/` y reintentar**. No hay error que diagnosticar — solo cache stale.

Idealmente: agregar un script `clean` al `package.json` que haga este borrado, y correrlo antes de cada build cuando se sospeche.

---

## 2026-05-08 — Argon2id con `@node-rs/argon2`

**Contexto**: necesitamos hash de passwords. `docs/12 §2.2` decidió Argon2id.

**Opciones de implementación**:
- A) `argon2` (npm) — node-gyp, requiere VS Build Tools en Windows. Falla común.
- B) `bcryptjs` — pure JS, sin compilación, pero bcrypt (no Argon2).
- C) `@node-rs/argon2` — Rust binding via napi-rs. Prebuilds Windows/Mac/Linux. Sin node-gyp.

**Decisión**: **C — `@node-rs/argon2`**.

**Razón**: cumple la decisión de Argon2id sin las complicaciones de instalación de A. Performance similar a A. Mantenimiento activo (napi-rs team).

**Implicaciones**:
- Dep agregada a `packages/db`.
- Helpers `hashPassword()` y `verifyPassword()` en `packages/db/src/utils/password.ts`.
- Apps/api consume desde `@casino/db` (no necesita argon2 directo).

---

## 2026-05-08 — Password helpers en `@casino/db/utils` (no en apps/api)

**Contexto**: ¿dónde van las funciones de hash/verify de passwords?

**Opciones**:
- A) En apps/api/src/auth/ — argon2 como dep de api.
- B) En packages/db/src/utils/ — argon2 como dep de db.
- C) Package nuevo `@casino/auth-utils`.

**Decisión**: **B**.

**Razón**: 
- Tanto la auth real (apps/api) como los seeds (packages/db) necesitan hash de passwords.
- Si fueran a parar a apps/api, los seeds tendrían que duplicar argon2 o importarlo desde apps (acoplamiento raro paquete-app).
- @casino/db ya está disponible para ambos. Sumar utilidades de auth-básico ahí no fuerza un module nuevo.

**Trade-off conocido**: empuja un poco de "responsabilidad de auth" al package de db. Si crece (verificación de complejidad, rotación de hashes, etc.) lo movemos a un paquete propio.

**Implicaciones**: `import { hashPassword, verifyPassword } from '@casino/db'`.

---

## 2026-05-08 — JWT TTL parseado a segundos (no string)

**Contexto**: `JwtModule.signOptions.expiresIn` de `@nestjs/jwt` (que usa el paquete `ms` internamente) acepta `number | StringValue` — donde `StringValue` es un template literal type del paquete `ms` como `${number}m`, `${number}h`, etc. Un `string` genérico (lo que devuelve `ConfigService.get<string>()`) no le cuadra al tipado.

**Opciones**:
- A) Type assertion `as` directa (rompe strict typing).
- B) Hardcodear el TTL en código (pierde control vía .env).
- C) Parsear "15m" / "1h" / "30d" a segundos numéricos en runtime.

**Decisión**: **C**.

**Razón**: mantiene control vía .env, código tipado limpio, no depende de tipos internos del paquete `ms`.

**Implicaciones**: 
- Helper `parseTtlToSeconds()` en `apps/api/src/platform-auth/platform-auth.module.ts`.
- Acepta formato `\d+[smhd]`. Fallback configurable.
- Documentado para reusar si aparecen otros TTL configs.

---

## 2026-05-08 — JWT payload mínimo + discriminador `type`

**Contexto**: ¿qué metemos en el payload del JWT?

**Decisión**: payload mínimo:
```ts
{ sub: userId, email, type: 'platform' }
```

**Razones**:
- `sub` (subject): convención estándar JWT, identifica al user.
- `email`: para identificación rápida en logs/audits sin re-query.
- `type: 'platform'`: discriminador para no confundir con tokens de tenant en el futuro (cuando agreguemos auth de admin_tenant, socios, jugadores).
- Todo lo demás (display_name, permisos, etc.) se obtiene por re-query.

**Por qué no incluir más**: cada byte aumenta tamaño del token (que va en cada request). Los datos útiles cambian (display_name puede actualizarse). Mejor re-consultar DB en cada validación crítica.

**Implicaciones**: `validateJwtPayload()` en service re-consulta DB y verifica `status === 'active'`. Permite banear mid-session.

---

## 2026-05-08 — Mensajes de error genéricos en login

**Contexto**: si un usuario intenta loguearse con email mal y password mal, ¿qué error devolvemos?

**Decisión**: **siempre el mismo mensaje genérico** ("Credenciales inválidas") sin importar si:
- el email no existe
- la password es incorrecta

**Razón**: 
- Evita que un atacante use el endpoint para enumerar emails registrados.
- Mensajes distintos para "email no existe" vs "password incorrecta" filtran info.
- Stripe, GitHub, AWS hacen lo mismo.

**Implicaciones**: 
- Internamente loggeamos el detalle (email no encontrado / password incorrecta) para ops/debug.
- Hacia afuera: msg uniforme.

---

## 2026-05-08 — Refresh tokens opaque + SHA-256 (no Argon2 ni JWT)

**Contexto**: implementamos refresh tokens. Hay tres decisiones que tomar:
1. JWT vs opaque token.
2. Hash con qué algoritmo (Argon2 vs SHA-256 vs ninguno).
3. Rotación estricta vs lazy.

### 1. JWT vs opaque

**Decisión**: **opaque** (random bytes base64url).

**Razones**:
- JWT con TTL largo (30d) es difícil de revocar (stateless, no se puede invalidar antes del exp).
- Opaque + DB lookup permite revocar instantáneamente con un UPDATE.
- Refresh tokens son raramente verificados (cada 15 min), así que el "costo" de DB lookup es despreciable.
- Industria estándar: GitHub, Auth0, AWS lo hacen así.

### 2. Hash: SHA-256 (no Argon2)

**Razones**:
- El refresh token ya tiene **256 bits de entropía** (32 random bytes). No hay nada que "brute force-ear".
- Argon2 está diseñado para passwords débiles donde necesitamos slow hashing. Acá no aplica.
- Argon2 usa **salt random** → mismo input produce hashes distintos → **no se puede hacer lookup en DB por hash**.
- SHA-256 es **determinístico** → mismo token = mismo hash = lookup por hash.
- Performance: SHA-256 es ~100,000x más rápido que Argon2. Para algo que se hace en cada refresh request, importa.

### 3. Rotación estricta

**Decisión**: cada `/refresh` revoca el actual y emite uno nuevo.

**Razones**:
- Si alguien roba tu refresh token y lo usa, rotás → cuando el dueño legítimo refrescue, su token (ya rotado) será rechazado → señal de compromiso.
- Lazy rotation (mismo refresh sirve hasta exp) no detecta robo hasta que el token expira.
- Industria estándar (OAuth 2.0 BCP).

**Implicaciones**:
- Tabla `platform_user_sessions` con `token_hash UNIQUE`, `revoked_at`, `revoked_reason`.
- Service: `issueTokens()` privado helper. `login`, `refresh` lo usan.
- Reuso de refresh ya rotado → 401 + log warning. (En v2: revocar todas las sesiones del user como protección agresiva.)
- Logout = `UPDATE revoked_at`, idempotente.

---

## 2026-05-08 — Refresh tokens y 2FA postpuestos (sesión auth básica)

**Contexto**: docs/12-seguridad-compliance.md describe refresh tokens rotativos (30 días) y 2FA obligatorio para super-admin. En la sesión que implementó auth básica decidimos solo access tokens.

**Decisión**: **Refresh tokens en sesión siguiente** (la que se ejecuta a continuación). 2FA pospuesto a otro sprint.

**Razón**: 
- Scope manejable por sesión.
- Refresh requiere infraestructura (tabla `platform_user_sessions`).
- 2FA requiere setup de TOTP (qr code, recovery codes, etc.).

**Resultado**: refresh tokens implementados y funcionando (ver entrada arriba). 2FA sigue pendiente.

---

# Decisiones futuras a tomar (TBD)

Los `.md` de `/docs` listan pendientes que merecen discusión cuando aparezcan:
- Provider concreto a contratar primero (cuando se quiera real game provider).
- Política de fees del provider (antes/después del cálculo de comisión super-admin).
- Multi-region (cuando un tenant lo justifique).
- Estrategia exacta de bucket R2 (compartido con prefix vs uno por tenant).
- Decisión sobre captcha (Cloudflare Turnstile vs hCaptcha vs reCAPTCHA).
- Schemas de DB de tenant (próximo sprint).
- TenantResolver middleware (después de schemas de tenant).
- Sustitución de AdminTokenGuard por JWT + permisos `platform.*` (Fase 1.5+).

Cuando alguno se decida, agregar entrada acá.
