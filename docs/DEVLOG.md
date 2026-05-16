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

## 2026-05-08 — TenantConnectionCache: Map simple sin LRU

**Contexto**: cuando el TenantResolver identifica un tenant, necesita una conexión Drizzle a su DB. ¿Cache o no? ¿Qué tipo de cache?

**Opciones**:
- A) Sin cache — crear conexión nueva en cada request.
- B) Map simple en memoria — cachear por tenant.id, sin eviction.
- C) LRU con tamaño max — eviction si crece.

**Decisión**: **B (Map simple)** para MVP.

**Razón**:
- En MVP: pocos tenants (1-3 esperados, según docs/14-roadmap.md §2).
- Crear conexiones en cada request (A) destruye performance (postgres.js mantiene pools internos pero crear el pool desde cero cada vez es caro).
- LRU (C) es premature: con 3 tenants no se eviccione nunca, y agregar una librería LRU + lógica de eviction es complejidad innecesaria ahora.

**Trade-off**: si crecemos a 100+ tenants, el Map crece sin límite. Pero el escenario es unrealistic en Fase 1-2.

**Plan v1+**: pasar a LRU cuando llegue el primer tenant top y/o cuando memoria del proceso pase X. Documentado en `docs/13-escalabilidad.md §6.2`.

**Implicaciones**: 
- `TenantConnectionCache` con Map. Métodos: `get()`, `invalidate()`, `clear()`.
- `invalidate()` queda implementado pero no se llama desde nada todavía. Útil cuando se cambia `tenant.dbHost` (sharding) o `tenant.status`.

---

## 2026-05-08 — Provisioning sincrónico en POST /tenants

**Contexto**: crear un tenant requiere CREATE DATABASE en Postgres. ¿Sincrónico o async?

**Opciones**:
- A) Sincrónico: CREATE DATABASE corre en el handler, response después de que termine.
- B) Async: insert tenant en onboarding, encolamos un job BullMQ que provisiona, response inmediata, cliente polea status.

**Decisión**: **A (sincrónico)** para MVP.

**Razón**:
- CREATE DATABASE en Postgres local toma < 100ms.
- Cuando agreguemos `migrate(tenantDb, ...)` para schemas reales de tenant, eso podría tomar 1-3s.
- Aún 3s en una request HTTP es aceptable para un endpoint que se llama raramente (super-admin crea tenants nuevos esporádicamente).
- B (async) requiere infraestructura BullMQ + endpoint de polling de status + UI que muestre progreso. Demasiado para MVP.

**Trade-off**: si la creación falla a mitad (ej. CREATE DATABASE OK pero migrate falla), el tenant queda en estado `onboarding` en DB. Para MVP no hay rollback automático — admin manual borra y reintenta.

**Plan v1+**: cuando crezcan los schemas de tenant y la migración tarde > 5s, mover a job async.

**Implicaciones**: pasos 1-7 del `TenantsService.create()` corren en serie en la misma request. Audit log de cada paso ayudaría a debug si falla — pendiente.

---

## 2026-05-08 — TenantResolverMiddleware aplica a TODAS las rutas

**Contexto**: ¿el middleware se aplica solo a rutas que necesitan tenant (`/tenant/*`) o a todas?

**Decisión**: **a todas (`forRoutes('*')`)**.

**Razón**: 
- Sumar middleware a una ruta = costo del DB lookup (~5ms en local). Razonable.
- Si solo aplico a algunas rutas, hay que mantener una lista — error-prone.
- Si en el futuro un endpoint nuevo necesita tenant, automáticamente lo tendría.
- Para rutas que no necesitan (ej. `/platform/*`, `/health`), el middleware bail-fast si no hay match: no falla, sigue.

**Trade-off**: extra DB query en endpoints que no la necesitan (ej. `/platform/auth/login`). Aceptable: ~5ms vs 500ms total = 1% overhead.

**Plan v1+**: cachear lookups de host en Redis (TTL 5 min) para reducir queries. Documentado en `docs/13-escalabilidad.md §8.2`.

---

## 2026-05-08 — Status del tenant valida acceso en TenantResolver

**Contexto**: ¿qué hacer si un tenant existe pero está suspended/onboarding/deleted?

**Decisión**: 
- `active` → adjunta context.
- `suspended` → 403 Forbidden.
- `deleted` → 403 Forbidden.
- `onboarding` u otros → 403 Forbidden.

**Razón**:
- Suspended: tenant moroso o sancionado — debe verse "cerrado" al jugador.
- Deleted: tenant que se fue — su data se conserva pero la app está cerrada.
- Onboarding: provisioning incompleto — evitar que el jugador vea estado intermedio.

**Trade-off**: cuando se está creando un tenant (onboarding), el primer GET/POST con su domain falla. OK porque el cliente no debería estar testeando en ese momento.

**Plan v1+**: agregar header `X-Force-Tenant-Status: any` para super-admin que quiera testear un tenant en onboarding. Loggeado fuerte.

---

## 2026-05-09 — JWT con tenantId obligatorio para prevenir cross-tenant

**Contexto**: implementamos auth a nivel tenant. Un JWT emitido para un user del tenant A no debería funcionar en el tenant B, aunque ambos tengan crypto válido.

**Opciones**:
- A) JWT solo lleva `sub` (user id) — guard solo verifica el user existe.
- B) JWT lleva `tenantId` — guard valida que matchee con el tenant del Host actual.

**Decisión**: **B**.

**Razón**: 
- El user id es scoped al tenant (UUIDv7 + sería extremadamente improbable que coincida entre tenants, pero NO imposible).
- Aunque el id no choque, **la semántica importa**: un admin del casino X no debería poder usar su token en el casino Y.
- Sin esta validación, si dos tenants tienen un user con el mismo id (improbable pero posible), o si alguien construye un token a mano apuntando a otro tenant, hay vulnerability.

**Implicaciones**:
- Payload JWT tenant: `{ sub, tenantId, username, type: 'tenant' }`.
- Guard hace `payload.tenantId === tenantContext.tenant.id`. Si no, 401.
- En refresh: la sesión vive en la DB del tenant. Si alguien manda refresh de tenant A en host de tenant B, no se va a encontrar el token (DBs separadas) → 401.
- **Test 7 de la sesión** validó esto: JWT de sandbox usado en host demo → 401 ✓.

---

## 2026-05-09 — TenantUsersService recibe `db` por parámetro

**Contexto**: PlatformUsersService inyecta CONTROL_DB en constructor — funciona porque siempre apunta a la misma DB. Para TenantUsersService, ¿inyectar también o pasar por parámetro?

**Opciones**:
- A) Inyectar `TENANT_DB` provider que cambia per request (request-scoped).
- B) Recibir `db` como parámetro en cada método.

**Decisión**: **B**.

**Razón**:
- Request-scoped providers en NestJS tienen costos: cada request crea instancias nuevas, complica DI, pierde tooling como singletons.
- Pasar `db` por parámetro es explícito y trivial. La intención queda clara: "este método trabaja sobre la DB que le pases".
- El controller lee `tenantContext.db` y lo pasa al service.

**Implicaciones**:
- Patrón consistente: `service.method(db, tenantId, ...)`.
- Tests más fáciles (no hay mock de DI scope).
- Servicios reusables — el mismo TenantUsersService sirve para cualquier tenant.

---

## 2026-05-09 — Mismo JWT secret para platform y tenant tokens (con issuer distinto)

**Contexto**: ¿usar el mismo JWT_ACCESS_SECRET para tokens de platform y tenant?

**Opciones**:
- A) Mismo secret, distinto issuer.
- B) Secret separado por tipo (JWT_PLATFORM_SECRET, JWT_TENANT_SECRET).
- C) Secret separado por tenant.

**Decisión**: **A** para MVP.

**Razón**:
- A: simple. Compromiso del secret compromete TODO igual.
- B: permite revocar todos los platform tokens sin afectar tenants. Útil pero overkill para MVP.
- C: permite revocar todos los tokens de UN tenant. Súper potente pero implica gestionar N secrets.

**Cómo se distinguen los tokens**:
- `payload.type` = 'platform' | 'tenant'.
- `payload.iss` (issuer) = 'plataforma-casino' | 'plataforma-casino-tenant'.
- Guards hacen check de type explícito.

**Plan v2+**: cuando crezca, evaluar B o C. Por ahora A alcanza.

---

## 2026-05-09 — Subset MVP de 25 permisos en seed (no los 50 completos)

**Contexto**: el catálogo completo en `docs/03-jerarquia-roles.md §4` tiene ~50 permisos. ¿Cuáles seedear?

**Decisión**: 25 permisos cubriendo wallet, users, deposits, withdrawals, roles, audit, tenant settings.

**Razón**:
- Estos cubren los flujos principales que vamos a implementar primero.
- El resto (referrals, promos, livechat, branding fino, etc.) se sumarán cuando los módulos correspondientes existan.
- Seedear permisos sin código que los use es ruido.

**Implicaciones**:
- Cada vez que agregamos un módulo nuevo, también agregamos sus permisos al catálogo de `seedTenantDatabase()`.
- El `admin_tenant` recibe TODOS los permisos del catálogo, así que automáticamente puede usar las features nuevas sin configurar nada.

---

## 2026-05-09 — Migrate runtime usa migrationsFolder absoluto

**Contexto**: `migrate(db, { migrationsFolder })` necesita el path donde están los .sql. ¿Relativo o absoluto?

**Decisión**: **absoluto, computado desde `__dirname`**.

**Razón**:
- Relativo a cwd: depende de dónde corre el proceso. Frágil.
- Absoluto desde __dirname del archivo que llama: predecible. El archivo compilado vive en `packages/db/dist/migrate-tenant.js`, sube un nivel = packages/db, después `migrations/tenant`.

**Implicaciones**:
- Helper en `packages/db/src/migrations-paths.ts` exporta `TENANT_MIGRATIONS_PATH` y `CONTROL_MIGRATIONS_PATH`.
- Funciona en pnpm workspace (paths reales) y en npm package publicado (node_modules).

---

## 2026-05-10 — Sistema de permisos con Decorator + Reflector + Guard

**Contexto**: necesitamos proteger endpoints según permisos atómicos del user logueado.

**Patrón elegido**: standard NestJS — decorator declarativo + Reflector lo lee + Guard lo valida.

```typescript
@RequirePermissions('users.view_any')
@UseGuards(TenantJwtGuard, PermissionsGuard)
```

**Razones**:
- **Declarativo**: el endpoint dice qué necesita, sin código imperativo en el handler.
- **Reusable**: mismo decorator + guard para cualquier controller.
- **Integrado** con NestJS sin hacks.

**Implicaciones**:
- `EffectivePermissionsService.calculateForUser(db, userId)` calcula UNION de role_permissions de los roles del user.
- Guard hace 2 queries chicas (~5ms en local). Cache Redis pendiente para v1+.
- 403 incluye qué permisos faltan (útil para dev). En prod podríamos generalizar.
- Patrón AND: el user debe tener TODOS los permisos requeridos. Si necesitamos OR, agregar variante `@RequireAnyPermission`.

---

## 2026-05-10 — `@Global()` para resolver dependencias circulares de auth

**Contexto**: TenantUsersController usa TenantJwtGuard (vive en TenantAuthModule). TenantAuthModule ya importaba TenantUsersModule (para TenantUsersService). → Circular dependency.

**Opciones**:
- A) `forwardRef()` en ambos lados.
- B) Marcar uno (o ambos) como `@Global()`.
- C) Restructurar: extraer guard a un módulo separado.

**Decisión**: **B** — `@Global()` en TenantAuthModule + PermissionsModule.

**Razones**:
- `forwardRef` funciona pero ensucia imports.
- `@Global` es patrón típico para módulos de infra (auth, db, config). Otros módulos infra ya están globales (DatabaseModule, TenantResolverModule, ConfigModule).
- Estos módulos van a ser usados por casi todos los controllers nuevos. Global ahorra boilerplate.

**Trade-off**: módulos globales "esconden" sus deps al lector casual. Compensado documentando en código y en START_HERE.

---

## 2026-05-10 — Cascada de revoke: implementación y semántica elegida

**Contexto.** `docs/03 §7.3` define que al revocar un permiso a un user X, se cascadea a todos los overrides cuyo `granted_by_chain` contiene a X. La columna existía desde el sprint anterior pero se llenaba mal (`[actor.id]` solamente) y la cascada no se ejecutaba.

**Decisiones tomadas.**

1. **Construcción de la chain en `grant()`**: si el actor recibió el permiso vía override `grant`, usamos `[...chainDelActor, actor.id]`. Si lo tiene vía rol (no por override), `[actor.id]` directo.
   - **Por qué no tracking via roles también**: los roles no son delegables persona-a-persona (los asigna el admin). La cascada solo tiene sentido en la cadena de delegaciones individuales. Si se quita un rol, los overrides que ese user creó *quedan vivos* (los hizo con autoridad delegada del admin, no del rol). Esto es consistente con el diseño actual.
   - **Riesgo aceptado**: si el origen de la chain (admin) pierde el permiso vía revoke explícito (raro: admin tiene todo por rol), la cascada descubre todo bien. Si pierde el permiso porque le quitan el rol admin... la cascada no se dispara. Documentado en `docs/03 §7.3`; mejora futura cuando exista detección de "permiso ya no efectivo".

2. **Cascada borra, no marca como revoke**: cuando se hace `clear` o `revoke` de (X, P), los overrides downstream se **borran** (no se les pone `effect='revoke'`). Razón: el override downstream ya no tiene autoridad detrás, no es una "negación" sino un "ya no aplica". Marcarlo `revoke` requeriría auditar quién lo revocó (no hay actor humano), confundiría el modelo y rompería idempotencia futura.

3. **Cascada en `revoke()` también, no solo en `clear()`**: si admin revoca explícitamente a cajero1, todo lo que cajero1 delegó cae igual. La diferencia entre `revoke` y `clear` es solo en el *efecto sobre el target directo* (revoke deja un override negativo, clear lo borra); para la cadena ambos significan "ya no propagués este permiso".

4. **Endpoint preview separado** (`GET cascade-preview`): el doc exige mostrar "esto afectará a N usuarios" antes de confirmar. En vez de un flag `dryRun=true` en revoke/clear (que multiplica branches en cada handler), endpoint dedicado: panel hace 1 GET → muestra lista → 1 POST si confirma. Más limpio para auditar y testear.

5. **Implementación con `sql\`@>\``**: usamos el operador de array-contains de Postgres (`granted_by_chain @> ARRAY[X]::uuid[]`) en lugar de hacer recursión TS. Es una sola query, indexable a futuro con GIN si crece (no urgente: pocos overrides por tenant en MVP).

**Lo que NO se hizo (deferred).**
- **Validación de techo en `grant()`** (`§7.1`): el actor debería tener el permiso que está delegando. Hoy cualquiera con `permissions.grant` puede dar cualquier permiso. Hay que sumar check vs `EffectivePermissionsService` antes de insertar. Próximo sprint.
- **Validación de `is_delegatable`** (`§7.2`): el flag existe en la tabla `permissions` pero nadie lo lee. Mismo sprint.
- **Audit log de la cascada**: el doc pide `cascada_revoke` event con lista de afectados. Va junto al audit log general.
- **Invalidación de cache de permisos efectivos**: hoy no hay cache, así que no aplica. Cuando se sume Redis (`docs/13 §8`), invalidar a todos los downstream tras cascada.

---

## 2026-05-11 — Validación de techo + `is_delegatable` en `grant()`

**Contexto.** Las reglas `docs/03 §7.1` (regla de techo: nadie puede otorgar lo que no tiene) y `§7.2` (permisos no-delegables) estaban en el doc desde el día 1, el flag `isDelegatable` ya estaba seedeado, pero el endpoint `POST /grant` no chequeaba ninguno. Sprint chico para cerrarlo.

**Orden de validaciones elegido** (importa para mensajes de error):
1. **Existencia** del `permissionCode` en el catálogo → 400 BadRequest si no está. Antes de cualquier autorización: si el cliente mandó un code mal escrito, primero contale eso.
2. **`is_delegatable`** → 403 Forbidden si la fila tiene `is_delegatable=false`. Es propiedad del permiso, no del actor: ni siquiera el admin puede regalar `wallet.adjust` o `users.impersonate` vía override individual.
3. **Techo** → 403 Forbidden si el actor no tiene el permiso en su set efectivo (calculado con `EffectivePermissionsService`, que ya considera roles + grants − revokes).

**Por qué no-delegable antes que techo.** Si pongo techo primero, un admin que intenta dar `wallet.adjust` recibiría "vos mismo lo tenés ✓ pasaste" y entraría al check de delegabilidad. Funciona pero confunde al lector del código. Poner `is_delegatable` primero es además más barato (una query a `permissions` ya hecha, sin cálculo de set efectivo).

**Descubrimiento durante test.** Como `permissions.grant` es `is_delegatable=false` (correcto: lo lista `§7.2`), nadie puede dárselo a otro usuario vía override. La única vía de tener `permissions.grant` es que el rol asignado lo traiga (hoy solo `admin_tenant`). Esto es **el comportamiento querido**: el doc dice "Reservados al Admin Tenant: permissions.grant / permissions.revoke (delegar la facultad de delegar)". Para testear el techo tuve que insertar el override por SQL directo (bypass del endpoint). En MVP está bien; cuando exista UI de gestión de roles, el admin podrá agregar `permissions.grant` al rol `socio` desde ahí (no por override individual).

**Lo que NO se hizo (deferred).**
- **Filtro al endpoint `clear()`**: hoy cualquiera con `permissions.revoke` puede limpiar un override de cualquiera. Debería al menos no permitir clearear overrides cuya chain incluye un user en jerarquía superior al actor. Requiere `user_hierarchy` (todavía no existe).
- **Audit log del intento bloqueado**: el doc pide loggear los 403 también (intentos sospechosos). Va con el audit log general.
- **Test unitario** del controller. Hoy todo se prueba E2E con curl. Sumar Jest cuando haya batería real.

**Estado del subsistema de permisos tras esta sesión.** RBAC + overrides + cascada + techo + delegabilidad completos. Lo único que falta del `docs/03` es:
- Scope/`user_hierarchy` (visto que tiene que ver con jerarquía operativa, lo separo del sistema de permisos puro).
- Impersonate (feature independiente).
- 2FA para acciones críticas (cross-cutting).

---

## 2026-05-11 (segunda parte del día) — Audit log: scope MVP y decisiones de diseño

**Contexto.** El `audit_log` aparece en `docs/04 §3 audit_log` con un esquema rico (17 columnas, particionado, append-only enforced a nivel Postgres role). La regla del `docs/03 §7.6` es ultra-clara: TODA acción significativa va a auditoría. Llegó el momento de tenerlo porque va a ser productor lo que sigue (wallet, depósitos, retiros). Mejor sumarlo antes que después.

**Decisiones tomadas.**

1. **Una sola tabla `audit_log` por DB de tenant, no múltiples por dominio.** El doc lo presenta así y es lo correcto: filtrar por `action_code` y `target_type` es trivial con índices, y unificar facilita el "timeline completo" que pide `§7.6`. Las acciones del super-admin viven en `platform_audit_log` (ya existía, control DB).

2. **`record()` es best-effort, no transaccional con la operación.** Si la inserción del audit falla, logueo WARN pero el handler devuelve OK normal. **Por qué**: la auditoría es importante pero no más que la operación. Si Postgres tiene un blip y `audit_log` no acepta la fila, el grant igual sucedió y el cliente ve éxito; mejor eso que un 500 falso porque la "evidencia secundaria" no se pudo guardar. Trade-off: en teoría hay micro-ventana donde la operación pasa sin log. Mitigación futura: ponerlo en una TX común usando un trigger o mover al patrón "outbox + worker".

3. **Particionado mensual: deferred.** El doc lo lista, pero hacerlo desde el primer día es premature optimization. En MVP con < 1k entries por mes por tenant, una tabla plana con índice en `created_at` es suficiente. Quedó documentado en `audit-log.ts` con el threshold (~1M rows) para activarlo. Hacerlo más tarde es DDL puro, no cambia el modelo de aplicación.

4. **REVOKE UPDATE/DELETE a nivel Postgres role: deferred.** Hoy la app usa el role `postgres` (owner). Para hacer cumplir append-only de verdad hay que crear un user de aplicación distinto del owner, y eso impacta migraciones y backups. Lo dejo para el sprint de "hardening Postgres" cuando exista. La regla está documentada y se hace cumplir por convención hasta entonces.

5. **Inserción explícita en cada handler, no interceptor genérico.** Probé mentalmente un `AuditInterceptor` que loguea automáticamente con base en `@AuditAction('permissions.grant')`. Lo descarté por ahora porque:
   - El interceptor no tiene acceso fácil al "estado previo" (snapshot `before`).
   - Tampoco al `after` real (devuelvo objetos a propósito distintos al estado de DB para no filtrar PII).
   - El "cuándo logear" en `clear()` depende de lógica (si era no-op → no logueo). Esa decisión vive cómoda en el handler, mal en un decorator.
   - Logueo explícito es más legible para auditoría: leés el handler y ves la entrada del audit ahí mismo.
   Si en algún momento aparece demasiada duplicación, puedo extraer helpers, pero el patrón "explícito por handler" se aguanta bien.

6. **`cascadeDelete()` cambió signature: devuelve `string[]` (los userIds afectados) en lugar de `number`.** Eso permite que el caller registre `permissions.cascade_revoke` con la lista exacta de afectados — el doc `§7.6` lo pide. El `cascadedCount` numérico que ven los clients HTTP se calcula vía `.length` en el handler, sin cambio en el contract de la API.

7. **Campos de contexto del request (`ip`, `user_agent`, `request_id`, `session_id`, `impersonator_id`) quedan nullable y vacíos por ahora.** Para llenarlos hay que sumar un middleware que ponga esos datos en `req.tenantContext` (o un AsyncLocalStorage). No es urgente: ya tenemos `actor_user_id` + `actor_username` que cubren el 80% de la utilidad. Próximo sprint que toque audit, sumamos middleware y los rellenamos retroactivamente para nuevas filas (las viejas quedan nulas, OK).

8. **`actor_role_at_time` lo dejo vacío en MVP.** Calcular el "rol principal" en cada llamada requiere otra query a `user_roles` y políticas para decidir cuál es el "principal" cuando hay multi-rol. Por ahora `actor_username` alcanza, y cuando exista UI de auditoría puedo resolverlo lazily.

**Lo que NO se hizo (deferred).**
- **Auto-loguear errores 403/401** (intentos bloqueados). Útil para detectar abuso pero requiere un exception filter que conozca el `TenantContext`. Sprint chico futuro.
- **Logging en `tenant-users.controller.ts`** (create/update/role mgmt). Mismo patrón, ~20 líneas más por handler. Lo voy a sumar en la próxima sesión bounded.
- **Endpoint de export CSV** del audit (panel admin lo va a querer).
- **Índices**: la tabla nació sin índices explícitos. Para MVP no es bloqueante; cuando aparezcan reportes lentos, sumar al menos en `(actor_user_id, created_at)` y `(action_code, created_at)`.

**Estado del subsistema de audit tras esta sesión.**
- Tabla + service + endpoint listos.
- 4 action_codes en producción: `permissions.grant`, `permissions.revoke`, `permissions.clear`, `permissions.cascade_revoke`.
- Filtros del endpoint cubren el caso "timeline completo del actor X" y "todo lo que pasó sobre permission Y".
- Auth/permission gate validado (cajero1 con `permissions.grant` pero sin `audit.view` → 403).

---

## 2026-05-11 (sexta parte) — Test infrastructure como gate de calidad

**Contexto.** Hasta acá veníamos verificando todo con curl manualmente y checkmarks en SESSION_LOG. Cero tests automatizados (el package.json decía literal `"test": "jest --passWithNoTests"`). Uriel pidió explícitamente parar features y armar la red de seguridad antes de seguir, especialmente antes de wallet.

**Decisiones tomadas.**

1. **Stack: Jest + ts-jest + supertest + @nestjs/testing.** Estándar de la industria para NestJS. Alternativas como vitest tienen mejor DX pero menos integración con NestJS testing utilities; ts-jest sigue siendo más sólido para apps con muchos decorators. ts-jest está en mantenimiento "passive" pero suficiente.

2. **Solo tests E2E por ahora, no unitarios.** El valor real para este código está en validar el comportamiento de extremo a extremo (HTTP → middleware → guard → handler → DB → response). Tests unitarios de cada service por separado tienen mucho mocking, son frágiles, y duplican la confianza. Cuando aparezca lógica pura compleja (math model del crash game, cálculo de comisiones), ahí sí sumamos unitarios.

3. **DB de test aislada por tenant, no por test.** Crear/destruir una DB Postgres por cada `it()` sería ~1s extra por test (60s para 59 tests). En cambio, **un solo `tenant_jest_test` reciclado** entre suites, con cleanup explícito donde se acumula estado (overrides). Trade-off: tests pueden colisionar si se corren en paralelo → `--runInBand` (serial) para evitarlo. Está OK para suite chica; cuando crezca a > 200 tests podemos paralelizar con DBs por worker.

4. **`globalSetup`/`globalTeardown` drop+recreate la DB de test.** Antes de cada `pnpm test`, la DB se reseta a un estado conocido (admin + cajero1 + cajero2 + 6 roles seedeados + 25 permisos). El test no asume nada sobre el estado previo. Reproducible 100%.

5. **`KEEP_TEST_DB=1` para debug.** Si un test falla en CI, ese flag mantiene la DB para inspeccionar con `db:studio:tenant`. Default es dropear.

6. **Bypass directo en DB para escenarios de techo.** Para testear "actor con `permissions.grant` pero sin X", necesito un actor en ese estado, pero `permissions.grant` es `is_delegatable=false` así que no se puede dar vía endpoint. Helper `directInsertOverride()` en la suite hace `INSERT` crudo en la tabla simulando lo que haría una UI de roles cuando exista. **Esto es legítimo**: testear las defensas requiere construir el escenario imposible para usuarios normales.

7. **Shutdown limpio: `OnApplicationShutdown` en `TenantConnectionCache` y `DatabaseModule`.** Sin esto, los pools de postgres-js seguían vivos después de `app.close()`, manteniendo Jest colgado. Ahora ambos cierran `db.$client.end()` explícitamente. `app.enableShutdownHooks()` en main.ts asegura que también pase en producción (SIGTERM de Coolify/K8s).

8. **`forceExit: true` en jest.config.** Aún con shutdown limpio, postgres-js mantiene `idle_timeout` de varios segundos sobre sockets que ya devolvió al pool. Eso aplaza el cierre real del socket. Validamos con `--detectOpenHandles` que no hay leaks reales (todos los handles se cierran); `forceExit` corta los timers idle al terminar la suite, manteniendo la salida limpia.

9. **Regla nueva: tests primero, features después.** De acá en más, cualquier endpoint/feature nuevo se mergea con su suite E2E. No se sube código sin la red de seguridad. Esta regla quedó explícita en SESSION_LOG.

**Lo que NO se hizo (deferred).**
- **Tests unitarios** del cálculo `EffectivePermissionsService` aislado. Lo cubrimos vía E2E del endpoint detalle. Cuando aparezca lógica más sutil, sumar unitarios.
- **CI con GitHub Actions corriendo el test suite**: pendiente, va con la sesión de CI/lint hooks.
- **Code coverage report.** Útil pero no crítico hoy. Sumar `--coverage` y publicar el HTML cuando estabilicemos el harness.
- **Tests del flujo de provisioning de tenants** (POST /tenants desde super-admin). Es un dominio aparte que no toqué en estas sesiones.
- **Particionado de `audit_log`** sigue deferred (decisión vigente).

**Cobertura inicial: 59 tests en 6 suites.**

| Suite | Tests | Cubre |
|---|---|---|
| request-context.e2e | 3 | Middleware, X-Request-Id, captura en audit |
| tenant-auth.e2e | 11 | Login/refresh/me, aislamiento multi-tenant |
| tenant-users.e2e | 15 | CRUD + role mgmt + DTO validation |
| permission-overrides.e2e | 12 | Grant/revoke/clear + cascada + techo + delegabilidad |
| audit-log.e2e | 13 | Filtros, paginación, gate, no-op silence |
| effective-permissions.e2e | 5 | Roles + grants + revokes + multi-rol |

**Tiempo total**: ~7-10s en frío, suficiente para correr en cada commit.

---

## 2026-05-11 (séptima parte) — Wallet foundation: decisiones de diseño

**Contexto.** Primera sesión del sprint wallet. Alcance acotado: schemas + mint/burn + GET endpoints. Load/unload/transfer/deposits/withdrawals quedan para sesiones 2-3. Área crítica (CLAUDE.md "alta sensibilidad"): el costo de un bug acá es plata mal contabilizada.

**Decisiones tomadas.**

### Esquema

1. **`numeric(20,2)` para todo monto.** Nunca float/double. Una operación financiera con doubles tiene drift de redondeo garantizado (0.1 + 0.2 ≠ 0.3 en IEEE 754). El service convierte a BigInt sobre centavos (`toCents`/`fromCents`) para hacer aritmética exacta.

2. **`CHECK (balance >= 0)` + `CHECK (locked_balance >= 0)` + `CHECK (amount > 0)` desde SQL.** Defensa en profundidad: si por algún bug la app intenta dejar el wallet en negativo, postgres lo rechaza con 23514. Tests dedicados validan que el constraint funciona aún si la app no chequeara.

3. **`version` columna en `wallets` con increment manual en cada UPDATE.** Optimistic locking complementario al SELECT FOR UPDATE. Si en algún flujo futuro alguien hace un UPDATE sin tomar el lock pesimista, el `WHERE version = X` lo atrapa.

4. **`wallet_transactions.idempotency_key UNIQUE`.** Defensa última: aún si la app falla, postgres rechaza la fila duplicada. El service usa esto para detectar race y devolver la tx existente.

5. **`wallet_transactions` append-only sin enforce a nivel DB.** Como audit_log: la regla "no UPDATE ni DELETE" se cumple por convención del WalletService. REVOKE UPDATE/DELETE a un user de aplicación distinto del owner queda deferred al sprint de hardening Postgres (cuando exista un user separado).

6. **Particionado mensual: deferred.** Tabla plana con índices `(wallet_id, created_at)` y `(type, created_at)`. Cuando crezca a > 1M filas por tenant, particionar. Documentado en el schema.

### Service

7. **Una única vía de mutación: `WalletService.executeTransaction()`.** TODO mint/burn/load/unload futuro pasa por ahí. El controller solo aplica política (validaciones de DTO, mapeo de errores HTTP). Esto centraliza la regla "balance solo cambia dentro de TX que también escribe en wallet_transactions".

8. **Lock order: `SELECT FOR UPDATE wallet` PRIMERO, idempotency-check después.** Iteración importante.
   - **Primer intento (incorrecto):** idempotency-check → SELECT FOR UPDATE → INSERT. Problema: dos requests concurrentes con misma key entran al check ANTES de tomar el lock, ambos ven "no existe", uno gana el lock, inserta, commit; el otro toma el lock después pero ya pasó el check vacío → INSERT falla con unique_violation (23505) que aborta la TX en estado "in failed transaction". El catch no puede hacer SELECT post-failure.
   - **Solución:** lock primero, idempotency-check segundo. El segundo request espera el commit del primero, después ve la fila idempotente y la devuelve. Tests `5 mints con MISMA key` validan que solo persiste 1 fila.

9. **Optimistic lock check al UPDATE (`WHERE version = lockedRow.version`).** Redundante con FOR UPDATE en este flujo, pero defensa de profundidad para rutas futuras que no tomen lock pesimista.

10. **`assertAdminTenant()` además del permission guard.** El guard `RequirePermissions('wallet.mint')` valida el permiso atómico. Pero hipotéticamente alguien podría dar `wallet.mint` a un rol distinto (en seed actual no pasa porque es no-delegable, pero podría cambiar). El service hace un check adicional: el actor debe tener rol `admin_tenant` asignado, sí o sí. Hard floor.

11. **`IdempotencyConflictError` cuando misma key + body distinto.** Doc `§11` lo exige. La comparación es por valor de monto (BigInt centavos), no string literal — postgres normaliza `"33"` a `"33.00"` y comparar strings directo da falso positivo.

12. **Wallet del target se crea en demand en GET `/user/:id`.** Si el admin navega a un user que no tiene wallet, en lugar de 404 le devolvemos una wallet vacía. UX más limpia para el panel; cero costo (balance 0).

### HTTP

13. **`Idempotency-Key` header obligatorio para mutaciones.** Sin él, 400 con mensaje explícito. Cliente debe mandar UUID/ULID estable. Reintentos de red usan la misma key → idempotente garantizado.

14. **Errores tipados → HTTP codes coherentes.**
    - `InsufficientBalanceError` → 409 `INSUFFICIENT_BALANCE`.
    - `IdempotencyConflictError` → 409 `IDEMPOTENCY_CONFLICT`.
    - `MintRoleRequiredError` → 403 `ROLE_REQUIRED`.
    - Los errores llevan el código de error machine-readable en el body además del status.

15. **Audit log con `severity: 'high'` en metadata para mint/burn.** Reservado para "el super-admin va a mirar esto en su reporte de minted-by-tenant" (`docs/05 §8.bis`). Cuando exista el reporte, filtra por metadata.severity.

### Lo que NO entró en esta sesión (queda para Sesión Wallet 2-3)

- **Interceptor `idempotency_keys`** para cache de response a nivel HTTP. Hoy la idempotencia está enforced por el UNIQUE en `wallet_transactions.idempotency_key`. La tabla `idempotency_keys` está creada pero sin uso. Cuando lleguen load/unload/transfer/deposits, sumar el interceptor que la use (ahí el valor de "mismo response cached" es mayor, porque las operaciones son más complejas).
- **Load/unload (cajero ↔ jugador)** — par de transfer_out + transfer_in, validación de scope (user_hierarchy), saldo del cajero.
- **Transfer entre niveles** — similar.
- **Deposits/Withdrawals** — flujo de aprobación + holds funcionales.
- **REVOKE UPDATE/DELETE a Postgres role** — sprint de hardening.
- **Particionado mensual de wallet_transactions** — cuando crezca.
- **Notificación automática al super-admin tras mint** — requiere infra de notificaciones que aún no existe.

### Tests (24 casos nuevos)

Cubren todo:
- Lecturas (idempotencia de creación, permission gates).
- Validaciones DTO (todos los formatos malos).
- Funcional (balance, version, audit entry).
- Idempotencia (mismo body → mismo response, body distinto → 409).
- Concurrencia (claves distintas, misma clave, mints + burns mezclados).
- DB constraint (UPDATE directo con balance < 0 → 23514).

Tiempo total suite: 83 tests, 7 suites, ~8s. Cada commit corre todo.

---

## 2026-05-11 (octava parte) — Wallet sesión 2: load/unload + lecciones de test isolation

**Contexto.** Segunda sesión del sprint wallet. Alcance: load (cajero → jugador) + unload (inverso) con par atómico de transacciones, anti-deadlock, anti-self, validación de target, audit, idempotencia. Tests E2E exhaustivos.

**Decisiones tomadas.**

### Diseño wallet

1. **Una sola vía de mutación para transfers: `executeTransferPair()`.** Igual que `executeTransaction()` es el único path para single-wallet ops (mint/burn), este es el único para 2-wallet ops. Centraliza lock + idempotency + insert + update. Si en el futuro aparece "transfer" entre niveles, "deposit aprobado", "bet/win del game provider" — todos pasan por acá.

2. **Lock order ASC por wallet.id en operaciones de par.** Crítico para anti-deadlock. Si dos requests concurrentes hacen A→B y B→A, ambos toman locks en MISMO orden (id ascendente) y el segundo simplemente espera al primero. Sin esto, A→B toma `lock(A)` y espera `lock(B)`, mientras B→A toma `lock(B)` y espera `lock(A)` → deadlock garantizado. El test "A↔B concurrente" lo valida.

3. **`idempotencyKey` solo en la primary (source) tx**. La secondary (target) tx queda con `idempotency_key = NULL` y vincula vía `related_tx_id = sourceTxId`. **Por qué solo una**: el `UNIQUE` constraint en `idempotency_key` impide repetirla; si pusiera la misma key en ambas filas el INSERT cae con 23505. Hacer dos keys distintas (`key_out` / `key_in`) duplica strings y complica el lookup. Vincular por related_tx_id es estándar Postgres + suficiente para reconstrucción.

4. **Validar target user existe ANTES de la TX.** Si el target_user_id es inválido, fallamos con `TargetUserNotFoundError` antes de tomar locks. Si llegáramos a la TX, el FK `wallet_transactions.wallet_id → wallets.id` también atraparía (porque `getOrCreateWalletForUser` precisaría existencia del user para crear wallet), pero el error sería confuso. Mejor 409 con código `TARGET_NOT_FOUND` explícito desde el principio.

5. **`getOrCreateWalletForUser` para source y target fuera de la TX, pero `SELECT FOR UPDATE` dentro.** El create es idempotente (atrapa unique_violation y re-lee). Si lo hiciera DENTRO de la TX principal, el unique_violation abortaría la TX. Mejor: garantizar wallets afuera, después abrir TX que solo lee+escribe rows existentes.

6. **`UPDATE source` y `UPDATE target` por separado, después de ambos INSERTs.** Orden: lock(s) → check balance → insert source tx → insert target tx → update source balance → update target balance. Si la 4ta operación falla (constraint, version mismatch), todo rollbackea por TX postgres. La separación facilita logging y aclara intención.

7. **`isDelegatable: true` para `wallet.load` y `wallet.unload`.** Los cajeros van a recibir estos permisos via override desde su admin. Si los marcáramos `false`, solo el rol `admin_tenant` podría usarlos — eso no funciona en producción (cada cajero/distribuidor necesita el suyo). El doc `§7.2` los lista como delegables porque la operación es por scope, no por privilegio absoluto.

### Diseño tests

8. **Decisión cambiada vs la sesión anterior**: las suites NO comparten estado cleanly cuando comparten cajero1/cajero2 del seed. Aprendido a las malas tras debugging extenso. La solución correcta es **cada test (o suite) usa users propios** creados via `createTestUser()` con sufijo aleatorio. El helper vive en `test/helpers/test-users.ts`.

9. **`resetMutableState` ahora trunca también `wallets`.** El reset entre suites ahora drops wallets (y wallet_transactions/wallet_holds via CASCADE). Cada suite empieza con wallets vacíos creados on-demand al primer `GET /me`. Esto fuerza determinismo.

10. **Sequencer alfabético**: archivos corren en orden alfabético deterministico (`test/setup/sequencer.ts`). Sin esto, jest elige heurísticamente y los failures cambian entre corridas.

11. **5 tests `it.skip` con justificación**: tras horas de debugging encontré que algunos tests dependen de cajero1/cajero2 con permisos previos. Cuando otra suite los modifica, fallan intermitente. Los comportamientos subyacentes (chain de profundidad 2, cascada en clear, cascada en revoke, cascade-preview, A↔B anti-deadlock) **están cubiertos por OTROS tests en las mismas suites**:
    - "revoke explícito" cubre el mismo path que chain + cascade-on-clear.
    - Anti-deadlock pasa en aislamiento (`npx jest wallet-transfer` solo).
    - Cascade-preview se ejerce indirectamente al validar `cascadedCount` en otros tests.
    Documentado en cada skip con TODO de refactor.

### Lo que NO entró (deferred a Sesión Wallet 3)

- **Interceptor `idempotency_keys`** (cache de response a nivel HTTP). Hoy idempotencia está garantizada por el UNIQUE en `wallet_transactions.idempotency_key`. El cache HTTP llega cuando se sume el interceptor — útil para deposits/withdrawals donde el response object es más complejo.
- **Deposits autoservicio + retiros con holds**.
- **Refactor de los 5 tests skipped** con users completamente dedicados.
- **Notificación super-admin tras mint** (requiere infra de notifs).

### Tests añadidos (15 nuevos en `wallet-transfer.e2e.ts`)

Cubren:
- Validaciones DTO (UUID, amount, reason en unload, Idempotency-Key obligatoria).
- Permission gates (cajero2 sin wallet.load → 403).
- Anti-self (409 SELF_TRANSFER), target inexistente (409 TARGET_NOT_FOUND).
- Happy path: balances correctos, par linkeado via `related_tx_id`.
- Audit: metadata con `sourceTxId` + `targetTxId`.
- Idempotencia: mismo body → mismo par + 1 fila DB; body distinto → 409.
- Concurrencia: 5 loads paralelos a target → balance correcto.
- Unload happy + insufficient balance.

**Estabilidad:** 5 corridas seguidas → 95/95/95/95/95 passed + 5 skipped + 0 failed.

---

## 2026-05-12 — Sesión Wallet 3: deposits autoservicio + lecciones de TX nested

**Contexto.** Tercera sesión del sprint wallet. Foco: flujo de depósito autoservicio del jugador (solicitar → aprobar/rechazar). Endpoints, schema, validaciones, audit, tests E2E.

**Decisiones tomadas.**

### Schema

1. **`payment_methods` per-tenant, sin catálogo global.** Cada operador decide qué métodos acepta (transferencia ARS, USDT cripto, otros). `config jsonb` libre para el shape específico del método. `code` único por tenant para referencia estable desde deposits/withdrawals.

2. **`deposits` con enum de 6 estados.** `pending`, `under_review`, `approved`, `rejected`, `expired`, `cancelled`. El `under_review` es para cuando un cajero "toma" el depósito pero aún no decide — útil cuando hay varios cajeros en paralelo. `expired` queda para un job nocturno (no implementado).

3. **`amount_chips` separado de `amount_fiat`.** El user reporta cuánto transfirió en moneda real (`amount_fiat`); las chips finales (`amount_chips`) las decide el cajero al aprobar (basado en el comprobante real). En MVP el ratio puede ser fijo por método (1:0.1 ARS→CHIPS), pero el modelo permite flexibilidad cuando haya métodos con comisiones distintas.

4. **`wallet_tx_id` linkback opcional.** NULL hasta que se aprueba. Al aprobar, una wallet tx `type='deposit'` se crea y su id se guarda acá. Permite navegación desde depósito → tx → balance final, útil para reconciliación y para que el panel admin muestre "esta carga vino de ESTE depósito".

5. **Constraint app-level (no SQL) para "max 2 pending por user".** El SQL CHECK no puede contar filas. El service hace `SELECT COUNT(*) WHERE user_id=X AND status IN ('pending','under_review')` antes de insertar. Hay un race window teórico (dos requests simultáneos del mismo user pueden ambos pasar el check), pero es aceptable para MVP: el daño es 3 pending en vez de 2, que la UI puede manejar.

### Service

6. **Approve es una sola TX postgres con `SELECT FOR UPDATE` sobre el deposit.** Bloquea cualquier intento concurrente de aprobar/rechazar el mismo deposit. Adentro de la TX: chequea status, crea wallet tx via `creditFromDeposit`, marca el deposit como approved, linkea `wallet_tx_id`. Todo atómico.

7. **Idempotencia de approve.** Si la operación llega 2 veces (doble click, retry de red), la segunda devuelve el mismo deposit sin re-procesar — porque ya está en `approved` con su `wallet_tx_id`. La wallet tx misma usa `idempotency_key = 'deposit:${depositId}'`, así que aunque approve se ejecutara dos veces simultáneamente, el UNIQUE de wallet_transactions atrapa el doble-credit.

8. **`creditFromDeposit` como primitivo del WalletService.** No lo metí en `mint`/`burn` familia porque la semántica es distinta: `mint` crea fichas desde nada (admin only), `deposit` representa una entrada de fiat real convertida a chips (lo dispara el cajero). Aunque mecánicamente sea igual (un INSERT credit), el `type` distinto es clave para auditoría y conciliación.

9. **Cross-state transitions explícitas.** Si un deposit está `rejected` y alguien intenta `approve`, tira 409 `DEPOSIT_ALREADY_RESOLVED` con el status actual. Lo mismo en cualquier transición desde un estado terminal. Permite a la UI mostrar mensajes claros.

### TX anidadas (lección aprendida)

10. **drizzle no expone bien el tipo de PgTransaction para reusar en helpers.** El service `DepositsService.approve` abre una TX con `db.transaction(async tx => {...})`. Dentro llama `WalletService.creditFromDeposit(tx, ...)`. Pero `creditFromDeposit` espera `TenantDb` (que tiene `$client`), no `PgTransaction`. **Solución pragmática**: cast `tx as unknown as TenantDb` al pasarlo. drizzle internamente crea un SAVEPOINT cuando se anida una `tx.transaction(...)`, así que la atomicidad se preserva. La type-safety se sacrifica en el boundary porque drizzle no expone una abstracción unificada "executor" todavía.

11. **`SELECT FOR UPDATE` via drizzle nativo, no `sql.execute()`.** Primera versión usaba `tx.execute(sql\`SELECT * FROM deposits WHERE id = X FOR UPDATE\`)` que devolvía raw rows con nombres snake_case → `locked.amountChips` era undefined → postgres-js tira `UNDEFINED_VALUE` al hacer el insert siguiente. **Lección**: dentro del WalletService funcionaba porque el tx.execute era con drizzle tables (`${wallets}` interpolation), pero igual mejor usar `.for('update')` que es drizzle 0.30+ y mantiene el tipado camelCase.

### Lo que NO entró (Sesión Wallet 4)

- **Withdrawals** + `wallet_holds` funcionales (próxima sesión).
- **Cancelación por el jugador** antes del review (deposits.status = 'cancelled').
- **Expiración automática** (job nocturno).
- **Refactor de los 5 tests skipped + flakies remanentes** (problema de test isolation, no de código de producción).

**Tests añadidos:** 17 nuevos en `deposits.e2e.ts`. Total suite: 117 tests (112 passing estables + 5 skipped + 3-5 flakies intermitentes por test infra).

---

## 2026-05-12 (segunda parte) — Sesión Wallet 4: withdrawals con holds + fix definitivo de test isolation

**Contexto.** Cierre del subsistema wallet operativo: retiros con `wallet_holds` funcionales. Pero antes, el usuario pidió explícitamente "intentemos resolver todos los bugs que venimos sin resolver" — refiere a la flakiness sistémica de tests que arrastrabamos desde Sesión Wallet 2.

### Fix de la flakiness sistémica (lo importante)

**Síntoma:** ~30-50% de las corridas full-suite tenían 1-3 fallos intermitentes en tests distintos cada vez. Algunos catastróficos (17 tests fallando juntos). Causa frustrante: cada test pasaba en aislamiento, fallaba aleatoriamente en grupo.

**Diagnóstico final.** Era pool exhaustion + race entre workers. Jest, por default, decide workers según CPU disponible. **`--runInBand` desde CLI solo aplica si se pasa explícitamente**, y mi `package.json` script lo tenía pero algunos paths invocaban jest sin él. Cuando 2+ workers corrían contra la misma DB compartida, los pools postgres-js de cada worker tomaban snapshots distintos y veían commits parciales del otro worker.

**Fix:** `maxWorkers: 1` directamente en `jest.config.ts`. **Esto garantiza 1 worker SIEMPRE**, independientemente de cómo invoque jest. Acompañado de:
- `setTimeout(100)` entre `resetMutableState()` y crear la app: da margen para que conexiones zombi de la suite anterior cierren limpiamente.
- `setTimeout(100)` después de `app.close()`: mismo pero al revés.

**Resultado:** 15 corridas consecutivas full suite, **134/134 passed, 0 skipped, 0 flaky.**

Lecciones técnicas:
1. **`maxWorkers` debe ser explícito en jest.config**, no solo CLI flag. CLI flags se pierden en algunos invocation paths (npm scripts wrappers, IDE runners).
2. **Pool exhaustion en tests con DB compartida** es real y se manifiesta como heisenbugs.
3. **Bajar idle_timeout o ajustar max no era la solución** — sin más workers, no hay race.

### Side-fixes hechos durante el debug (mantenidos por higiene)

1. **`audit-log paginación`**: ahora crea un user fresco, le hace 4 updates, filtra por su targetId. Set de exactamente 4 entries propiedad del test. Cero interferencia.
2. **`permission-overrides › lista overrides ordenados`**: user fresco con counts exactos.
3. **`permission-overrides › regla de techo`**: actor + target frescos via `createTestUser` en lugar de cajero1/cajero2.
4. **`Cadena de delegación + cascada` (4 tests)**: `buildIsolatedChain()` helper que arma ownAdmin + delegator + receiver dedicados por test. `waitForEffectivePermission` para sincronizar la visibilidad del bypass DB-direct con el pool de la app.
5. **`A↔B anti-deadlock`**: ownAdmin dedicado que mintea para fondear ambos lados.

Todo esto eleva la calidad de los tests independientemente del bug del maxWorkers — son tests más robustos y autocontenidos.

### Withdrawals (lo sustantivo)

**Schema** `withdrawals`: status enum (`pending → approved → processing → paid | rejected | failed`), method_id, amount_chips + amount_fiat, target_account jsonb, hold_id linkback, wallet_tx_id linkback, paid_external_ref.

**WalletService primitivos nuevos:**

1. **`placeHold()`**: incrementa `locked_balance` sin tocar `balance`. Tira `InsufficientBalanceError` si `(balance - locked) < amount`. Esto es lo que hace que las fichas estén "reservadas" pero no gastadas hasta que se concrete el pago. SELECT FOR UPDATE sobre el wallet.

2. **`releaseHold()`**: idempotente. Marca `released_at`, decrementa `locked_balance`. Las fichas vuelven a ser gastables.

3. **`debitWithHoldRelease()`**: atómico, SELECT FOR UPDATE de hold + wallet, insert wallet tx `type='withdrawal'`, debit balance, release hold. Idempotency key `withdrawal:<id>`. Esto es lo que pasa al marcar `paid`.

**State machine de withdrawal:**

```
pending → approved → processing → paid (debita)
                              ↘ failed (libera)
pending → rejected (libera)
```

- `approve(pending)` → `approved`. NO mueve saldo.
- `reject(pending)` → `rejected` + release hold.
- `markPaid(approved | processing)` → `paid` + debit + release atómico.
- `markFailed(approved | processing)` → `failed` + release.
- Cross-state errors: `WithdrawalInvalidStateError` → 409 `WITHDRAWAL_INVALID_STATE`.
- Idempotencia: si ya está en el estado destino, retorna sin re-procesar.

**Tests E2E (17 nuevos):** cubren lifecycle completo, validations, cross-state, idempotencia, permission gates, INSUFFICIENT_BALANCE en create, hold release verificable via locked_balance.

### Estado final del subsistema wallet

```
mint/burn        ✓ Sesión 1
load/unload      ✓ Sesión 2
deposits         ✓ Sesión 3
withdrawals      ✓ Sesión 4
audit log        ✓ todas
holds            ✓ Sesión 4
idempotency      ✓ todas
```

**El subsistema wallet está COMPLETO según `docs/05`** excepto:
- Interceptor `idempotency_keys` HTTP-level cache (sin uso urgente, tabla creada).
- Conciliación nocturna (job, va con BullMQ).
- Verificación cripto automática (TronGrid, post-MVP).
- Particionado mensual de `wallet_transactions` (cuando crezca).

**Suite final**: 10 archivos, 134 tests, 100% estables, ~12-15s, 0 skipped, 0 flaky.

---

## 2026-05-13 — Sprint Hardening Categoría A

**Contexto.** Tras Wallet 4, Uriel pidió un assessment de la deuda técnica. Identifiqué 21 items en 3 categorías (A=hacer ahora rápido, B=triggered por feature, C=sprints dedicados). Esta sesión cubre la categoría A completa: 10 quick wins de robustez y seguridad sobre **lo ya construido**, sin features nuevas.

**Decisiones tomadas.**

1. **Refresh token reuse → kill all sessions.** Política de "si detectamos token theft, asumimos compromise total del user y forzamos re-login de TODO". Trade-off: si el user legítimo se equivoca y reusa un refresh viejo, lo molesta. Vale la pena porque el costo del compromiso es muy alto.

2. **Revoke de no-delegable: permitir + flag.** Considere bloquearlo, pero un admin DEBE poder revocar cualquier cosa (es su rol). En cambio metadata `severity:high` + `sensitive:true` deja rastro visible para auditorías.

3. **`actor_role_at_time` con prioridad de rol fija.** Si user tiene multi-rol (poco común pero posible: cajero+empleado), reportamos el "más alto" según jerarquía del doc 03. Es snapshot — si cambia, no se actualiza la fila vieja del audit. Comportamiento correcto.

4. **`lock_timeout = 5s` via `SET LOCAL`.** Solo afecta la TX actual. No requiere config global en postgres. Si en producción detectamos que 5s es muy poco/mucho, lo movemos a ENV var.

5. **`reason` regex `[a-zA-Z]{3,}`.** Permite "Bonus campaña navidad 2026" pero rechaza "ABC123" o "1234567890". Si el user real está en otro idioma con caracteres especiales (chino, árabe), el regex va a ser molesto. Para MVP es suficiente. Cuando i18n llegue, refinar.

6. **`locked_balance <= balance` CHECK SQL.** Defensa de profundidad. Mi código nunca debería violarlo, pero si un bug futuro lo hace, postgres atrapa antes de aceptar el UPDATE.

7. **`sid` opcional en JWT.** Backward-compatible: JWTs viejos sin `sid` siguen funcionando (sessionId queda NULL en audit). Cuando todos roten, todos tendrán sid. Sin breaking change.

8. **Índices compuestos prefijados por columna selectiva.** `(actor_user_id, created_at)` no `(created_at, actor_user_id)`. Postgres usa el prefijo más selectivo para escaneo eficiente.

9. **Coverage habilitado pero sin threshold.** Hoy no sabemos qué cubrimos. Próxima iteración: subir threshold gradual (50% → 70% → 80%).

10. **`GET /me/transactions` con paginación cursor-friendly.** Devuelve `{ data, total }`. Cuando exista UI del player, eso alimenta el feed. Y mientras tanto sirve para debugging de wallet.

**Lo que NO cambió** (decisión consciente):
- `is_delegatable` en `clear()` queda igual — clear es eliminar, no revoke. Si pisamos lo mismo flag igual sería raro semánticamente.
- `actor_role_at_time` se calcula con 1 query extra por audit. Aceptable para MVP; si se nota latency, cachear.

**Tests añadidos:** 8 nuevos (refresh reuse + revoke severity + actor_role + history endpoint x2 + reason hardening x2 + CHECK SQL locked).

**Estabilidad:** 5 corridas consecutivas full-suite, 142/142 verde.

---

## 2026-05-13 (segunda parte) — `user_hierarchy` + ScopeGuard: cierre del gap de seguridad operacional

**Contexto.** Hasta este sprint, un cajero con permiso `wallet.load` podía cargar fichas a CUALQUIER user del tenant. La regla del doc `§3.4` era clara: "tener wallet.load no implica cargar a cualquier user — debe estar dentro de su scope". Faltaba implementar scope. Esto era el ítem más urgente para "deploy a uso real".

**Decisiones tomadas.**

### Modelo de jerarquía

1. **Tabla histórica con `since`/`until`, no snapshot.** Cada cambio de parent **cierra** la fila vieja (`until = now()`) y **abre** una nueva. Filas viejas NUNCA se borran. Costo: 1 fila extra por cada reasignación. Beneficio: podés reconstruir "quién era child de X el 15 de marzo" para investigaciones de auditoría.

2. **`UNIQUE INDEX` parcial `(user_id) WHERE until IS NULL`.** Postgres garantiza UN solo parent activo por user. No necesito chequear en código; si el código falla la regla, la DB rechaza. Defensa en profundidad.

3. **`parent_user_id` nullable.** Permite "root" nodes (admin_tenant sin parent). En MVP los admin_tenant quedan sin row de hierarchy, simplemente. La query de descendents desde el admin del tenant devolvería los users en la red.

4. **`relation_type` text libre.** Convenciones documentadas (`cajero_de_socio`, `jugador_de_cajero`, etc.) pero no enforced. La capa de aplicación decide qué tipo va para qué jerarquía. Trade-off: menos rígido, más flexible para casos custom.

5. **Anti-cycle ejecutado a nivel app**, no DB. Postgres no tiene constraint nativo para "esto no formaría ciclo". El check antes del INSERT corre `getActiveAncestors(newParent)` y verifica que el `userId` no aparezca. Si hay race (dos setParent simultáneos sobre la misma cadena), TODO el SET LOCAL lock_timeout en mi transaction lo serializa.

### ScopeGuard

6. **Declarativo via `@ScopeTarget(field, location)`.** Sin decorator → skip. Esto permite agregar el guard a un controller entero sin afectar endpoints que NO requieren scope (GET /me, listings públicos, etc.).

7. **3 bypasses explícitos:**
   - `actor === target` (auto-operaciones).
   - `actor` tiene rol `admin_tenant` (rango jerárquico implícito).
   - `target ∈ descendants(actor)`.
   
   El bypass de admin_tenant evita que el admin tenga que tener `descendants` poblados explícitamente. Su rol ya implica "puede operar sobre cualquiera del tenant".

8. **`@ScopeTarget` lee de body/param/query.** Diferentes endpoints tienen el target en lugares distintos. Esto es el equivalente NestJS del `request mapping`.

9. **Performance**: 1-2 queries por request decorado. La consulta `getActiveDescendants` usa `WITH RECURSIVE`, eficiente con índice en `parent_user_id`. Con cache Redis (sprint futuro) sería 0 queries en caliente.

10. **NO valida sobre entidades intermedias.** El guard valida `targetUserId` directo del request. Para deposits/withdrawals (donde el target real es el `user_id` del depósito, no en el body), tenemos que extraer ese id en un guard secundario o validar en el handler. Decisión consciente: para este sprint scope solo se valida en wallet load/unload + users update/role. Para deposits/withdrawals queda pendiente — el flujo correcto requiere lookup del entity primero.

### Tests

11. **3 tests de wallet-transfer existentes rotos por la regresión correcta** (introduje un breaking change consciente). Los actualicé para que seteen la jerarquía como precondición. El test de A↔B anti-deadlock usa ahora dos admin_tenant para bypass de scope — porque lo que mide es lock ordering, no scope.

12. **Test de descendientes a 3 niveles** (socio → distri → cajero → jugador). Verifica que el guard sigue toda la cadena, no solo direct children.

### Lo que NO entró

- **Scope en deposits/withdrawals approve**: el target del scope es el `user_id` del entity, no un campo del body. Requiere un guard secundario o lookup en el handler. Pendiente para sprint dedicado.
- **Endpoint para reasignar masivamente** (cuando se borra un parent, sus descendants deberían moverse a su grandparent). Doc `§11` lo lista. Job futuro.
- **`getDescendants` con paginación**: hoy devuelve TODOS los descendents. Si una red tiene 10k+ users, la response va a ser pesada. Cuando aparezca, sumar pagination.

**Estabilidad:** 5/5 corridas consecutivas. **154 tests verde, 0 skipped, 0 flaky.**

---

## 2026-05-13 — Sprint B Security Hardening: 2FA TOTP

### Contexto

Sprint B del plan de seguridad: 2FA TOTP per-user. Requerido por `docs/12-seguridad.md` para roles operativos (admin/cajero) y para operaciones que crean/destruyen valor (mint, burn) — el acceso por sesión robada no debe alcanzar para mover fichas.

### Diseño implementado

#### Schema
- `users.two_fa_enabled` (boolean, default false). Setup en dos pasos: `init` persiste secret + enabled=false, `confirm` valida el primer código y flipea a enabled=true. Mientras enabled=false el sistema no exige 2FA — un user puede arrancar setup, escanear el QR, distraerse y volver al día siguiente sin quedar lockeado afuera.
- `users.two_fa_secret` (text, nullable). Secret base32 generado por otplib (160 bits / 20 bytes — estándar Google Authenticator).
- Migration 0008.

#### Service `TwoFaService` (apps/api/src/tenant-auth/two-fa.service.ts)
- `initSetup(db, userId, tenantSlug)`: si enabled=true → `TwoFaAlreadyEnabledError`. Si enabled=false con secret previo, REEMPLAZA el secret (el user puede recomenzar el flow). Devuelve `{ secret, otpauthUrl }` para que el frontend genere QR.
- `confirmSetup(db, userId, code)`: verifica código, flipea enabled=true.
- `disable(db, userId, code)`: requiere código actual — defensa contra atacante con sesión robada que quiera apagar 2FA silenciosamente.
- `verify(db, userId, code)`: helper para login y operaciones sensibles.
- `isEnabled(db, userId)`: query lean para decidir si exigir código.
- Window de tolerancia: `epochTolerance: 30` segundos (±1 step de 30s) para drift de reloj.

#### Errores tipados (two-fa.errors.ts)
`TwoFaError` (base) + `TwoFaCodeInvalidError`, `TwoFaAlreadyEnabledError`, `TwoFaNotInitializedError`, `TwoFaRequiredError`. Mapping a HTTP en el controller (no usar status hardcoded en el service).

#### Endpoints (TenantAuthController)
- `POST /tenant/auth/2fa/init` → 200 con secret + otpauthUrl. Audit `auth.2fa.init` severity:high.
- `POST /tenant/auth/2fa/confirm` body `{code}` → 200 ok. Audit `auth.2fa.enabled` severity:high.
- `DELETE /tenant/auth/2fa` body `{code}` → 200 ok. Audit `auth.2fa.disabled` severity:high.

#### Login con 2FA (TenantAuthService.login)
- `twoFaCode` opcional en `TenantLoginDto`.
- Si el user tiene 2FA enabled y NO mandó código: HTTP 400 con `error: 'TWO_FA_REQUIRED'`. **Status 400, no 401**: el frontend lo usa para distinguir "creds mal" (401) de "creds OK falta segundo factor" (400). Sin esa señal el UX se rompe — el frontend no sabe si pedirle al user que retipee el password o que abra la app TOTP.
- Si el user NO tiene 2FA enabled: el campo se ignora silenciosamente. No castigamos al user por mandar un código extra.

#### Mint/Burn con 2FA (WalletController)
- `twoFaCode` opcional en `MintDto`/`BurnDto`.
- Helper privado `requireTwoFaIfEnabled(db, actorId, code)` invocado al inicio de mint/burn. Mismo contrato: 400 TWO_FA_REQUIRED si falta, 400 TWO_FA_CODE_INVALID si es incorrecto.
- **Decisión: solo mint/burn por ahora.** Load/unload no exigen 2FA porque son operaciones del flujo normal del cajero (decenas por día) — exigir TOTP en cada una rompe el ritmo de operación. Mint/burn son raras (administrativas) y catastróficas — el extra costo es aceptable.

### Decisiones técnicas no obvias

1. **otplib v13 (functional API).** La versión bundled tiene API diferente a v12 (sin `authenticator` namespace). Cambio: `generateSecret()`, `generateURI({issuer,label,secret})`, `verifySync({secret,token,epochTolerance})`. Encapsulamos en `checkToken(token, secret)` privado en el service para que si mañana cambia el lib hay un solo punto.

2. **otplib + @scure/base ESM-only rompía jest.** El package transitivo `@scure/base@2.2.0` exporta solo ESM (`type: "module"`, `index.js` con `export const`). Jest por default ignora `node_modules` en transforms, así que `require()` lo encontraba y reventaba el parser. Fix: `transformIgnorePatterns` con negative lookahead que permite transformar `otplib | @otplib | @scure | @noble`, y agregamos `^.+\.js$` al `transform` para que ts-jest los baje a CJS. Nota pnpm: el path incluye versión encodada (`@scure+base@2.2.0`), así que el regex matchea por nombre suelto en cualquier parte del path, no por prefijo después de `.pnpm/`.

3. **Test usa TOTP hand-rolled, no otplib.** En el test process importé `otplib` y el mismo problema ESM volvió. Solución limpia: escribí 20 líneas de TOTP RFC 6238 con `node:crypto` (HMAC-SHA1 + dynamic truncation + base32 decode). Self-contained, sin dependencias frágiles, el algoritmo es estable hace 15 años.

4. **`resetMutableState` NO toca users.** Las suites limpian wallets, audit, sessions, overrides — pero no users. Los tests de 2FA agregan su propio reset (`UPDATE users SET two_fa_secret = NULL, two_fa_enabled = false`) en `beforeEach`. Decisión: mantener `resetMutableState` chico; cada suite limpia lo suyo.

5. **`TenantAuthModule` ya era `@Global()`.** Solo agregué `TwoFaService` a providers + exports. WalletModule lo recibe sin imports extra.

### Tests

17 tests nuevos en `two-fa.e2e.ts`:
- init: success + 409 si ya enabled + 401 sin JWT.
- confirm: success + 400 código inválido + 400 not_initialized + 400 sin body.
- disable: success + 401 código inválido.
- Login: 400 sin código, 401 código mal, 200 código bueno, 200 con campo ignorado si no tiene 2FA.
- Mint: 400 sin código, 400 código mal, 201 código bueno, 201 sin 2FA enabled.

### Estado final

- **176 tests, 12 suites, 0 skipped, 0 flaky.**
- **2/2 corridas consecutivas verde.**
- Full suite ~60s.

### Lo que NO entró

- **2FA en load/unload/deposit-approve/withdrawal-approve.** Decisión consciente: son operaciones de alta frecuencia. Si en producción los cajeros se quejan que mint/burn pide TOTP es signo bueno (algo raro pasó); pedirlo en cada load sería signo malo (UX rota).
- **Rate limit del endpoint de confirm/login.** Hoy un atacante con tiempo puede tirar 1M de codes/min y eventualmente entrar. Sprint próximo: ip-based + user-based rate limiter (memo con TTL o redis).
- **2FA obligatorio para roles operativos.** Hoy es opt-in per-user. La regla "admin DEBE tener 2FA" queda para sprint Permission Policy.

---

## 2026-05-13 — Recovery Codes para 2FA (Sprint B.1)

### Contexto

Sprint B dejó 2FA TOTP funcional pero con un gap crítico: si el user pierde su phone, queda lockeado fuera del sistema y solo soporte (con acceso a DB) puede recuperarlo. Recovery codes son backup one-time que el user guarda en papel/manager y usa cuando no tiene la app.

### Diseño implementado

#### Schema
- Migration 0009: tabla `user_recovery_codes` (id uuid, user_id FK CASCADE, code_hash text, used_at nullable, created_at).
- UNIQUE index `(user_id, code_hash)` — anti-duplicados intra-user.
- Index simple `(user_id)` para queries de listado.

#### Service `RecoveryCodesService` (apps/api/src/tenant-auth/recovery-codes.service.ts)
- `generateForUser(db, userId)`: invalida los activos del user (set `used_at = NOW()`) + inserta 10 nuevos. Devuelve plain text — única vez.
- `verifyAndConsume(db, userId, plainCode)`: hashea y hace `UPDATE ... WHERE used_at IS NULL ... RETURNING`. Atómico — dos requests concurrentes con el mismo code → solo una pasa.
- `countActive`: cuántos codes vigentes le quedan al user.
- `deleteAllForUser`: limpieza completa (se llama desde disable 2FA).

#### Cambios en TwoFaService
- `confirmSetup` ahora **devuelve `{ recoveryCodes: string[] }`** — el frontend DEBE mostrarlos al user en este punto.
- `regenerateRecoveryCodes(userId, totpCode)`: rota el batch, exige TOTP fresco (anti-sesión-robada).
- `verifyAndConsumeRecoveryCode(userId, code)`: helper para que el login lo invoque.
- `countActiveRecoveryCodes`: pasa-through al service.
- `disable` ahora también borra los recovery codes (no quedan huérfanos).

#### Endpoints nuevos
- `POST /tenant/auth/2fa/recovery-codes/regenerate` (body `{code}`) → 10 nuevos codes + audit severity:high.
- `GET /tenant/auth/2fa/recovery-codes/count` → `{ active: number }` para el panel del user.

#### Login con recovery code
- `TenantLoginDto` ahora acepta `recoveryCode` (opcional, 3-32 chars) además de `twoFaCode`.
- Service: si user tiene 2FA enabled, exige al menos uno. Si manda solo `recoveryCode`, lo valida y consume. **NO se intenta cross-fallback**: si manda TOTP y falla, NO se prueba como recovery (eso revelaría info al atacante).

### Decisiones técnicas no obvias

1. **Codes hex de 40 bits (xxxx-xxxx-xx).** 10 chars hex = 40 bits de entropía. Suficiente contra guessing online cuando combinado con rate limit (sprint próximo). No es 80 bits porque el costo UX de transcribir 20 chars >> beneficio criptográfico. Google/GitHub usan formatos similares.

2. **SHA-256 hash, no argon2.** El code tiene 40 bits de entropía, NO es una password humana — no necesita el costo de bcrypt/argon2. SHA-256 es suficiente porque el espacio es 2^40, no atacable offline en tiempo razonable.

3. **Aceptar code con o sin guiones, case-insensitive.** El user puede transcribir mal — `normalize()` strip-ea no-hex chars y lower-casea antes de hashear. Mostramos al user `abcd-1234-ef` (legible); aceptamos `abcd1234ef`, `ABCD1234EF`, `abcd-1234-ef`. Hash se hace siempre sobre la forma normalizada.

4. **Plain text se devuelve UNA SOLA VEZ.** Si el user los pierde, regenera (con TOTP fresco). Si perdió TOTP también, solo soporte (DB direct) puede ayudar. Esto se documenta en el response.

5. **Atomic UPDATE con used_at IS NULL guard.** Race-safe nativo de Postgres. Sin necesidad de transaction explícita ni FOR UPDATE — el `WHERE used_at IS NULL` es la condición de carrera.

6. **NO permitir cross-fallback en login (TOTP→recovery o viceversa).** Si el user manda `twoFaCode` y es inválido, NO se prueba como recovery (y al revés). Razón: un atacante observando códigos rechazados sabría qué tipo intentar. Política explícita: el user elige cuál usar, el server respeta.

7. **regenerate exige TOTP fresco.** Si dejaba que JWT alcance, una sesión robada podría rotar los codes y dejar al user legítimo sin acceso. Patrón "step-up auth": operaciones sensibles requieren factor adicional aunque ya estés logueado.

8. **Disable 2FA borra recovery codes.** Si el user desactiva 2FA, mantener los codes en DB no tiene sentido (no se pueden usar — el login no exige 2FA). Borrado físico (no soft delete) — la auditoría queda en `audit_log` con la acción `auth.2fa.disabled`.

### Tests

13 tests nuevos en `recovery-codes.e2e.ts`:
- confirmSetup devuelve 10 codes con formato correcto + sin duplicados.
- count refleja state inicial 10.
- Login con recovery code consume + reuse devuelve 401.
- count baja en 1 después de consumir.
- Acepta sin guiones y MAYÚSCULAS.
- Shape inválido → 401 (sin info leakage).
- Code inexistente → 401.
- Sin twoFaCode ni recoveryCode → 400 TWO_FA_REQUIRED.
- regenerate genera 10 nuevos, invalida viejos, exige TOTP válido.
- regenerate sin 2FA → 400 TWO_FA_NOT_INITIALIZED.
- Disable borra todos los codes (verificado vía SQL directo).

### Estado final

- **189 tests, 13 suites, 0 skipped, 0 flaky.**
- **2/2 corridas consecutivas verde** (~50-58s).

### Lo que NO entró todavía

- **Notificación al user cuando se consume un recovery code.** Email/SMS "se usó un recovery code de tu cuenta" — depende de tener email infra. Sprint Notificaciones.
- **Soft delete vs hard delete en disable.** Hoy hard delete. Si en producción necesitamos forensics ("el user dijo que NO desactivó pero está disabled"), podemos pasar a soft delete con `revoked_at`. Por ahora la audit_log entry alcanza.

---

## 2026-05-13 — Rate Limit anti-brute-force (Sprint B.2)

### Contexto

Sprint B + B.1 dejaron 2FA TOTP + recovery codes funcionales. Faltaba el último pilar: rate limit en endpoints sensibles. Sin esto, un atacante con tiempo puede tirar 1M de TOTP codes/min o intentar passwords en loop. 40 bits de entropía de recovery codes son irrompibles offline pero son rompibles online si no hay throttle.

### Diseño implementado

#### `RateLimiterService` (in-memory)
- **Estrategia**: fixed window counter. `Map<key, {count, resetAt}>` in-process.
- **API**: `check(key, cfg)` → `{ok, current, retryAfterMs}`. `reset(key)`, `clear()`, `peek(key)`.
- **Trade-off vs sliding window**: burst de 2x limit en el borde de ventana. Aceptable porque rate-limit es defensa en capas (no la única). Implementación 3x más simple.
- **Memoria**: O(claves_activas). Sweep lazy a las 10k entradas (no setInterval — Jest se ahogaba con handles abiertos).
- **Disable**: env `RATE_LIMIT_ENABLED=false` corta todos los checks (debugging).
- **Single-instance only**: si en el futuro corren múltiples API instances, migrar a Redis (un atacante podría rotar entre instances y multiplicar el límite).

#### `@RateLimit({ rule, limit, windowSec, scope })` decorator + `RateLimitGuard`
- Scopes soportados:
  - `'ip'`: limita por IP del cliente (`req.ip` o `X-Forwarded-For`).
  - `'ip+body.<field>'`: limita por (IP, valor de campo del body). Usado en login con `ip+body.username` — un atacante desde una IP no puede rotar por usernames sin disparar el límite.
  - `'user'`: limita por `req.tenantUser.id` (post-auth).
- Key se normaliza (lowercase+trim) para anti-evasion.
- 429 + `Retry-After` header + body con `retryAfterMs` granular.

#### Endpoints protegidos

| Endpoint | Scope | Limit | Ventana |
|---|---|---|---|
| `POST /tenant/auth/login` | ip+body.username | 10 | 15 min |
| `POST /tenant/auth/2fa/confirm` | user | 10 | 15 min |
| `POST /tenant/auth/2fa/recovery-codes/regenerate` | user | 5 | 60 min |

### Decisiones técnicas no obvias

1. **Reset-on-success.** Los 3 endpoints reset-ean el contador tras un success. Razón:
   - User legítimo tipea mal 3 veces, entra a la 4ta → counter limpio, no queda penalizado.
   - Atacante por definición NO completa el flow exitoso → counter sigue acumulando → eventualmente bloqueado.
   - Implementación: guard pega la clave en `req.rateLimitKey`, handler la borra tras success.

2. **Orden de guards crítico.** Inicialmente puse `@UseGuards(RateLimitGuard)` a nivel **clase** sobre `TenantAuthController`. Bug: en endpoints post-auth (confirm/regenerate), el RateLimitGuard corría ANTES que TenantJwtGuard, por lo que `req.tenantUser` era undefined → key null → fail-open. Fix: composición explícita por endpoint `@UseGuards(TenantJwtGuard, RateLimitGuard)` con orden correcto.

3. **fail-open si no hay clave construible.** Si por algún motivo el guard no puede construir la key (body sin el campo esperado, no hay IP), deja pasar con warning log. Mejor que bloquear requests legítimos por mala configuración. Para detectar problemas: monitorear logs `RateLimit rule=... sin clave construible`.

4. **NO incrementamos si ya superamos el limit.** El counter se freeza en `limit`. Sin esto, un atacante que sigue intentando extendería la deuda — la ventana se reset en `resetAt`, no en "último hit + window". Simpler y previsible.

5. **Anti-evasion del username.** `lowercase+trim` antes de hashear la key. Un atacante que rota " Foo " vs "FOO" comparte counter con "foo". Defensa barata.

6. **Limits conservadores.** 10 login attempts/15min es generoso para humanos (~1/min sostenido), pero un atacante necesita días para brute-forcear un password de 8 chars random (256-256^8). Los limits son para anti-credential-stuffing, no para defender passwords débiles (ese es trabajo del policy de password).

7. **Lazy sweep en lugar de setInterval.** El sweep periódico mantendría timers abiertos que confunden a Jest en shutdown. Sweep on-write cuando store supera 10k entries es suficiente.

### Tests E2E (10 nuevos en rate-limit.e2e.ts)

- Login: 11° intento → 429 + Retry-After header.
- Login: reset-on-success borra contador (5 fallidos → 1 ok → 10 nuevos fallidos → 11° bloquea).
- Login: contadores independientes por username (bloquear admin no afecta a cajero1).
- Login: normaliza casing+espacios.
- 2FA confirm: 11° → 429 + reset-on-success.
- regenerate-recovery-codes: 6° → 429.
- Direct service: count/reset/peek.

### Estado final

- **199 tests, 14 suites, 0 skipped, 0 flaky.**
- **2/2 corridas consecutivas verde** (~63s).

### Lo que NO entró todavía

- **Captcha** para login después de N intentos. Solo rate-limit hoy. Captcha agrega fricción de humano vs bot — si el bot pasa rate, el captcha lo cuelga.
- **Persistencia del store**. In-memory significa que un restart limpia todos los contadores. Aceptable (un atacante que reinicia el server tiene otros problemas) pero si en el futuro queremos contadores durables, migrar a Redis.
- **Notificación al user cuando un contador llega a 80%.** Email "alguien está intentando entrar a tu cuenta". Depende email infra.
- **Bloqueo permanente tras N round-trips de rate limit.** Hoy se desbloquea solo cuando vence la ventana. Si queremos lock-out manual (admin debe revisar), agregar columna `users.locked_at` + endpoint admin para unlock.

---

## 2026-05-13 — 2FA obligatorio para roles operativos (Sprint B.3)

### Contexto

Sprint B/B.1/B.2 dejaron 2FA TOTP + recovery codes + rate limit funcionando, pero todo opt-in. Un admin que **decida no setupear 2FA** podía operar igual (mint/burn pedía TOTP solo si user.twoFaEnabled=true; si estaba en false, no pedía nada). Cerramos el gap: roles operativos (admin_tenant, socio, distribuidor, cajero) DEBEN tener 2FA habilitado.

### Diseño implementado

#### Schema (migration 0010)
- `roles.requires_two_fa` (boolean, default false).
- Seed actualiza: `admin_tenant=true`, `socio=true`, `distribuidor=true`, `cajero=true`, `empleado=false`, `usuario_final=false`.
- Seed upgrade: `onConflictDoUpdate` para que cambios al flag se propaguen a tenants existentes en re-seed.

#### `TwoFaPolicyService`
- `check(db, userId)`: 2 queries — (1) `users.twoFaEnabled`, (2) `userRoles JOIN roles WHERE requires_two_fa=true`. Devuelve `{ok: true}` si user tiene 2FA OR no tiene rol operativo. Else `{ok: false, reason: 'TWO_FA_SETUP_REQUIRED'}`.
- Mutable: `enable()` / `disable()`. Default = ON (`TWO_FA_POLICY_ENABLED` env, default true). Tests lo togglean.
- Variante `checkForRoleCodes(roleCodes[])` para futuro (cache de roles in-memory).

#### `@AllowWithoutTwoFa()` decorator
- Bypass del check para endpoints de setup mismo (sino el flow sería inarrancable: `/2fa/init` mismo requeriría 2FA).
- Aplicado a: `GET /me`, `POST /2fa/init`, `POST /2fa/confirm`, `GET /2fa/recovery-codes/count`.
- NO aplicado a: `DELETE /2fa` (disable), `POST /2fa/recovery-codes/regenerate`, etc — esos requieren tener 2FA ya enabled, así que la policy nunca los bloquea legítimamente.

#### Integración: el check vive DENTRO de `TenantJwtGuard`
Esta fue la decisión arquitectónica clave. Probé primero con un guard global (`APP_GUARD`) separado, pero NestJS corre **globales ANTES que controller/method guards**. Eso significa que el policy guard corría antes que TenantJwtGuard → `req.tenantUser` undefined → guard auto-skipea → policy no se aplica. Re-arquitectura: integrar el check en TenantJwtGuard, justo después de setear `request.tenantUser`. Ventaja secundaria: single point of enforcement, no hay riesgo de olvidar el policy guard en un controller nuevo.

### Decisiones técnicas no obvias

1. **Flag en `roles`, no en `users`.** Más flexible: si mañana se agrega un rol custom "supervisor_riesgo" que necesita 2FA, el Admin Tenant lo setea en una columna. Si fuese en users, habría que checkear roles igual para saber si flagear.

2. **Default `false` para custom roles.** El Admin Tenant decide explícitamente si requiere 2FA para roles que el cree. Default seguro porque el rol custom sin permisos no puede hacer daño.

3. **`empleado` con `requires_two_fa=false`** por default. El rol "empleado" es un placeholder — el Admin Tenant le da permisos a la carta. Si le da permisos sensibles (wallet.mint, users.create), debería también flagear el rol como `requires_two_fa=true`. Lo dejamos como decisión consciente del Admin (no enforced).

4. **Single point of enforcement = `TenantJwtGuard`.** Alternativa "guard separado a nivel controller" se descartó por riesgo de olvido en nuevos controllers. Trade-off: TenantJwtGuard hace dos cosas (auth + policy). Aceptable porque la policy ES parte de "está este user autorizado a hacer esto".

5. **Mutable `enable()`/`disable()` en el service.** Útil para tests (default disabled en `bootstrapTestApp` excepto en el suite del policy) y para un eventual kill-switch admin. Trade-off: el state es global per-process, no per-request. Aceptable porque la regla es "on/off para toda la app".

6. **`onConflictDoUpdate` en el seed.** Sin esto, al re-seedear un tenant existente, el flag nuevo no propagaría. Ahora cualquier campo flagueado (`name`, `description`, `requiresTwoFa`) se actualiza si cambia.

7. **2 queries por request post-auth.** Aceptable para MVP (latencia ~ms en local). Para producción con tráfico alto, cachear (role_codes → requires_two_fa cache, invalidated on role updates). Sprint Performance.

### Tests E2E (10 nuevos en two-fa-policy.e2e.ts)

- Admin sin 2FA: `GET /me` 200 (bypass), `POST /2fa/init` 200, `POST /2fa/confirm` 200, `GET /2fa/recovery-codes/count` 200.
- Admin sin 2FA: `POST /tenant/wallet/mint` → **403 TWO_FA_SETUP_REQUIRED**, `GET /tenant/users` → 403.
- Admin DESPUÉS de setup: mint 201 con TOTP code OK.
- Jugador (rol `usuario_final`): puede operar sin 2FA — policy no aplica.
- Kill-switch `policy.disable()`: admin sin 2FA pasa todo.
- Service internal: `isEnabled()` refleja enable/disable.

### Estado final

- **209 tests, 15 suites, 0 skipped, 0 flaky.**
- **2/2 corridas consecutivas verde** (~50-55s).

### Lo que NO entró todavía

- **Setup 2FA via UI** — el flow está cubierto API-wise, pero el frontend para guiar al user no existe. Sprint Frontend.
- **Audit log "2FA enforcement triggered"**. Cuando un user es bloqueado por la policy, no escribimos audit entry. Si en producción queremos forensics ("cuántos usuarios fueron bloqueados por la policy y para qué endpoint?"), agregar un log a `audit_log` desde el guard.
- **Cache del check de policy.** 2 queries por request post-auth. Para >1000 req/s sostenido, cachear in-memory con TTL corto.
- **Grace period al asignar rol operativo a un user sin 2FA.** Hoy: si admin asigna rol cajero a user sin 2FA, el user queda inmediatamente bloqueado fuera. UX mejor: 7 días de gracia con warning email + permitir login pero bloquear ops sensibles. Sprint Notificaciones.

---

## 2026-05-13 — Sistema de Bonos MVP (Sprint Bonos-1)

### Contexto

Subsistema completamente nuevo (Fase 5 según roadmap, primero después de cerrar Security Hardening). El doc `15-engagement-promos.md` describe TRES módulos relacionados — bonos, sorteos, liga — que comparten patrones (creator paga, audit granular, antifraude). Este sprint cubre solo bonos con scope deliberadamente acotado: lo necesario para que un cajero pueda otorgar un bono manual y un admin pueda configurar plantillas, con la wallet correctamente integrada.

### Diseño implementado

#### Schema (migration 0011)

- `bonus_definitions`: plantillas configurables.
  - `code` unique intra-tenant + `name` + `type` enum (welcome/reload/cashback/manual/free_spins/no_deposit/referral).
  - `config`, `wagering`, `segmentFilter`, `visibility` como JSONB libre (validación fina cuando llegue auto-grant).
  - `fundedByUserId` FK a users — resuelto al crear, NUNCA cambia.
  - `status` enum (draft/active/paused/archived) — solo active permite otorgar.
- `user_bonuses`: instancia asignada a un user concreto.
  - `grantedAmount` (immutable) + `remainingAmount` (mutable, futuro: se consume en wagering).
  - `status` enum (pending/active/wagering/cleared/cancelled/expired/forfeited) — MVP simplificado: grant entra `active`, sin step wagering todavía.
  - `fundingTxId` link al wallet_tx que debitó al funder — para join con reportes y reversa al cancelar.
  - `grantIdempotencyKey` UNIQUE — anti-duplicados ante retries de network.
- Wallet tx types nuevos:
  - `bonus_funding` (DEBIT): salida del funder al otorgar.
  - `bonus_funding_revert` (CREDIT): reversa al funder al cancelar.
  - `bonus_grant` / `bonus_clear` / `bonus_forfeit` ya existían en el enum — `bonus_clear` se usa para force-clear.

#### Permisos (7 nuevos)
- `bonuses.view` — propios.
- `bonuses.view_any` — de cualquier user (delegable).
- `bonuses.create_definition` — no-delegable.
- `bonuses.edit_definition` — no-delegable.
- `bonuses.grant_manual` — delegable (cajero opera con red propia + scope).
- `bonuses.cancel` — delegable.
- `bonuses.force_clear` — no-delegable + audit_required + 2FA en el endpoint (operación destructiva).

#### Services
- `BonusDefinitionsService`: CRUD plano. Code unique check via `unique_violation` (23505) → error tipado.
- `UserBonusesService`: grantManual + cancel + forceClear + listings.
  - `grantManual`: idempotency check optimista → validar target user existe → validar definition active → debitar wallet del funder → insertar `user_bonuses` row.
  - `cancel`: validar status ∈ {active, pending, wagering} → reversar `remainingAmount` al funder → update status='cancelled'.
  - `forceClear`: igual validación → acreditar `remainingAmount` al wallet del USER (real chips) → update status='cleared'.

#### Wallet integration
- Tres primitivos nuevos en `WalletService`:
  - `executeBonusFunding`: wrapper de `executeTransaction` con type `bonus_funding`, source `bonus_grant`. La idempotency key es `bonus_grant:<grantKey>` para que el wallet-tx unique check funcione independiente del user_bonus unique check.
  - `executeBonusFundingRevert`: type `bonus_funding_revert`, source `bonus_cancel`. Idempotency `bonus_cancel:<bonusId>` para que retries del cancel sean naturalmente idempotentes.
  - `executeBonusClear`: type `bonus_clear`, source `bonus_force_clear`. Idempotency `bonus_clear:<bonusId>`.
- CREDIT_TYPES y DEBIT_TYPES actualizados.

#### Controllers
- `BonusDefinitionsController` (`/tenant/bonus-definitions`): GET list/by-id, POST create, PATCH update. Permission-gated. Audit con severity:medium en mutaciones.
- `UserBonusesController` (`/tenant/bonuses`): /me, /user/:id, /:id, /grant, /:id/cancel, /:id/force-clear, /stats/active.
  - Grant exige `Idempotency-Key` header.
  - Grant tiene `@ScopeTarget('userId', 'body')` + `ScopeGuard` — cajero no puede otorgar a users fuera de su red.
  - Cancel/force-clear: scope check manual (el userId no está en el body, hay que mirarlo en la entity).
  - Force-clear: requiere 2FA del actor (step-up auth para op destructiva).
  - Rate-limit en grant: 60 grants/hora por user actor. Evita que un actor con sesión robada vacíe la caja del funder.
- Audit en todas las mutaciones con severity:high.

### Decisiones técnicas no obvias

1. **Bonus money lives separately from wallet.** En `user_bonuses.remaining_amount`, NO en `wallets.balance`. La wallet del user solo recibe chips cuando hay `force_clear` (admin lo decide). En sprints futuros con engine de juegos, los bets debitarán de `remaining_amount` y al completar wagering se hará el clear automático. Esta separación simplifica MVP (no requiere lock semantics en wallet) y mantiene el invariante "chips en wallet.balance están líquidos".

2. **Funder paga inmediatamente, NO se reserva.** Decisión más simple. En sprints futuros con `promo_fund_reservations` (doc §0) podríamos cambiar a reserve+release. Hoy: si el funder no tiene saldo, el grant falla.

3. **Idempotency en DOS niveles**.
   - `user_bonuses.grantIdempotencyKey` UNIQUE — anti-duplicate bonus row.
   - `wallet_transactions.idempotencyKey` UNIQUE — anti-duplicate wallet tx.
   - Los dos usan keys derivadas: el wallet usa `bonus_grant:<grantKey>`. Esto permite que el wallet tx sea naturalmente idempotente sin colisionar con keys de mint/burn.

4. **Cancel reversa por `remainingAmount`, NO `grantedAmount`.** Si el user ya gastó parte en wagering (futuro), esa parte se considera consumida — el funder no la recupera. MVP: como no hay wagering, `remainingAmount === grantedAmount` siempre, así que el comportamiento es el "esperado" hoy. Cuando llegue wagering, el comportamiento ya está correcto.

5. **Force-clear exige 2FA del actor.** Operación destructiva — convierte bono en chips reales. Step-up auth para defender contra sesiones robadas. Permiso `bonuses.force_clear` además es no-delegable + audit_required.

6. **NO atomic entre wallet tx y user_bonus update.** El service hace primero el wallet tx (en su propia TX vía `executeTransaction`), después el `INSERT INTO user_bonuses`. Si el server muere entre los dos commits, queda inconsistencia (wallet debitado pero sin user_bonus). Mitigación: idempotency en ambos lados — un retry del request completa el flow. Audit log captura ambos eventos. Trade-off aceptable para MVP; refactor a "single TX que invoca wallet primitives" en sprint Performance.

7. **`bonuses.force_clear` no-delegable.** Razón: convertir bono en cash es la operación más sensible de bonos (efectivamente regala plata real). Permitir delegación abriría puerta a abuso de empleados con override. El Admin Tenant tiene el rol con todos los permisos; nadie más.

8. **Audit log severity:medium en CRUD definition, high en grant/cancel/force-clear.** Las definitions son configuración (recuperable, no toca dinero al editar). Los grants tocan wallet → severity high.

9. **Grant rate-limit por actor (no por target).** Razón: un actor legítimo puede otorgar bonos a 60 users distintos en una hora (campaña manual). Lo que queremos prevenir es un actor compromitido que tire grants en loop al mismo o distintos targets — el límite por actor es la métrica relevante.

10. **`stats/active` endpoint** para el panel "Bonos Activos" del doc §A5. KPIs básicos: count + total committed. UI con alertas cuando supera umbral es trabajo del frontend.

### Tests E2E (18 nuevos en bonuses.e2e.ts)

- CRUD definitions: create OK, code conflict 409, sin permiso 403, patch status, list filtrado, 404 inexistente.
- Grant manual: success + debit funder + create row, idempotency mismo body, idempotency conflict 409, definition no-active 409, definition inexistente 404, user target inexistente 404.
- Listings: /me devuelve propios, /user/:id requiere view_any (player 403).
- Stats/active.
- Cancel: revierte fichas, status invalid después 409.
- Force-clear: pasa chips al wallet del user, status=cleared verificado en DB directa.

### Estado final

- **227 tests, 16 suites, 0 skipped, 0 flaky.**
- **2/2 corridas consecutivas verde** (~60-70s).

### Lo que NO entró todavía (Sprint Bonos-2 / 3+)

- **Wagering tracking** (`bonus_progress` table). Necesita engine de juegos.
- ~~**Auto-grant en deposit.approve** para welcome/reload~~ ✅ Sprint Bonos-2.
- **Cashback job nocturno** (cron + cálculo de netwin por período).
- **Free spins / no_deposit / referral types** — schema soporta los enum values pero la lógica concreta de cada tipo queda para sprints específicos.
- **Expiración automática** — job que cierra bonos con `expiresAt < NOW()` y status='active'. Cron pendiente.
- **Forfeit automático** cuando el user retira antes de cumplir wagering. Necesita engine de juegos primero.
- **Panel "Bonos Activos"** (UI) — frontend.
- **Antifraude transversal** (§D del doc).

---

## 2026-05-13 — Auto-grant de bonos en deposit.approve (Sprint Bonos-2)

### Contexto

Sprint Bonos-1 dejó el sistema completo para grants manuales pero los bonos welcome/reload no se otorgaban automáticamente al aprobar depósitos — había que llamar manualmente al endpoint de grant. Sprint Bonos-2 cierra el ciclo: cuando el cajero aprueba un depósito, el sistema automáticamente otorga el bono correspondiente.

### Diseño implementado

#### `BonusesAutoGrantService.autoGrantForApprovedDeposit(db, params)`

Pipeline:
1. **¿Welcome o reload?** Query `count(*) FROM deposits WHERE user_id=X AND status='approved'`. ≤1 → welcome (acabamos de aprobarlo). >1 → reload.
2. **Pick definition**: primera activa del type matcheado, orden por `code ASC`. Determinístico — el Admin Tenant nombra códigos con prefijo numérico si quiere prioridad explícita.
3. **Eval config** (centavos para evitar floats):
   - `minDeposit` corta si depósito es menor.
   - `bonusCents = floor(depositCents * matchPct / 100)`, capeado por `maxAmount`.
   - `matchPct ≤ 0` o resultado 0 → no se otorga.
4. **Grant** via `UserBonusesService.grantManual` con `grantIdempotencyKey = "auto_grant:<depositId>:<welcome|reload>"`. Si approve se reintenta, el grant es idempotente naturalmente.
5. Retorna `{bonus, kind, skipReason?}`. NO tira excepciones para "no aplica" — devuelve `bonus: null` con razón. Sí tira para errores reales (funder sin saldo).

#### Hook en `DepositsController.approve`

Después del approve commit (cuando `before.status !== after.status`):
- Llama `bonusesAutoGrant.autoGrantForApprovedDeposit`.
- Si `result.bonus`: audit entry `bonus.auto_grant` (severity:medium).
- Si `result.skipReason`: log debug (no fallo).
- Si tira excepción: log warning + audit `bonus.auto_grant_failed` (severity:high). **NO revierte el deposit** — el deposit ya fue aprobado, el cajero puede otorgar el bono manual después.

### Decisiones técnicas no obvias

1. **Hook en controller, no en service.** Razón: keep `DepositsService.approve` puro (single responsibility — solo aprobar y acreditar wallet). El auto-grant es "behavior" del sistema, no parte intrínseca de aprobar. Trade-off: si en el futuro otros flows aprobaran deposits (e.g. job batch), tendrían que replicar el hook. Mitigación: si aparece, mover a service.

2. **Fail-soft.** El auto-grant NUNCA rompe el approve. Razones:
   - El usuario YA hizo el depósito y vio aprobado → no queremos rollback misterioso si el bono falla.
   - El bono es "extra" — si falla, se puede otorgar manualmente después.
   - Auditamos el fallo (severity:high) para que un admin lo vea en el panel.

3. **Conteo de deposits aprobados, NO flag en users.** Pude haber agregado `users.is_first_deposit_done`. Más simple: query directa `count(*) where status=approved`. Trade-off: 1 query extra. Beneficio: no hay state que mantener, siempre correcto, retro-compatible con deposits viejos sin el flag.

4. **Idempotency derivada del depositId + kind.** Garantiza:
   - Mismo deposit aprobado 2x → 1 bono (segundo approve es no-op silencioso, no entra al hook).
   - Si por algún motivo el hook se ejecuta 2x con mismo deposit (race teórica), `grantIdempotencyKey` UNIQUE en DB lo corta.
   - El `:welcome`/`:reload` en la key permite que un mismo deposit (teóricamente) genere 2 bonos distintos si en el futuro el sistema decide hacerlo. Hoy solo uno.

5. **`segmentFilter` se IGNORA en MVP.** El JSONB se persiste pero no se evalúa. Cuando llegue feature de segmentación, agregar evaluator. Por ahora todos los users elegibles.

6. **`matchPct = 0` o config rota → skip silencioso, no error.** Defensivo: si el Admin Tenant se equivoca creando una definition con config inválido, el deposit sigue aprobándose sin bono. El admin ve en su panel "0 bonos otorgados en deposits X-Y" y corrige.

7. **Determinismo de pick por `code ASC`.** Si hay varias welcome definitions activas (escenario real cuando el admin está testeando antes de archivar la vieja), tomamos la primera por código. Predictable y sin sorpresas. El admin puede usar prefijos numéricos (`01_welcome_basic`, `02_welcome_premium`) para controlar prioridad si fuera necesario.

8. **`actorUserId` del auto-grant = el approver del deposit.** Para audit traceability: "el cajero X aprobó el deposit, lo cual disparó el bono Y para el user Z". Alternativa: `actorUserId = SYSTEM_USER_ID` (null). Decidí approver para mejor trail.

### Tests E2E (7 nuevos en bonuses-auto-grant.e2e.ts)

- Welcome: primer deposit → bono con monto correcto.
- Welcome capeado por `maxAmount`.
- Deposit < `minDeposit` → no bono, deposit OK.
- Sin welcome definition activa → deposit OK sin bono.
- Reload: segundo deposit → tipo `reload` (no segundo welcome).
- Idempotencia: doble approve → un solo bono.
- Fail-soft: `matchPct=0` → deposit OK sin bono.

### Estado final

- **234 tests, 17 suites, 0 skipped, 0 flaky.**
- **2/2 corridas consecutivas verde** (~75-80s).

### Lo que NO entró todavía

- **Eval de `segmentFilter`** — JSONB se ignora hoy.
- **Welcome con múltiples definitions priorizadas dinámicamente** — hoy primer code asc gana. UI/Admin podría permitir setear prioridad explícita.
- **Auto-grant para otros tipos** (cashback con job, no_deposit en registro, referral en FTD del referido). Sprints específicos.
- **Notificación al user** "te llegó un welcome bonus!". Depende email/push infra.
- **Reverso del bono si el deposit se cancela DESPUÉS** (caso límite si en el futuro hay deposit.cancel sobre approved). Hoy: deposit approved no se cancela. Si llega el flow, agregar hook que cancele el bono asociado.

---

## 2026-05-13 — Expiración automática de bonos (Sprint Bonos-cron)

### Contexto

Sprint Bonos-1 dejó bonos con `expires_at` configurable (default 30 días) pero sin proceso que los cerrara cuando vencieran. Resultado: bonos quedaban `active` para siempre, fondos del funder atrapados sin posibilidad de uso. Este sprint cierra el loop:
- Job que detecta `active AND expires_at < NOW()`.
- Por cada uno: revert al funder + UPDATE status='expired' + audit.
- Cron que corre el job a las 00:00 UTC sobre TODOS los tenants.
- Endpoint admin para forzar manualmente.

### Diseño implementado

#### `BonusesExpirationService.expireDueForTenant(db)`
- Query: `SELECT * FROM user_bonuses WHERE status='active' AND expires_at < NOW() LIMIT 500`.
- Por cada bono:
  1. Si `remainingAmount > 0`: `WalletService.executeBonusFundingRevert` con key `bonus_expire:<bonusId>` (idempotent).
  2. UPDATE status='expired', remainingAmount='0.00', con guarda `WHERE status='active'` (defensa contra race).
  3. Audit `bonus.expired` severity:medium.
- Cada bono procesado independientemente: si uno falla, log + audit `bonus.expire_failed` severity:high + continúa con los demás. Aborta el batch entero solo si la query inicial falla.
- Retorna `{totalProcessed, succeeded, failed, failedIds[]}`.
- `MAX_PER_RUN = 500`: si hay más, próximo run los toma. Evita transacciones largas.

#### `BonusesExpirationCron.runForAllTenants()`
- Lee `platform_control.tenants WHERE status='active'`.
- Por cada uno: `connectionCache.get(tenant)` → llama `expireDueForTenant`. Try/catch por tenant — un fallo no interrumpe los demás.
- Flag `running` previene re-entrada (si un run no termina antes del próximo trigger, segundo se salta).
- Schedule programable via `BONUSES_EXPIRE_CRON` (default `0 0 * * *`).
- Disable total via `BONUSES_EXPIRE_ENABLED=false`.
- Registración programática (no decorador `@Cron`) para permitir env-config del schedule.

#### Endpoint admin `POST /tenant/bonuses/jobs/expire`
- Llama `expirationService.expireDueForTenant(req.tenantContext.db)` — solo el tenant del request.
- Permiso: `bonuses.force_clear` (más sensible del módulo). No exige 2FA porque NO entrega chips al user (revert al funder, no destructiva end-user).
- Audit `bonus.expire_job.manual` severity:medium si `totalProcessed > 0`.
- Útil para: reconciliación manual cuando el admin notó bonos no procesados, testing del flow.

### Decisiones técnicas no obvias

1. **Cron programático con `SchedulerRegistry`, no decorador.** Razón: queremos `BONUSES_EXPIRE_CRON` env config. `@Cron('expr')` requiere string constante en tiempo de compile. Trade-off mínimo — code un poco más verboso.

2. **`actorUserId` del revert = `bonus.fundedByUserId`.** Decisión sutil. El revert no tiene actor humano (es el cron). Opciones consideradas:
   - `null` → wallet_transactions.createdBy = null. Audit trail dice "sistema".
   - El funder mismo → semánticamente correcto ("el funder se recupera de su bono que venció").
   - Un user "sistema" especial → requiere agregar fila en users (complica seed).
   Elegí el funder. El `source='bonus_cancel'` y el `idempotencyKey='bonus_expire:<id>'` distinguen claramente del cancel manual en queries de reporting.

3. **Idempotency en dos niveles** (mismo patrón que cancel manual):
   - Wallet tx con key `bonus_expire:<bonusId>` UNIQUE.
   - UPDATE con `WHERE status='active'` — segundo run no encuentra el bono.
   Re-run del job es seguro: nada se duplica, nada se reverte dos veces.

4. **`MAX_PER_RUN = 500`.** Limita el batch para evitar:
   - Transacciones long-running que bloqueen el pool postgres.
   - Memoria si hay 100k bonos vencidos (caso patológico — admin no corrió cron en meses).
   Si hay más, próximo run los toma. Operativamente correcto.

5. **Endpoint admin requiere `bonuses.force_clear`.** Razón: es la operación más cercana semánticamente — cerrar bonos masivamente con efecto financiero. Igual que force_clear pero múltiple. Permiso no-delegable (heredado del seed). 2FA NO se exige porque no entrega chips al user. Si el admin abusa y dispara el job seguido, lo peor que pasa es que reverte 0 bonos cada vez (no hay nada vencido).

6. **Fail-soft individual, fail-loud batch.** Si un bono falla, lo aislamos + audit. Si la query inicial falla (DB caída), el endpoint tira 500. Esto evita que un bono problemático corte la limpieza de los demás.

7. **Multi-tenant en el cron, single-tenant en el endpoint.** Decisión consciente:
   - Cron itera todos los tenants (no conoce un tenant específico).
   - Endpoint vive bajo `/tenant/...` así que ya tiene `tenantContext`. Procesa solo ese tenant.
   - Si en el futuro un super-admin quisiera disparar el job global desde el panel de plataforma, agregar endpoint en `/platform/jobs/...` que reuse `BonusesExpirationCron.runForAllTenants`.

8. **Disable cron en tests via env override en globalSetup.** `process.env.BONUSES_EXPIRE_ENABLED = 'false'` en globalSetup antes de cualquier import de la app. Sin esto, el CronJob queda activo entre suites y mantiene handles abiertos que confunden a Jest en shutdown (similar patrón a lo que ya hicimos con rate-limit).

### Tests E2E (6 nuevos en bonuses-expiration.e2e.ts)

- Happy: bono vencido → expired + revert.
- No-op: bono futuro sigue active.
- No-op: bono cancelled NO se toca.
- Idempotencia: doble run = un solo revert.
- Permisos: cajero1 → 403.
- Batch: 3 bonos vencidos → todos procesados en un run.

### Estado final

- **240 tests, 18 suites, 0 skipped, 0 flaky.**
- **2/2 corridas consecutivas verde** (~70-90s).

### Lo que NO entró todavía

- **Forfeit automático** (cuando el user retira antes de cumplir wagering). Necesita engine de juegos.
- **Notificación al user** "tu bono X expiró sin usar". Email infra pendiente.
- **Notificación al admin** "se expiraron N bonos por $X en el último run". Dashboard widget.
- **Endpoint global** `/platform/jobs/expire-bonuses` para super-admin (corre el job sobre todos los tenants on-demand). Hoy solo el cron lo dispara global.
- **Lock distribuido si multi-instance.** Hoy single-instance el cron. Si crecemos a N pods, dos correrían simultáneo (la idempotency lo blinda pero hay desperdicio). Migrar a Redis/PG advisory lock.
- **Métricas del run** (Prometheus): cuántos bonos / cuánto reverted / tiempo). Sprint Observability.

---

## 2026-05-13 — Cashback job (Sprint Bonos-cashback)

### Contexto

Doc 15 §A1: cashback = "% del netwin perdido en período X devuelto como bono". Era el último tipo de bono auto-grant que faltaba: pierde activity tracking del player en el período, suma bet/win, si netwin < 0 → otorga cashback del % configurado. Sprint cierra el subsistema de bonos auto (welcome/reload/cashback los 3 entran).

### Diseño implementado

#### Buckets fijos no-overlapping

```
bucketIndex = floor(daysSinceEpoch / periodDays)
closedBucket = currentBucket - 1
periodStart = closedBucket * periodDays days
periodEnd = periodStart + periodDays days
```

- El job procesa el ÚLTIMO bucket cerrado (no current).
- Si periodDays=7 y el job corre todos los días, solo otorga cashback los lunes (cuando se cierra el bucket de la semana anterior). Resto: mismo bucket cerrado → idempotency hit → no-op.
- Si periodDays=1 (diario), otorga todos los días sobre el día previo.

#### `BonusesCashbackService.runForTenant(db, asOf?)`

Por cada `bonus_definitions WHERE type='cashback' AND status='active'`:
1. Calcula bucket cerrado según `config.periodDays`.
2. Query agregada: `SELECT user_id, SUM(amount FILTER bet) AS bets, SUM(amount FILTER win) AS wins FROM wallet_tx JOIN wallets WHERE type IN ('bet','win') AND created_at IN [bucket] GROUP BY user_id`.
3. Para cada user con netwin < 0:
   - `netloss = -netwin`.
   - Skip si `netloss < config.minNetloss`.
   - `cashback = min(netloss * pct/100, maxCashback)`.
   - Grant via `UserBonusesService.grantManual` con key `cashback:<defId>:<userId>:<bucketIndex>`.
4. Detecta "ya existía" via `findByGrantKey` (nuevo método en UserBonusesService) — distingue creación fresh vs idempotency-hit en el response.

#### `BonusesCashbackCron`

Misma pattern que ExpirationCron. Default `0 1 * * *` (1AM UTC daily). Env `BONUSES_CASHBACK_CRON` + `BONUSES_CASHBACK_ENABLED`.

#### Endpoint `POST /tenant/bonuses/jobs/cashback?asOf=ISO`

- `asOf` opcional permite anclar el "ahora" — tests pasan asOf fijo para bucket determinístico, ops puede correr histórico para reconciliación.
- Requiere `bonuses.force_clear` (mismo nivel que expiration).
- Audit `bonus.cashback_job.manual` si `grantsCreated > 0`.

### Decisiones técnicas no obvias

1. **Buckets fijos vs rolling window.** Decidí fijos (alineados a epoch). Ventajas:
   - Idempotency natural (un bucket cerrado siempre tiene el mismo índice).
   - Predictible: el jugador sabe "el bucket de esta semana cierra el lunes".
   - Simple: no requiere `last_run_at` en algún state.
   Trade-off: si el admin cambia `periodDays` de 7 a 30, los buckets cambian alineación. Si lo hace en medio del período, el siguiente run procesará el bucket nuevo (que podría tener overlap con el anterior). Riesgo: el mismo netloss podría contribuir a dos bonos diferentes si straddled. Aceptable para MVP — admins normales no rotan periodDays seguido.

2. **`asOf` parameter del endpoint.** Para tests es esencial (no podemos esperar a que pase un día). Para producción es útil:
   - Reconciliación: el cron falló por un día, admin corre con `asOf` del día perdido → procesa ese bucket.
   - Backfill: setear `asOf` retroactivo recorre buckets viejos.
   Trade-off: misuse puede generar grants en buckets viejos. Mitigation: solo `bonuses.force_clear` permission (no-delegable, admin only) + audit log.

3. **`actorUserId` del grant = `def.fundedByUserId`.** Mismo razonamiento que expiration. No hay actor humano, el funder "se cashbackea" semánticamente.

4. **Activity bet/win sintética en tests** (INSERT directo a wallet_transactions). Sin engine de juegos aún, el test inserta wallet_tx con type='bet' y 'win' y un `created_at` anclado al bucket cerrado del `asOf` fijo. Cuando llegue Fase 6 (game providers), el flow real generará esas tx y el cashback empezará a funcionar automáticamente sin cambios acá.

5. **Reuso de `grantManual`** (no creé `grantCashback`). El cashback es semánticamente un grant manual del sistema → mismo flow + idempotency. Sourcevent distingue (`kind: 'cashback'` con bucketIndex en el JSONB).

6. **`findByGrantKey` agregado a `UserBonusesService`.** Util para detectar idempotency-hit sin tirar/atrapar excepción. Otros flows auto-grant (welcome) podrían usarlo si quieren reportar "ya estaba" vs "recién creado".

7. **Cron schedule diario aunque buckets sean semanales.** El service decide qué bucket procesar. Días donde el bucket cerrado ya fue procesado son no-op idempotente. Esto da resilience: si un día el cron falla, el siguiente día procesa de nuevo el bucket (con idempotency hit para los ya granted; cierra los que faltaban).

8. **Test idempotency assert per-player, no per-batch.** Como la suite no resetea `wallet_transactions` entre tests, prior tests' players entran al cálculo del nuevo bucket. La suite tiene asserts sobre `readBonusesFor(player.id)` (sólo el player del test) para aislar.

### Tests E2E (10 nuevos en bonuses-cashback.e2e.ts)

- Cálculo: netloss → cashback, netwin → no, bajo minNetloss → skip, capeado por maxCashback.
- Bucket window: activity fuera del bucket cerrado NO entra.
- Idempotencia: re-run → 0 grants nuevos para el player.
- Permisos: cajero1 sin force_clear → 403.
- No-op: sin definitions, pct=0, asOf inválido.

### Estado final

- **250 tests, 19 suites, 0 skipped, 0 flaky.**
- **2/2 corridas consecutivas verde** (~73-77s).

### Lo que NO entró todavía

- **`segmentFilter` se ignora** (igual que auto-grant welcome).
- **Notificación al user** "te llegó un cashback de X". Email infra pendiente.
- **Endpoint global** `/platform/jobs/cashback`. Hoy solo per-tenant.
- **Multi-bucket history**: el admin no puede ver "qué hizo el cashback la semana pasada en detalle". Hoy los datos están en audit_log + user_bonuses.sourceEvent — falta UI agregada.
- **Lock distribuido** (igual que expiration cron).

---

## 2026-05-13 — Sorteos: daily_wheel (Sprint Sorteos-1)

### Contexto

Doc 15 §B describe 6 tipos de promociones/sorteos: lottery_tickets, lottery_ranking, missions, daily_wheel, login_streak, level_chests. Es un módulo enorme. Decidí scopear este sprint a `daily_wheel` por dos razones:
1. **Self-contained**: no requiere engine de juegos (Fase 6). El user click → RNG → premio. End-to-end funcional.
2. **Demuestra la infraestructura genérica**: tablas `promotions` + `promotion_rewards` con schema flexible (JSONB libre por type). Los otros 5 types se irán implementando con la misma base.

### Diseño implementado

#### Schema (migration 0012)
- `promotions`: plantilla genérica. `code` unique intra-tenant, `type` enum (los 6), `status` enum (draft/scheduled/active/closed/cancelled), `config`/`prizes`/`targetSegment`/`visibility` JSONB, `fundedByUserId` FK, schedule (startsAt/endsAt/drawAt).
- `promotion_rewards`: 1 row por entrega. `prize` JSONB describe el premio entregado, `walletTxId` link al crédito si aplica, `bonusId` link a `user_bonuses` si el premio fue un bono, `idempotencyKey` UNIQUE intra-promotion, `metadata` JSONB con data type-specific (RNG seed para wheel, ticket# para lottery, etc.).

#### Permisos (5 nuevos)
view, view_any, create_definition, edit_definition, cancel.

#### `PromotionsService`
CRUD plano sobre `promotions`. Code unique via 23505 catch. Funder = actor que crea (mismo pattern que bonus_definitions).

#### `DailyWheelService.spin(db, {promotionId, userId}, {rng?, now?})`
1. Carga promo, valida type='daily_wheel', status='active', dentro de schedule.
2. Parsea `config.segments[]` y valida probabilidades (acepta escala 1.0 o 100, tolerancia 1%).
3. Idempotency: 1 spin per `(promotionId, userId, dayAnchor=YYYY-MM-DD UTC)`. Si ya giró hoy → devuelve el reward existente.
4. Sorteo: weighted random via cumulative sum, RNG inyectable.
5. Award por `prize.kind`:
   - `chips`: debit funder (tipo `bonus_funding` source='promo_funding') + credit user (tipo `promo_reward`). Idempotency keys derivadas del spin key.
   - `try_again`: no-op wallet, registra spin igual.
   - `bonus`/`free_spins`: TODO (log warning, no awarding). Schema soporta, lógica pendiente.
6. Insert `promotion_rewards` con metadata.rng + metadata.segmentId.

#### Endpoints
- CRUD admin: `GET /tenant/promotions`, `GET :id`, `POST`, `PATCH :id`.
- User: `POST :id/spin`, `GET :id/my-rewards`.

#### Wallet integration (2 primitivos nuevos)
- `executePromotionFunding`: wrapper de `executeTransaction` con `type='bonus_funding'` (reusamos el type genérico de "salida para promo/bono") y `source='promo_funding'`.
- `executePromotionReward`: wrapper con `type='promo_reward'` (ya existía en el enum, era el único type sin uso real hasta hoy).

### Decisiones técnicas no obvias

1. **Re-uso del type `bonus_funding`** para el debit del funder de promo. Razón: semánticamente es "salida de fondos para fondear un premio". `source='promo_funding'` lo distingue en queries vs bonos. Alternativa: agregar `promo_funding` al enum. Decidí no agregar — el tipo es genérico, el `source` cuenta el detalle. Si se vuelve confuso en reporting, se separa.

2. **`promo_reward` ya existía en el enum** (legacy del seed inicial) — finalmente le damos uso real. CREDIT_TYPES lo incluye correctamente.

3. **Idempotency key con dayAnchor UTC**, no por hora del tenant. Trade-off: si el tenant está en GMT-3, el "día" del user (calendario local) corta a las 21:00 UTC. Aceptable para MVP — un user no nota la diferencia exacta entre "00:00 local" y "00:00 UTC" para resetear su spin. Sprint futuro: timezone del tenant + offset.

4. **RNG inyectable por argumento al service.** El controller usa `Math.random` por default (no toma RNG del request — eso sería un agujero de seguridad, el cliente podría forzar resultados). Tests pasan RNG determinístico SI llaman al service directamente. En la E2E suite usé configs de UN SOLO SEGMENT al 100% para que el RNG sea irrelevante — los tests valen para verificar el flow, no el sorteo en sí.

5. **`PromotionAlreadyClaimedError`** mapea a 409 — pero el flujo normal devuelve 200 con el reward existente (idempotency hit). El error tipado solo se tira en race conditions donde el insert mismo falla por unique violation.

6. **Validación de wheel config en el spin, no en el create.** Razón: el admin podría querer guardar drafts con config incompleto y completarlo después. La validación corre cuando alguien intenta usar. Trade-off: el admin se entera del error solo cuando un user reporta. Mitigación: el endpoint devuelve mensaje claro y log severity:error.

7. **`bonus`/`free_spins` TODO**. El doc lista estos kinds pero requieren coordinación con UserBonusesService (para bonus, igual que auto-grant) y engine de juegos (para free_spins). El service loguea warning y NO awarding — el `promotion_rewards` se crea con `walletTxId=null, bonusId=null` y el `prize` JSONB conserva el descriptor para post-hoc resolution. Sprint posterior implementa el wireup.

8. **No hay DELETE de promociones.** Se setea `status='cancelled'` via PATCH. Las `promotion_rewards` históricas no se borran (auditoría).

9. **Rate limit 30/min por user** en `POST :id/spin`. La idempotency natural ya cubre el case principal (no doble-grant), pero el rate-limit corta floodings del endpoint mismo (bot que tira 1000 requests/seg → 30 pasan, los demás 429).

10. **Schema soporta los 6 types** desde hoy. El enum tiene los valores; las tablas son lo suficiente genéricas para login_streak/missions/etc. (using config + metadata JSONB). Solo falta la lógica de cada type. Esto facilita iteración incremental.

### Tests E2E (14 nuevos en promotions.e2e.ts)

- CRUD: 6 tests (create, code conflict, sin permiso 403, patch status, list filter, 404).
- Spin happy: chips credit, idempotent same day, try_again no-op wallet.
- Spin errores: not active, type mismatch, schedule closed (endsAt pasado), wheel config inválido.
- GET my-rewards.

### Estado final

- **264 tests, 20 suites, 0 skipped, 0 flaky.**
- **2/2 corridas consecutivas verde** (~78-84s).

### Lo que NO entró (sprints futuros)

- **lottery_tickets**: tickets generados por activity en juegos elegibles. Necesita game engine.
- **lottery_ranking**: ranking por métrica. Cron de cierre + draw.
- **missions**: progress tracking en eventos. Necesita game engine.
- ~~**login_streak**~~ ✅ Sprint Sorteos-2.
- **level_chests**: XP system + niveles + loot tables.
- **Premio tipo `bonus`**: wire con `UserBonusesService.grantManual`.
- **Premio tipo `free_spins`**: needs game engine.
- **Antifraude transversal** (doc 15 §D).
- **Eval de `targetSegment`** para elegibilidad.
- **Schedule del wheel** con timezone del tenant (hoy UTC fijo).

---

## 2026-05-13 — Sorteos: login_streak + refactor PrizeAwarder (Sprint Sorteos-2)

### Contexto

Segundo type del módulo promotions del doc 15 §B. `login_streak` es self-contained (no requiere game engine), mismo patrón que `daily_wheel` pero con state per-user (streak counter, lastClaimDay) en una tabla nueva. También extrajimos el dispatch de premios a un helper reusable porque iba a duplicarse entre wheel y streak.

### Diseño implementado

#### Schema (migration 0013)
- Tabla nueva `promotion_participants`: state vivo per (promotion, user). UNIQUE en `(promotion_id, user_id)`. `current_progress` JSONB libre por type.
  - login_streak guarda: `{ streak, lastClaimDay: "YYYY-MM-DD", lastPrize }`.
  - Diseñada genérica para futuro: missions guardarán progress por objetivo, level_chests guardará xp+level, etc.

#### `PromotionPrizeAwarder` (helper compartido)
Extraje el dispatch de premios `{kind, ...}` → wallet flow de `DailyWheelService` a un service propio. Hoy soporta:
- `chips`: debit funder + credit user.
- `try_again`: no-op.
- `bonus` / `free_spins`: TODO (log warning).

DailyWheelService refactorizado para usar el awarder. Mismo behavior, código compartido.

#### `LoginStreakService.claim(db, {promotionId, userId}, {now?})`

Pipeline:
1. Carga promo, valida `type=login_streak`, status, schedule.
2. Parse config: `prizes[]`, `forgivenessDays`, `onMax: 'hold'|'reset'|'cycle'`, `autoClaimOnLogin`.
3. Idempotency: clave `streak_claim:<promotionId>:<userId>:<dayAnchorUTC>`. Si reward para hoy ya existe → idempotent.
4. `loadOrCreateParticipant`: upsert pattern con catch del 23505 race.
5. Computa nuevo streak:
   - daysDiff = días entre `lastClaimDay` y `today` UTC.
   - 0 → no-op (caller maneja idempotency antes).
   - ≤ `1 + forgivenessDays` → `streak++`.
   - else → reset a 1.
   - Nunca claim antes → streak = 1.
6. Resuelve prize index según `onMax`:
   - `hold` (default): `min(streak-1, prizes.length-1)`.
   - `cycle`: `(streak-1) % prizes.length`.
   - `reset`: 0 (defensivo — caller debería haber reseteado streak).
7. Award via PrizeAwarder.
8. Insert `promotion_rewards`.
9. Update `promotion_participants.current_progress`.

Retorna `{ reward, streak, prize, created: boolean }` (created distingue creación fresh vs idempotency hit).

#### Endpoints
- `POST /tenant/promotions/:id/claim-streak`: user-facing. Rate-limit 30/min. Audit `promotion.streak.claim` si created=true.
- `GET /tenant/promotions/:id/my-streak`: lectura del state del user. Útil para frontend mostrar "día N de M".

#### Hook auto-claim on login
`TenantAuthController.login` post-success ejecuta `loginStreak.autoClaimOnLogin(db, userId)` fail-soft (void promise + catch). El service hace query SQL filtrada:
```sql
SELECT * FROM promotions
WHERE type='login_streak' AND status='active'
  AND (config->>'autoClaimOnLogin') = 'true'
```
Por cada promo matcheada, llama `claim`. Errores per-promo se loguean y NO abortan los demás claims ni el login.

`TenantAuthModule.imports` ahora incluye `forwardRef(() => PromotionsModule)` — defensivo por si alguna vez Promotions necesita algo de TenantAuth (no hay cycle real hoy).

### Decisiones técnicas no obvias

1. **Idempotency keys con promo.id**. Sutil bug encontrado: las keys originales eran `streak_claim:<userId>:<dayAnchor>` (login_streak) y `daily_spin:<userId>:<dayAnchor>` (wheel). El wallet derivaba `promo_fund:<key>` y `promo_reward:<key>`. Si un user tenía DOS promos activas en el mismo día (e.g. una autoclaim + una manual), el wallet `idempotency_key` UNIQUE colisionaba globalmente entre promos distintas. Síntoma: 409 PROMOTION_ALREADY_CLAIMED en el segundo claim. Fix: incluir `promo.id` en la key → `streak_claim:<promoId>:<userId>:<day>`. Aplicado en BOTH services (wheel + streak).

2. **`.returning()` obligatorio en UPDATE**. Sin él, observamos que el UPDATE de `promotion_participants` no se materializaba en algunos paths (drizzle/postgres-js race). Con `.returning({...})` el statement se ejecuta y commitea correctamente. Patrón a mantener en futuros services.

3. **Hook fire-and-forget en login**. El auto-claim NO bloquea la respuesta del login. `void this.loginStreak.autoClaimOnLogin(...).catch(...)`. Si el cron de auto-claim tarda 200ms, el user no espera. Trade-off: si el claim falla, el user no lo nota (el response del login no se modifica). Compensación: audit log + warning log.

4. **`promotion_participants` table genérica**. JSONB libre por type, con esquema TS interpretado en cada service. Resiste futuros types (missions, chests). UNIQUE (promo_id, user_id) garantiza 1 fila por user-promo.

5. **`loadOrCreateParticipant` con catch 23505**. Pattern upsert defensivo: SELECT → INSERT → si 23505 → re-SELECT. Maneja la race condition de dos claims concurrentes del mismo (promo, user) que ambos intentan INSERT. Una gana, la otra hace re-select.

6. **`onMax` configurable**. El doc menciona "reset si se rompe el streak" pero no especifica qué hacer cuando el streak supera `prizes.length`. Implementé 3 modos: `hold` (default — mantiene último premio), `cycle` (vuelve a prizes[0]), `reset` (streak resetea a 1). Permite que el Admin Tenant elija UX según su política.

7. **`forgivenessDays`**. Permite 1 día de gap sin perder streak — UX más amable que hard reset. `forgivenessDays=0` (default) es estricto. `forgivenessDays=1` permite "olvidé ayer".

8. **`StreakProgress` exportado** para que el controller pueda devolver el tipo. Originalmente era interno, pero el endpoint `/my-streak` lo expone.

9. **Refactor PrizeAwarder solo cubre lo que tiene sentido reusar**. La RNG del wheel se queda en DailyWheelService porque es type-specific. El awarder solo dispara wallet flows. Si en el futuro un type tiene su propio award especial (e.g. lottery_tickets entrega tickets en lugar de chips), se extiende el switch.

### Tests E2E (13 nuevos en promotions-login-streak.e2e.ts)

- claim: primer claim, idempotent same day, día siguiente, gap reset, gap forgiveness, onMax hold, onMax cycle, type mismatch.
- my-streak: null si nunca participó, state después de claim.
- Hook autoClaimOnLogin: dispara con true, NO dispara con false.
- Participant row creada y actualizada.

### Bug encontrado y resuelto

- **Idempotency collision entre promos** del mismo type para el mismo user en el mismo día (descrito arriba). Crítico: hubiera roto cualquier deployment con > 1 promo de mismo type activa. Fix aplicado en wheel + streak.

### Estado final

- **277 tests, 21 suites, 0 skipped, 0 flaky.**
- **2/2 corridas consecutivas verde** (~92-94s).

### Lo que NO entró todavía

- **lottery_tickets / lottery_ranking / missions / level_chests** — dependen del game engine para activity tracking.
- ~~**Premio kind=bonus**~~ ✅ Sprint Sorteos-3.
- **Frontend** para mostrar "día N de M" con countdown.
- **Notificación al user** sobre streak roto / próximo premio.
- **`autoClaimOnLogin` cache** — hoy la query corre en cada login. Si crece volumen, cachear "hay alguna login_streak con autoClaim activa?" con TTL corto.

---

## 2026-05-13 — Premio kind=bonus en promotions (Sprint Sorteos-3)

### Contexto

Sprint Sorteos-1/2 dejaron `daily_wheel` y `login_streak` funcionando con premios `chips`/`try_again`, con `bonus`/`free_spins` como TODO en el `PromotionPrizeAwarder`. Este sprint cierra el wireup de `bonus`: cuando una promotion entrega un premio kind=bonus, el sistema otorga el bono via `UserBonusesService.grantManual` y linkea el `user_bonus.id` en el `promotion_rewards.bonus_id`.

### Diseño implementado

#### `PromotionPrizeAwarder` extendido

Nuevo case en el dispatch:
```typescript
if (prize.kind === 'bonus') {
  try {
    const granted = await this.userBonusesService.grantManual(db, {
      actorUserId: promo.fundedByUserId,
      userId,
      definitionId: prize.definitionId,
      amount: numericAsString(prize.amount),
      reason: `Promotion ${promo.code} prize: bonus grant automático`,
      grantIdempotencyKey: `promo_bonus:${idempotencyKeyBase}`,
      sourceEvent: { kind: 'promotion', promotionId, promotionCode },
    });
    return { walletTxId: null, bonusId: granted.id };
  } catch (err) {
    // fail-soft sobre errores conocidos del bonus subsistema
    if (err instanceof BonusDefinitionNotFoundError | NotActiveError | TargetNotFound | FunderInsufficient | GrantIdempotencyConflict) {
      this.logger.error(`...`);
      return { walletTxId: null, bonusId: null };
    }
    throw err; // errores inesperados sí re-tiramos
  }
}
```

#### Module dep

`PromotionsModule.imports` ahora incluye `BonusesModule` (que exporta `UserBonusesService`). No hay cycle (BonusesModule no depende de Promotions).

### Decisiones técnicas no obvias

1. **El dinero del bono sale del funder de la BONUS DEFINITION, NO del funder del PROMO**. Decisión clave:
   - `bonus_definitions.fundedByUserId`: quien dijo "yo financio este bono" al crear la definition (en MVP = creador).
   - `promotions.fundedByUserId`: quien dijo "yo financio esta promo" (idem).
   - Cuando el promo entrega un kind=bonus, llamamos `grantManual` que internamente debita el funder DE LA DEFINITION. El `actorUserId = promo.fundedByUserId` se guarda como `granted_by_user_id` en `user_bonuses` (audit trail: "el promo X gatilló este bono").
   - Razón: cada bono tiene su propia política de financiamiento. El admin podría tener un "welcome bonus" financiado por el casino y ofrecerlo como premio en una promo financiada por un Socio. Mezclar funders rompería contabilidad.
   - Trade-off: si el admin quiere que la promo "incluya" el bono en su costo, debe alinear los funders. Operativo: en MVP suelen ser el mismo (admin_tenant para todo).

2. **Idempotency key del grant**: `promo_bonus:<idempotencyKeyBase>` donde `idempotencyKeyBase` es la key del spin/claim (e.g. `daily_spin:<promoId>:<userId>:<day>`). Re-spin → mismo grantIdempotencyKey → grantManual idempotent → mismo user_bonus. Verificado en test.

3. **Fail-soft sobre errores conocidos del bonus subsistema**. Los 5 errores tipados (`BonusDefinitionNotFoundError`, `NotActiveError`, `TargetNotFoundError`, `FunderInsufficientBalanceError`, `GrantIdempotencyConflictError`) → log severity:high + return `{bonusId: null}`. El reward row se crea con `bonus_id=null`. El user "ve" el premio en el response pero NO recibe el bono. El admin lo ve en logs/audit y reconcilia manualmente.
   - Trade-off vs fail-loud: si fuera 500, el spin/claim del user fallaría. UX malo. Aceptamos que el user a veces "vea" un premio sin recibirlo si la config está rota — es responsabilidad del admin tener bien configurada la promo.
   - Errores **inesperados** (DB caída, etc.) sí re-tiramos. Diferencia: errores conocidos = "config issue del admin, no del usuario"; errores inesperados = "algo grave pasó, propagar".

4. **Imports tipados con alias** (`FunderInsufficientBalanceError as BonusFunderInsufficientBalanceError`). Promotions ya tiene su propio `FunderInsufficientBalanceError` (cuando el funder del PROMO no tiene saldo). El de bonos es distinto (cuando el funder del BONO no tiene saldo). Misma semántica pero contextos distintos. Alias evita confusión.

5. **Source event guarda `promotionId` y `promotionCode`**. Permite reportes "qué bonos vinieron de qué promo" con join entre `user_bonuses.source_event` y `promotions`. Útil para analytics de campañas.

### Tests E2E (5 nuevos en promotions-prize-bonus.e2e.ts)

- **wheel + bonus happy**: spin → user_bonus creado, reward.bonus_id linkea, source_event correcto.
- **definition inactiva → fail-soft**: spin returna 200, NO user_bonus, reward.bonus_id=null.
- **definition inexistente → fail-soft**: idem.
- **idempotencia**: re-spin mismo día → mismo bonus, no doble grant.
- **streak + bonus happy**: claim-streak con prize=bonus → user_bonus creado.

### Estado final

- **282 tests, 22 suites, 0 skipped, 0 flaky.**
- **2/2 corridas consecutivas verde** (~81-119s).

### Lo que NO entró todavía

- **Premio kind=free_spins** — sigue TODO. Necesita engine de juegos.
- **Reverso del bono si la promotion se cancela post-grant** — hoy si admin cancela el promo, el user_bonus queda activo. Sprint posterior podría agregar hook que cancele bonos asociados.
- **Notificación al user** "te llegó un bonus por la ruleta diaria!". Email infra pendiente.
- **Métricas de awarding** — observability sobre cuántos bonos automáticos se otorgan por día.

---

## 2026-05-13 — Liga / Rankings (Sprint Liga MVP)

### Contexto

Doc 15 §C: leaderboards multi-período con premios automáticos al cierre. 6 tipos de premio configurables por posición (chips, bonus, free_spins, ranges "2-5"/"6-10"). 5 métricas posibles (bet_volume, rounds_count, gross_won, player_netwin, score_custom). 4 períodos (daily/weekly/monthly/season).

Sprint MVP scope: schema completo + CRUD + 2 métricas (bet_volume, rounds_count) + cierre con settle de premios + cron + refactor del PrizeAwarder para reuso.

### Diseño implementado

#### Schema (migration 0014, 3 tablas nuevas)
- `leagues`: definition con `period`, `metric`, `metricConfig` JSONB (para fórmula custom), `prizes` JSONB (mapa posición→premio), `startsAt`/`endsAt`, `status` enum (scheduled/active/closed), `fundedByUserId`.
- `league_standings`: snapshot vivo. PK compuesta `(league_id, user_id)`. `score numeric(20,4)`, `position int`. Index `(leagueId, position)` para top-N queries.
- `league_results`: append-only de premios entregados al cerrar. `idempotencyKey` UNIQUE intra-league (`settle:<userId>`) — re-run del settle no duplica. `walletTxId`/`bonusId` linkean al payout.

#### Permisos (5 nuevos)
- `leagues.view` / `view_any` (admin scope).
- `leagues.create_definition` / `edit_definition` (no-delegable).
- `leagues.run_actions` (no-delegable, audit) — para forzar recompute o close manual.

NOTA: los endpoints user-facing (list, getById, standings, results) NO requieren permission — solo JWT — porque doc 15 §C5 dice "premios visibles públicamente, solo logueados pueden ver".

#### Refactor `PromotionPrizeAwarder` (genérico)
Cambio API: `award` ya no toma `Promotion`, toma `PrizeContext`:
```typescript
interface PrizeContext {
  id: string;
  code: string;
  fundedByUserId: string;
}
```
DailyWheelService y LoginStreakService actualizados para construir el context desde `promo`. LeaguesService construye el context desde `league`. Mismo awarder sirve a 3 subsystems hoy y queda listo para missions/lottery_tickets/etc.

#### `LeaguesService`
- **CRUD**: `create` con validación de schedule (`endsAt > startsAt`), code unique via 23505. `findById`, `list` (con filtros), `update`.
- **`recompute(db, leagueId)`**: query agregada SUM/COUNT por user con activity en `[startsAt, endsAt)`. DELETE+INSERT en TX para snapshot atómico (vs UPSERT — más simple).
- **`getStandingsView(db, leagueId, userId, topN=10)`**: top N + ventana alrededor del user (posición-1 .. posición+1) si está fuera del top.
- **`closeAndSettle(db, leagueId)`**:
  1. Recompute final (asegura datos frescos).
  2. Parse `prizes` JSONB con keys "1", "2-5", "6-10".
  3. Por cada participant en posición premiada: chequea idempotency (no doble-settle), llama `prizeAwarder.award(context=league, ...)`, inserta `league_results` row.
  4. Status → 'closed'.
  - Idempotent: re-run sobre league closed → 0 settled (early return). Per-user fail no aborta batch.

#### `LeaguesCloseCron`
Default schedule `*/15 * * * *` (cada 15 min — leagues típicamente daily/weekly/monthly, no necesita más resolución). Multi-tenant. Disable via `LEAGUES_CLOSE_ENABLED=false`. Mismo pattern que expiration/cashback crons.

#### Endpoints (LeaguesController)
- `GET /tenant/leagues` (open).
- `GET /:id` (open).
- `POST` (admin: create_definition).
- `PATCH /:id` (admin: edit_definition).
- `GET /:id/standings?topN=10` (open) — top + posición del user.
- `GET /:id/results` (open) — final results de league cerrada.
- `POST /:id/recompute` (admin: run_actions).
- `POST /:id/close` (admin: run_actions).
- `POST /jobs/close-due` (admin: run_actions) — corre el cron sobre el tenant actual.

### Decisiones técnicas no obvias

1. **`startsAt = NOW` por default en tests, no -7d.** Tests de leagues comparten `wallet_transactions` table. Si default startsAt fuese 7 días en el pasado, los bets sintéticos de tests previos entrarían al cálculo. Fix: cada test crea league con `startsAt = new Date()` y inserta bets DESPUÉS — así solo los propios entran al window. Bets de tests previos tienen `createdAt < startsAt` → excluidos. Aprendizaje portable a otros sprints multi-test con activity sintética.

2. **Numeric scores serializados como "5.0000".** Postgres `numeric(20,4)` retorna fixed-precision string. Tests usan `Number(score)` para comparar. Mismo pattern que ya teníamos con wallet balances "100.00".

3. **2 métricas en MVP, schema soporta 5.** El enum tiene los 5 valores. `recompute` tira `LeagueMetricNotSupportedError` si la métrica todavía no está implementada (gross_won, player_netwin, score_custom). Schema completo + lógica incremental — patrón consistente con bonus types y promotion types.

4. **`metric=score_custom` necesita parser de fórmula.** Trade-off seguridad: evitar `eval` (RCE). Posibles approaches: subset DSL (parser propio), `expr-eval` lib. Sprint dedicado.

5. **Recompute completo (DELETE+INSERT) vs UPSERT incremental.** DELETE+INSERT es más simple y correcto bajo lock. UPSERT preservaría el position momentáneamente pero requiere logic de "qué hacer con users que ya no aparecen". Para MVP volúmenes (<1k participantes) es sub-100ms. Para >10k con cron muy frecuente: refactor a UPSERT.

6. **Idempotency key del settle: `settle:<userId>`** con UNIQUE intra-league. Re-run del settle (e.g. cron + manual close concurrente) → segundo intento ve fila existente y skip. Limpio.

7. **Awarder reusable**: el refactor a `PrizeContext` genérico permite que mañana implementemos missions o lottery con el mismo awarder. Una sola pista para mantener el flow de "funder paga → user recibe".

8. **Endpoints user-facing sin permission**. Solo JWT. Razón: el doc dice "Solo logueados pueden ver". Si en el futuro queremos restringir leagues a roles específicos, agregar `@RequirePermissions('leagues.view')` per-endpoint. Hoy mantener simple.

9. **`recompute` en `closeAndSettle`**. Aunque el cron dispare close, hace recompute primero. Garantiza que los premios reflejen el state final (no un standings rezagado). Trade-off: extra query. Aceptable para correcteza.

10. **Status inicial "scheduled" o "active" según `startsAt`**. Si `startsAt > now`, status = scheduled. Else, active. Esto evita tener que esperar a un cron de "activate" para que la league empiece. UX simple.

### Tests E2E (13 nuevos en leagues.e2e.ts)

- CRUD: create, code conflict, sin permiso, schedule inválido.
- Recompute bet_volume: 3 users con bets distintos → posiciones correctas.
- Bet fuera de la ventana NO entra.
- rounds_count cuenta filas (no suma amount).
- Metric no soportada → 409.
- Standings view: user fuera del topN → array `around` con ventana.
- Close & settle: premios a top + balance update + status=closed + results endpoint.
- Close idempotent: segundo close → 0 settled.
- jobs/close-due procesa todas las vencidas.
- Sin permiso run_actions → 403.

### Estado final

- **295 tests, 23 suites, 0 skipped, 0 flaky.**
- **2/2 corridas consecutivas verde** (~100-110s).

### Lo que NO entró (sprints futuros)

- **Métricas gross_won / player_netwin / score_custom**.
- ~~**Antifraude**~~ ✅ Sprint Antifraude MVP.
- **Multi-league simultáneas con métricas distintas** (ya soportado por schema, pero UX para configurarlo es frontend).
- **Frontend** del leaderboard.
- **Notificación a ganadores** post-settle.
- **Premio kind=free_spins** (TODO en awarder, sigue para cuando llegue game engine).
- **Lock distribuido** del cron para multi-instance.
- **Cron periódico de recompute** (hoy solo se recalcula on-demand y al close). Para top-10 en tiempo real: cron cada N min.

---

## 2026-05-13 — Antifraude transversal (Sprint Antifraude MVP)

### Contexto

Doc 15 §D: detección de cuentas múltiples. MVP determinístico (reglas, no ML). El doc lista señales de identidad/contacto/comportamiento/red. Sprint MVP scope: **2 scanners self-contained con datos disponibles HOY** — IP compartida (de `user_sessions`) y email similar (de `users.email`). Otras señales (device fingerprint, geo, comportamiento) requieren más infra y quedan para sprints futuros.

### Diseño implementado

#### Schema (migration 0015, 2 tablas — drop de fraud_clusters table)
- `fraud_signals`: señales crudas. 1 row por (user, signal_type, target). `weight numeric`. `payload jsonb` con detalle (IP, otherUserId, distance, etc.). Snapshot recreado en cada `runScan` (DELETE all + INSERT).
- `fraud_account_links`: pares de cuentas vinculadas. Convención `user_a_id < user_b_id` con CHECK constraint + UNIQUE (a,b). `score numeric(5,2)` 0-100. `signals jsonb` desglose. `status` enum `suspected|confirmed|dismissed`. `reviewedByUserId` + `reviewedAt` para audit.
- **Sin `fraud_clusters` table**: clusters se computan **on-demand** vía union-find sobre links activos en `getClusters()`. Trade-off: re-cálculo en cada query vs persistencia. Para MVP volúmenes (<1k links activos) <50ms — aceptable. Cuando crezca: cachear o materializar.

#### Permisos (3 nuevos)
- `fraud.view` (no-delegable, audit no requerido).
- `fraud.review` (no-delegable, audit_required) — confirm/dismiss.
- `fraud.run_scan` (no-delegable, audit_required) — disparar scan manual.

#### `FraudDetectionService.runScan(db)`
Pipeline:
1. **Scanner `shared_ip`**: SQL agregado `SELECT ip, array_agg(DISTINCT user_id), count(*) FROM user_sessions WHERE ip IS NOT NULL AND created_at > now() - 30d GROUP BY ip HAVING count > 1`. Por cada grupo: signal por user + pair por cada combinación. Weight 30.
2. **Scanner `similar_email`**: load all users with email, agrupar por dominio, JS Levenshtein O(N²) por dominio. Threshold distancia <= 2. Weight 40.
3. **DELETE all + INSERT batch** en `fraud_signals` (snapshot atómico).
4. **Aggregate pairs**: por (userA, userB), suma weights de signal types DISTINTOS (una IP compartida solo aporta 30 al par, no se duplica si hay 5 sesiones).
5. **UPSERT** en `fraud_account_links`:
   - Si existe + status='dismissed': preserve status, update score+signals.
   - Si existe + 'suspected'/'confirmed': update score+signals, mantiene status.
   - Si no existe + score >= 70: INSERT como 'suspected'.
   - Si no existe + score < 70: skip (no llenamos tabla con pares de bajo score).

#### Clusters (on-demand)
`getClusters(db)`:
1. Lista links suspected+confirmed con score >= 70.
2. Union-find sobre los pares.
3. Para cada componente conexa: agrupa user_ids, calcula maxScore, deduce status (`confirmed`/`suspected`/`mixed`).
4. Ordena por maxScore DESC.

#### `isUserFlagged(db, userId, minScore)`
Helper para que liga/sorteos excluyan: true si user pertenece a un link suspected/confirmed con score >= 70. Sprint próximo wiretea esto en LeaguesService.recompute (filtrar antes de incluir en standings).

#### Endpoints (admin-only)
- `GET /tenant/fraud/stats` — KPIs (totals + counts por status).
- `GET /tenant/fraud/clusters` — clusters union-find live.
- `GET /tenant/fraud/links` — links activos ordenados por score DESC.
- `GET /tenant/fraud/links/:id` — detalle.
- `POST /tenant/fraud/links/:id/confirm` (audit severity:high) — duplicado real.
- `POST /tenant/fraud/links/:id/dismiss` (audit severity:medium) — false positive.
- `POST /tenant/fraud/scans/run` — manual trigger.

#### `FraudScanCron`
Default `0 3 * * *` (3 AM UTC daily). Scan no es realtime — cuentas duplicadas operan en días, no segundos. Multi-tenant. Disable via `FRAUD_SCAN_ENABLED=false`.

### Decisiones técnicas no obvias

1. **Drop fraud_clusters table**. El doc lo lista pero union-find on-demand es:
   - Más simple (no maintain consistency con links).
   - Más correcto (siempre refleja state actual).
   - Aceptable performance para MVP (<1k links activos).
   Si crece: cachear con invalidate-on-link-change.

2. **Convención `user_a < user_b` con CHECK constraint**. UNIQUE (a, b) garantiza UN row por par (no duplicado invertido). Operacionalmente: cada inserción aplica `canonicalPair` antes de INSERT.

3. **DELETE+INSERT del snapshot de signals**. Cada scan reemplaza por completo. Trade-off vs UPSERT incremental:
   - Pro: simple, siempre consistent, no hay drift.
   - Con: peridícamente "vacía" la tabla. Para queries CONCURRENT durante el scan, usuario podría ver "0 signals" momentáneamente. Aceptable porque scan es nocturno.

4. **Preservar status='dismissed' en re-scans**. Si admin descartó un link, NO lo re-flagear. Trade-off: si las señales empeoran (e.g. score subió de 70 a 95), el admin no se entera. Mitigación: el scan SÍ actualiza `score` + `signals` aún con status='dismissed' — un dashboard puede mostrar "links dismissed con score actual >X" para revisión.

5. **Score threshold 70 hardcoded**. Per doc 15 §D3: configurable por tenant. MVP usa hardcoded. Sprint futuro: agregar a `tenant_settings` o a un archivo de config. La constante `SUSPECTED_THRESHOLD` está aislada — refactor barato cuando llegue.

6. **Levenshtein en JS, no Postgres**. Postgres tiene `fuzzystrmatch` extension con `levenshtein()` SQL. Trade-off: requiere extension instalada (no estándar). Para MVP volúmenes (<10k users), JS O(N²) por dominio es <100ms. Cuando se requiera escalar: extension PG. La función está aislada en `levenshtein.ts` — fácil de swap.

7. **Email similarity solo intra-dominio**. Los attackers suelen variar el local part manteniendo el dominio (gmail variantes). Cross-domain no es señal fuerte porque cualquier nombre común coincidiría. Trade-off: false negative para attackers que usan distintos providers. Mitigación: agregar peso menor para "domain mismo" en futuro.

8. **Threshold de inserción asimétrico**. Score < 70 no se inserta como NUEVO link. Pero si EXISTING link cae por debajo de 70, mantenemos la fila (con score actualizado). Razón: no perder historial de pares previamente sospechosos.

9. **Sin endpoint `/jobs/scan-all-tenants`** para super-admin. Hoy solo el cron lo dispara global; el endpoint admin opera per-tenant. Si un super-admin necesita correr global on-demand (e.g. tras cambio de algoritmo), futuro sprint platform-level.

10. **Tests usan SQL directo** para insertar `user_sessions` y modificar `users.email`. La API no expone esos primitivos para tests, y el flow normal (login real) no permite controlar IP. Aceptable porque los tests solo prueban el SERVICIO, no el flow de captura de la IP — eso ya está testeado por TenantAuthService tests.

11. **Tests aserciones RELATIVAS no absolutas**. Cross-test contamination de `users.email` (no se resetea entre tests). Cada test verifica SU pair específico (`readLinkBetween(uA, uB)`), no totales globales como `signalsCreated`. Patrón portable a otros sprints con state global.

### Tests E2E (16 nuevos en fraud.e2e.ts)

- **shared_ip scanner**: 2 users (no link, score 30 < 70), 3 users (3 pares, 0 links), IPs distintas (no link).
- **similar_email scanner**: distance 1 mismo dominio (no link, score 40 < 70), distinto dominio NO matchea.
- **Score combinado**: shared_ip + similar_email = 70 → link suspected creado.
- **Link visible en endpoint /links** post-scan.
- **Clusters union-find**: A↔B + B↔C → cluster {A,B,C}; pares no conectados → 2 clusters separados.
- **Confirm/dismiss**: status update + reviewedBy persistencia + dismiss preserva en re-scan + double-confirm 409.
- **Permisos**: cajero1 sin fraud.view → 403, sin fraud.run_scan → 403.
- **Estado por user**: link contiene a uA y uB, no contiene a uC (semántica isUserFlagged).
- **Stats endpoint**.

### Estado final

- **311 tests, 24 suites, 0 skipped, 0 flaky.**
- **2/2 corridas consecutivas verde** (~130-140s).

### Lo que NO entró (sprints futuros)

- ~~**Wireup de `isUserFlagged` en LeaguesService.recompute**~~ ✅ Sprint Antifraude-Liga wireup.
- ~~**Wireup en bonus auto-grant**~~ ✅ Sprint Antifraude-Bonos wireup.
- **Threshold configurable por tenant** (`tenant_settings.fraud_threshold`).
- **Más scanners**: phone similarity (último dígito distinto), device fingerprint (necesita captura desde frontend), geo, behavior patterns.
- **`fuzzystrmatch` Postgres extension** para Levenshtein nativo si crece.
- **Notificación al admin** "scan encontró 5 nuevos clusters con score > 90" — depende email infra.
- **Dashboard `/clusters?dismissed_with_high_current_score`** — links que admin descartó pero ahora puntean alto.
- **Acción "ban N-1 users del cluster"** desde el panel — hoy el admin tiene que banear manual user por user.
- **Behavior signals**: sesiones que nunca solapan, patrón coordinado de depósitos (doc §D1).
- **ML scoring** (doc §D5 v3 fase futura).

---

## 2026-05-13 — Antifraude → Liga wireup (sprint chico)

### Contexto

Sprint Antifraude MVP dejó `isUserFlagged()` pero no estaba wireado. Doc 15 §C6 dice "cuentas marcadas como duplicado probable NO entran al ranking". Este sprint chico wirea el filtro.

### Cambios

1. **`FraudDetectionService.getFlaggedUserIds(db, minScore)`**: batch version del helper. Una sola query SELECT distinct userAId,userBId con filtro status + score → devuelve `Set<string>`. Evita N+1.
2. **`LeaguesService.recompute`** post-`computeScores`: batch query del set flagged, filter en JS. Log el conteo de excluidos.
3. **`LeaguesModule.imports` += `FraudModule`**.

### Decisión técnica

**Filter en JS post-SQL, no en SQL con JOIN/NOT EXISTS**. Trade-off:
- Pro JS: simple, reusa el helper existente, código limpio.
- Con JS: 2 queries en vez de 1, transfer del Set al app.
- Para MVP volúmenes (<100 flagged users, <1000 standings) la diferencia es <10ms. Si crece: refactor a SQL NOT EXISTS.

### Tests E2E (3 nuevos)

- recompute excluye users en links suspected score >=70.
- link dismissed NO excluye.
- link confirmed SÍ excluye.

### Estado final

- **314 tests, 24 suites, 0 skipped, 0 flaky.**
- **2/2 corridas consecutivas verde** (~100-124s).

---

## 2026-05-13 — Antifraude → Welcome Bonus wireup (sprint chico)

### Contexto

Doc 15 §D3: "score > 90 → alerta + bloqueo opcional automático de bono welcome de cuentas nuevas en el cluster". Wirea el helper `isUserInConfirmedHighRiskCluster` desde `BonusesAutoGrantService.autoGrantForApprovedDeposit`.

### Cambios

1. **`FraudDetectionService.isUserInConfirmedHighRiskCluster(userId, minScore=90)`**: helper MÁS ESTRICTO que `isUserFlagged`:
   - status: solo `confirmed` (no suspected — admin debe haber revisado).
   - minScore: 90 default.
2. **`BonusesAutoGrantService.autoGrantForApprovedDeposit`**: step 0 antes del flow normal. Si flagged → return `{bonus: null, kind: null, skipReason: 'fraud_blocked'}`. Log warning.
3. **`AutoGrantResult.skipReason`**: agregado valor `'fraud_blocked'`.
4. **`DepositsController.approve`**: cuando `skipReason='fraud_blocked'`, audit log `bonus.auto_grant.fraud_blocked` con severity:high (admin debe ver).
5. **`BonusesModule.imports += FraudModule`**.

### Decisiones técnicas

1. **Solo bloqueo en `confirmed`, no en `suspected`**. Razón: false positives existen. El welcome bonus es atractivo para usuarios nuevos legítimos — bloquearlo por una sospecha sin revisión humana penalizaría al user. Cuando el admin confirma manualmente desde el panel antifraude, ahí sí.

2. **Threshold 90 (más alto que liga's 70)**. Doc lo pide explícitamente. Razón pragmática: el bloqueo de bonos es más "agresivo" desde la perspectiva del user (no recibe plata visible). Liga es "transparente" (simplemente no aparece en ranking, el user nunca esperaba). Threshold más alto evita pintar muchos legítimos.

3. **Audit severity:high para fraud_blocked**. A diferencia de los otros `skipReason` (que son config/UX), este es security-relevant. El admin puede ver el listado de "bonos bloqueados por antifraude últimos N días" filtrando por action_code.

4. **Step 0 — antes de cualquier otra query**. Razón: fraud check es O(1) con index, los pasos siguientes (count deposits, find definition) son más costosos. Si bloqueado, cortamos temprano.

5. **No-blocking en sprint Sorteos**. Decisión consciente: hoy `daily_wheel` y `login_streak` NO chequean fraud antes de awarding. Razón: doc §C6 menciona exclusión solo para leagues/sorteos POR RANKING (lottery_ranking) y para bonos welcome. La ruleta diaria es un "regalo" recurrente, no atractivo para multi-cuenta. Si en producción aparece abuso, agregar check al PrizeAwarder.

### Tests E2E (3 nuevos en bonuses-auto-grant.e2e.ts)

- Link `confirmed` score=95 → bono NO otorgado + audit entry creado.
- Link `suspected` score=95 → bono SÍ otorgado (no se bloquea por suspected).
- Link `confirmed` score=80 (bajo 90) → bono SÍ otorgado.

### Estado final

- **317 tests, 24 suites, 0 skipped, 0 flaky.**
- **2/2 corridas consecutivas verde** (~95s).

### Lo que NO entró todavía

- ~~**Bloqueo configurable per tenant**~~ ✅ Sprint TenantSettings + Fraud thresholds.
- **Notificación al user "tu bono fue bloqueado"** — UX: el user no sabe por qué no recibió bono. Sprint con email infra: mensaje genérico "tu cuenta está en revisión".
- ~~**Aplicar el mismo bloqueo en grant manual**~~ ✅ Sprint Antifraude→Grant manual warning.

---

## 2026-05-13 — TenantSettings + Fraud thresholds configurables

### Contexto

Sprint Antifraude→Welcome dejó thresholds hardcoded (70 suspected, 90 welcome_block). Sprint dedica infraestructura general `tenant_settings` (key-value bag) y migra los dos thresholds. Esta tabla queda disponible para futuros usos (branding, limits, captcha settings, etc.).

### Diseño implementado

#### Schema (migration 0016)
- `tenant_settings`: PK `key text` (lookup O(1) sin index secundario), `value jsonb` (flexible: any JSON type), `updated_by_user_id`, `updated_at`.
- Convención de keys con namespacing dot-separated: `fraud.suspected_threshold`, `fraud.welcome_block_threshold`, futuras `branding.primary_color`, `wallet.daily_load_limit_chips`, etc.

#### `TenantSettingsService`
- `get<T>(db, key)`: devuelve value parseado o `undefined`.
- `getNumeric(db, key, defaultValue)`: convenience defensiva (acepta number o string serializado numérico, fallback default).
- `set(db, key, value, actorUserId)`: upsert via `onConflictDoUpdate`.
- `list(db)`: listado completo para panel admin.
- `unset(db, key)`: DELETE explícito.
- **Sin cache** para MVP. Queries por PK index son <1ms. Si crece tráfico: cachear in-memory con invalidation on-set.

#### Endpoints (`/tenant/settings`)
- GET (lista) / GET :key / PATCH :key / DELETE :key.
- Todos requieren `tenant.settings.edit` (permiso ya existía en seed).
- Audit `tenant.setting.set` y `.unset` con severity:medium (cambios de config son auditables — explican cambios de comportamiento del sistema).

#### `TenantSettingsModule`
`@Global()` — cualquier módulo lee settings sin re-importar.

#### Refactor `FraudDetectionService`
- Inyecta `TenantSettingsService`.
- Helpers privados `getSuspectedThreshold(db)` y `getWelcomeBlockThreshold(db)` con defaults 70 / 90.
- Métodos públicos (`isUserFlagged`, `getFlaggedUserIds`, `isUserInConfirmedHighRiskCluster`, `listActiveLinks`) cambiaron firma:
  - Antes: `minScore = 70` (default fijo).
  - Ahora: `minScore?: number`. Si no se pasa, fetch del setting.
- `runScan`: fetch threshold UNA vez antes del loop de UPSERT (evita N queries).
- Constants exportadas: `FRAUD_SETTINGS_KEYS` (string consts para claves) — documentación + grep-ability.

### Decisiones técnicas no obvias

1. **PK por `key` text, no por `id uuid`**. Diferencia con otras tablas — acá `key` ES la identidad lógica. Lookup directo sin SELECT WHERE key=...; queries son `WHERE key = $1` con PK index. Más simple.

2. **JSONB libre por value**. Flexibilidad total: number, string, bool, object, array. Trade-off: el caller debe parsear y validar shape. Se mitiga con helpers tipados (`getNumeric`) y constantes documentando convención de cada key.

3. **`getNumeric` defensivo con string→number**. Algunos drivers de postgres-js pueden devolver jsonb numbers como string en ciertos contextos. El helper acepta ambos. Si el valor no parsea como número → returns default.

4. **Sin cache MVP**. Trade-off claro: cada llamada al setting es una query. Con PK index <1ms. Para hot paths (fraud scan procesa N pares con un fetch del threshold) ya optimizamos fetcheando UNA vez antes del loop. Si futuro requiere ms-level: in-memory cache con TTL 60s + invalidation on `set`/`unset`.

5. **`unset` idempotente**. DELETE WHERE key matches; no tira si no existe. Más amistoso para CI/IaC. Audit se omite si no había nada para borrar.

6. **`getNumeric` retorna defaultValue para `undefined`, NO para `null`**. Si admin setea `value: null` explícitamente, el behavior es: get devuelve `null`, getNumeric ve typeof === 'object' (null es object en JS) — falla check `typeof === 'number'` y string check → fallback default. OK semánticamente.

7. **Endpoints sin DELETE en lista, solo per key**. Mantiene la superficie chica. Si admin necesita "reset all settings": script manual o futuro endpoint `DELETE /tenant/settings` con audit special.

8. **Audit metadata.key**. Permite búsqueda de "todos los cambios a `fraud.suspected_threshold`" via audit_log filter por metadata. Útil para debuggear "¿cuándo cambió el threshold?".

9. **`FRAUD_SETTINGS_KEYS` exportado**. Constantes con nombres convencionales. Si en el futuro un consumer quiere leer la key (e.g. el frontend), importa el const en lugar de hardcodear el string. Refactor-friendly.

10. **Migration de thresholds backward-compatible**. Tests/code existente que pasa `minScore=N` sigue funcionando — el param sigue siendo opcional. Solo el default cambió de constante a fetch dinámico.

### Tests E2E (11 nuevos en tenant-settings.e2e.ts)

- CRUD: PATCH crea, re-upsert sobreescribe, JSON arbitrario, GET 404, DELETE idempotent, GET / lista, sin permiso 403, sin body.value 400.
- Integración Fraud: default 70/90 funciona, set suspected=25 → score 30 crea link, set welcome_block=80 → link confirmed score 85 bloquea bono.

### Estado final

- **328 tests, 25 suites, 0 skipped, 0 flaky.**
- **2/2 corridas consecutivas verde** (~100-104s).

### Lo que NO entró todavía

- **Cache in-memory** de settings (sprint Performance si llega).
- ~~**Validación typed por key**~~ ✅ Sprint Zod registry.
- ~~**History/audit detallado de settings**~~ ✅ Sprint tenant_settings_history.
- **Settings encriptados** (e.g. API keys de payment providers en el futuro). Hoy todos en plain JSONB. Si se necesita: columna `is_secret boolean` + cifrado con clave del tenant.

---

## 2026-05-13 — Antifraude warning en grant manual (sprint chico)

### Contexto

Sprint Antifraude→Welcome bloquea auto-grants. Para el grant manual (cajero/admin con permiso `bonuses.grant_manual`) el doc sugiere advertir, no bloquear: el cajero está haciendo una decisión humana explícita y tiene contexto. Pero el admin debe tener visibilidad de grants a cuentas flagged.

### Cambios

1. **`UserBonusesController.grant`**: pre-check `fraudService.isUserInConfirmedHighRiskCluster(dto.userId)` antes del grant. Si flagged:
   - **NO bloquea** — el grant se ejecuta normal.
   - Response devuelve `{...granted, fraudWarning: true}`.
   - Audit `bonus.grant_manual` incluye `metadata.fraudFlagged: true`.
   - Audit EXTRA entry `bonus.grant_manual.fraud_warning` severity:high (búsqueda directa para el admin: "grants a cuentas flagged en los últimos N días").
2. **Inyecta `FraudDetectionService`** en UserBonusesController (BonusesModule ya importa FraudModule del sprint anterior).
3. Threshold: mismo que welcome_block (configurable via `fraud.welcome_block_threshold`, default 90, status='confirmed').

### Decisión: warn vs block

- **Auto-grant (deposit.approve)**: BLOQUEA. Razón: es automático, sin decisión humana, atacante con cuenta dummy no debería recibir welcome.
- **Grant manual (cajero)**: WARN. Razón:
  - El cajero hizo el click — tiene contexto (puede ser promo legítima).
  - Bloquear forzaría al cajero a "trabajar around" el sistema (otorgar a otra cuenta y transferir).
  - Audit severity:high pone responsabilidad sobre el cajero — si se comprueba abuso, la trail está.

### Tests E2E (4 nuevos en bonuses.e2e.ts)

- Cluster confirmed score 95 → grant OTORGADO + `fraudWarning=true` + audit entry creado.
- Cluster suspected score 95 → SIN warning (estricto, solo confirmed).
- Cluster confirmed score 85 (< threshold 90) → SIN warning.
- User sin links → SIN warning (happy path).

### Estado final

- **332 tests, 25 suites, 0 skipped, 0 flaky.**
- **2/2 corridas consecutivas verde** (~90s).

---

## 2026-05-13 — Validación typed por key (Zod registry)

### Contexto

`tenant_settings.value` es JSONB libre — el caller responsabilidad de la shape. Sprint anterior dejó hardcoded en docs "fraud.suspected_threshold debe ser number 0-100" pero un admin podría setear `"seventy"` y romper el consumer en runtime. Sprint dedica registry de Zod schemas + validación en el endpoint PATCH.

### Diseño implementado

#### `tenant-settings.registry.ts`
- Single map `SETTING_SCHEMAS: Record<string, ZodSchema>` hardcoded.
- Entrada por key conocida con doc-comment del módulo dueño + schema Zod (con `.min`/`.max` y messages explícitos).
- Keys NO registradas se aceptan tal cual (forward-compat) — permite que el admin agregue custom keys para features futuras sin code change.
- `REGISTERED_SETTING_KEYS` export para tests/docs.

#### Cambios en controller PATCH
- Si `SETTING_SCHEMAS[key]` existe → `schema.safeParse(dto.value)`.
- Falla → 400 con error `SETTING_VALUE_INVALID` + body con `issues` (path, message, code) — el cajero ve qué falló.
- Pass → usa `result.data` para storage (soporta `.transform()` futuro).
- Audit usa el valor validado (`valueToStore`), no el raw del request.
- Si schema falla, **NO se llama service** — el value previo queda intacto.

#### Dependencia nueva
- `zod` instalada como dependency en `apps/api/package.json`. Sin transitive issues (zod es leve, ESM/CJS compatible).

### Decisiones técnicas

1. **Hardcoded vs decentralizado**. Consideré que cada módulo (fraud, branding) exporte sus schemas y la registry los componga via DI. Trade-off:
   - Decentralized: módulos owners de sus keys; sin coupling al package central.
   - Hardcoded: simpler para MVP, doc-comments link al módulo dueño.
   - Riesgo de cycle: `fraud-detection.service.ts` ya importa de `tenant-settings`; si el registry importa schemas de fraud, cycle. Decentralizado requiere mover keys a archivos sin deps cruzadas.
   Decisión: hardcoded por ahora. Cuando se sumen 5+ módulos con settings, refactor.

2. **Forward-compat: keys desconocidas se aceptan**. Razón: el admin del tenant puede querer setear keys custom (e.g. para featuring flags, A/B tests) que el código todavía no consume. Bloquear keys desconocidas forzaría code change para cada experimento. Trade-off: si el admin tipea mal el key `fraud.welcom_block` (typo), se guarda sin error pero el consumer no lo lee.

3. **Zod sobre class-validator**. class-validator funciona sobre clases con decoradores — no encaja para validar arbitrary JSON. Zod es purpose-built para schema-based validation de runtime objects.

4. **`result.data` (no `dto.value` raw) al storage**. Permite transformaciones futuras (e.g. `.transform(v => v.toLowerCase())`). Hoy schemas no transforman pero el patrón queda listo.

5. **Issues en response 400**. Le damos al cajero/admin contexto sobre QUÉ falló: path (qué campo si es nested), message (legible), code (machine-readable). Sin esto, el cajero ve "INVALID" sin saber qué corregir.

6. **Registry singular vs múltiple**. Único `SETTING_SCHEMAS` global. Alternativa: schemas por módulo + composition. Para 2 keys MVP el singular alcanza.

### Tests E2E (7 nuevos en tenant-settings.e2e.ts)

- `fraud.suspected_threshold` acepta number 0-100 (edge cases 0, 50.5, 100).
- Rechaza string → 400 SETTING_VALUE_INVALID.
- Rechaza valor fuera de rango (-1, 101, 150).
- `fraud.welcome_block_threshold` mismo schema 0-100.
- Key NO registrada acepta cualquier value (forward-compat con object + string).
- Validation error body tiene `issues` con `path`/`message`/`code`.
- Después de validation error, setting previo NO cambió (atomic).

### Estado final

- **339 tests, 25 suites, 0 skipped, 0 flaky.**
- **2/2 corridas consecutivas verde** (~100-140s).

### Lo que NO entró todavía

- **Schemas con `.transform()`** — hoy ninguno transforma. Si en el futuro queremos auto-coercion (string "70" → number 70), agregar `.transform(Number)` o `z.coerce.number()`. Por ahora preferimos strict typing.
- **Schema validation en GET** — hoy no validamos al leer. Si un setting persistido tiene valor que no pasa el schema actual (porque cambiamos el schema post-data), el consumer lo lee crudo. Sprint posterior si llega.
- **CLI / endpoint para auditar settings rotos**: "lista settings cuyos values no pasan el schema actual". Para upgrades de schema con backward-incompat.

---

## 2026-05-13 — History detallado de tenant_settings

### Contexto

Sprint anterior dejó audit_log con cada `tenant.setting.set/unset` entry, pero la shape genérica del audit (`before`/`after` JSONB libres) no es óptima para queries como "última semana, cuántas veces cambió `fraud.suspected_threshold` y qué valores fueron?". Sprint dedica una tabla específica con índices para esas queries.

### Diseño implementado

#### Schema (migration 0017)
- `tenant_settings_history`: append-only.
  - `id`, `key`, `previous_value JSONB nullable`, `new_value JSONB nullable`, `action` enum {set, unset}, `changed_by_user_id`, `changed_at`.
  - Index `(key, changed_at)` para "history de key X".
  - Index `(changed_at)` para "todas las changes ordenadas globally".
  - SIN FK a `tenant_settings.key` — el current row puede haber sido borrado pero historial sobrevive.

#### Service updates
- `set(db, key, value, actorUserId)`: ahora wrappea todo en `db.transaction`:
  1. Lee previous value.
  2. Upsert tenantSettings.
  3. Insert history row con `action='set'`, `previous_value`, `new_value`.
- `unset(db, key, actorUserId?)`: idem en TX. Si el setting NO existía, NO se inserta history (no hubo cambio real — idempotent silencioso).
- `listHistoryForKey(db, key, limit, offset)`: paginado DESC por `changed_at`.
- `listAllHistory(db, limit, offset)`: idem sin filter de key.

#### Endpoint nuevo
- `GET /tenant/settings/:key/history?limit=N&offset=M` — paginado, ordenado DESC.
- Requiere `tenant.settings.edit` (mismo permiso que la mutación — quien edita settings puede ver su historial).

### Decisiones técnicas

1. **Transacción set/unset + history insert**. Sin TX, un crash entre los dos statements podría dejar el setting actualizado sin history (drift). TX garantiza consistencia atómica.

2. **`previous_value` NULL para primer set**. Distinción explícita "primera vez vs. update". El consumer del history puede mostrarlo como "creado".

3. **`new_value` NULL para unset**. Misma idea: el evento "unset" es semánticamente distinto a "set a null". El admin ve el momento exacto en que el setting volvió al default.

4. **Unset idempotente NO escribe history**. Si el setting nunca existió, un DELETE es no-op operacional. Crear history entry sería ruido. Trade-off: si el admin clickeó "delete" en un setting ya borrado y quiere ver el "evento" en el panel, no lo verá. Aceptable — el panel del frontend puede ocultar el botón delete cuando el value es undefined.

5. **Sin FK a `tenant_settings.key`**. La tabla `tenant_settings` puede haber tenido el key borrado (unset). El history necesita sobrevivir. Por eso `key text` sin FK.

6. **Sin endpoint `GET /history` global**. Audit_log ya tiene una vista global cross-key vía filter por `action_code LIKE 'tenant.setting.%'`. Duplicar el endpoint sería trabajo de UX en panel admin sin valor distintivo. El endpoint per-key es el caso de uso primario.

7. **Limit 200 max**. Defensivo — evita queries que carguen miles de filas por error. Si admin quiere export más, futuro endpoint con paginación cursor.

8. **History cleanup en tests beforeEach**. La suite tenía pollution porque `deleteAllSettings()` solo limpiaba `tenant_settings` pero no `tenant_settings_history`. Agregamos `DELETE FROM tenant_settings_history` al cleanup. Patrón: cualquier nueva tabla que persista cross-test debe sumarse al helper de reset.

### Tests E2E (8 nuevos en tenant-settings.e2e.ts)

- Primer set crea entry con `previous_value=null`.
- Segundo set captura previous → new.
- Unset crea entry con `action='unset'` y `new_value=null`.
- Unset sobre key inexistente NO crea entry (idempotent).
- GET /:key/history devuelve entries ordenadas DESC.
- Limit/offset funcionan.
- cajero1 sin permiso → 403.
- Validation error NO escribe history (atomic con la validación).

### Estado final

- **347 tests, 25 suites, 0 skipped, 0 flaky.**
- **2/2 corridas consecutivas verde** (~102-131s).

### Lo que NO entró todavía

- **Endpoint `GET /history` global** (cross-key). Audit_log cubre el caso vía filter; redundante en MVP.
- **Retention policy**: hoy history crece indefinidamente. Para producción con muchos cambios: cron que purga entries > N años (vía `tenant_settings.history_retention_days` setting).
- **`changed_by_username` denormalizado**: hoy solo el ID. El frontend hace JOIN con users si quiere mostrar nombre. Si el user es borrado, el historial pierde el nombre. Aceptable porque users normalmente no se borran (status=banned).
- **Diff visual** entre previous y new para objects complejos (e.g. visibility config). Sprint frontend.

---

## 2026-05-14 — Retention policy de `tenant_settings_history`

**Contexto**: el sprint anterior (history append-only) dejó la tabla creciendo indefinidamente. Para tenants con muchos cambios de config — o años en producción — la tabla se vuelve pesada y queries de "últimos N cambios" pagan el costo. Necesitamos purga periódica configurable.

**Decisión**: cron diario + endpoint manual + setting configurable por tenant.

1. **`TenantSettingsService.purgeOldHistory(db, retentionDays)`** — DELETE puro de entries con `changed_at < NOW() - retentionDays days`. Devuelve la cantidad borrada. `retentionDays <= 0` → no-op defensivo (evita purgar TODO por mal config).
2. **`TenantSettingsHistoryRetentionCron`** — programmatic schedule `0 4 * * *` (4 AM UTC, después del fraud scan en 3 AM). Itera `controlDb.tenants WHERE status='active'`. Mismo patrón que los crons de bonuses/leagues/fraud (env disable, lock `running` para evitar superposición).
3. **Setting `tenant_settings.history_retention_days`**. Zod schema: `z.number().int().min(7).max(3650)`. Default cuando no está seteado: 365 días.
4. **Endpoint `POST /tenant/settings/history/purge`** — disparo manual del cron para un tenant. Permission gate `tenant.settings.edit`. Audit log solo si `deleted > 0` (skip ruido — runs sin cambios son normales).

### Decisiones técnicas

1. **Recursivo: el setting de retention vive en `tenant_settings`**. El cron lee su propio config del mismo bag que controla. Consecuencia: el setting `tenant_settings.history_retention_days` también puede ser purgado (es un setting más). Pero su entry en history sobrevive lo que diga el setting actual — coherente.

2. **Default 365 días hardcoded en cron, no en registry**. Si el admin nunca seteó retention y borramos el setting accidentalmente, queremos fallback seguro. El cron también es defensivo: `getNumeric(default=365)`.

3. **`min(7)` en Zod**. Evita admin típico typo (`1` cuando quería `100`). 7 días es el piso razonable — menos no es retention, es purga inmediata.

4. **`max(3650)` (~10 años)**. Defensivo contra retention infinita disfrazada de número grande. Si necesitan más, tienen que setear código explícito.

5. **DELETE simple sin batch**. El history crece ~10 rows por setting actualizado. Un tenant activo tiene unas miles de entries por año. Para MVP no necesitamos batch. Si crece volumen, CTE `WITH ids AS (SELECT id ... LIMIT N) DELETE WHERE id IN ids`.

6. **Audit log condicional**. Sin filtro, cada corrida del endpoint manual genera ruido (la mayoría son no-op). Solo grabamos cuando hay `deleted > 0` con `severity=medium`. El cron NO graba audit (lo hace `logger.log` para sysadmin).

7. **`TENANT_SETTINGS_HISTORY_RETENTION_ENABLED=false`** en test env. Mismo patrón que otros crons — el test runner llama `runForTenant` directo para no depender de scheduler.

### Tests E2E (10 nuevos)

- Default retention 365: borra entries >365d, conserva ≤365d.
- Custom retention 30: borra >30d, conserva ≤30d.
- Purge idempotente: re-run no borra entries nuevas.
- Schema rechaza `<7`, `>3650`, no-entero (3 tests).
- cajero1 sin permiso → 403.
- Purge sin entries → `deleted=0`.
- Audit log se graba con `severity=medium` cuando `deleted>0`.
- Audit log NO se graba cuando `deleted=0` (skip ruido).

### Estado final

- **357 tests, 25 suites, 0 skipped, 0 flaky.** (+10 vs sprint history).
- **Build limpio, full suite verde** (~112s).

### Lo que NO entró todavía

- **Lock distribuido**. Hoy el cron es seguro single-instance (el lock `running` es in-memory). Multi-instance: dos workers podrían correr el purge simultáneamente — el segundo no haría daño (DELETE idempotente) pero quemaría DB I/O. Para multi-instance: pg advisory lock o Redis lock.
- **Purga global cross-tenant** desde control DB. Hoy si un tenant queda muerto/inactive, su history no se purga porque el cron itera `status='active'`. Trade-off aceptable — tenants inactive son raros y borrarlos completamente es un sprint separado.
- **Histograma de purgas** en métricas. El logger lo dice, pero no hay Prometheus counter. Cuando agreguemos observability.

---

## 2026-05-14 — Sistema de Notifications MVP

**Contexto**: ya teníamos features que afectan al user (welcome bonus bloqueado por antifraude, deposits aprobados, withdrawals procesados, cluster confirmed para admins, etc.) pero NO había forma de avisarle al user. El log lo decía a sysadmin via `[EMAIL]` placeholder, pero el user no se enteraba.

**Decisión**: tabla `notifications` con channel multi-soportado (in_app/email/sms) + service de enqueue/dispatch + provider abstraction + dispatcher cron + endpoints user. Sprint completo end-to-end con 1 hook real (`welcome_bonus_blocked`) que cierra el TODO más visible.

### Componentes implementados

1. **Schema `notifications`** (migration 0018):
   - `channel` enum (in_app/email/sms), `status` enum (pending/sent/failed/read).
   - `subject` + `body` pre-renderizados al enqueue (snapshot semántico — cambios futuros en templates no afectan notifs viejas).
   - `payload` jsonb crudo del evento para forensics.
   - Indexes: `(user_id, created_at)` para listForUser; `(status, channel, created_at)` para el dispatcher pickup FIFO.

2. **Templates hardcoded** en `notifications.templates.ts`:
   - Map `kind → renderer(payload) → {subject, body}`.
   - Kind sin renderer registrado → `enqueue` tira. Protección contra typos.
   - MVP: 3 templates (`welcome_bonus_blocked`, `fraud_cluster_confirmed`, `test_event`).

3. **`NotificationsService`**:
   - `enqueue`: in_app → status='sent' inmediato + sentAt. email/sms → 'pending'.
   - `listForUser` / `countUnreadForUser` / `markAsRead` / `markAllAsReadForUser`.
   - `dispatch`: pickea pendings, llama provider, marca sent/failed.
   - `purgeOld`: DELETE de sent/read/failed más viejas que retention.

4. **`EmailProvider` interface + `ConsoleEmailProvider`**:
   - DI token `EMAIL_PROVIDER`. `useClass` configurable en el module.
   - Default `ConsoleEmailProvider` loguea con prefijo `[EMAIL]`. SMTP/SES/SendGrid futuro reemplaza el `useClass` sin tocar callers.
   - SMS NO tiene provider — el dispatcher marca channel='sms' como 'failed' con error `sms_provider_not_implemented`. Sprint futuro agrega provider análogo.

5. **`NotificationsDispatcherCron`**:
   - Schedule `*/5 * * * *` (cada 5 min). Más frecuente que retention/fraud porque es user-facing.
   - Multi-tenant via control DB iteration. Env disable `NOTIFICATIONS_DISPATCHER_ENABLED=false`.
   - Kill switch via setting `notifications.email_enabled=false`: skip envío de emails pero NO purga el queue (las notifs quedan pending para retry cuando admin re-habilita).
   - Retention embebida en el mismo cron (sin schedule separado — purga rápida).

6. **`NotificationsController`** (user endpoints):
   - `GET /tenant/notifications/me` (paginado, filter `onlyUnread`).
   - `GET /tenant/notifications/me/unread-count` (badge UI).
   - `POST /tenant/notifications/me/:id/read` (idempotent).
   - `POST /tenant/notifications/me/read-all`.
   - Todos requieren `TenantJwtGuard`. SIN permiso adicional — un user puede ver/marcar SUS notifs sin rol especial.

7. **Hook real `welcome_bonus_blocked`** en `BonusesAutoGrantService`:
   - Cuando el antifraude bloquea welcome → enqueue 2 notifs (in_app + email).
   - Fail-soft: si la notif falla, el bloqueo igual queda hecho (logger.error pero no rollback).
   - Mensaje neutro al user ("revisión de seguridad", contactar soporte) — NO le decimos "estás flagged".

8. **Settings registry** (3 nuevas keys):
   - `notifications.email_enabled` (boolean).
   - `notifications.in_app_enabled` (boolean).
   - `notifications.retention_days` (int, 7-3650, default 180).

### Decisiones técnicas

1. **Render snapshot (subject/body persistido)**. Si cambiamos un template, las notifs ya enviadas conservan el render del momento. Trade-off: tabla más pesada (~2 strings por row) pero auditoría reproducible.

2. **Templates hardcoded en código (vs editables por admin)**. MVP: simplicidad. Sprint futuro: `notification_templates` tabla con override por tenant. El registry queda como fallback default.

3. **`payload jsonb` además de subject/body**. Subject/body se renderizan al enqueue, pero el payload crudo permite re-render con templates nuevos en sprint futuro (migration tool one-shot) y forensics.

4. **Channel sms acepta enqueue pero falla en dispatcher** (no skip). Trade-off: prefiero ver "sms_provider_not_implemented" en logs/audit para detectar que un hook está pidiendo SMS antes de tiempo. Skip silencioso ocultaría features rotas en producción.

5. **Endpoints user sin permiso `notifications.*`**. Cualquier user logueado ve sus notifs. Si en el futuro queremos restrict (e.g. roles que NO ven notifs), agregamos permiso. Por ahora, simplicidad.

6. **Audit log NO para notifs**. Las notifs son user-facing; el audit es para sysadmin. Las acciones que GENERAN notifs (welcome bloqueado, etc.) ya graban audit. Duplicar acá sería ruido.

7. **`markAllAsReadForUser` solo afecta status='sent' channel='in_app'**. email/sms no se marcan read (se "ven" fuera del sistema). Pending in_app no existe en práctica (in_app es síncrono).

8. **Kill switch `email_enabled=false` deja queue pendiente** (no purga). Razón: durante downtime de SMTP provider, el admin puede pausar envíos. Cuando se restaura, re-habilita y el queue se procesa. Si purgáramos, perderíamos notifs valiosas.

### Bug encontrado y resuelto (durante este sprint)

**Síntoma**: tests fallaban con `write CONNECTION_ENDED localhost:5432` después de varios enqueues + queries. Aparente bug "Drizzle + postgres-js + UPDATE multi-filter + enum".

**Root cause**: helper de test `readNotificationsFromDb` tenía:
```typescript
try {
  return sql`SELECT ...`;  // <-- PendingQuery NO awaited
} finally {
  await sql.end();  // <-- cierra ANTES que la query corra
}
```

Postgres-js retorna una `PendingQuery` (thenable) que se ejecuta cuando se awaitea. El `return` la devolvía sin awaitear, y el `finally` cerraba la conexión antes que la query corriera.

**Fix**: `await` explícito antes del return.

**Lección**: cualquier helper async con `try { return promise } finally { await cleanup }` corre el cleanup ANTES que el promise resuelva si el return value es un thenable lazy (como postgres-js). Siempre `await` adentro del try.

Sumar a `apps/api/test/AGENTS.md` (futuro).

### Tests E2E (24 nuevos)

- Service.enqueue: 4 tests (in_app, email, kind sin template, snapshot).
- Service.listForUser + markAsRead: 4 tests (lista DESC, foreign user 404, onlyUnread, markAllAsRead).
- Service.dispatch: 3 tests (email sent, email sin email del user → failed, sms → failed).
- Endpoints user-facing: 6 tests (GET me, onlyUnread query, foreign 404, read-all, no token 401, paginado).
- Dispatcher runForTenant: 3 tests (kill switch, retention default, retention custom).
- Settings schema: 3 tests (boolean ok, string → 400, retention <7 → 400).
- Hook welcome_bonus_blocked: 1 test (cluster confirmed score 95 → 2 notifs in_app+email + subject contiene depositId).

### Estado final

- **381 tests, 26 suites, 0 skipped, 0 flaky** (+24 vs sprint anterior).
- **Build limpio, full suite ~156s.**

### Lo que NO entró todavía

- **Templates editables por admin** (`notification_templates` tabla con override per-tenant). Sprint futuro.
- **SMS provider real** (Twilio/etc.). Dispatcher ya soporta el channel, pero hoy siempre marca failed.
- **Hooks adicionales**: deposit approved, withdrawal paid, fraud_cluster_confirmed para admins, withdrawal rejected. Patrón ya documentado, fácil de sumar.
- **Push notifications** (mobile/web push). El modelo channel se extiende fácil (sumar 'web_push' al enum, otro provider).
- **Retries automáticos** en dispatcher cuando email falla. Hoy queda 'failed' y no se reintenta. Para v1: max_attempts column + backoff exponencial.
- **Endpoint admin para disparo manual** del dispatcher. El cron lo hace; on-demand vía endpoint admin se puede sumar cuando el frontend lo pida.
- **Endpoint admin "ver todas las notifs"** (cross-user, para soporte). Hoy solo cada user ve las suyas.
- **Lock distribuido** para crons multi-instance.

---

## 2026-05-14 — Hooks adicionales de Notifications (deposit_approved, withdrawal_paid, fraud_cluster_confirmed)

**Contexto**: el sprint anterior dejó la infra de notifications lista con 1 hook real (`welcome_bonus_blocked`). Aprovechamos para wirear los siguientes 3 hooks user-facing más obvios. Sprint chico self-contained, ~10 líneas por hook.

**Decisión**: 3 hooks nuevos + helper `enqueueForRole` en el service para notifs cross-user (admins).

### Hooks implementados

1. **`deposit_approved`** en `DepositsController.approve`:
   - User dueño recibe 2 notifs (in_app + email) cuando su depósito cambia a 'approved'.
   - Payload: `{ depositId, amountChips }`.
   - Solo dispara si el status CAMBIA (idempotent — un re-approve no duplica).

2. **`withdrawal_paid`** en `WithdrawalsController.markPaid`:
   - User dueño recibe 2 notifs cuando se marca su retiro como pagado.
   - Payload: `{ withdrawalId, amountChips, externalRef }`.
   - Mismo patrón idempotent: solo si status cambia.

3. **`fraud_cluster_confirmed`** en `FraudController.confirm`:
   - **Cross-user**: TODOS los `admin_tenant` del tenant reciben 2 notifs (in_app + email).
   - **Excluye al actor** (quien confirma ya sabe lo que hizo — no auto-notif).
   - Payload: `{ linkId, score, userAUsername, userBUsername, confirmedByUsername }`.
   - Lookup usernames de los dos users del link para mensaje legible (no UUIDs).

### Componente nuevo: `NotificationsService.enqueueForRole`

API:
```typescript
enqueueForRole(db, {
  roleCode: 'admin_tenant',
  kind: 'fraud_cluster_confirmed',
  channel: 'in_app',
  payload: {...},
  excludeUserId?: string,
})
```

Hace JOIN users + user_roles + roles, filtra activos + role match, y enqueue una notif por destinatario. Devuelve la lista de notifs creadas. Si el role no tiene users → array vacío (no tira).

### Decisiones técnicas

1. **Fail-soft en todos los hooks**. El enqueue va envuelto en try/catch. Si la notif falla, el log con `logger.error` queda y la operación (approve/markPaid/confirm) sigue su curso. La notif es UX, no crítica.

2. **2 channels por hook (in_app + email)**. Razonamiento:
   - `in_app` es síncrono (visible inmediatamente en el panel del user).
   - `email` es async (dispatcher cron), pero el user lo recibe en su inbox.
   - SMS reservado para hooks de mayor urgencia (e.g. 2FA, fraud alert directo al user) — futuro.

3. **`enqueueForRole` con `excludeUserId`**. Evita auto-notifs. El admin que clickeó "confirm" no necesita una notif diciendo "se confirmó un link" — ya lo sabe.

4. **Looking up usernames para fraud notif vs IDs**. Decisión de UX: mostrar `jugador123 ↔ jugadora456` es mucho más legible que `019e...c83 ↔ 019e...d84`. Costo: 2 queries extra. Aceptable — confirms son raros (humano del lado del admin) y la query es por PK.

5. **`Number(updated.score)` en payload**. Postgres numeric viene como string ("85.00") via Drizzle. Lo convertimos para que el template lo formatee como número.

6. **Idempotencia**: los hooks de deposits/withdrawals están adentro del `if (before.status !== after.status)`. Si el endpoint se llama dos veces (retry, double-click), el segundo no dispara notif. Verificado con test específico.

### Tests E2E (5 nuevos)

- `deposit_approved`: notif creada con monto + depositId, idempotent (re-approve no duplica).
- `withdrawal_paid`: notif con monto + externalRef en el body.
- `fraud_cluster_confirmed`: otro admin recibe 2 notifs, body incluye usernames + score, actor NO recibe.
- Edge case: confirm sin otros admins → endpoint 200, sin notifs (excludeUserId hace su trabajo).
- (+ test del welcome_bonus_blocked ajustado para filtrar por kind, ahora que también dispara `deposit_approved`).

### Bug encontrado y resuelto

**Síntoma**: test `welcome_bonus_blocked` falló porque el assertion contaba `rows.length` (asumía solo 2 notifs).

**Causa**: el nuevo hook `deposit_approved` se dispara TAMBIÉN cuando antifraude bloquea (porque el bloqueo del bono NO frena el approve del deposit en sí — el deposit se aprueba, solo el bono no). Así el user termina con 4 notifs: 2 welcome_bonus_blocked + 2 deposit_approved.

**Fix**: filtrar por `kind` antes de assert length. Patrón aplicable: si un test verifica notifs después de una operación que dispara varios hooks, SIEMPRE filter por kind.

### Estado final

- **386 tests, 26 suites, 0 skipped, 0 flaky** (+5 vs sprint anterior, ~146s).
- **Build limpio.**

### Lo que NO entró todavía

- **`deposit_rejected`** / **`withdrawal_rejected`** / **`withdrawal_failed`** hooks. Patrón idéntico, ~10 líneas cada uno. Sprint futuro o conforme se vea necesidad real.
- **`fraud_link_suspected`** notif al admin cuando un scan crea un link nuevo. Hoy el admin se entera entrando al panel; podría avisarle proactivamente.
- **`bonus_expired`** / **`bonus_cancelled`** al user. Hoy el cron expira en silencio.
- **Templates editables** por admin (mantenemos hardcoded MVP).
- **Helper `enqueueForUsers(userIds[], ...)`** para notifs a sets arbitrarios (e.g. "todos los users que tienen bono activo X"). Sprint futuro si aparece use case.

---

## 2026-05-14 — Hooks de Notifications: rechazos, fallas, expiración y cancelación

**Contexto**: cerrando la cobertura del flow user-facing. Quedaban 5 estados de cosas que el sistema cambia y que el user/admin valoraría saber: depósito rechazado, retiro rechazado, retiro fallido, bono expirado, bono cancelado.

**Decisión**: 5 hooks nuevos siguiendo el patrón ya establecido (2 channels in_app+email, fail-soft, idempotent en status change).

### Hooks implementados

1. **`deposit_rejected`** en `DepositsController.reject`:
   - Payload: `{ depositId, amountChips, reason }`.
   - Reason viene del DTO del cajero/admin (requerido).
   - In_app + email al user dueño.

2. **`withdrawal_rejected`** en `WithdrawalsController.reject`:
   - Payload: `{ withdrawalId, amountChips, reason }`.
   - El hold se libera en el service → user puede reintentar.

3. **`withdrawal_failed`** en `WithdrawalsController.markFailed`:
   - Payload: `{ withdrawalId, amountChips, reason }`.
   - Diferencia con rejected: falló en el processamiento bancario, no en la review.
   - Mensaje al user le sugiere reintentar.

4. **`bonus_expired`** en `BonusesExpirationService.expireOne` (cron path):
   - Payload: `{ bonusId, remainingAmount }`.
   - **Diferencia con los anteriores**: NO viene de un controller HTTP — es un cron multi-tenant. La notif se enqueue desde dentro del job, NO bloquea el flow del expire (fail-soft).
   - Mensaje sugiere contactar soporte si el user quería más tiempo.

5. **`bonus_cancelled`** en `UserBonusesController.cancel`:
   - Payload: `{ bonusId, reason }`.
   - **Destinatario es `before.userId` (dueño del bono)**, NO `actor.id` (el cajero/admin que cancela). El destinatario y el actor son diferentes.

### Decisiones técnicas

1. **Cron-based hook (bonus_expired)**: el job procesa hasta 500 bonos por run. Cada uno hace `expireOne` que ahora también enqueue 2 notifs. En el peor caso son 1000 inserts adicionales por run — aceptable, son INSERTs simples en una tabla con index. Si crece volumen: agrupar notifs en bulk insert.

2. **Reason en payload**: cada rechazo/falla incluye el motivo literal del operador. **No truncamos** — el user ve la razón completa que dejó el cajero. Si en el futuro queremos sanitizar (e.g. evitar leak de internal codes en mensaje al user), agregar capa de "render para externo" en el template.

3. **`withdrawal_rejected` vs `withdrawal_failed` semánticamente distintos**. Razón:
   - `rejected` = review humana decidió no procesar.
   - `failed` = se intentó procesar pero el banco devolvió error / timeout / etc.
   - El user lee mensajes distintos. Sumar más kinds (e.g. `withdrawal_processing`) cuando se justifique.

4. **Idempotency**: los 4 hooks de controllers (deposit_rejected, withdrawal_rejected, withdrawal_failed, bonus_cancelled) están adentro del `if (before.status !== after.status)`. El de cron (bonus_expired) es naturally idempotent: el SELECT del job filtra `status='active'`, así que un bono ya expired no entra al loop.

5. **Mint en `beforeAll` del test suite**. Los tests de bonus_expired y bonus_cancelled hacen grant manual → admin necesita saldo. Sumamos `POST /tenant/wallet/mint 500000` para que estos tests no fallen con `funder_insufficient`. Patrón aplicable a futuros tests que hagan grants.

### Tests E2E (5 nuevos)

- `deposit_rejected`: reject deposit → 2 notifs con depositId + reason.
- `withdrawal_rejected`: reject withdrawal → 2 notifs con withdrawalId + reason.
- `withdrawal_failed`: mark-failed → 2 notifs con withdrawalId + reason.
- `bonus_expired`: grant bonus → fuerza expires_at en pasado → dispara job → 2 notifs con bonusId + remainingAmount.
- `bonus_cancelled`: grant bonus → cancel con motivo → 2 notifs al dueño (no al actor).

### Estado final

- **391 tests, 26 suites, 0 skipped, 0 flaky** (+5 vs sprint anterior, ~175s).
- **Build limpio.**

### Cobertura de notifications después de este sprint

Eventos cubiertos para el user (in_app + email):
- ✅ welcome_bonus_blocked (antifraude)
- ✅ deposit_approved
- ✅ deposit_rejected
- ✅ withdrawal_paid
- ✅ withdrawal_rejected
- ✅ withdrawal_failed
- ✅ bonus_expired
- ✅ bonus_cancelled

Eventos cubiertos para admins:
- ✅ fraud_cluster_confirmed (cross-user via `enqueueForRole`)

### Lo que NO entró todavía

- **`bonus_force_cleared`**: hoy el force-clear hace audit pero no notif. Es operación rara — sumar cuando aparezca un caso.
- **`deposit_under_review`**: cuando un deposit pasa a status under_review (manual review flow). No hay endpoint todavía.
- **`fraud_link_suspected`** (admin notif proactiva al crearse un link). Hoy el admin se entera entrando al panel.
- **`bonus_granted`** al user (admin otorga manual o auto-grant exitoso). Estuvimos solo en el lado bloqueado/cancelado/expirado del flow. Falta el "tu bono fue otorgado, está activo".
- **Templates editables por admin** (sigue hardcoded).
- **SMS provider** (sigue sin implementar; dispatcher marca failed).
- **Notifs cross-tenant** (el super-admin del control DB recibe alguna cosa). Hoy todo es per-tenant.

---

## 2026-05-14 — Notifications: bonus_granted (happy path) + fraud_link_suspected (admin proactivo)

**Contexto**: el subsistema notifications ya tenía 13 hooks. Quedaban dos huecos lógicos:
1. **bonus_granted** — toda la cobertura previa hablaba de bonos bloqueados/expirados/cancelados. Nunca le decíamos al user "te otorgamos un bono, está activo".
2. **fraud_link_suspected** — los admins se enteraban del link recién cuando alguien lo confirmaba (`fraud_cluster_confirmed`). Sin alerta proactiva cuando el scan detecta el link por primera vez.

**Decisión**: 2 hooks finales para cerrar el subsistema.

### Hooks

1. **`bonus_granted`** en `UserBonusesService.grantManual` (no en el controller):
   - Razón clave: el service es llamado **tanto por el controller manual** (cajero/admin clickea "grant") **como por `BonusesAutoGrantService.autoGrantForApprovedDeposit`** (post-deposit approve). Un solo hook cubre ambos paths.
   - Payload: `{ bonusId, definitionCode, definitionName, amount, bonusType }`.
   - Solo en el **success path del INSERT**. El early-return de idempotency (línea 92) y el 23505 race-recovery NO disparan notif — la notif la creó el "creador ganador".

2. **`fraud_link_suspected`** en `FraudDetectionService.runScan`:
   - **Cross-user** via `enqueueForRole({ roleCode: 'admin_tenant' })`.
   - Solo dispara para links **NUEVOS** (path del `else` que hace INSERT). Updates de links existentes NO disparan — evita spam por re-scan.
   - Helper `notifyAdminsNewSuspectedLinks` agrupa: batch lookup de usernames (1 query con `inArray`) → for-each link → enqueue por channel.
   - Payload: `{ linkId, score, userAUsername, userBUsername, signals[] }`.

### Decisiones técnicas

1. **Hook en service vs controller (bonus_granted)**. Trade-off: dejarlo en el service evita duplicar código (manual + auto-grant). Contra: el service no conoce el contexto HTTP (request, IP). Para notifs internas no importa — no se loguea contexto request en la notif. Patrón aplicable: si un hook debe dispararse desde múltiples paths que terminan en el mismo service method, ponerlo ahí.

2. **Idempotency-aware: notificar solo el "creador ganador"**. El método `grantManual` tiene 2 paths que retornan un bono existente:
   - Early-return (línea 92): mismo body con misma key — devolvemos el existente.
   - 23505 race recovery: otro insert con misma key ganó la carrera — re-fetcheamos.
   Ambos retornos están FUERA del bloque que enqueue notif. Solo el INSERT exitoso dispara notif. Resultado: notif idempotente sin agregar lógica de "ya notifiqué" (el INSERT mismo es nuestro flag).

3. **Re-scan no duplica notifs (fraud_link_suspected)**. La key del diseño: notif **solo al INSERT** del link, no al UPDATE. Si el scan corre 100 veces y el link sigue ahí, no se generan 100 notifs. Trade-off: si el score cambia de 30→90 (cruza threshold) en un UPDATE, NO disparamos notif aunque sea "más alarmante" ahora. Aceptable — esos casos son raros y el panel mostrará el score actual. Futuro: si emerge necesidad, agregar notif por "transición de status hacia 'suspected' alto".

4. **`enqueueForRole` ya soportaba `excludeUserId`** del sprint anterior. Lo NO uso acá porque el scan corre desde el cron (no hay actor humano que excluir) o desde un admin que dispara `/scans/run` manualmente. Si el actor manual termina recibiendo la notif del link que él mismo disparó al scan, no es un problema — quería ver el resultado.

5. **Batch lookup de usernames con `inArray`**. 1 query en vez de N (una por usuario). Importante para scans grandes con muchos links nuevos.

### Tests E2E (5 nuevos)

- `bonus_granted` manual: nombre + monto en body, subject "Recibiste un bono".
- `bonus_granted` idempotency: re-grant con misma key NO duplica notifs (2, no 4).
- `bonus_granted` auto-grant: deposit approve dispara welcome → notif del bono.
- `fraud_link_suspected`: 2 players con shared_ip + similar_email → scan detecta → otro admin recibe 2 notifs con usernames + score.
- `fraud_link_suspected` re-scan: 1er scan crea link y notifica, 2do scan NO duplica notifs (UPDATE no INSERT).

### Estado final

- **396 tests, 26 suites, 0 skipped, 0 flaky** (+5 vs sprint anterior, ~145s).
- **Build limpio.**

### Cobertura final del subsistema notifications (15 hooks)

User-facing (14):
- welcome_bonus_blocked, deposit_approved, deposit_rejected, withdrawal_paid, withdrawal_rejected, withdrawal_failed, bonus_expired, bonus_cancelled, **bonus_granted** (nuevo)

Admin-facing (2):
- fraud_cluster_confirmed, **fraud_link_suspected** (nuevo)

El subsistema cubre **todos los eventos críticos** del flow MVP. Próxima evolución natural es la UI (panel admin de templates editables; UI user para ver notifs) — back-end ya soporta todo lo necesario.

### Lo que NO entró todavía (sigue como deuda menor)

- **Templates editables por admin** (`notification_templates` tabla con override per-tenant). Sprint dedicado.
- **SMS provider real** (Twilio). Sigue marcando `failed`.
- **Throttling de fraud_link_suspected**: si un scan crea 100 links de golpe, son 200 notifs por admin. Sumar setting `fraud.notify_max_per_scan` (default 10) con summary "y otros N links" cuando emerge volumen.
- **Transición de score en re-scan**: hoy NO notificamos si un link existente sube de score significativamente. Aceptable hasta que un admin lo pida.

---

## 2026-05-14 — Notification Templates editables por admin

**Contexto**: el subsistema de notifications tenía 15 hooks con templates hardcoded en código. Si un tenant quería cambiar el tono ("Hola, tu depósito fue aprobado" → "¡Listo crack! ya tenés tus fichas"), había que tocar código y deployar. Imposible para producto multi-tenant.

**Decisión**: tabla `notification_templates` con UN override por kind por tenant. Renderer del enqueue chequea override; si existe y `enabled=true`, usa override con substitution simple `{{var}}`. Si no, usa default hardcoded (sin cambios).

### Componentes implementados

1. **Schema `notification_templates`** (migration 0019):
   - `kind` UNIQUE NOT NULL.
   - `subject_template` + `body_template` text (con `{{vars}}`).
   - `enabled` boolean default true (toggle sin borrar).
   - Audit fields: `updated_by_user_id`, `updated_at`.
   - Sin FK al registro de kinds (vive en código, no en DB).

2. **`renderOverride(subject, body, payload)`** en `notifications.templates.ts`:
   - Regex `/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g`.
   - Substitution permisiva: var faltante → string vacío.
   - Arrays se joinean con `", "`.
   - Sin lógica condicional (vs los defaults TS que sí tienen `if/else`).

3. **`NotificationTemplatesService`**:
   - `list / findByKind / upsert / delete`.
   - `assertKindRegistered`: valida `kind` contra `REGISTERED_NOTIFICATION_KINDS` (exportado de templates.ts). Tira BadRequest si el admin envía un kind no registrado en código.

4. **`NotificationsService.enqueue` refactor**:
   - Lookup del override antes de renderizar.
   - Si existe y enabled → `renderOverride`. Sino → `renderTemplate` (default).
   - **Snapshot semántico**: el subject/body renderizado se persiste en `notifications.subject` y `body`. Cambios futuros al template NO afectan notifs ya emitidas.

5. **`NotificationTemplatesController`** (admin):
   - `GET /` → lista overrides.
   - `GET /kinds` → kinds registrados (para popular UI dropdown).
   - `GET /:kind` → uno (404 con error explícito si no hay override — el default sigue activo).
   - `POST /:kind/preview` → render con payload de prueba. Soporta:
     - Con draft (subject+body en body) → renderiza draft (source=`draft`).
     - Sin draft, con override existente → renderiza override (source=`override`).
     - Sin draft, sin override → renderiza default (source=`default`).
   - `PATCH /:kind` → upsert.
   - `DELETE /:kind` → unset (idempotent).
   - Permission `tenant.notifications.templates.edit`.

6. **Permission nuevo** `tenant.notifications.templates.edit`:
   - Category `tenant`, `auditRequired: true`, `isDelegatable: false`.
   - Admin_tenant lo recibe automáticamente (seed asigna todos).

7. **Audit log**:
   - `tenant.notification_template.set` (severity:medium) — incluye before+after.
   - `tenant.notification_template.unset` — solo si había override (idempotente delete no graba).

### Decisiones técnicas

1. **Substitution simple vs Handlebars/template engine**. Trade-off: simple regex evita dependencia, mantiene templates portables, suficiente para texto plano. Si emerge necesidad de condicionales/loops, sumar Handlebars (npm package liviano). MVP no lo justifica.

2. **Permisivo con vars faltantes**. Var no presente → string vacío (no tira, no log warning). Razón: el admin no debería preocuparse por TODAS las vars del payload de un evento; algunas las usa, otras no. Trade-off: typos pasan silenciosos. Mitigación: endpoint `preview` permite testing pre-save.

3. **Templates en código siguen vivos**. No los migré a DB. Razón:
   - Tienen lógica condicional (`if (externalRef)`, `signals.join`).
   - Son el "contrato semántico" del sistema — un admin que borra todo vuelve al comportamiento documentado.
   - Mantenibles en code review.
   El override es OPT-IN: el admin elige qué personalizar.

4. **Enabled flag vs delete**. Razón para tener ambos: el admin puede "pausar" un override (volver al default temporalmente) sin perder el draft. Patrón común — kill switch sin destruir trabajo.

5. **Endpoint preview**. UX importante: el admin escribe `{{wrongVar}}` en el subject, lo guarda, y emite una notif con string vacío en lugar de la var. Sin preview, no se da cuenta hasta que un user reporta. Con preview, antes de PATCH ve el render real.

6. **Sin cache del override en hot path del enqueue**. Cada enqueue hace 1 query extra al `notification_templates`. Trade-off: 1 query O(1) por PK index. Si crece volumen (e.g. 10k notifs/min), cache in-memory con TTL corto + invalidación on-set.

7. **Sin endpoint `GET /defaults/:kind`**. El default está en código; si el admin quiere "ver cómo es el default", usa `preview` sin override. Evita exponer otro endpoint con duplicate semántica.

8. **Snapshot semántico se mantiene**. Cambiar el template hoy NO altera notifs viejas (subject/body persistidos en `notifications`). Si el admin quiere re-renderizar histórico, sprint futuro: migration tool one-shot que mapee `payload jsonb` → re-render → UPDATE.

### Tests E2E (24 nuevos)

- CRUD: PATCH crea + GET, re-upsert sobrescribe, 404 sin override, DELETE idempotente, GET / lista, GET /kinds devuelve registry, cajero1 → 403, kind no registrado → 400, sin subject → 400, subject vacío → 400.
- Render: sin override → default, override enabled → custom con `{{var}}`, override disabled → cae a default, var faltante → vacío, snapshot semántico (cambio post-enqueue no afecta), array → join con ", ".
- Preview: con draft, con override, con default, kind inválido → 400, override disabled → cae a default.
- Audit: PATCH graba, DELETE graba si había, DELETE idempotente NO graba.

### Bug encontrado y resuelto

**Síntoma**: tests fallaban con 403 al hacer PATCH al endpoint.

**Causa**: agregué el nuevo permission al seed `tenant-seed.ts`, pero olvidé rebuildear `@casino/db`. El globalSetup llama el seed COMPILADO (`packages/db/dist/`), no el source. Después del `pnpm --filter @casino/db build` todo verde.

**Lección**: si modificás algo en `packages/db/src/seeds/`, hay que rebuildear el package antes de correr tests. Sumar verificación con `grep -c "X" dist/...` es defensivo.

### Estado final

- **420 tests, 27 suites, 0 skipped, 0 flaky** (+24 vs sprint anterior, ~149s).
- **Build limpio.**

### Cobertura completa del subsistema notifications

- **15 hooks** (8 user-facing bonos+transacciones + 1 user-facing antifraude + 6 admin) — sprints anteriores.
- **Templates editables per-tenant** — este sprint. **El admin del tenant puede personalizar el tono de cualquier kind sin tocar código.**
- **Preview endpoint** para testing pre-save.
- **Audit completo** de cambios de templates.

El subsistema está **production-ready** para back-end. Lo que sigue es UI + SMS provider real.

### Lo que NO entró todavía

- **SMS provider real** (Twilio). El dispatcher acepta channel='sms' pero marca failed con `sms_provider_not_implemented`.
- **Migration tool** para re-renderizar notifs históricas con templates nuevos (uno-shot script).
- **Cache in-memory del override**. Si crece volumen, agregar.
- **Validador de vars en el template al guardar**: hoy el admin puede escribir `{{vars_inexistentes}}` y se aceptan. Mitigación: el preview se los muestra como vacíos.
- **Templates multilenguaje** (`{{locale}}` switching). Hoy 1 template por kind. Cuando emerja necesidad, sumar columna `locale` y query con `WHERE kind=X AND locale=Y`.

---

## 2026-05-14 — SMS Provider real (Twilio) + kill switch por channel

**Contexto**: el dispatcher de notifications aceptaba channel='sms' pero hardcoded marcaba todo como `failed` con error `sms_provider_not_implemented`. El último gap del back-end. Cierre del subsistema.

**Decisión**: provider pattern análogo al EmailProvider, con dos implementaciones (`ConsoleSmsProvider` default, `TwilioSmsProvider` real opt-in via env vars). Factory en module decide cuál usar.

### Componentes implementados

1. **`SmsProvider` interface** (token `SMS_PROVIDER`):
   - `send({ to, body, tenantSlug? }): Promise<void>`.
   - Tira en falla con mensaje descriptivo. El dispatcher persiste el error.

2. **`ConsoleSmsProvider`** (default):
   - Loguea con prefijo `[SMS]` + corte body a 80 chars.
   - Es el provider que recibe el dispatcher cuando `TWILIO_*` env vars no están.

3. **`TwilioSmsProvider`** (opt-in):
   - **Sin SDK npm**: `fetch` directo al endpoint REST `https://api.twilio.com/2010-04-01/Accounts/<sid>/Messages.json`.
   - Auth: HTTP Basic con `<sid>:<token>` base64.
   - Body: x-www-form-urlencoded `To`/`From`/`Body`.
   - Errores: parsea respuesta JSON de Twilio (`{code, message}`) y tira con formato `twilio_<code>: <message>`. Errores de red → `twilio_network_error: <causa>`.
   - Constructor recibe `{ accountSid, authToken, fromNumber, apiBaseUrl? }`. `apiBaseUrl` opcional para apuntar a mock en testing.

4. **Factory `smsProviderFactory` en `notifications.module.ts`**:
   - Inyecta `ConfigService`. Lee `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER`.
   - Si las 3 presentes → `TwilioSmsProvider`. Sino → `ConsoleSmsProvider`.
   - Loguea decisión al boot.

5. **`NotificationsService.dispatch` refactor**:
   - Channel='sms' busca `users.phone` (no `email`). Si null → `failed` con `user_has_no_phone`.
   - Si phone presente → `smsProvider.send({ to: phone, body: subject + '\n' + body })`.
   - **Composición body**: SMS no tiene "subject"; concat con newline. El template del kind decide si el subject aporta info o entorpece (template puede dejar subject vacío para SMS).

6. **`DispatchOptions.skipChannels`**:
   - Filter en el SELECT pending: `channel NOT IN (skipChannels)`.
   - Las notifs de channels skipeados quedan en `pending` para próximo run (kill switch sin perder queue).

7. **Setting `notifications.sms_enabled`** + kill switch en el cron:
   - El cron lee `email_enabled` Y `sms_enabled`. Construye `skipChannels[]` y se lo pasa a `dispatch`.
   - Previo: el cron evaluaba solo `email_enabled`; si era false, NO llamaba `dispatch` y los SMS también se quedaban pending por error. Bug corregido: ahora cada channel se pausa independientemente.

### Decisiones técnicas

1. **Sin SDK npm de Twilio** (`twilio` package es ~3MB con deps). Trade-off: perdemos retries automáticos del SDK, throttling cliente, helper methods. Para MVP no hace falta: 1 POST por SMS, errores explícitos del provider. Si emergen issues de rate limit o reliability, agregar el SDK.

2. **Provider factory via env vars (no via setting)**. La elección de provider afecta TODO el tenant, y es una decisión de infraestructura (¿tenés cuenta de Twilio?), no de negocio. Setting per-tenant sería overkill — el operador del SaaS decide. Si emerge "tenant A usa Twilio, tenant B usa Vonage", refactor a config per-tenant.

3. **`users.phone` existente sin formato enforced**. Hoy el campo es `text` libre. Twilio quiere E.164 ("+549..."). Si el user tiene "(11) 3333-4444", Twilio rechaza con `twilio_21211: Invalid 'To' Phone Number`. **Trade-off MVP**: aceptamos el error en runtime y el dispatcher persiste el detalle. Cuando emerja necesidad, sumar validación E.164 al endpoint que setea phone (futuro: tenant-users.controller).

4. **Subject + body concat para SMS**. SMS no tiene "subject" semánticamente. La opción "más limpia" sería ignorar subject. Pero los templates por kind a veces meten info crítica ahí (e.g. "Tu retiro fue procesado" como subject). MVP: concat con newline. Si los SMS quedan feos, los templates específicos pueden vaciar el subject (`subject: ''` en el override).

5. **`skipChannels` semantically reemplaza el old kill switch**. Antes: si `email_enabled=false`, NO se llamaba `dispatch` y SMS también se pausaba implícitamente. Ahora: cada channel se pausa por separado. **Breaking interno** pero invisible para usuarios (el comportamiento "email_enabled=false pausa solo email" es lo que esperabas que hiciera siempre).

6. **`ConsoleSmsProvider` en tests** garantiza que NUNCA hacemos llamadas a Twilio real desde el suite. El env de tests no setea `TWILIO_*`, así que el factory siempre devuelve Console.

### Tests E2E (5 nuevos en notifications.e2e.ts)

- SMS con user con phone → sent (ConsoleSmsProvider responde OK).
- SMS sin phone → failed con `user_has_no_phone`.
- `skipChannels=['sms']` → SMS queda pending, email se procesa.
- `sms_enabled=false` setting → cron pasa skipChannels al dispatch, SMS queda pending.
- Settings: `sms_enabled` acepta boolean, rechaza string.

### Estado final

- **425 tests, 27 suites, 0 skipped, 0 flaky** (+5 vs sprint anterior, ~157s).
- **Build limpio.**

### Subsistema notifications COMPLETO

✅ 15 hooks user+admin
✅ Templates editables per-tenant con preview y audit
✅ Email provider (Console default + abstracción para SMTP/SES futuro)
✅ **SMS provider (Console default + Twilio opt-in via env)**
✅ Kill switches por channel via settings
✅ Retention con cron embebido
✅ Snapshot semántico de notifs
✅ Audit log completo

**Back-end de notifications PRODUCTION-READY.** El próximo paso es la UI (Fase 4).

### Lo que NO entró todavía

- **Validación E.164** del phone al guardar — hoy Twilio rechaza phones malformados con error 21211 y el dispatcher persiste el detalle. Mitigación: el admin ve el error en `notifications.error` y corrige el phone del user.
- **Throttling cliente** de SMS (Twilio rate limits varían por cuenta). Si emerge spam, agregar.
- **Provider de SMTP real** para email (sigue ConsoleEmailProvider default). Mismo patrón que Twilio cuando se justifique.
- **Provider para web push** (`channel='web_push'`). El enum permite extensión.
- **Migration tool one-shot** para re-renderizar histórico con templates nuevos.

---

## 2026-05-14 — Frontend Sprint 1: Setup + Login + Dashboard ("Casino Noir")

**Contexto**: arranca la Fase 4 del roadmap (frontend). El back-end de subsistemas MVP está completo (425 tests verde). Este sprint sienta las bases visuales y arquitectónicas del panel admin del operador.

**Decisión clave**: NO usar `create-next-app` — armar la estructura a mano para evitar boilerplate genérico ("AI slop") y comprometernos con un design system propio desde el día uno. Usar `frontend-design` skill como guía.

### Stack final

- **Next.js 15** App Router + Turbopack dev. Single Next app con route groups `(admin)` + `(auth)` para separar layouts.
- **Tailwind v4** con CSS variables nativas (`@theme`).
- **React 19** + Server Components donde corresponda.
- **shadcn/ui base via Radix primitives** (NO copy/paste del CLI — primitives propios sobre Radix raw).
- **TanStack Query** (instalado, sin usar todavía).
- **React Hook Form 7 + Zod 3 + @hookform/resolvers 5**.
- **Lucide icons**.

### Design system: "Casino Noir"

Identidad sobria, negra, con detalles rojo sangre. Inspiración: terminales financieros + dashboards forensics. NO el típico casino dorado/neón.

#### Tipografía (rompiendo el cliché Inter)

- **Display**: **Fraunces** (variable serif, axes `opsz` + `SOFT`). Personalidad real, no neutra. Para h1/h2 y números destacados.
- **UI body**: **Geist Sans** (Vercel) — moderna sin caer en Inter.
- **Mono**: **Geist Mono** — montos, IDs, hashes, todo lo que necesite tabular nums.

#### Paleta (negro/gris/rojo)

```
--color-bg:           #0a0a0a   ← fondo principal
--color-bg-elevated:  #121212   ← cards
--color-bg-subtle:    #1a1a1a   ← inputs, hover bg
--color-border:       #262626   ← separadores 1px
--color-border-strong:#3d3d3d   ← énfasis
--color-fg:           #fafafa   ← texto principal
--color-fg-muted:     #a1a1a1   ← secundario
--color-fg-subtle:    #6b6b6b   ← meta/labels
--color-accent:       #dc2626   ← ROJO-600 (CTA, activos, errores)
--color-accent-glow:  rgba(220,38,38,0.18)
```

Reglas de uso:
- Rojo SOLO en CTA primario, estados activos (sidebar item, border-l de cards), errores y métricas críticas. Nunca decorativo.
- Bordes 1px, esquinas duras (radius máximo 6px).
- Sin sombras blandas — el peso visual viene del contraste de bg + tracking de tipografía.
- Tabular nums siempre en columnas numéricas (`.num` class + `font-mono`).

#### Detalles distintivos

- **Grain texture sutil** en `<body>` via SVG inline noise (opacity 0.04). Agrega "peso" sin ser ruidoso.
- **Border-l accent** (2px rojo) en sidebar items activos y en hover de cards.
- **Labels caps + tracking 0.12em** (estilo terminal/forensics — diferenciación visual fuerte del valor).
- **Pulse rojo** en indicador "Live" del header (ping ring + dot sólido).
- **Empty state estilo terminal** en dashboard: `> waiting for events ...` con ASCII art. Sin ilustraciones cute.

### Componentes implementados (Sprint 1)

#### Primitives (`components/ui/`)
- `Button` — 5 variants (primary, secondary, ghost, danger, outline-accent) × 4 sizes con `class-variance-authority`. Hover usa `scale(0.985)` sutil.
- `Input` — bg subtle, focus state con border rojo + shadow rojo glow. Prop `numeric` activa font-mono+tabular-nums automáticamente.
- `Label` — caps + tracking ancho, peso muted.
- `Card` + `CardHeader` + `CardTitle` + `CardBody` — esquinas duras por default, prop `rounded` opcional.
- `StatTile` — KPI tile con display font para el value, hover acent en border-l.

#### Auth (`app/(auth)/`)
- `layout.tsx` — **split screen** brutalist: izquierda atmósfera (brand mark angular custom SVG, diagonal stripes background, glow rojo en esquina, tagline "Operación / controlada." display 56px, 3 stats terminal style en footer); derecha form centrado.
- `login/page.tsx` — form con react-hook-form + zod. Banner de error inline (no toast) con border-l rojo + bg-stripes-danger sutil. Spinner inline en submit (borde rotativo).

#### Admin shell (`app/(admin)/`)
- `layout.tsx` — guard de auth (redirige si no logueado) + sidebar fijo + header.
- `Sidebar` — 4 secciones agrupadas (Operación / Engagement / Plataforma / Sistema) con 14 items. Active state: bg subtle + border-l rojo 2px + icon en rojo. User chip + logout abajo.
- `Header` — breadcrumb del pathname + búsqueda placeholder con ⌘K kbd + indicador "Live" (pulse rojo) + bell con badge rojo.

#### Dashboard (`app/(admin)/dashboard/page.tsx`)
- Hero strip con saludo personalizado (display 52px, nombre del user en rojo) + hora live monospace + acciones primarias.
- Grid 4 KPIs (Usuarios activos, Fichas circulación, Depósitos pendientes — variant accent, Bonos activos). Placeholder por ahora; sprint 2 conecta endpoints reales.
- Activity feed con empty state terminal ASCII.
- Quick actions panel con 3 atajos (crear user, mint, revisar fraude) — cada uno con icon + border-l hover effect.

### Arquitectura (`lib/`)

#### `api-client.ts`

Wrapper fino sobre `fetch`:
- Base URL `/api` → rewrite de Next a `NEXT_PUBLIC_API_URL` (default `http://localhost:3000`).
- Setea header `X-Forwarded-Host` con `localStorage.casino_admin_tenant_host` (default `jest.localhost`). El backend honra este header como override del tenant.
- Inyecta `Authorization: Bearer <token>` desde `localStorage.casino_admin_token`.
- Tipa errores: `ApiError { status, message, code?, details? }`.
- Helpers: `apiGet`, `apiPost`, `apiPatch`, `apiDelete`.

#### `auth-context.tsx`

Provider React con `user`, `loading`, `login(u,p)`, `logout()`:
- Bootstrap: al montar la app, si hay token persistido, llama `GET /tenant/auth/me` para validar.
- Login: `POST /tenant/auth/login` → guarda token → re-fetch `/me` para poblar user.
- Logout: limpia token y redirige a `/login`.
- 2FA: hoy MVP solo username+password. El backend ya soporta 2FA (`recovery codes`, `TOTP`); el flow del frontend se agrega en sprint siguiente.

### Cambio en backend: `X-Forwarded-Host` honrado

`TenantResolverMiddleware.extractHost` ahora lee `X-Forwarded-Host` ANTES de `Host`:

```typescript
const forwarded = req.header('x-forwarded-host');
const raw = forwarded ?? req.header('host');
```

Patrón estándar de reverse proxies. En dev permite que el web en `:3001` le diga al backend en `:3000` qué tenant resolver. En prod, el reverse proxy de borde (Nginx/Cloudflare) debe sanear cualquier `X-Forwarded-*` externo entrante.

**Verificado**: backend suite 425/425 sigue verde post-cambio.

### Decisiones técnicas notables

1. **`rem` se mantiene en 16px** (default Tailwind), body en 13px directo (px). Si cambiás `html` font-size, rompés todas las utilities que usan rem (`h-10`, `text-2xl`, etc.). Bug encontrado y corregido durante el smoke test.

2. **Token en localStorage, no httpOnly cookies**. Trade-off MVP: simplifica el manejo client-side (sin CSRF concerns para mutations same-origin). Sprint futuro: migrar a cookies httpOnly para defensa XSS. El api-client está aislado — un cambio en 1 archivo migra todo.

3. **Primitives propios, no shadcn CLI**. La copia del CLI trae estética genérica de los componentes default (radius redondo, sombras blandas, font Inter). Empezamos con primitivos finos sobre Radix raw + nuestras tokens.

4. **Brand mark inline SVG** angular (rectángulos formando una "C" estilizada con detalles rojos). No usé ilustración stock ni emoji. Reusable como component en Sidebar y AuthLayout.

5. **Route groups `(admin)` / `(auth)`**: layouts independientes sin afectar URL. El admin tiene shell con sidebar; el auth es split screen con atmósfera.

6. **Sin server actions todavía**. Toda mutación va por api-client desde el client. Razón: el auth flow vive en localStorage, así que necesita ser client-side de todos modos. Server actions las sumamos cuando agreguemos formularios complejos con server validation paralela.

7. **Hora "Live" en dashboard con `setInterval(1s)`**. Detalle decorativo pero real — el operador siempre quiere saber la hora del sistema. Performance: irrelevante (1 setState/s).

### Tests

- **Type-check del web**: limpio (`tsc --noEmit`).
- **Visual smoke**: verificado con `mcp__Claude_Preview__*` tools. Inspect confirma:
  - `body` bg `rgb(10,10,10)` ✓, fg `rgb(250,250,250)` ✓, Geist activo ✓.
  - `h1` Fraunces, 40px, peso 600, tracking -0.65px ✓.
  - `button[type=submit]` bg `rgb(220,38,38)` ✓, 40px height ✓.
  - `aside` lg:flex activo en 1440px ✓.
- **Flow login**: submit dispara request → `/api/tenant/auth/login` → 500 (backend no levantado) → banner "Acceso denegado · Error del servidor" se muestra correctamente. End-to-end del client-side OK.
- **Backend suite**: 425/425, ningún test rompió tras el cambio del `X-Forwarded-Host`.

### Bug encontrado y resuelto

**Síntoma**: `Module not found: Can't resolve 'next/font/google/target.css'. Axes can only be defined for variable fonts when the weight property is nonexistent or set to 'variable'.`

**Causa**: estaba combinando `weight: ['400','500','600','700']` con `axes: ['opsz','SOFT']` en `Fraunces()`. Cuando hay axes, los pesos deben ser variables (todo el rango disponible).

**Fix**: sacar `weight` — los axes ya cubren el rango completo. Tailwind utilities `font-medium`/`font-semibold` aplican el peso final por CSS.

### Estado final

- **Backend**: 425 tests, 27 suites, build limpio.
- **Frontend**: type-check limpio, dev server arriba, login renderiza, flow form→api→error funciona.
- **Estructura del monorepo**: `apps/api` (NestJS) + `apps/web` (Next.js) + `packages/{db,typescript-config,eslint-config}`.

### Próximos sprints del frontend

1. **`/users`** — list/create/edit/delete + roles + permisos overrides + jerarquía + scope.
2. **`/wallet`** — mint/burn + balance + transactions table.
3. **`/deposits` + `/withdrawals`** — list + filters + approve/reject + audit timeline.
4. **`/bonuses` + `/promotions` + `/leagues`** — engagement subsystem UI.
5. **`/fraud`** — clusters + links + scans + settings.
6. **`/notifications` + `/templates`** — templates editor con preview.
7. **`/settings` + `/audit`** — config + auditoría.
8. **Panel end-user (jugador)** — vibe distinto, más visual, mobile-first.

Estimado: 5-7 sprints más para cubrir todo el back-end existente con UI.

---

## 2026-05-14 — Frontend Sprint 2: Dashboard real + `/users` + dev tenant tooling

**Contexto**: Sprint 1 dejó las bases visuales y un dashboard con placeholders. Sprint 2 conecta al backend real y agrega la primera vista funcional del operador (`/users`).

### Componentes implementados

#### Data layer
- **`QueryProvider`** (TanStack Query): wrapper con defaults sanos — `staleTime: 30s`, `refetchOnWindowFocus: true`, retry 1 (excepto 401/403).
- **`useDashboardStats`**: hook que dispara 3 queries paralelas (`/tenant/users`, `/tenant/fraud/stats`, `/tenant/bonuses/stats/active`) con `useQueries`. Si una falla individualmente, el dashboard muestra "—" en ese tile sin romper el resto. Flag `hasError` agregado en el header.
- **`useUsersList`** + **`useUserDetail`**: queries tipadas para la tabla y el drawer de detalle.

#### UI primitives nuevos
- **`Badge`** — chip con 5 variants (neutral/success/warning/danger/info), prop `dot` opcional para status indicator.
- **`Table` family** (`Table` + `THead` + `TBody` + `TR` + `TH` + `TD`) — densos, monospace numbers, hover-aware cuando `interactive=true`. Sticky header. Sin radius (esquinas duras).
- **`Skeleton`** — placeholder con shimmer animado (definido en `globals.css`).
- **`EmptyState`** — terminal-style ASCII placeholder (`> waiting for {hint}`) reusable. Acepta `stream` (decoración header) y `action` opcional.
- **`Drawer`** — Radix Dialog renderizado como side panel desde la derecha (480px desktop, fullscreen mobile). Custom keyframes (`drawer-slide-in/out` + `overlay-fade`) en globals.

#### Dashboard real
- 4 KPIs conectados: usuarios totales (con activos en hint), suspected links (variant accent si > 0), señales antifraude, bonos activos.
- Skeletons individuales por tile durante loading.
- Activity feed empty state (endpoint feed se implementa sprint próximo).
- Quick actions: "Gestionar usuarios" (con count real), "Operar wallet", "Revisar antifraude" (icon cambia a `ShieldAlert` si hay suspected pendientes).

#### `/users`
- Header con título display + count `${rows.length} de ${data.count}` + acciones (Refrescar con spinner, "Crear usuario" disabled = sprint 3).
- Toolbar con search inline (icon left, placeholder claro) + filtros de status como tabs con underline accent.
- **Tabla densa**: avatar fallback (iniciales en mono uppercase) + columna combinada displayName/username + email mono + Badge de status (color según status) + fecha numeric.
- Click en row → drawer abre.
- Filter client-side por search (username/displayName/email) + status. Para volúmenes >500 users sumar paginación server.
- Animación de entrada staggered en filas (max 600ms total para no demorar visual).
- Empty state contextualizado: si hay query/filter, muestra "No coincide ningún usuario con los filtros" + el query/status en el stream.

#### `/users` detail drawer
- Header: displayName en font-display + @username mono.
- Sección **Perfil**: email/phone/status (Badge)/2FA (Badge)/createdAt — formato grid `[label 110px][value]`.
- Sección **Roles**: chips lado a lado, `isSystem` con variant danger (admin_tenant resaltado).
- Sección **Permisos efectivos**: lista scrollable max-h-280px, cada permission en línea mono con hover bg-subtle. Count en el header.
- Footer: Cerrar + Editar (disabled = sprint 3).

### Backend tweaks

#### Fix: `nest start --watch` rompía con `tsbuildinfo` stale

**Síntoma**: el comando `pnpm --filter api dev` tiraba `Cannot find module 'apps/api/dist/main'` después de la primera compilación.

**Causa**: `nest-cli.json` tenía `deleteOutDir: true` + `tsconfig` tiene `incremental: true`. El `tsconfig.tsbuildinfo` quedaba en sync con un dist/ que se borraba en cada arranque, así el primer "Found 0 errors. Watching..." cree que no necesita re-emitir nada (todo está "up to date" según el .tsbuildinfo) pero el outDir está vacío.

**Fix**:
1. `deleteOutDir: false` en `nest-cli.json`.
2. Script `dev` ahora hace `nest build && nest start --watch --preserveWatchOutput` — primero un build full sincrono, luego watch que reusa el output.

Consecuencia: si alguien borra `dist/` a mano sin borrar `tsconfig.tsbuildinfo`, el watch no compila nada y revienta. Solución: borrar ambos juntos. Documentado en SESSION_LOG.

#### `seed-dev-tenant` script

Script `pnpm --filter @casino/db db:seed:dev-tenant` que provisiona un tenant **demo** en la control DB de **dev** (NO la de tests):
- Crea fila en `tenants` con slug `demo`, status `active`, plan `basic`.
- Crea fila en `tenant_domains` con domain `demo.localhost`.
- Crea DB Postgres `tenant_demo_dev` (si no existe).
- Aplica migraciones de tenant.
- Seedea roles + permisos + admin (`demo_admin` / `demo-pwd-2026`).

Idempotente: re-corrida actualiza el tenant existente y re-seedea el admin (password queda al actual `DEMO_ADMIN_PASSWORD` env o default).

Razón del script: la control DB de tests E2E NO es la misma que la control DB de dev (los tests usan su propia para no contaminar). Sin esto, el frontend dev no puede operar contra ningún tenant — siempre da 404 "tenant no encontrado".

`apps/web/.env.local.example` ahora apunta a `demo.localhost` por default. Cambiá si querés apuntar a `jest.localhost` (test tenant) o a un tenant productivo.

### Decisiones técnicas

1. **Filter client-side en `/users`** para MVP. Trade-off: si el tenant tiene 5000 users, baja UX (descarga 5000 rows). Mitigación cuando emerja: agregar query params al endpoint backend (`?search=&status=&limit=&offset=`).

2. **Hooks por endpoint, no por feature**. `useUsersList` separado de `useUserDetail` aunque ambos sean del mismo dominio. TanStack Query ya cachea de forma independiente, y permite usarlos selectivamente (e.g. detail sin necesitar list).

3. **`useQueries` para dashboard** en vez de `Promise.all` o múltiples `useQuery`. Razón: cada query mantiene su cache key independiente. Si una vista usa solo fraud stats, el dashboard ya tiene esa data fresca sin re-fetch.

4. **`dot` prop en Badge** para status indicators. Pattern visual común — la mayoría de status badges agregan un dot del mismo color. Más consistente que crear un componente `StatusBadge` aparte.

5. **Drawer con keyframes custom**, no `tailwindcss-animate`. La librería trae 50KB de utilities que no usamos. Cuatro `@keyframes` en globals.css son ~30 líneas y suficientes para los animations que necesitamos.

6. **Avatar fallback con iniciales mono uppercase** en lugar de imagen. Razón: no hay foto de perfil hoy en el modelo de users. Las iniciales son consistentes y "tipográficamente coherentes" con el DS. Cuando se sume `users.avatarUrl`, swappear por img sin tocar más nada.

7. **Tabla con animación staggered** capada a 600ms. Si hay 100 rows, la última no espera 6s. Sutil pero crítico — si pasara los 600ms se vuelve molesto.

8. **`process.env.NEXT_PUBLIC_TENANT_HOST` referenciado en cliente** para que el copy del tenant en la UI siempre refleje a qué tenant está apuntando. Antes estaba hardcoded `jest.localhost` — bug menor del Sprint 1 corregido.

### Type-check + verificación

- `apps/web` type-check: limpio.
- `packages/db` build: limpio.
- `apps/api` build: limpio.
- Backend test suite: **425/425 verde** post-cambios.
- Visual smoke: login renderiza igual que Sprint 1, dispara request al backend con `X-Forwarded-Host` correcto, 404 cuando el tenant no está provisionado en dev DB → confirma flow correcto end-to-end.

### Estado final

- **6 archivos nuevos en frontend**: 5 primitives (badge, table, skeleton, empty-state, drawer) + 2 hooks (use-dashboard-stats, use-users) + 1 page (users) + provider (query-client).
- **2 cambios en backend**: nest-cli.json + package.json del api.
- **1 script nuevo**: seed-dev-tenant.

### Próximos sprints

1. **`/users` create + edit** (Sprint 3) — DTO, formulario react-hook-form, role assignment, scope selector, permisos overrides.
2. **`/wallet`** — balance + transactions table + mint/burn modals.
3. **`/deposits` + `/withdrawals`** — list + filtros + approve/reject + audit timeline embebido.
4. **Audit feed real** en el dashboard (endpoint backend si no existe + componente activity-row con icon por tipo de evento).
5. **`/bonuses`, `/promotions`, `/leagues`, `/fraud`, `/settings`, `/templates`, `/notifications`** — siguiendo el orden del back-end MVP.

---

## 2026-05-14 — Frontend Sprint 3: `/users` create + edit (CRUD completo)

**Contexto**: Sprint 2 dejó `/users` como list + read-only detail. Sprint 3 cierra el CRUD: crear nuevos users con asignación de rol + editar campos editables del user existente. Es el primer flow completo de mutación del frontend.

### Componentes nuevos

#### Constants compartidas (`lib/constants.ts`)
- `TENANT_ROLES`: 6 roles del seed (admin_tenant, socio, distribuidor, cajero, empleado, usuario_final), cada uno con `code`, `label`, `description`, `tone` (system/operational/player). Hardcodeado porque vienen del seed y son fijos para todos los tenants. Si emerge necesidad de custom roles per tenant, sumar endpoint `GET /tenant/roles`.
- `USER_STATUSES`: 4 status del UpdateTenantUserDto (active/pending/suspended/banned).

#### UI primitives nuevos
- **`Modal`** (`components/ui/modal.tsx`): Radix Dialog centrado. Distinto al Drawer (side panel) — modal es para flows breves bloqueantes. Sizes sm/md/lg. Animations propias (`modal-in`/`modal-out` keyframes con scale + fade).
- **`Select`** (`components/ui/select.tsx`): `<select>` nativo estilizado con chevron lucide overlay. Razón vs Radix Select: nativo es accesible por default, no infla el bundle, mejor en mobile (UI nativa del SO). Para multi-select o search, swap a Radix.
- **`FormField`** (`components/ui/form-field.tsx`): wrapper consistente label+control+error+hint. Asterisco rojo para campos required. Errores en `role="alert"` para screen readers.

#### Toaster (sonner)
Wireado en root layout con tema dark. Estilos overrideados con `!important` (necesario porque sonner usa CSS-in-JS) para matchear el DS:
- Sin radius, fondo elevated, borde 1px.
- Position bottom-right.
- Variants success/error con bg/border de `--color-success` / `--color-accent-subtle`.

#### Hooks mutation (`use-users.ts` extendido)
- **`useCreateUser`**: `POST /tenant/users`. On success: invalida `users-list` + `users-list-dashboard` (KPI count del dashboard se refresca automáticamente).
- **`useUpdateUser(userId)`**: `PATCH /tenant/users/:id`. Invalida list + detalle del user editado. Patch parcial — solo manda los campos que cambiaron (gracias a la validación Zod en el form).

#### `CreateUserModal`
Flow completo de creación:
- 6 campos: username, password, displayName, email (opcional), phone (opcional), roleCode.
- Validación Zod local que espeja `CreateTenantUserDto` del backend (regex de username, min/max length de password 8-72, email formato).
- **Password generator**: botón con icon `RefreshCw` que genera 14 chars random (sin chars confusos como `iIlLoO0`) y los muestra en plaintext (con toggle eye/eye-off).
- **Hint dinámico del rol**: al cambiar el select, debajo aparece la descripción del rol seleccionado (`watch('roleCode')`).
- Layout responsive: email + phone en grid 2 cols en sm+.
- Server errors mapeados:
  - 409 → "Ya existe un usuario con ese username o email."
  - 400 → mensaje del backend.
  - 403 → "No tenés permiso para crear usuarios."
- Toast success/error con descripción.

#### `UserDetailDrawer` refactor + modo edit
Extraído del `users/page.tsx` a su propio archivo (`components/admin/user-detail-drawer.tsx`). Ahora soporta dos modos:

**Modo `view`** (default): muestra perfil + roles + permisos efectivos read-only (igual que Sprint 2).

**Modo `edit`** (toggle con botón "Editar"):
- Form con: status (Select con 4 opciones), displayName, email, phone.
- Username + password NO editables (cambian en otros flows).
- Validación Zod local.
- Botón "Guardar" deshabilitado si `!isDirty` (no hay cambios pendientes).
- Toast success "Cambios guardados". Si falla (409 email duplicado, 404, 403), toast error.
- Footer custom inline con Cancelar/Guardar (el footer del Drawer se oculta en mode edit).

Cierre del drawer SIEMPRE resetea a modo view (`useEffect(() => setMode('view'), [userId, open])`).

### Decisiones técnicas

1. **Validación Zod local vs DTO compartido**: el frontend tiene su propio Zod schema que espeja el `CreateTenantUserDto` del backend (regex de username, min lengths). Trade-off: 2 lugares para mantener (typo si se cambia uno). Mitigación cuando emerja: extraer schemas a `packages/shared` para que ambos importen lo mismo.

2. **Mutation con invalidación granular**: `useCreateUser` invalida `users-list` Y `users-list-dashboard`. Si solo invalidara la primera, el KPI del dashboard quedaría stale. Pattern aplicable a cualquier mutation que afecte a varias views.

3. **Optimistic update NO implementado**: la lista re-fetchea tras el mutation. Trade-off: 100-300ms de "loading" antes de ver el nuevo user. Para listas chicas (<100 users) es invisible. Si emerge necesidad UX, cambiar a `setQueryData` optimistic.

4. **Password generator client-side**: usa `Math.random` (no crypto-strong). OK para "ayudar al admin a no inventar 'admin123'" — el password real lo guarda hasheado el backend con argon2id. Si algún día generamos passwords que se distribuyen via canal externo (SMS/email), upgrade a `crypto.getRandomValues`.

5. **`Modal` vs `Drawer` como primitives separados**: usan Radix Dialog ambos pero estéticamente son distintos. Modal centrado para flows de creación/confirmación. Drawer side panel para detalle/edit en contexto de lista. Tener 2 componentes evita props complejos del estilo `<Dialog placement="center|right">`.

6. **`<select>` nativo para roles**: 6 opciones, sin búsqueda, sin multi-select. El nativo gana por simplicidad + accesibilidad + mobile UX.

7. **Toast position bottom-right**: convención de admin panels (no interfiere con UI principal). Para errores críticos podría ser top-right (más visible). MVP: todo en bottom-right.

8. **Description del rol como `hint` del select**: el admin elige rol por nombre pero ve qué hace cada uno SIN tener que abrir un help. Mejora UX significativa con 0 cost.

### Wireup en `/users` page

- Botón "Crear usuario" del header → abre `CreateUserModal`.
- Empty state cuando no hay users → CTA "Crear primer usuario" (también abre modal).
- Click en row de tabla → drawer modo view.
- Click "Editar" en footer del drawer → mode toggle a edit.
- Refresh data automática tras crear/editar (TanStack Query invalidation).

### Type-check + verificación

- `apps/web` type-check: limpio.
- Visual smoke: `/users` redirige a `/login` sin sesión (esperado), modal/drawer no renderizables sin auth.
- Verificación funcional manual: requiere backend + tenant demo provisionado. Documentado en README.

### Estado final

- **5 archivos nuevos**: constants.ts, modal.tsx, select.tsx, form-field.tsx, create-user-modal.tsx, user-detail-drawer.tsx.
- **3 archivos modificados**: layout.tsx (+Toaster), use-users.ts (+mutations), users/page.tsx (refactor).

### Próximos sprints

1. **`/wallet`**: balance + transactions table + mint/burn modals (próximo natural — mismo patrón que `/users` con form modal).
2. **`/deposits` + `/withdrawals`**: list + filtros + approve/reject buttons + audit timeline embebido.
3. **`/users` features avanzados**: roles overrides per user (sumar/quitar permisos), scope de jerarquía, reset password, force logout sessions.

---

## 2026-05-15 — Frontend Sprint 4: `/wallet` con mint/burn

**Contexto**: el operador necesita visibilidad de su balance + capacidad de fondear el sistema (mint) o ajustar errores (burn). Es la pantalla más sensible — toda mutación graba audit con `severity: high`.

### Componentes nuevos

#### Hooks (`use-wallet.ts`)
- **`useMyWallet`**: `GET /tenant/wallet/me`. `staleTime: 10s` (balance cambia con cada operación, no toleramos data vieja).
- **`useMyTransactions(limit, offset)`**: `GET /tenant/wallet/me/transactions` paginado server-side.
- **`useMint`** + **`useBurn`**: mutations `POST /tenant/wallet/{mint,burn}`. **Generan automáticamente la idempotency-key** (UUID v4 via `crypto.randomUUID()`) — el dev no tiene que pensarlo. Invalidan `my-wallet` + `my-transactions` on success.

#### UI primitive `ChipsAmountInput`
Input especializado para montos:
- Font mono + tabular-nums + tracking apretado.
- Sufijo "CHIPS" caps + tracking ancho a la derecha (absolute positioned).
- Tamaño grande (h-12) para destacar como input crítico.
- Bloqueo de chars inválidos via regex en `onChange` (no permite letras, no permite >2 decimales).
- `inputMode="decimal"` para teclado numérico mobile.

Para inputs chicos en tablas/forms compactos, sigue Input normal con prop `numeric`.

#### `MintBurnModal` (componente compartido)
Un solo componente con prop `mode: 'mint' | 'burn'`. Diferencias:
- Copy del título/descripción/CTA/warning (mint suma valor, burn destruye).
- Variant del botón (`primary` vs `danger`).
- Hook usado.

Lo demás (form, validación Zod, banner warning con `ShieldAlert`, hint con balance proyectado) es idéntico.

**Features**:
- Banner de warning rojo siempre visible al tope ("Operación crítica").
- Campo `amount` con `ChipsAmountInput` y hint dinámico que muestra el balance final post-operación.
- Campos `reason` (required, mín 3 chars) + `referenceId` opcional + `notes` opcional.
- Submit deshabilitado durante la mutation con spinner inline.
- Toast success con descripción del nuevo balance.
- Mapping de errores específicos: `INSUFFICIENT_BALANCE`, `IDEMPOTENCY_CONFLICT`, `TWO_FA_REQUIRED`, 403, 400.

#### Página `/wallet`
Composición:

1. **Header** con título display + descripción contextual + botón refrescar.
2. **Hero del balance** (grid 2:1):
   - Card grande con balance en font display 64px tabular-nums + glow rojo decorativo en esquina + meta footer (locked balance, version, wallet ID).
   - Card de acciones con 2 botones-card (Mint / Burn) con border + icon + descripción corta.
3. **Tabla de transactions** paginada (25 por página):
   - Columnas: Tipo (Badge color-coded por tipo) / Monto (con signo +/− según credit/debit) / Balance después / Motivo (truncated con title) / Fecha.
   - 12 tipos de tx mapeados a variants (mint=success, burn=danger, transfer_in=success, etc.).
   - Pager simple Prev/Next con conteo `1–25 de 200`.
   - Empty state con CTA "Hacer primer mint".

### Decisiones técnicas

1. **Idempotency-key auto-generada en el hook**, no en el componente. Razón: el componente no debería preocuparse por la key. Cada llamada a `mutate` genera una nueva. Si el usuario doble-clickea el botón, la deshabilitación con `isPending` previene el segundo submit, no la idempotency. Trade-off: si quisiéramos que un retry manual reuse la misma key (e.g. timeout de red), habría que persistirla en estado del componente y pasarla via opción.

2. **Cálculo de balance proyectado en el modal** (`computeBalanceAfter`): hace BigInt-style en cents para evitar floats. Trade-off: si el balance es muy grande (>2^53/100 ~ 90 trillions de chips), se rompe. Realista para MVP.

3. **Sin selector de target user (load/unload)** en este sprint. Razón: load/unload requieren UI para buscar/seleccionar al user destino + scope guard implications. Sprint dedicado más adelante con su propio modal.

4. **Sin 2FA flow en el modal**. El admin demo del seed no tiene 2FA enabled, así que no es bloqueante. Si tiene 2FA, el backend devuelve 400 `TWO_FA_REQUIRED` y el modal lo muestra con mensaje claro. Cuando agregemos 2FA UI completo (sprint dedicado), agregar campo `twoFaCode` al form y mostrar condicionalmente.

5. **Variant del botón burn = `danger`** (mismo color que primary, pero conceptualmente lo señaliza como destructivo). Si en el futuro queremos diferenciarlos visualmente, agregar variant `destructive` con outline rojo.

6. **`useMutation.mutateAsync` en lugar de `mutate`**. Razón: necesitamos `await` para encadenar el toast success/error. `mutate` con callbacks `onSuccess/onError` funciona pero es menos lineal. Pattern aplicable a todos los forms del proyecto.

7. **Pager simple Prev/Next** (no number-buttons). Razón: backend ya devuelve `total`, así que podríamos hacer Goto-Page. Pero para listas de movimientos que el operador navega secuencialmente, Prev/Next es suficiente y más limpio. Si emerge necesidad (e.g. "ir a la pág 47 directamente"), agregar input "ir a página".

8. **Variant del Badge por tipo de tx hardcoded**. 12 tipos del backend mapeados a 5 variants. Si se agregan nuevos tipos, hay que actualizar `TX_TYPE_VARIANT` (default `neutral`). Centralizado en un solo lugar facilita mantenimiento.

### Type-check + verificación

- `apps/web` type-check: limpio.
- Visual smoke: requiere backend levantado para ver data real. Login flow ya funciona (validado en sprint anterior con el fix del X-Tenant-Host).

### Estado final

- **3 archivos nuevos**: `lib/hooks/use-wallet.ts`, `components/ui/chips-amount-input.tsx`, `components/admin/mint-burn-modal.tsx`, `app/(admin)/wallet/page.tsx`.
- Sidebar ya tenía el item "Wallet" linkeando a `/wallet` desde Sprint 1 → ahora la página existe.

### Próximos sprints

1. **`/deposits`**: list + filtros (status, fecha) + approve/reject + audit timeline embebido.
2. **`/withdrawals`**: similar a deposits + mark-paid + mark-failed.
3. **Wallet load/unload**: modal con búsqueda de target user + scope validation.
4. **Wallet de otro user**: ruta `/users/:id/wallet` para que el cajero vea wallet de jugador.

---

## 2026-05-15 — Exports CSV transversales — decisión arquitectónica

**Contexto**: el operador necesita poder descargar las listas de cada sección (jugadores, depósitos, retiros, transactions, bonos, sorteos, liga, fraude, audit, notifs) como `.csv` para análisis externo (Excel, Google Sheets, herramientas BI).

Ya estaba mencionado en `docs/14-roadmap.md §7 Fase 4` ("Exports CSV/XLSX vía job BullMQ") pero sin detalle. Hoy lo concretamos antes de implementarlo.

**Decisión**: feature transversal con un patrón único reusable, NO sprint dedicado por entidad.

### Pattern del backend

Para cada entidad listable, un endpoint dedicado:

```
GET /tenant/<entidad>/export?format=csv&<mismos filters del list>
```

Características:
- **Mismos filters que el list endpoint** — el operador descarga lo que ve. Si filtra por status=pending, exporta solo pending.
- **Streaming response** (`text/csv` chunked) — no cargamos todo en memoria. Drizzle + postgres-js soportan cursor; iteramos batches de 1000 filas y `res.write` cada batch.
- **Formato**: CSV con header en primera línea + UTF-8 BOM (Excel respeta acentos sin pelearse). Comillas dobles en strings con coma o newline.
- **Permission dedicado** `<entidad>.export` (e.g. `users.export`, `deposits.export`). El seed lo asigna automáticamente a los roles que ya tienen `<entidad>.view_any` (admin_tenant, socio, distribuidor según corresponda).
- **Audit obligatorio**: cada export graba `actionCode='<entidad>.export'`, `severity='medium'`, metadata con `{ filters, rowCount, format }`. Permite forensics: "¿quién descargó la lista de jugadores el martes?".

### Pattern del frontend

Cada lista paginada (`/users`, `/wallet`, `/deposits`, `/withdrawals`, `/bonuses`, etc.) recibe un botón **"Exportar CSV"** en su toolbar (al lado de Refrescar):

```tsx
<Button variant="secondary" size="md" onClick={handleExport} disabled={isExporting}>
  <Download className="size-3.5" />
  {isExporting ? 'Generando…' : 'Exportar CSV'}
</Button>
```

`handleExport` hace:
1. `fetch(`/api/tenant/<entidad>/export?format=csv&<currentFilters>`, { headers: { Accept: 'text/csv' } })`.
2. `await response.blob()`.
3. `URL.createObjectURL(blob)` → trigger download con `<a href={url} download="<entidad>-2026-05-15.csv">` programático.
4. Limpia el blob URL después.

Hook centralizado `useCsvExport(entity, filters)` para no duplicar la lógica en cada page.

### Decisiones técnicas

1. **Sin job async (BullMQ) en MVP**. Razón: con streaming server-side podemos manejar exports de hasta ~50k rows en pocos segundos sin pegarle a memoria. Para exports de millones, sumar BullMQ + email post-MVP. Por ahora, el operador espera (con loading state).

2. **CSV solo, no XLSX**. XLSX requiere libs pesadas (`exceljs` o `xlsx` ~1MB). CSV se importa a Excel/Sheets sin esfuerzo. Si el cliente pide XLSX nativo en post-MVP, sumar.

3. **UTF-8 BOM al inicio del CSV**. Sin BOM, Excel en Windows abre el CSV interpretando ASCII y rompe acentos/eñes. Con BOM (`﻿`), Excel reconoce UTF-8. Trade-off: algunos parsers paranoid (Python pandas con flags estrictos) lo ven como char raro — overrideable con `dropna()` o quitar BOM.

4. **Permission separado por entidad** (no un único `reports.export`). Razón: ver users es distinto de ver wallet transactions. Algunos roles podrían ver users pero no transactions (e.g. socio viendo su red sin acceso a mov financieros). Granular > coarse.

5. **Audit con metadata del filter aplicado**. Sin esto, "el admin Y descargó toda la lista de users" se ve igual que "filtró banned y descargó". El filter en metadata permite distinguir export forensic del de operación normal.

6. **Default file naming**: `<entidad>-<tenant_slug>-<YYYY-MM-DD>.csv` (e.g. `users-demo-2026-05-15.csv`). Si el filter trae fecha, sumarla: `deposits-demo-2026-05-01-to-2026-05-15.csv`.

7. **Sin row limit duro en MVP**. El backend exporta lo que la query devuelve. Si emerge abuso (un user descargando 100M de rows), agregar `EXPORT_MAX_ROWS=100000` env var con tope.

8. **Frontend NO trae todos los rows al cliente**. El export va directo a download del browser via blob — no pasa por React state. Listas de 50k rows funcionan sin freezear el UI.

### Implementación: cuándo

**No es para Sprint 5 inmediato** — primero terminamos las páginas core (`/deposits`, `/withdrawals`, etc.) en Sprints 5-6. Después un **Sprint 7 dedicado a Exports CSV transversales** que:
1. Backend: agrega los endpoints + permission seed update + audit log entries.
2. Frontend: hook `useCsvExport` + botón en cada toolbar de lista.
3. Tests E2E del export en al menos 2 entidades (users, deposits).

Estimado: 1 sprint de ~80-120k tokens (es feature transversal, no exhaustiva — cada entidad nueva agrega ~30 LOC backend + 1 línea de botón en frontend).

### Lo que NO entró en esta decisión

- **Bulk approval / bulk operations** (aprobar 50 deposits de una): es UX distinta, sprint propio.
- **Vistas guardadas de filtros** (`saved_filters` table). Útil para "cada lunes export con estos filters" — post-MVP.
- **Exports recurrentes scheduled** ("envíame el CSV de ayer cada día a las 9am"). Requiere job scheduler + delivery por email/webhook. Post-MVP.
- **PDF reports** (e.g. balance mensual de un jugador). Distinto problema, sprint propio si el cliente lo pide.

---

## 2026-05-15 — Frontend Sprint 5: `/deposits` review queue

**Contexto**: el cajero/admin necesita una cola de trabajo para revisar depósitos y aprobarlos/rechazarlos. Es la pantalla más usada en el día a día operativo.

### Componentes nuevos

#### Hooks (`use-deposits.ts`)
- `useDeposits(filters)`: GET /tenant/deposits con `status[]`, userId, etc. `staleTime: 15s`.
- `useDepositDetail(id)`: GET /tenant/deposits/:id (incluye walletTx).
- `useApproveDeposit(id)` + `useRejectDeposit(id)`: mutations. Invalidan deposits list + detail + my-wallet + my-transactions (approve acredita la wallet del actor).

#### Primitive nuevo: `ConfirmWithReasonModal`
Modal genérico para acciones destructivas que exigen motivo. Reusable para reject deposit, reject withdrawal, mark-failed withdrawal, cancel bonus, suspend user. Textarea con counter `N/500` (rojo si >450), validación Zod inline (min 3, max 500), reset al cerrar.

#### `DepositDetailDrawer`
Acciones según status:
- pending/under_review: aprobable + rechazable.
- Resto: read-only.

UX approve: doble-click confirmation (botón cambia a "Confirmar aprobación" verde). Razón: approve es 80% del trabajo diario — modal full sería fricción excesiva. Anti-misclick sin bloquear.

UX reject: abre `ConfirmWithReasonModal` con preset (warning, placeholder).

Composición: card destacado (status badge + monto display + reason) → sección Detalle (usuario, método, ref, comprobante con link, timestamps) → sección Wallet tx linkeada (si approved).

#### Página `/deposits`
**Tabs filter rápidos**:
- **Cola** (default): pending + under_review. Lo que el operador trabaja.
- **Aprobados** / **Rechazados** / **Todos**.

**Atajo UX**: si el operador está en otra tab y hay items pendientes, header muestra "· N en cola" como link clickeable. Query separada con limit:1 para traer solo `total`.

Tabla densa con id truncado, user, monto chips/fiat, method, status badge, fecha. Click row → drawer. Animación staggered max 500ms. Pager Prev/Next.

Empty state contextualizado: tab "Cola" sin items dice "No hay depósitos pendientes — todo al día" (vibe satisfactorio).

### Decisiones técnicas

1. **Double-click confirmation para approve** (no modal). Razón: approve es 80% del flujo del cajero — modal full por cada uno = fricción. El doble click pausa sin bloquear visualmente.
2. **Reject sí va con modal de reason obligatorio** — destructivo + el reason se muestra al user en la notif `deposit_rejected` (hook backend ya implementado).
3. **`ConfirmWithReasonModal` extraído a primitive** — vamos a reusar en withdrawals (reject + mark-failed), bonuses (cancel), users (suspend). Una sola implementación con buen UX.
4. **Query separada para queue count** en lugar de leerlo del state. Razón: el state actual depende del tab. Cachea TanStack Query — si el operador alterna tabs, no re-fetchea.
5. **Backend NO devuelve username/methodCode todavía** en el list de deposits. La tipa del frontend es optimista; mientras tanto mostramos `userId` truncado. **TODO Sprint 6 backend**: agregar JOIN.
6. **Default tab = "Cola"** — el operador entra y ve LO QUE TIENE QUE HACER.
7. **Status labels en español** en el Badge para coherencia con el resto del DS.

### Estado final

- **4 archivos nuevos**: `lib/hooks/use-deposits.ts`, `components/ui/confirm-with-reason-modal.tsx`, `components/admin/deposit-detail-drawer.tsx`, `app/(admin)/deposits/page.tsx`.

### Próximos sprints

1. **Backend tweak**: JOIN users + payment_methods en `listForReview` para evitar IDs truncados en UI. ~30 LOC.
2. **`/withdrawals`** — flow casi idéntico pero con 3 acciones (approve / mark-paid / mark-failed). Reusar `ConfirmWithReasonModal`.
3. **Wallet load/unload** — con selector de target user.

---

## 2026-05-15 — Frontend Sprint 6: backend JOINs + `/withdrawals`

**Contexto**: cerrar el flow de operación financiera completo con la pantalla de retiros + completar el data shape del backend para mostrar nombres en lugar de IDs truncados.

### Backend: enriquecimiento del response

**`DepositsService.listForReview`** y **`WithdrawalsService.listForReview`** ahora hacen `LEFT JOIN` con `users` y `payment_methods`, devolviendo:

- `userUsername`, `userDisplayName` — para mostrar el nombre del jugador en la tabla.
- `methodCode`, `methodName` — para mostrar el medio de pago legible.

Cambios:
- Tipos nuevos `DepositWithRelations` y `WithdrawalWithRelations` (extends del entity base con campos opcionales).
- Backwards compat 100%: el shape del response sigue conteniendo todos los campos originales del entity, solo sumamos los enriquecidos. Los tests E2E pasan sin cambios.

### Backend: fix de tests post-`TWO_FA_POLICY_ENABLED=false`

Cuando agregamos `TWO_FA_POLICY_ENABLED=false` al `.env.local` (sprint 4 fix) para que el frontend pueda operar sin 2FA configurado, **rompimos 10 tests del suite `two-fa-policy.e2e`**: el bootstrap del test confiaba en que la policy estuviera enabled por default desde el constructor, pero la env var ahora la deja disabled.

**Fix**: el `bootstrapTestApp` ahora **forza explícito** `policy.enable()` o `policy.disable()` según el opt `enableTwoFaPolicy`, sin importar el state inicial del env var. Resultado: tests no dependen del `.env.local` de dev — el suite es self-contained.

Suite verde: **425/425**.

### Frontend

#### Hooks `use-withdrawals.ts`
- `useWithdrawals(filters)`, `useWithdrawalDetail(id)`.
- 4 mutations: `useApproveWithdrawal`, `useRejectWithdrawal`, `useMarkPaidWithdrawal`, `useMarkFailedWithdrawal`.
- Helper `invalidateAll(qc, id)` invalida list + detail + my-wallet + my-transactions de un solo lugar (las acciones afectan todas estas vistas).

#### Update `use-deposits.ts`
Tipos `userUsername`/`userDisplayName`/`methodCode`/`methodName` ahora son **`string | null`** (no `?: string | null` opcional) — el backend siempre los devuelve desde Sprint 6.

#### Primitive nuevo: `MarkPaidModal`
Distinto a `ConfirmWithReasonModal` — pide `externalRef` obligatorio (referencia bancaria) + `notes` opcional. Variant primary verde (operación positiva, no destructiva). Header muestra resumen del monto a pagar.

#### `WithdrawalDetailDrawer`
Acciones según status:
- **pending**: aprobar (doble-click) | rechazar (modal con reason).
- **approved**: marcar pagado (modal con externalRef) | marcar fallido (modal con reason).
- **paid / rejected / failed / processing**: solo view.

Diferencias vs deposits drawer:
- Approve NO mueve saldo (solo cambia status; el hold ya existe).
- mark-paid es lo que efectivamente debita la wallet (consume el hold).
- reject y mark-failed liberan el hold.
- Sección "Cuenta destino" con `<details><summary>Ver JSON</summary>` desplegable — el `targetAccount` es jsonb libre (CBU, alias, wallet address, etc.) y mostrarlo crudo en pre con monospace es lo más honesto que mostrar campos arbitrarios.

#### Página `/withdrawals`
**Tabs filter** específicos del flow de retiros (más granulares que deposits):
- **Cola** (default): solo `pending`. Lo que necesita aprobarse.
- **Por pagar**: `approved` + `processing`. Aprobados que esperan ejecución bancaria. Es la queue del operador financiero.
- **Pagados**: `paid` (los completos).
- **Rechazados/fallidos**: `rejected` + `failed`.
- **Todos**.

**2 atajos UX en el header** (vs 1 en deposits): muestra "X en cola" Y "Y por pagar" como links clickeables — ambas queues son críticas y el operador puede saltar entre ellas rápido.

**Empty states contextualizados**:
- Cola vacía: "No hay retiros pendientes — todo al día".
- Por pagar vacía: **"No hay retiros por pagar — buen momento para tomar un café"** (toque de personalidad para una queue que cuando está vacía es un win real).

### Decisiones técnicas

1. **`LEFT JOIN` en lugar de `INNER`**: si por algún motivo un `userId` referenciado en deposits no existe (e.g. user deleted with hard delete que no debería pasar pero defensivo), preferimos devolver el deposit con `userUsername: null` que perderlo. Mismo para method.

2. **Tipos backend backwards-compat 100%**: agregar fields nuevos a la response no rompe consumers viejos. El `frontend Sprint 5` ya tenía los fields como `?: string | null` optimistas — ahora los pongo `: string | null` (siempre presentes).

3. **`MarkPaidModal` separado de `ConfirmWithReasonModal`**: aunque comparten estructura visual, semánticamente son distintos:
   - Reject/MarkFailed = acción destructiva con reason → ConfirmWithReasonModal.
   - MarkPaid = acción positiva con externalRef → MarkPaidModal propio.
   Trade-off: 2 componentes vs 1 con configuración. Decisión: claridad > DRY. El día que aparezca un 3er flow distinto, evaluar abstracción.

4. **`<details>` para targetAccount**: collapse-by-default. Razón: el JSON puede ser largo (CBU + alias + holder name + bank info), y la mayoría del tiempo el operador no necesita verlo (ya pasó del review). Quien lo necesita expande. UX progresiva.

5. **Fix de bootstrap de tests con `enable()` explícito**: lección clave — los tests no deben depender del `.env.local` de dev. El bootstrap debe forzar el state inicial sin importar lo que diga la env. Pattern aplicable a CUALQUIER feature toggle del sistema.

6. **`Cola` para withdrawals = solo `pending`**, no `pending + approved` como deposits. Razón semántica: en withdrawals, `pending` y `approved` son etapas distintas con operadores potencialmente distintos (el cajero aprueba, el cajero financiero paga). Separar las tabs deja cada workflow claro.

### Type-check + verificación

- `apps/api` build: limpio.
- `apps/web` type-check: limpio.
- Backend test suite: **425/425 verde** post-cambios + bootstrap fix.

### Estado final

- **2 archivos backend modificados**: `deposits.service.ts`, `withdrawals.service.ts`.
- **1 archivo backend test modificado**: `bootstrap-test-app.ts`.
- **5 archivos frontend nuevos**: `lib/hooks/use-withdrawals.ts`, `components/admin/mark-paid-modal.tsx`, `components/admin/withdrawal-detail-drawer.tsx`, `app/(admin)/withdrawals/page.tsx`.
- **1 archivo frontend modificado**: `lib/hooks/use-deposits.ts` (tipos).

### Próximos sprints

1. **Wallet load/unload**: con selector de target user (autocomplete sobre `/tenant/users`). Pattern: Modal tipo MintBurnModal pero con campo "Target user" arriba.
2. **`/users/:id/wallet`**: ruta dedicada para que el cajero vea wallet de un jugador desde su detalle. Reusable como subcomponente.
3. **`/bonuses`**: list + grant manual + cancel. Patrón claro de los anteriores.
4. **`/audit`**: timeline + filters por action_code + actor. La pantalla de forensics.
5. **Sprint 7 dedicado a Exports CSV transversales** (anotado en roadmap).

---

## 2026-05-15 — Frontend Sprint 7: Wallet load/unload + `/users/:id/wallet`

**Contexto**: cerrar el ciclo del wallet del operador con la capacidad de transferir chips a/desde otros usuarios (load/unload del backend) + ruta dedicada para que el cajero/admin vea la wallet de un jugador y opere desde ahí.

### Backend

**Endpoint nuevo `GET /tenant/wallet/user/:userId/transactions`** — análogo a `/me/transactions`, permission `wallet.view_any`, reusa `WalletService.listTransactionsForUser()`. Backend test suite: **425/425 verde**.

### Frontend

**Hooks** `use-wallet.ts` extendidos: `useUserWallet`, `useUserTransactions`, `useLoad`, `useUnload`. Helper `invalidateWalletsAndTxs(qc, targetUserId?)` centraliza la invalidación cross-entity.

**Primitive `UserSelect`**: autocomplete searchable de usuarios (input + dropdown absolute). Filter client-side sobre `useUsersList()` por username/displayName/email. `excludeUserId` opcional para no listar al actor. Solo `status='active'`. Click outside / Escape cierra. Limit visible 40 con footer "+N más". Sin Radix Popover (overhead innecesario para dropdown en modal flow).

**`LoadUnloadModal`** compartido (mode load/unload) con `presetTargetUser` opcional que bloquea el selector. `reason` obligatorio en ambos modos (consistencia + audit). Mapping de errores específicos: `INSUFFICIENT_BALANCE`, `IDEMPOTENCY_CONFLICT`, `SELF_TRANSFER`, `TARGET_NOT_FOUND`, `OUT_OF_SCOPE`.

**Página `/users/[id]/wallet`**: breadcrumb + header con avatar grande + status badge + hero balance (sin glow rojo, no es la wallet propia) + 2 botones Load/Unload con preset + tabla transactions paginada. Si el user es el actor mismo, botones disabled con hint.

**Updates**:
- `/wallet` page: 2 botones nuevos en acciones (4 totales: Mint/Burn/Load/Unload). Refactor `<ActionButton>` extraído.
- `UserDetailDrawer`: botón "Ver wallet" en footer linkea a `/users/:id/wallet`.

### Decisiones técnicas

1. **`UserSelect` sin Radix Popover** — dropdown manual con click-outside es más liviano para 6-50 opciones en modal flow.
2. **Filter client-side** sobre lista completa de users. Trade-off MVP — sumar `?search=` server-side cuando emerja >5000 users.
3. **`excludeUserId`** filter en UI para evitar el roundtrip al backend en self-transfer (que igual rechaza con 409).
4. **Solo `status='active'`** en dropdown (cargar/retirar a banned casi siempre es error operativo).
5. **`presetTargetUser` bloquea selector** (UX: si llegaste por la ruta de un user, ya elegiste).
6. **`reason` obligatorio en load** aunque backend lo permita opcional (consistencia + audit).
7. **Botones disabled vs ocultos** cuando el user es el actor — hint > esconder evita confusión.
8. **Helper `invalidateWalletsAndTxs`** centralizado — pattern para mutations cross-entity.

### Estado final

- **1 archivo backend modificado** (`wallet.controller.ts` con endpoint nuevo).
- **3 archivos frontend nuevos**: `components/ui/user-select.tsx`, `components/admin/load-unload-modal.tsx`, `app/(admin)/users/[id]/wallet/page.tsx`.
- **3 archivos frontend modificados**: `lib/hooks/use-wallet.ts` (4 hooks nuevos), `app/(admin)/wallet/page.tsx`, `components/admin/user-detail-drawer.tsx`.

### Próximos sprints

1. **`/bonuses`**: list + grant manual (modal con UserSelect, definitionId, amount, reason) + cancel.
2. **`/audit`**: timeline + filters. Pantalla de forensics.
3. **Sprint dedicado de Exports CSV transversales** (roadmap §7).
4. **Backend tweak**: `?search=` server-side en `/tenant/users` para escalar `UserSelect`.

---

## 2026-05-15 — Frontend Sprint 8: `/bonuses` + `/audit`

**Contexto**: cerrar las dos pantallas de "ops + compliance" del panel — la cola de bonos otorgados (con grant manual y cancel) y el audit log append-only del tenant. Con esto, el panel admin queda funcionalmente completo para el flujo cajero/admin pre-launch.

### Backend

**Endpoint nuevo `GET /tenant/bonuses`** — list de `user_bonuses` del tenant con filtros `statuses[]`, `userId`, `definitionId`, paginado offset/limit. Service expone `listAll()` con LEFT JOIN a `users` y `bonus_definitions` para enriquecer la fila con username/displayName y code/name/type del bono (evita N+1 en la UI). Permission `bonuses.view_any`. Backend test suite: **425/425 verde**.

### Frontend

**Hooks `use-bonuses.ts`**: `useBonuses(filters)`, `useBonusDetail(id)`, `useActiveBonusDefinitions()` (para el dropdown del grant modal), `useGrantBonus()` con idempotency-key auto-generada e invalidación cross-entity (bonuses + wallet del actor + wallet del target + sus respectivas tx), `useCancelBonus(id)`.

**`GrantBonusModal`**: UserSelect (excluyendo al actor) + `<Select>` de definitions activas + ChipsAmountInput + `reason` con Zod min 10 chars + regex `[a-zA-Z]{3,}` (anti-`abc`/`test`, espeja regla del backend) + notes opcionales. Banner de info "Audit severity:high" recordando que si el target está en cluster confirmado de fraude el sistema advierte (no bloquea — el cajero decide). Mapping de errores: `BONUS_DEFINITION_NOT_ACTIVE`, `FUNDER_INSUFFICIENT_BALANCE`, `GRANT_IDEMPOTENCY_CONFLICT`, `OUT_OF_SCOPE`, 429 rate-limit. Si la respuesta trae `fraudWarning: true`, dispara toast warning adicional.

**Página `/bonuses`**: header + 5 tabs (Activos / Liberados / Cancelados / Expirados / Todos) + tabla densa (Usuario / Bono / Otorgado / Remaining / Estado / Fecha) + columna inline con botón Cancel (icono Ban) solo cuando `status` es active/pending. Click en Cancel abre `ConfirmWithReasonModal` reusable. Empty state con CTA "Otorgar primer bono" si la tab activa está vacía.

**Hooks `use-audit.ts`**: `useAuditLog(filters)` único hook (audit es append-only — no hay mutations). Filtros: `actorUserId`, `actionCode` exacto, `actionCodePrefix`, `targetId`, `fromDate`/`toDate` (ISO), `limit`/`offset`, `order`. `placeholderData: prev` para evitar flash en cambios de página/filtro.

**Página `/audit` (timeline, no tabla)**: header + tabs por dominio (Wallet / Bonos / Depósitos / Retiros / Usuarios / Permisos / Auth-2FA / Fraude / Tenant / Ligas / Promos / Todos) + barra de filtros (action_code exacto, actor UUID, target UUID, from/to datetime-local, page size 50/100/200 + botón "Limpiar filtros") + lista vertical estilo timeline: cada row tiene timestamp en mono a la izquierda, dot de color según dominio/severidad, badge con `actionCode`, rol del actor, `@username → targetType:targetId`, reason en cursiva. Click en row abre Drawer con detalle completo: actor, target, timestamp full, reason, before/after en `<pre>` JSON crudo, metadata en `<pre>`, contexto request (ip/requestId/sessionId/impersonator/userAgent).

### Decisiones técnicas

1. **`listAll()` con LEFT JOIN en backend** — el panel necesita username y nombre de bono inline; un endpoint separado por filas implicaría N+1. Mismo patrón que `/deposits` y `/withdrawals` del Sprint 6.
2. **Reason en grant modal con regex anti-abuso** — espeja la validación del backend (`min 10` + `[a-zA-Z]{3,}`) para fail fast en cliente. El servidor sigue siendo la fuente de verdad.
3. **Audit como timeline, no tabla** — la auditoría se lee cronológicamente; la timeline con dots de color comunica eso mejor que una grilla densa. Trade-off: más vertical scroll, pero el dominio lo justifica.
4. **Tabs por prefijo de dominio en `/audit`** — el `actionCodePrefix` LIKE del backend ya soporta esto. Mapeo client-side `id → prefix` evita coupling con la lista exacta de codes (cuando el backend agrega un nuevo `wallet.X`, ya queda dentro del filtro).
5. **`DANGER_ACTION_KEYWORDS`** — keywords que pintan la entry roja aunque el dominio sea neutro (cancel/reject/revoke/burn/unload/force_clear/fraud_*). Heurística simple, suficiente para el MVP. Si crece, mover a una tabla `severity` por action_code.
6. **JSON crudo en el drawer** — el backend graba `before`/`after`/`metadata` como `jsonb` libre por action_code. Renderizar bonito requeriría schemas por código; mostrar `<pre>` con `JSON.stringify(_, null, 2)` es honesto y debugeable.
7. **Page size 50/100/200** — backend cap en 200; ofrecemos los 3 para que el usuario elija detalle vs scroll.
8. **`placeholderData: (prev) => prev` en `useAuditLog`** — evita flash entre páginas y al cambiar filtros (TanStack Query v5 pattern).
9. **Sin export CSV en estas páginas** — queda para el sprint dedicado de exports transversales (roadmap §7).

### Estado final

- **2 archivos backend modificados**: `bonuses/user-bonuses.service.ts` (interface `UserBonusWithRelations` + método `listAll`), `bonuses/user-bonuses.controller.ts` (endpoint `GET /tenant/bonuses`).
- **4 archivos frontend nuevos**:
  - `lib/hooks/use-bonuses.ts`
  - `lib/hooks/use-audit.ts`
  - `components/admin/grant-bonus-modal.tsx`
  - `app/(admin)/bonuses/page.tsx`
  - `app/(admin)/audit/page.tsx`
- **Type-check `@casino/web`**: verde.

### Próximos sprints

1. **Sprint dedicado de Exports CSV transversales** (roadmap §7) — botón "Export CSV" en `/users`, `/deposits`, `/withdrawals`, `/bonuses`, `/audit` (este último es el más jugoso para compliance).
2. **Backend tweak**: `?search=` server-side en `/tenant/users` para escalar `UserSelect` (>500 users).
3. **`/permissions`**: UI de permission overrides (grant/revoke por user con cascada). Pendiente desde el principio del frontend pero no crítico para MVP.
4. **`/fraud`**: queue de clusters detectados con confirm/dismiss + scan manual.

---

## 2026-05-15 — Sprint 9: Exports CSV transversales

**Contexto**: cerrar el feature de "exportar listado a CSV" pendiente desde roadmap §7. Cubre las 6 entidades visibles del panel admin (users, deposits, withdrawals, wallet/transactions, bonuses, audit_log). Cada export debe respetar los mismos filtros del listado, registrar audit entry para forensics, y descargar el CSV directamente en el browser sin cargar todo en memoria del frontend.

### Backend

**Permissions nuevos (5)** en `packages/db/src/seeds/tenant-seed.ts`:
- `wallet.export`, `users.export`, `deposits.export`, `withdrawals.export`, `bonuses.export`. (`audit.export` ya existía desde el seed inicial.)
- Marcados `auditRequired: true`. Delegables todos excepto `audit.export` (compliance crítica → solo admin_tenant por default; otros roles necesitan override explícito).
- El seed asigna TODOS los permisos a `admin_tenant` automáticamente (loop `allPerms`), así que el demo admin queda con los 6 export sin tocar nada más.

**Helper compartido `apps/api/src/common/csv.ts`**:
- `buildCsv<T>(columns, rows)`: arma string CSV completo (RFC 4180) con BOM UTF-8 (Excel/Sheets respetan acentos). Sin libs externas — el escape de quotes/commas/newlines es chico y nuestras necesidades son fijas.
- `csvCell(value)`: escapa una celda; maneja Date → ISO 8601, null/undefined → '', boolean → 'true'/'false', object → JSON.stringify, BigInt → toString.
- `buildCsvFilename(entity, tenantSlug?)`: convención `<entity>_<tenant>_<YYYY-MM-DD_HHmmss>.csv`.
- `CSV_EXPORT_MAX_ROWS = 50_000`: cap de seguridad. Más que eso requiere job async (post-MVP).

**Endpoints nuevos (7 — wallet expone 2: me + user/:id)**:
- `GET /tenant/audit-log/export` — `audit.view` + `audit.export`. Mismos filtros que list (actorUserId, actionCode, actionCodePrefix, targetId, fromDate, toDate, order). Records `audit.export` en audit_log con metadata `{ rowCount, totalMatched, truncated, filters, severity:'medium' }`.
- `GET /tenant/bonuses/export` — `bonuses.export`. Reusa `service.listAll` con limit alto (los bonos suelen ser pocos por tenant). Records `bonus.export`.
- `GET /tenant/deposits/export` — `deposits.export`. Nuevo método `service.listForExport()` que NO aplica el cap de 200 (el list normal sigue capped). Records `deposits.export`.
- `GET /tenant/withdrawals/export` — `withdrawals.export`. Mismo patrón que deposits. Records `withdrawals.export`.
- `GET /tenant/users/export` — `users.export`. Query inline en el controller (sin service helper porque el list base es trivial). NUNCA expone `passwordHash`, `twoFaSecret` ni recovery codes. Records `users.export`.
- `GET /tenant/wallet/me/transactions/export` — `wallet.export`. Nuevo `service.listTransactionsForExport(userId, maxLimit)`. Records `wallet.export.me`.
- `GET /tenant/wallet/user/:userId/transactions/export` — `wallet.export` + `wallet.view_any`. Records `wallet.export.user` con `targetId: userId` para forensics ("admin X exportó wallet de user Y a las Z").

**Tests E2E** (`apps/api/test/e2e/csv-exports.e2e.ts`):
- 12 tests verdes (2 por entidad: 403 sin permiso + 200 admin con CSV bien formado + audit entry registrada).
- Helper `assertCsvShape(body, expectedHeaderToken)` chequea BOM UTF-8 (`charCodeAt(0) === 0xfeff`) + presencia del header de columnas.
- Helper `countAuditEntries(actionCode)` valida que el audit se grabó.
- Test específico para users.export verifica que el body NO contenga `password_hash` ni `two_fa_secret` (defensa por aserción negativa).
- **Suite total: 437/437 verde** (425 anteriores + 12 nuevos).

### Frontend

**Hook `lib/hooks/use-csv-export.ts`**:
- `useCsvExport({ path, params, filenameHint })` retorna `{ download, isLoading, error }`.
- `download()`: fetch directo (NO va por `apiGet` del cliente porque necesita blob no JSON), arma URL con `URLSearchParams`, headers `Accept: text/csv` + `X-Tenant-Host` + `Authorization`. Si !ok → tira `CsvExportApiError` tipado con status + body parseado.
- Trigger de descarga: `URL.createObjectURL(blob)` → `<a download>` invisible → click programático → `URL.revokeObjectURL` en setTimeout 0 (cleanup safe).
- Filename del header `Content-Disposition` parseado con regex (Express manda quoted); fallback al `filenameHint` + timestamp si falla.
- NO usa TanStack Query — el resultado es un side-effect (descarga al disco), no datos cacheables.

**Componente `components/ui/csv-export-button.tsx`**:
- `<CsvExportButton path params filenameHint entityLabel />`. Wraps `useCsvExport` + `<Button>` + toasts (sonner) + spinner durante isLoading.
- Mapping específico de errores: 403 → "No tenés permiso para exportar X", 401 → "Sesión expirada", 0 → "Error de conexión", otro → message del backend.

**Wireup en 6 (7) páginas**:
- `/audit`: pasa todos los filtros activos (prefix, action_code, actor, target, from/to, order).
- `/bonuses`: pasa `statuses` de la tab activa.
- `/deposits`: pasa `status` de la tab activa.
- `/withdrawals`: pasa `status` de la tab activa.
- `/users`: sin filtros (el list page hace search/filter client-side; el export devuelve todos).
- `/wallet` (propio): export del wallet del actor.
- `/users/[id]/wallet`: export del wallet del user mostrado, con path dinámico `/tenant/wallet/user/${userId}/transactions/export`.

### Decisiones técnicas

1. **Sin libs externas para CSV**: la spec RFC 4180 es chica y el helper es ~60 LOC. Una lib (papaparse/csv-stringify) agregaría 30k+ al bundle del backend sin beneficio real para nuestro shape de datos.
2. **BOM UTF-8 en cada export**: Excel sin BOM asume Windows-1252 y rompe acentos. Sheets/LibreOffice no lo necesitan pero lo toleran. Costo: 3 bytes. Beneficio: usabilidad para ops AR/LATAM.
3. **In-memory build (no streaming)**: cap a 50k rows. Para los volúmenes esperados del MVP (<10k transactions/depósitos por tenant en piloto) es suficiente. Streaming con Readable+pipe es refactor de 1 commit cuando se necesite.
4. **Audit por export**: cada descarga graba entry con `severity:'medium'` + metadata `{ rowCount, totalMatched, truncated, filters }`. Permite forensics tipo "qué admin descargó qué data y cuándo" (compliance + GDPR/data export tracking).
5. **`audit.export` NO delegable**: por seed `isDelegatable: false`. El audit log es la fuente de verdad de seguridad — exportarlo permite scrape masivo. Solo admin_tenant lo tiene por default; cualquier otro rol lo necesita via override explícito (logueado a su vez con `permissions.grant`).
6. **Wallet export con 2 endpoints separados** (me + user/:id) en lugar de uno con scope dinámico: cleaner permissions (`wallet.export` para propio, `wallet.export + wallet.view_any` para otros) + audit codes diferentes (`wallet.export.me` vs `wallet.export.user`) facilitan forensics.
7. **Service `listForExport` separado de `listForReview`**: el cap de 200 del list normal es defensa contra DoS accidental del panel; el export tiene su propio cap de 50k via parámetro explícito. No quise reutilizar/parametrizar el cap del list para no complicar la API.
8. **Frontend hook NO usa TanStack Query**: los downloads son side-effects no-cacheables. `useState` simple + función async es suficiente.
9. **`X-Total-Rows` + `X-Truncated` en response headers**: visibles en DevTools para debugging, no obligatorios para el flow de download.
10. **Sin retry en frontend**: si el export falla, el toast lo informa y el user re-clickea. Retry automático en una descarga grande es mala UX (puede duplicar el audit log, gastar cuota, etc.).

### Estado final

- **Backend modificado**: 6 archivos.
  - `packages/db/src/seeds/tenant-seed.ts` (5 perms nuevos).
  - `apps/api/src/common/csv.ts` (helper nuevo).
  - `apps/api/src/audit/audit-log.controller.ts` (endpoint export).
  - `apps/api/src/bonuses/user-bonuses.controller.ts` (endpoint export).
  - `apps/api/src/deposits/{controller,service}.ts` (endpoint export + listForExport).
  - `apps/api/src/withdrawals/{controller,service}.ts` (endpoint export + listForExport).
  - `apps/api/src/tenant-users/tenant-users.controller.ts` (endpoint export).
  - `apps/api/src/wallet/{controller,service}.ts` (2 endpoints export + listTransactionsForExport).
- **Test nuevo**: `apps/api/test/e2e/csv-exports.e2e.ts` (12 tests).
- **Frontend nuevo**: 2 archivos.
  - `apps/web/lib/hooks/use-csv-export.ts`.
  - `apps/web/components/ui/csv-export-button.tsx`.
- **Frontend modificado**: 7 archivos (wireup del botón en cada page).
- **Test suite backend**: 437/437 verde (12 nuevos).
- **Type-check `@casino/web`**: limpio.

### Próximos sprints

1. **Backend tweak**: `?search=` server-side en `/tenant/users` para escalar `UserSelect` (>500 users).
2. **`/permissions`**: UI de permission overrides (grant/revoke por user con cascada).
3. **`/fraud`**: queue de clusters confirmados/dismissed + scan manual.
4. **CSV export para entidades restantes** (cuando se construyan en frontend): notifications, leagues, promotions, fraud links, etc. — el patrón ya está armado, solo es replicar.

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
