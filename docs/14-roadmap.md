# 14 · Roadmap

> Estado: **vivo**. Las fechas son guía, los entregables son el commitment. Se actualiza al cierre de cada fase.

Ruta de implementación de la plataforma desde cero hasta GA, considerando contexto real:
- **Solo** + agentes IA (Claude Code, opencode, Cursor).
- **Part-time** (~15-20 hs/semana).
- **Budget mínimo** (free tiers / open source / self-hosted).
- **MVP en 6 meses**, beta el mes 7.
- **Piloto inicial = el propio dueño** → MVP es validación funcional, no operación real.
- **Mock game provider durante todo MVP**. Provider real y propio sportsbook fuera de scope MVP.

---

## 1. Filosofía

| Principio | Implicación |
|---|---|
| **Funciona end-to-end antes que pulido** | Cada fase produce un slice vertical que funciona, aunque feo. Polish al final. |
| **Producible-no-producción** en MVP | El MVP corre en un VPS chico, soporta 1-2 tenants, 100 usuarios. Suficiente para piloto. |
| **AI agents = leverage real** | Agentes hacen 60-80% del código boilerplate. El humano pone arquitectura, decisiones de negocio, debugging fino. |
| **Documentación primero** | Todo lo que está en `/docs` ya destrabó decisiones. Implementación es ejecución sobre eso. |
| **Mock antes que integraciones reales** | Game provider, KYC provider, pasarelas de pago: todo mock hasta validar internamente. |
| **MVP cerrado** | Cuando algo no es MVP, va a la lista post-MVP. No scope creep. |
| **Cierre de fase = decisión binaria** | "¿La fase está hecha?" Sí/No. Si no, no se avanza a la siguiente sin razón explícita. |

---

## 2. Fases — visión global

```
Mes 1   Mes 2   Mes 3   Mes 4   Mes 5   Mes 6   Mes 7+
│       │       │       │       │       │       │
▼       ▼       ▼       ▼       ▼       ▼       ▼
Setup   Auth+   Wallet  Panels  Juegos  Polish  Beta cerrada
Founda  Permis  Depós./ Operac. Engage  + bug   con piloto
tion    os      Retiros        ment    fix     (vos mismo)
                                                │
                                                ▼
                                        Mes 8+: post-MVP
                                        (game provider real,
                                         v1 features, etc.)
```

---

## 3. Fase 0 — Setup (semana 1–2)

### Objetivo
Repositorio listo, infra de dev funcionando, primer push verde.

### Entregables
- ✅ Monorepo Turborepo + pnpm workspaces.
- ✅ Apps stub: `apps/web`, `apps/panel`, `apps/api`.
- ✅ Packages base: `packages/types`, `packages/ui`, `packages/db`, `packages/permissions`, `packages/config`.
- ✅ Docker Compose local: Postgres 16 + Redis + MinIO + Caddy.
- ✅ Pre-commit hooks (lint, format, type-check, secrets scan).
- ✅ CI básico (GitHub Actions): lint + test + build en cada PR.
- ✅ `tsconfig` estricto + ESLint + Prettier compartidos.
- ✅ AGENTS.md / CLAUDE.md / README ya existen, actualizar al estado real.

### Salida
Repo verde corriendo en local. Push a `main` deploya a staging (Coolify en VPS) en una sola pasada.

---

## 4. Fase 1 — Foundation (mes 1)

### Objetivo
Auth funcionando + multi-tenant skeleton + DB de control + provisioning de tenant.

### Entregables
- **DB de control** (`platform_control`) creada con tablas: `tenants`, `tenant_domains`, `tenant_plans`, `platform_users`, `platform_audit_log`, `commission_settings`.
- **Tenant Resolver middleware** — detecta dominio → carga tenant context.
- **Pool de pools (LRU)** para conexiones a DBs de tenants.
- **Job `provision-tenant`** crea DB nueva, aplica migraciones, seeds, crea Admin Tenant inicial.
- **Job `warmup-tenant`** post-provision.
- **Auth completo**:
  - Login con username/email/teléfono.
  - Registro con checkbox de mayoría de edad.
  - JWT (15 min) + refresh tokens rotativos (30 días).
  - Cookies httpOnly + sameSite + secure.
  - Recovery password por email.
  - Password hashing Argon2id.
- **Sessions** visibles al usuario, "cerrar todas".
- **2FA TOTP** activable + email codes como fallback.
- **Audit log** estructura básica (sin frontend todavía).
- **Healthcheck endpoints** (`/health`, `/readyz`).
- **Tests de integración** sobre auth y multi-tenant.

### Fuera de scope esta fase
- Permisos atómicos (próxima fase).
- Roles custom.
- Impersonate.
- Frontend de auth pulido (basic estética acá).

### Salida
Vos podés levantar el sistema, crear un tenant nuevo desde un script, loguearte como Admin Tenant, ver tu sesión, activar 2FA. Todo end-to-end.

---

## 5. Fase 2 — Identidad y Permisos (mes 2)

### Objetivo
Sistema de jerarquía, roles, permisos atómicos y delegación operativos.

### Entregables
- **Catálogo de permisos** (`permissions`) seedeado con todos los códigos definidos en `docs/03-jerarquia-roles.md §4`.
- **Roles base** (`admin_tenant`, `socio`, `distribuidor`, `cajero`, `empleado`, `usuario_final`) con permisos defaults.
- **`user_roles` + `user_permission_overrides` + `user_hierarchy`** funcionando.
- **Cálculo de permisos efectivos** (`packages/permissions`) con caching en Redis.
- **Validación en backend**: guards de NestJS `RequirePermissions` + `RequireScope`.
- **Delegación con techo**: validador que rechaza grant de permisos que el actor no tiene.
- **Cascada al revocar**: job que itera `granted_by_chain` y propaga revokes.
- **Permisos no-delegables** (flag `is_delegatable`).
- **Empleados del Socio** con scope limitado.
- **CRUD de usuarios** desde el panel del Admin Tenant.
- **Asignación de roles + overrides** desde panel.
- **Modo Impersonate** con doble auditoría.
- **Audit log** con frontend (panel del Admin Tenant ve timeline).
- **Seguridad reforzada para Admin Tenant**:
  - 2FA obligatorio.
  - Alertas de login por email.
  - Re-autenticación para acciones críticas.
  - Detección de impossible travel + device nuevo.

### Fuera de scope
- Roles custom (v2).
- Vista mapa interactivo de jerarquía (v2).

### Salida
Crear/editar usuarios con roles. Asignar permisos individuales. Revocar con cascada visible. Impersonate funcional con auditoría doble.

---

## 6. Fase 3 — Wallet y Operación Financiera (mes 3)

### Objetivo
Wallet completo + cargas manuales + depósitos autoservicio + retiros funcionando.

### Entregables
- **Tablas wallet**: `wallets`, `wallet_transactions` (particionada), `wallet_holds`, `idempotency_keys`.
- **Servicio Wallet** con todas las operaciones (`mint`, `burn`, `load`, `unload`, `transfer_in/out`, `bonus_grant/clear`, etc.) — TX Postgres, optimistic locking, idempotencia.
- **Mint/Burn** restringido a Admin Tenant + 2FA + audit log severidad alta.
- **Carga manual de cajero** end-to-end con scope + saldo del cajero como constraint.
- **Depósitos autoservicio**:
  - Solicitud desde sitio jugador.
  - Subida de comprobante a R2.
  - Cola en panel del cajero/empleado asignado.
  - Aprobar / rechazar con motivo.
  - Wallet tx generada al aprobar.
  - Max 2 pending por usuario.
- **Retiros**:
  - Solicitud desde sitio jugador con `target_account` (CBU/wallet).
  - Wallet hold inmediato.
  - Cola de aprobación.
  - Marca como `paid` con `external_ref` cuando se transfiere fuera.
  - Max 2 pending por usuario.
- **Métodos de pago configurables** por tenant (transferencia ARS + USDT TRC-20).
- **Verificación cripto manual** (sin TronGrid en MVP, todo aprobación humana).
- **Reservas para promos** (`promo_fund_reservations`) — backbone listo aunque no haya promos todavía.
- **Conciliación** básica (job nocturno que calcula totales por tenant + alerta si discrepancia).

### Fuera de scope
- Verificación cripto automática (TronGrid) — v1.
- Antifraude OCR de comprobantes — v1.

### Salida
Vos podés simular el ciclo completo: usuario deposita → cajero aprueba → usuario juega (mock) → solicita retiro → admin aprueba → marcamos pagado. Todo trazable.

---

## 7. Fase 4 — Paneles y Soporte (mes 4)

### Objetivo
Panel admin completo + panel cajero mobile + panel socio + livechat.

### Entregables
- **Layout shadcn/ui completo**: sidebar + topbar + breadcrumbs + temas (dark default + light switch).
- **Panel del Admin Tenant** (todas las secciones del `docs/10-panel-control.md §5.2`):
  - Dashboard maestro con widgets en vivo.
  - Usuarios, Wallet, Depósitos, Retiros, Apuestas, Auditoría, Solicitudes unificadas, Reportes, Configuración, Integraciones.
  - Vista "Empleados" global, "Actividad de Socios".
- **Panel del Cajero mobile-first**:
  - Cargar fichas en 2 taps.
  - Solicitudes asignadas con comprobante.
  - Lista de jugadores propios.
  - Saldo y movimientos propios.
- **Panel del Socio**:
  - Dashboard de su red.
  - Mis links (sin lógica de comisiones todavía, eso en fase 5).
  - Mis distribuidores y cajeros.
  - Solicitar cargas a sus cajeros.
- **Panel del Distribuidor + Empleado**: subset según permisos.
- **Búsqueda global ⌘K** con Postgres FTS.
- **Notificaciones real-time** vía Socket.io.
- **Exports CSV transversales** — cada listado paginado (usuarios,
  depósitos, retiros, transactions de wallet, bonos, sorteos, liga,
  links de fraude, audit log, notificaciones) tiene un botón
  "Exportar CSV" en su toolbar. Implementación:
  - Backend: endpoint `GET /tenant/<entidad>/export?format=csv&...filters`
    que respeta los mismos filters que el list, devuelve `text/csv`
    streamed (no carga todo en memoria).
  - Frontend: botón con icon `Download` al lado de Refrescar.
    Hace `fetch` con `Accept: text/csv`, response → blob → `URL.createObjectURL`
    → trigger download con `<a download>` programático.
  - Audit: cada export graba entry en audit_log con
    `actionCode='<entidad>.export'`, `severity='medium'`, metadata con
    el filter aplicado y row count del resultado. Permite forensics
    sobre qué admin descargó qué data.
  - Permission: `<entidad>.export` (e.g. `users.export`, `deposits.export`).
    Por default todos los roles que tienen `<entidad>.view_any` reciben
    también el export — el seed lo pre-asigna.
  - Para volúmenes grandes (>10k rows) o archivos pesados, sumar job
    async con BullMQ + email "tu export está listo" en post-MVP.
- **Filtros avanzados** en listados, paginación cursor-based.
- **Atajos de teclado** estilo Linear.
- **Helper `<Can>`** para gating declarativo.
- **`user_preferences`** (tema, densidad, locale, notifs).
- **Livechat widget nativo** en `apps/web` (Socket.io, sin Kommo todavía).
- **Cola de chats en panel** con asignación automática + escalado.
- **Conexión a Kommo** vía OAuth con sync básica (lead creation + mensajes).
- **Eventos auto sincronizados con Kommo** (registro, FTD, retiro, etc.).
- **Frontend de auditoría** con timeline + filtros.

### Fuera de scope
- Vista mapa interactivo de jerarquía (v2).
- Vistas guardadas (v2).
- Bulk approval (v2).
- Integración Chatwoot (post-MVP).

### Salida
Toda la operación se puede manejar desde el panel. Soporte funciona vía livechat nativo + Kommo en paralelo.

---

## 8. Fase 5 — Juegos y Engagement (mes 5)

### Objetivo
Mock provider funcionando + lobby + bonos básicos + referidos básicos.

### Entregables
- **`IGameProvider` contract** + **MockGameProvider** que ya incluye un **mini-Crash funcional con math + provably fair** (decisión locked: aprovechar MVP para aprender los conceptos que se reutilizan en juegos propios v1+):
  - 5-10 slots simulados con RNG simple (resultados al azar, sin math).
  - 1-2 mesas live simuladas (placeholder visual).
  - **1 mini-Crash con math model real** (RTP 99%, simulación validada).
  - **Provably fair completo** (commit-reveal con hash chain) en el mini-Crash.
  - RGS skeleton (`apps/rgs`) sirviendo el mini-Crash. Slots y mesas mock siguen viviendo en backend principal.
  - launchGame retorna iframe a `/games/mock-<juego>` con simulación.
  - Cumple wallet API (bet/win/rollback).
  - Cuando llegue v1 (Crash propio "real"), se extiende el mini-Crash en lugar de empezar de cero.
- **Wallet API que exponemos al provider** con HMAC + nonce + idempotency.
- **Lobby completo**:
  - Home con destacados, más jugados, recién agregados, jackpots calientes.
  - Categorías: slots, casino vivo, mesa, crash.
  - Agrupación por proveedor.
  - Búsqueda + filtros.
- **Sesiones de juego** + **rounds** persisten correctamente.
- **Modo demo** activable por tenant.
- **Round history + replay** (link al replayer del provider).
- **Sistema de bonos**:
  - Bono de bienvenida + bono manual + bono por referido.
  - Wagering tracking.
  - Panel "Bonos activos" en admin.
  - Funder = creador (`bonus_definitions.funded_by_user_id`).
- **Sistema de referidos básico**:
  - `referral_codes` con múltiples por Socio.
  - Atribución last-touch + cookie 90 días + manual code.
  - Fallback a Admin Tenant ("Socio madre").
  - Defensas D1 (device/IP) + D5 (rate limit registros) + D6 (FTD autoservicio).
  - **Comisión calculada y mostrada** en panel del Socio (sin payout automático todavía).
  - Bono al referido / al referente configurable.
- **Auto-exclusión + límites de juego responsable** (deposit, bet, loss, cool-off).
- **Antifraude transversal**:
  - Detección de impossible travel + device nuevo (login).
  - Velocity checks en depósitos.
  - Mismo método de pago en N cuentas → flag.
  - Bot detection en registros (Cloudflare Turnstile).
- **Branding personalizable**:
  - Logo + favicon + tagline.
  - Hero rotativo.
  - Estructura del lobby (drag-drop de bloques).
  - Live preview + publicar atómico.
  - Versionado + rollback.
- **Email templates** (welcome, depósito aprobado, retiro pagado, etc.).
- **Custom domain** opcional (con verificación DNS + cert auto).

### Fuera de scope
- Sorteos (post-MVP).
- Liga de jugadores (post-MVP).
- Misiones, ruleta diaria, login streak, cofres (v1).
- Jackpots propios (post-MVP, jackpots de red sí porque son del provider).
- Payout automático de comisiones a Socios (post-MVP, manual primero).
- Integración con game provider externo (post-MVP, posiblemente nunca si los juegos propios alcanzan).
- **Juegos propios completos (v1+)**. Pero sí en MVP: dejar el contrato `IGameProvider` listo para que el día que llegue el primer juego propio sea solo enchufar adapter. Ver `docs/own-games/00-overview.md`.

### Salida
End-to-end demo: usuario se registra con código de Socio → recibe bono → carga fichas → juega slots mock → recibe wagering progress → cumple → cobra → solicita retiro. Socio ve su comisión proyectada en panel.

---

## 9. Fase 6 — Polish y Bug Fix (mes 6)

### Objetivo
Estabilizar lo construido. Bug-fix masivo. UX refinement. Tests más profundos. Ready para que vos lo pruebes como piloto interno.

### Entregables
- ✅ **Testing E2E** (Playwright) sobre flujos críticos — **9/9 specs
  passing verified en Sprint 39**:
  - ✅ Login + credentials inválidas + logout (3 tests).
  - ✅ Deposit autoservicio: player crea → admin aprueba → balance refleja.
  - ✅ Game loop: lobby → launch → spin → resultado visible.
  - ✅ Retiro: player crea → admin aprueba + paga → balance refleja.
  - ✅ Responsible gaming: setear caps + auto-excluirse + login bloqueado.
  - ✅ Impersonate: admin desde drawer → banner sticky → vuelve.
  - Pendiente backlog: 2FA flow, carga manual del cajero, bono manual,
    referidos. Acotado a sprints futuros.
- **Pen testing básico** (yo mismo + checklist OWASP top 10).
- ✅ **Performance testing** con k6 (Sprint 38 + validación Sprint 39):
  - ✅ **smoke** (1 VU 1min): 105 reqs, 0 errors, p95 22ms.
  - ✅ **baseline** (50 VUs 5min): 24,819 reqs, 0 errors, login p95 133ms (target <300ms), reads p95 <40ms (target <200ms), 80 req/s sostenidos.
  - ⚠️ **spike** (200 VUs 90s): 17,291 reqs, 0.03% errors (sistema sobrevive), 187 req/s peak, p95 2.3s (excede threshold aspiracional de 2s — accionable: cache /tenant/info, pool DB más grande, Redis para sessions).
  - **500 req/s sostenido del target original** no validado — baseline mostró 80 req/s con 50 VUs en dev local. Para 500 req/s necesitaríamos 300+ VUs y servidor productivo, no dev local.
- **Pulido de UI** en móviles del Cajero/Socio.
- **Strings consistentes** (tono, voz, errores en español claros).
- **Empty states** decentes en cada listado.
- **Loading states + skeletons** completos.
- **Error boundaries** por sección.
- **Accessibility checks** (contraste, navegación por teclado, screen readers básicos).
- **Documentation pass**: actualizar todos los `/docs` con decisiones tomadas durante implementación.
- **Runbooks**: disaster recovery, super-admin recovery, onboarding de tenant nuevo.
- **Backup/restore probado** una vez completo.
- 🟡 **Observabilidad operativa**: runbook `docs/runbooks/observability.md` creado en Sprint 38 con queries Postgres "qué mirar día-a-día" + alertas sugeridas + setup path para Grafana/Prometheus. Dashboards Grafana reales pendientes — emerge cuando se integre el primer cliente externo.
- **Logging redaction PII** validado.

### Salida
**MVP listo**. Vos lo levantás, creás tu propio tenant, jugás, operás. Si algo se rompe, lo identificás y arreglás. Bug-fix loop hasta estabilidad.

---

## 10. Mes 7 — Beta cerrada con piloto (vos mismo)

### Objetivo
Operar el MVP **como si fueras un cliente real**. Encontrar lo que solo aparece con uso real.

### Actividades
- Crear el tenant piloto con tu branding.
- Crear estructura: vos como Admin Tenant + 1-2 Socios de prueba (cuentas tuyas) + 2-3 cajeros de prueba + 5-10 jugadores de prueba.
- Operar 4-6 semanas con flujo "completo" simulado:
  - Cargas + depósitos + retiros (con plata simulada o reales en chico).
  - Sesiones de juego diarias.
  - Bonos activos.
  - Referidos circulando.
  - Soporte vía livechat.
  - Reportes mensuales.
  - Backup + restore real.
- Tracking de bugs + feedback en issue tracker.
- Bug-fix incremental + mejoras UX.
- Identificar **gaps no documentados** y agregarlos al roadmap post-MVP.

### Salida
- Lista priorizada de mejoras para v1.
- MVP probado en condiciones reales por vos.
- Confianza para mostrar a primer cliente externo.

---

## 10.5. Backlog operativo post-MVP del panel (Sprint 23+)

> **Sección viva**. Se actualiza a medida que descubrimos gaps testeando con usuarios reales o el dueño. Prioridad P0 = bug funcional (rompe el modelo de negocio), P1 = falta feature definida en docs, P2 = UX/polish.

### P0 — Bugs funcionales / scope

#### ✅ ~~Scope de jerarquía en `/tenant/deposits`, `/tenant/withdrawals` y `/tenant/bonuses`~~ (Sprint 23 — cerrado)
- **Resuelto** en commit del 2026-05-18. Backend: 3 perms `*.view_all` nuevos (admin default, NO delegable), helper `resolveScope(db, actorId)` en cada controller que pasa `userIds: [actor.id, ...descendants]` al service si no tiene `view_all`. Tests: 6 nuevos en `scope-filtering.e2e.ts`. Suite 476/476.
- **Impacto desbloqueado**: comisiones automáticas (P1.8) ahora viable.

### P1 — Features pendientes (docs ya las definen)

#### 🆕 Sprint 45+ (pedido del dueño 2026-05-20)

**A. Sección "Estadísticas de pago"** — reporting consolidado de **todos** los movimientos de fichas, con discriminación por tipo de operación y rol del usuario para trazabilidad fina.
- **Backend**: nuevo controller `tenant/wallet-stats` (o extender `wallet.controller`) sobre la tabla `wallet_transactions` ya existente. Endpoints sugeridos:
  - `GET /tenant/wallet-stats/movements` — list paginada con filtros: `type` (mint/burn/load/unload/transfer/deposit/withdrawal/commission/bonus/...), `userRole` (admin/socio/distribuidor/cajero/usuario_final), `dateFrom`, `dateTo`, `userId`, `actorId`, `minAmount`, `maxAmount`. JOIN con `users` + `user_roles` para resolver roles del source/target.
  - `GET /tenant/wallet-stats/summary` — agregados por bucket (today/7d/30d/custom): total in, total out, net, count por type, top-N usuarios por volumen, top-N actores (cajeros que más cargaron).
  - `GET /tenant/wallet-stats/by-role` — breakdown del flujo: cuánto se cargó a cada rol, cuánto se retiró, balance neto. Útil para entender "qué tanto plata fluye hacia/desde cada nivel de la pirámide".
  - `GET /tenant/wallet-stats/export` — CSV con los mismos filtros (compliance).
- **Permissions**: nueva categoría `wallet_stats.*` — `wallet_stats.view_any` (admin/auditor), `wallet_stats.view_own_network` (socios/distribuidores ven solo su red), `wallet_stats.export`.
- **Frontend**: nueva página `/admin/wallet-stats` con:
  - Tabs: "Movimientos" (tabla detallada con filtros) / "Resumen" (cards de totales + sparklines por día) / "Por rol" (matriz origen→destino tipo Sankey simplificada).
  - Filtros sticky (rango de fechas, tipo, rol, search por username).
  - Click en fila → drawer con detalle full de la tx (related_tx_id, idempotency_key, balance_after, metadata).
- **Tests**: e2e con seed de varios movements + filtros + agregados.
- **Scope cuidado**: `wallet_transactions` es **append-only crítico** (área de alta sensibilidad). El controller es **read-only**, NUNCA muta. Reusa `WalletService` para queries — no escribe SQL crudo.

**B. Sección "Estadísticas de juego"** — reporting de **todas las jugadas** (game rounds) con métricas de juego.
- **Backend**: nuevo controller `tenant/game-stats` sobre `game_rounds` ya existente. Endpoints:
  - `GET /tenant/game-stats/rounds` — list paginada con filtros: `gameCode`, `userId`, `dateFrom/To`, `minBet/maxBet`, `outcome` (win/loss/zero), `sessionId`. Devuelve bet, payout, net, RTP por round, timestamp.
  - `GET /tenant/game-stats/summary` — bucket (today/7d/30d/custom): total bet, total payout, GGR (gross gaming revenue = bet - payout), número de rounds, jugadores únicos, RTP real promedio.
  - `GET /tenant/game-stats/by-game` — breakdown por `gameCode`: rounds, RTP real vs RTP target del config, top losers/winners, volumen.
  - `GET /tenant/game-stats/by-player` — top players por volumen de apuestas / GGR aportado / sesiones activas.
  - `GET /tenant/game-stats/export` — CSV.
- **Permissions**: `game_stats.view_any` (admin), `game_stats.view_own_network` (socios ven solo sus jugadores), `game_stats.export`.
- **Frontend**: nueva página `/admin/game-stats` con tabs:
  - "Rondas" (tabla filtrable) / "Por juego" (cards con RTP real, GGR, alertas si RTP diverge >5% del target) / "Por jugador" (rankings con paginación) / "Resumen" (KPIs + chart de GGR por día).
  - Drawer al hacer click en ronda → detalle full (payload del provider, wallet_tx ids vinculados, replay de la sesión).
- **Tests**: e2e que crea rounds via API + chequea agregados.
- **Sinergia con `leagues`**: las stats por player ya se calculan parcialmente para rankings — reusar `LeaguesService` queries cuando aplique.

**C. Lobby de juegos placeholder** (movido de P1.4) — vista pública sin engine real todavía. Solo grilla de cards "próximamente". Cierra el último P1 estructural del roadmap MVP.

 — ✅ **Cerrado en Sprint 27 (2026-05-18)**. Página `/play/wheel` con SVG dinámico (N segmentos), animación CSS `transform: rotate` 5 vueltas + landeo en el centro del segmento ganador, prize reveal modal. Backend: nuevo endpoint `GET /tenant/promotions/active?type=` (player-facing discovery) + 3 e2e. Nav entry "Rueda" en `PlayerHeader`. Suite 504/504 (+3).
2. ~~**Login streak claim (player)**~~ — ✅ **Cerrado en Sprint 28 (2026-05-18)**. Página `/play/streak` con grid de N días (uno por prize del config), states past/current/future con highlight accent, stat bar con racha actual + estado hoy, CTA "Reclamar día N" disabled si ya reclamado. Reusa endpoint `/active?type=login_streak` del Sprint 27. Nav entry "Racha" en `PlayerHeader`.
3. ~~**Notifications inbox del jugador** (`/play/notifications`)~~ — ✅ **Cerrado en Sprint 26 (2026-05-18)**. Página con tabs Todas/No leídas, mark-as-read individual + bulk, bell + badge con polling 30s en `PlayerHeader`.
4. ~~**Lobby de juegos placeholder**~~ — movido al nuevo bloque "Sprint 45+ pedido del dueño" arriba (item C). Mismo scope.
5. ~~**Branding tenant aplicado al player**~~ — ✅ **Cerrado en Sprint 29 (2026-05-18)**. Backend: 2 settings registradas (`branding.primary_color` hex + `branding.logo_url` HTTPS) con validación Zod; `GET /tenant/info` extendido con `branding: { primaryColor, logoUrl }` (público). Admin: KNOWN_SETTINGS catalog + `EditSettingDrawer` con tipos `color` (HTML picker + hex input + swatch) y `url` (con thumbnail preview). Player: `useTenantInfo` + override de `--color-accent` via inline style en layout (scoped a /play) + logo en `PlayerHeader` con fallback al SVG + favicon dinámico. Suite 514/514 (+10).
6. ~~**Vista de claims/spins en `/promotions` admin drawer**~~ — ✅ **Cerrado en Sprint 30 (2026-05-18)**. Backend: `GET /tenant/promotions/:id/rewards` (admin con `promotions.view`, filtros opcionales `userId/limit/offset`) + `PromotionsService.listRewardsForPromotion` con JOIN para `userUsername/displayName`. Frontend: hook `usePromotionRewards` + drawer refactored con tabs `Detalle` / `Premios entregados`. Tabla muestra beneficiario, prize con icono, segmento (wheel) o racha (streak), fecha relativa. Suite 517/517 (+3).
7. ~~**Editor visual de prizes/config por type**~~ (parcial) — ✅ **Daily wheel + login streak cerrados en Sprint 31 (2026-05-18)**. `WheelConfigEditor` (segments con add/remove, prize editor por kind con campos condicionales, indicador de suma vs target con auto-detección 0-1/0-100). `StreakConfigEditor` (prizes ordenables con ArrowUp/Down, settings panel para forgivenessDays/onMax/autoClaimOnLogin). Integrados en `PromotionDetailDrawer` edit mode y `CreatePromotionModal` — render condicional por type, fallback a textarea JSON para tipos sin editor. Pendiente para sprints futuros: welcome bonus matchPct slider, lottery, missions.
8. **Comisiones automáticas a la jerarquía** — ✅ **Cerrado en Sprint 25.** Widget de exposure en `/admin/dashboard` cerrado en **Sprint 32 (2026-05-18)**: backend `GET /tenant/commissions/stats` con 3 buckets (today, last7d, last30d) × 3 scopes (earnedByMe, earnedByTeam, tenantTotal solo si view_all). Widget renderea 2-3 tiles según permisos. Suite 521/521 (+4).
   - ✅ Sprint 24 (2026-05-18): schema `commission_rules` + `commission_payouts`, 3 perms (`commissions.configure/view/view_all`), `computeForEvent`, CRUD + payouts list scope-aware + preview, página `/commissions` con tabs Reglas/Pagos. Suite 494/494 (+18).
   - ✅ Sprint 25 (2026-05-18): `applyForEvent` hookeado en `deposits.approve` + `withdrawals.markPaid`. **Funder = approver** (operador que aprueba descuenta de su wallet). Edge case approver==ancestor: row registrada con `wallet_tx_id=null` (net zero). Saldo insuficiente → HTTP 409 + rollback total. `WalletService.executeCommissionTransfer` con type `commission_payout`. Suite 501/501 (+7).

### P2 — Polish y UX

#### 🆕 Sprint 45+ (pedido del dueño 2026-05-20)

**D. Simplificar creación de plantillas de bonos** — la UI actual del `/bonus-definitions` muestra un drawer con campos crudos del schema (`type`, `triggerEvent`, `config` JSON con `matchPct`, `maxAmount`, `wagerMultiplier`, `expirationDays`, etc.). El dueño reporta que **NO se entiende la configuración** ni cómo funcionará el bono.
- **Diagnóstico**: el drawer actual expone el modelo de datos en bruto. No hay tooltips, no hay presets, no hay preview del comportamiento, no hay validación cruzada de campos (ej. si el type es `welcome_match` el `matchPct` es obligatorio; si es `cashback_periodic` el `cashbackPct` lo es). El usuario tiene que leer docs/saber el dominio antes de tocar.
- **Solución propuesta** (no requiere cambio backend — solo UX):
  - **Wizard step-by-step** en lugar de drawer plano:
    1. *Tipo de bono* — cards visuales con descripción simple ("Bienvenida: regalá un % del primer depósito", "Cashback semanal: devuelvo X% de las pérdidas cada semana", "Free spins en X juego", etc.) + ícono. Selección bloquea steps siguientes a campos relevantes solo.
    2. *Cuándo se otorga* (trigger) — radios con explicación humana ("Al primer depósito", "Manual por el admin", "Recurrente por cron", "Al ganar racha de N días"). Diferentes opciones disponibles según type.
    3. *Cuánto y cómo* (config) — formulario con campos guiados por type seleccionado:
       - Match % con slider 0-200% + label "Por cada $100 deposita, das $X de bonus".
       - Max amount con preview ("Hasta $X de bonus por transacción").
       - Wager multiplier con preview ("El jugador apuesta $X total antes de poder retirar").
       - Expiration days con preview ("Vencerá en X días si no se completa").
    4. *Restricciones* — días de la semana, países, juegos elegibles, monto mínimo de depósito.
    5. *Preview* — card que muestra cómo va a impactar a un jugador-ejemplo: "Juan deposita $1000 → recibe $X bonus → necesita apostar $Y antes de poder retirar → vence el día Z".
  - **Presets** ("plantillas de plantillas") — 3-4 ejemplos predefinidos que arrancan el wizard ya configurado:
    - "Bienvenida estándar 100% hasta $5000"
    - "Cashback semanal 10% de pérdidas"
    - "Free spins de fin de semana"
    - "Bonus de cumpleaños"
  - **Tooltips inline** en cada campo técnico explicando qué significa en lenguaje del operador (no del dev).
  - **Validación cruzada** que tira error claro: "Si el tipo es 'welcome_match', necesitás definir matchPct" en vez de "config.matchPct: invalid".
- **Backend**: posiblemente agregar `GET /tenant/bonus-definitions/presets` (devuelve los 3-4 templates como JSON listos para hidratar el form), pero no es estrictamente necesario — los presets pueden vivir en el frontend.
- **Scope no-tocar**: el schema `bonus_definitions` y el `BonusesService` quedan idénticos. Es 100% reskin del frontend.
- **Tests**: e2e que recorra el wizard end-to-end + valida que el bonus se crea con la config esperada.


2. **Paginación visible** en `/play/deposits` y `/play/withdrawals` si jugadores acumulan >50.
3. **Refetch del balance al abrir `NewWithdrawalModal`** — evita balance stale entre hold y request.
4. **CSV export para `payment_methods`, `permission_overrides`, `fraud_links`** (compliance opcional).
5. **Postgres FTS sobre `users`** si `ILIKE` se vuelve lento (>10k users).
6. **Re-activar inline desde tabla** de `/payment-methods` (toggle isActive sin abrir drawer).
7. ~~**Impersonate UI**~~ — ✅ **Cerrado en Sprint 37 (2026-05-19)**. Schema: `user_sessions.impersonated_by_user_id` (migration 0023). Backend: JWT claim `impersonatedBy`, `POST /tenant/auth/impersonate/:userId` con permission `users.impersonate`, audit severity:high. Guard propaga `impersonatorId` al requestContext (auto-trace). Frontend: `AuthContext.impersonate/stopImpersonating` con sessionStorage restore; `ImpersonateBanner` sticky en root layout; botón en user-detail-drawer con ConfirmModal. 6 e2e nuevos. Suite 569/569.

### P3 — Nice-to-have (no críticos)

1. **Admin trigger del dispatcher de notifications** — `POST /tenant/notifications/dispatch` para forzar procesamiento inmediato post-retry.
2. **"Re-encolar todas las failed" bulk action** — riesgo de doble envío masivo; tratar con cuidado.
3. **Subir archivos de comprobante propiamente** (S3/R2 + signed URLs) — hoy es URL externa que el jugador pega manual.
4. **Tasa de cambio configurable por payment_method** — el ratio chips/fiat hoy lo decide el cajero al aprobar. Sumar `config.ratio` opcional + auto-llenado en el modal del jugador.

---

## 11. Post-MVP — v1 (mes 8–14)

### Tema central: primer juego propio + features avanzadas + operación real propia.

> **Decisión estratégica**: en lugar de contratar un game provider externo (tier 1 no integra a operadores no licenciados, tier 2 son cuestionables), el camino post-MVP es **construir juegos propios**. Detalle completo en `docs/own-games/00-overview.md`.

### Features prioritarias

#### Juego propio #1: Crash game
- Math model + simulador + Monte Carlo validation (RTP target 99%).
- RGS (`apps/rgs`) servicio Node.js separado.
- Provably fair desde día 1 (commit-reveal + hash chain).
- Cliente Phaser 3 con animaciones y mobile responsive.
- Integración con wallet API vía `OwnGamesProvider` adapter.
- UI de fairness verificable por el jugador.
- Tests: math (10M rounds), provably fair, idempotencia, concurrencia.
- Documentación en `docs/own-games/crash/`.
- **Tiempo estimado: 3–4 meses part-time**.

#### Game provider externo (opcional / fallback)
- Si querés catálogo amplio mientras construís los propios: contratar provider tier 2 (Jacktop, BetCore o similar).
- Adapter cumpliendo `IGameProvider`.
- Decisión: empezar sin provider externo y solo agregar si el catálogo propio se siente corto.

#### Promos avanzadas
- Sorteos por tickets + sorteos por ranking.
- Liga de jugadores (4 períodos simultáneos + métricas + premios automáticos).
- Misiones / desafíos.
- Ruleta diaria.
- Login streak.
- Cofres por nivel + sistema de XP.
- Jackpots propios del tenant.

#### Referidos avanzados
- Payout automático de comisiones a Socios (en fichas).
- Solicitud de retiro de comisiones a fiat (módulo separado).
- Carryover negativo + tracking visible.
- Hold period configurable (D2).
- KYC liviano sobre umbral (D4).
- Panel "Socios sospechosos" + métricas de calidad de tráfico (D7 + D8).

#### Operación
- Verificación cripto automática (TronGrid).
- OCR de comprobantes para antifraude.
- Provider de KYC integrado (Veriff/SumSub) si tenant lo pide.
- Plantillas de pipelines pre-armadas para Kommo.
- Reality checks (juego responsable v2).

#### Plataforma
- Read replicas de Postgres.
- Workers BullMQ en proceso separado.
- Sitio comercial público (landing) para vender la plataforma.
- CRM de marketing (Kommo Salesbot integrado).
- Multi-touch attribution para referidos.
- Vistas guardadas + dashboards configurables por usuario.

### Métricas de éxito v1
- Crash propio operando en producción con vos jugando real.
- Math validado matemáticamente + provably fair verificable.
- Operación con tu propio casino activo.
- $X de NGR consolidado (a definir).

---

## 12. v1.5 (mes 14–18)

### Tema central: ampliar catálogo propio + abrir a primer cliente externo (si querés).

### Features prioritarias

#### Juegos propios adicionales
- **Mines** o **Plinko** (1–2 meses cada uno, mecánicas simples, provably fair fácil).
- Reutilizar arquitectura del Crash (RGS, provably fair, math worksheet).
- Más rápido cada juego nuevo porque la infra ya está.

#### Plataforma
- Sitio comercial público (landing) para vender la plataforma.
- Documentación pública / demo para prospects.
- Onboarding semi-automatizado de tenant nuevo (1 hora vs 1 día).
- Materiales de venta (deck, comparativa vs SoftSwiss/EveryMatrix).

#### Operación
- Verificación cripto automática (TronGrid).
- OCR de comprobantes para antifraude.
- Plantillas de Kommo pre-armadas.

---

## 13. v2 (mes 18–24)

### Tema central: primer slot propio + profesionalización.

### Features prioritarias

#### Juego propio #4: Slot video con bonus
- 5 reels, 20+ líneas, feature bonus (free spins / pick-and-click).
- Math más complejo, simulación más exhaustiva.
- Más assets: $200–800 de assets + tiempo de polishing.
- **Tiempo estimado: 4–6 meses part-time**.

#### Plataforma
- **Migración a Kubernetes** si el volumen lo justifica.
- **Vista jerarquía interactiva** (mapa conceptual editable con React Flow).
- **Roles custom** que el Socio puede crear dentro de su red.
- **Multi-touch attribution** y atribución cross-device.
- **Landing pages custom** por link de referido.
- **A/B testing** del lobby + de copys + de campañas.
- **Multilenguaje del sitio jugador**.
- **Personalización profunda** del branding (paleta + tipografía configurables).
- **Modo de auto-pago de retiros cripto** automatizado.
- **Sistema de afiliados externos**.
- **Integración con más payment providers** (MercadoPago, otras criptos).
- **Mobile app nativa** (React Native) si el demand lo justifica.

---

## 14. v3+ (mes 24+)

### Tema central: catálogo propio robusto + diferenciación profunda.

#### Catálogo propio expandido
- **Slots adicionales** (1 nuevo cada 2-3 meses).
- **Ruleta propia** (math conocido, polish de UX).
- **Blackjack propio** (math con strategy table, modo single + multi-hand).
- **Live casino streamed** — solo si llegás con equipo real (out of scope solo).

#### Diferenciación
- **Tournaments propios** del tenant (más allá de los del provider).
- **Casino white-label como producto B2B** maduro (vos vendés a otros operadores).
- **Multi-region** (si crecés geográficamente).
- **AI / ML para detección de fraude avanzada** (modelo entrenado sobre clusters confirmados).
- **Personalización de UI con LLM** (asistente que ayuda al Admin Tenant a configurar promos).
- **Programa de bug bounty público**.
- **Certificación oficial** (eCOGRA / GLI) si decidís blanquear y operar regulado.

---

## 14. Riesgos y dependencias

| Riesgo | Impacto | Mitigación |
|---|---|---|
| **Disponibilidad part-time fluctúa** | Atraso del roadmap | Buffer de 1 mes incluido. Dejar features no-MVP fuera. AI agents = leverage. |
| **Bug crítico en wallet** | Datos financieros corruptos | Tests profundos + idempotencia + audit log + backups verificados. |
| **Burnout** | Pausa indeterminada | Mantener part-time, no pasar a 40hs sin estructura. Doc al día para retomar fácil. |
| **Game provider tarda en firmar (post-MVP)** | Demora abrir a clientes externos | Mock provider sigue operativo, validar internamente con vos. |
| **Banco / pasarela rechaza al primer tenant** | Imposibilidad de operar real | Multi-provider preparado. Usar cripto si fiat no avanza. |
| **Cambio regulatorio en Argentina** | Mercado se cierra | Arquitectura ya soporta KYC / AML — activable rápido. |
| **Complejidad de un módulo subestimada** | Una fase tarda 2x | Slicing vertical: cada fase entrega algo funcionando, no se posterga "un mes más". |

---

## 15. Checklist de salida del MVP (mes 6/7)

Antes de declarar MVP listo, verificar:

- [ ] Todos los entregables de fases 0–6 completos.
- [ ] Tests E2E pasan en CI sin fallos.
- [ ] Backup/restore probados al menos una vez en datos reales.
- 🟡 Disaster recovery runbook escrito (`docs/runbooks/disaster-recovery.md` — Sprint 38) — **probarlo end-to-end con un restore real pendiente**.
- [ ] Performance acceptable: p95 < 300ms, 500 req/s sostenibles.
- [ ] Auditoría revisada manualmente: cada acción sensible deja rastro.
- [ ] Permisos: imposible para Cajero hacer algo de Admin Tenant aunque toquetee la API.
- [ ] Mint / Burn solo para Admin Tenant verificado.
- [ ] Wallet sin negativos posibles (constraint Postgres validado).
- [ ] Multi-tenant: imposible cross-tenant data leak (test específico).
- [ ] 2FA funcionando para todos los roles operativos.
- [ ] Custom domain funcional para tenant piloto.
- [ ] Documentación al día.
- [ ] Vos confiás en el sistema para operarlo en serio.

---

## 16. Métricas de éxito por fase

### MVP (mes 6/7)
- 1 tenant (vos) operando.
- 0 bugs críticos abiertos.
- 100% de flujos críticos cubiertos por tests E2E.
- Auditoría completa funcional.

### v1 (mes 14)
- 3-5 tenants operando reales.
- Game provider real integrado.
- $X NGR mensual consolidado (definir según mercado real).
- < 0.1% rate de errores 5xx.
- 99.5% uptime.

### v2 (mes 24)
- 10-20 tenants.
- 99.9% uptime.
- Migración a K8s completa o cerca.
- Profitable / break-even.

### v3 (mes 36+)
- 30+ tenants.
- Juegos propios contribuyendo > 10% del catálogo.
- Producto consolidado en LATAM.

---

## 17. Cómo se actualiza este doc

- **Cierre de cada fase**: marcar entregables como ✅, agregar lecciones aprendidas, ajustar timeline si hubo desvío.
- **Cambio de scope**: si algo se mueve de fase, anotarlo con razón.
- **Quincenal mientras dure MVP**: review breve del status, ajustar prioridades inmediatas.
- **Mensual post-MVP**: review de métricas + decisión de prioridades v1.

> Este es el doc menos estático del repo. Cambiarlo es esperado. Lo importante es que refleje siempre la realidad, no la aspiración inicial.
