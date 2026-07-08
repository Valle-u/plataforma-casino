# 02 · Arquitectura

> Estado: **decidido**. Cambios mayores requieren aprobación explícita del dueño.

---

## 1. Vista de alto nivel

```
                                 ┌─────────────────────────────┐
                                 │      Cliente (Browser)      │
                                 └───────────────┬─────────────┘
                                                 │
                                                 │ HTTPS
                                                 ▼
              ┌─────────────────────────────────────────────────────────────┐
              │                       Apps (Next.js)                        │
              │  ┌───────────────────────┐    ┌───────────────────────────┐ │
              │  │ apps/web              │    │ apps/panel                │ │
              │  │ Sitio público         │    │ Panel de control          │ │
              │  │ + cliente jugador     │    │ (admin/socio/cajero/etc.) │ │
              │  └───────────────────────┘    └───────────────────────────┘ │
              └────────────────────────────┬────────────────────────────────┘
                                           │ REST + WebSocket
                                           ▼
              ┌─────────────────────────────────────────────────────────────┐
              │                    apps/api  (NestJS)                       │
              │  Tenant Resolver → Auth → Permissions → Domain Modules      │
              └────┬───────────────┬─────────────────┬───────────────┬──────┘
                   │               │                 │               │
                   ▼               ▼                 ▼               ▼
          ┌──────────────┐  ┌─────────────┐   ┌──────────┐   ┌─────────────┐
          │ DB control   │  │ DB tenant 1 │…  │  Redis   │   │ S3 (storage)│
          │ Postgres     │  │ Postgres    │   │ + BullMQ │   │ comprobantes│
          └──────────────┘  └─────────────┘   └──────────┘   └─────────────┘
                                                  │
                                                  ▼
                                           ┌──────────────┐
                                           │   Workers    │
                                           │ (BullMQ jobs)│
                                           └──────────────┘
                                                  │
                                                  ▼
                            ┌──────────────────────────────────────────┐
                            │ Integraciones externas (vía adapters)    │
                            │ Game Aggregator · Kommo · Pagos · Crypto │
                            └──────────────────────────────────────────┘
```

---

## 2. Stack

### Lenguaje
- **TypeScript estricto** en todos los paquetes. `any` prohibido salvo justificación en comentario.

### Monorepo
- **Turborepo** + **pnpm workspaces**.
- Cache compartido de builds, scripts orquestados, dependencias deduplicadas.

### Frontend
- **Next.js 15** (App Router) en `apps/web` y `apps/panel`.
- **TailwindCSS** + **shadcn/ui** para componentes.
- **Zustand** o **TanStack Query** para estado (definir en implementación).
- **Socket.io-client** para tiempo real.
- Tipos compartidos consumidos desde `packages/types`.

### Backend
- **NestJS** modular, organizado por dominio (no por capa técnica).
- Módulos previstos: `auth`, `tenants`, `users`, `roles-permissions`, `wallet`, `deposits`, `withdrawals`, `games`, `referrals`, `reports`, `audit`, `notifications`, `livechat`, `branding`.
- **DTOs validados con `class-validator`**. Nada entra al servicio sin validar.

### Base de datos
- **PostgreSQL 18**.
- **Drizzle ORM** (elegido sobre Prisma por mejor performance en queries de reporting complejas y mejor control sobre SQL crudo).
- Estrategia multi-tenant: **una DB por tenant** + **una DB de control** (`platform_control`).
- Migraciones gestionadas por un **runner propio** que itera sobre el registro de tenants y aplica migraciones a cada DB.

### Cache y colas
- **Redis** para cache, sesiones, locks distribuidos.
- **BullMQ** sobre Redis para jobs:
  - Reconciliación de balances.
  - Notificaciones (email, push, livechat).
  - Procesos pesados de reporting.
  - Webhooks salientes/entrantes.
  - Cierres de período (cálculo de netwin).

### Real-time
- **Socket.io** server adjunto al backend NestJS.
- Canales: livechat, notificaciones del panel, eventos de wallet (carga aprobada).

### Storage
- **S3-compatible**:
  - Dev: **MinIO** local (vía Docker Compose).
  - Prod: **Cloudflare R2** (preferido por costo) o **AWS S3**.
- Comprobantes de depósito, avatars, archivos de branding por tenant.

### Auth
- **JWT access tokens** (corta vida, ~15 min) + **refresh tokens** (rotación).
- **2FA opcional** por usuario (TOTP via authenticator app).
- **Cookies httpOnly + sameSite** para web; **Authorization header** para llamadas API directas.

### Observabilidad
- **Pino** para logs estructurados.
- **OpenTelemetry** para traces.
- **Grafana + Loki + Prometheus** (stack auto-hosteado en VPS) para visualización.

### Deploy
- **Dev**: Docker Compose local levanta todo (Postgres, Redis, MinIO, api, web, panel).
- **Staging**: VPS con **Coolify** (Hetzner u otro). Mismos servicios, datos sintéticos.
- **Producción**: a definir según volumen del primer cliente. Coolify alcanza para empezar; migrar a Kubernetes solo si hace falta.

---

## 3. Estructura del monorepo

```
plataforma-casino/
├── apps/
│   ├── web/                    # Sitio público + cliente jugador (Next.js)
│   ├── panel/                  # Panel de control (Next.js)
│   └── api/                    # Backend NestJS
│       └── src/
│           └── modules/        # auth, wallet, tenants, etc.
│
├── packages/
│   ├── types/                  # Tipos TS compartidos front/back
│   ├── ui/                     # Componentes shadcn compartidos
│   ├── db/                     # Schemas Drizzle + runner de migraciones
│   ├── permissions/            # Definición de permisos atómicos + helpers
│   ├── adapters/               # Adapters de proveedores externos
│   │   ├── game-providers/
│   │   ├── payments/
│   │   └── crm/
│   └── config/                 # eslint, tsconfig, tailwind base
│
├── docker/
│   ├── docker-compose.yml      # Stack local de dev
│   └── Dockerfile.{api,web,panel}
│
├── docs/                       # Documentación de diseño
├── scripts/                    # Tooling (migraciones, seeds, ops)
├── AGENTS.md
├── CLAUDE.md
├── README.md
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

---

## 4. Multi-tenancy: cómo funciona realmente

### Resolución de tenant
1. Request entra al backend.
2. Middleware **TenantResolver** lee el dominio (`Host` header).
3. Consulta la DB de control: `SELECT * FROM tenants WHERE domain = ?`.
4. Si existe y está activo → adjunta al `Request` un `TenantContext` con conexión a la DB del tenant.
5. Si no → 404 o redirección al sitio del super-admin.

### Pool de conexiones
- Mantener un pool por tenant es costoso si hay muchos tenants.
- Estrategia: **pool de pools con LRU**. Conexiones por tenant que no se usan en X minutos se cierran.
- Tunear según volumen real.

### Migraciones
- Runner CLI: `pnpm db:migrate-all`.
- Lee `tenants` de la DB de control.
- Por cada uno, aplica migraciones pendientes en orden.
- Falla atómicamente: si falla en el tenant N, marca el estado y reporta.
- Dry-run disponible: `pnpm db:migrate-all --dry-run`.

### Onboarding de tenant nuevo
1. Super-admin crea el tenant en el panel.
2. Job de BullMQ:
   - Crea la DB nueva (`tenant_<slug>`).
   - Aplica todas las migraciones.
   - Inserta el usuario Admin Tenant inicial.
   - Configura branding por defecto.
   - Notifica al super-admin.

### Aislamiento defensivo
Aunque la separación física por DB ya nos protege:
- **Nunca** loggear `tenant_id` ajeno en el contexto actual.
- **Nunca** abrir conexiones a DBs de tenants fuera del `TenantContext`.
- Tests automatizados que intenten cross-tenant queries y deban fallar.

---

## 5. Patrones de diseño clave

### Adapter Pattern
- Game providers, payment providers, CRM: todos detrás de interfaces (`IGameProvider`, `IPaymentProvider`, `ICRM`).
- Cambiar de proveedor = nuevo adapter, cero cambios en el core.

### Repository Pattern (suave)
- Acceso a DB encapsulado en repos por entidad (`UsersRepository`, `WalletRepository`).
- No abstraer en exceso: Drizzle ya da queries tipadas.

### CQRS-lite
- Separación clara entre **comandos** (escriben, validan permisos, generan auditoría) y **queries** (leen, optimizadas para reporting).
- No usamos CQRS pleno con event sourcing en MVP. Si después aparece, queda como evolución.

### Saga / Outbox
- Para operaciones que cruzan servicios (ej: aprobación de depósito → carga wallet → notificar usuario → notificar Kommo):
  - **Outbox pattern**: la operación financiera y el evento de "qué debe pasar después" se guardan en la misma transacción de DB.
  - **Worker** lee el outbox y dispara los efectos secundarios. Idempotente.

### Idempotencia
- Toda mutación financiera lleva `idempotency_key` (header).
- Tabla `idempotency_keys` por tenant: si la key ya existe → devolver el resultado anterior.

---

## 6. Seguridad de la arquitectura

- **TLS** obligatorio en todos los entornos (incluido staging).
- **Secrets** vía variables de entorno + vault (Doppler / Infisical / 1Password Connect; definir).
- **Rate limiting** en auth y operaciones financieras.
- **CSP estricto** en frontends.
- **Auditoría** automática para acciones sensibles (definidas en `permissions.audit_required`).
- **2FA obligatorio** para super-admin y admins de tenant; opcional para el resto.

Detalle completo: ver `docs/12-seguridad-compliance.md` (pendiente).

---

## 7. Decisiones de Arquitectura (ADR resumidos)

| ADR | Decisión | Razón |
|---|---|---|
| 001 | TypeScript estricto | Refactors seguros, tipos compartidos, mejor con agentes IA |
| 002 | Multi-tenant: DB por tenant | Aislamiento total, portabilidad por cliente, blast radius mínimo |
| 003 | Drizzle sobre Prisma | Mejor para queries complejas de reporting (netwin, trazabilidad) |
| 004 | NestJS sobre Express puro | Estructura modular, DI, ecosystem maduro |
| 005 | BullMQ sobre RabbitMQ | Suficiente para MVP, menos overhead operacional |
| 006 | Coolify para staging | Self-hosted, simple, sin lock-in |
| 007 | Adapters para integraciones | Cambiar proveedor sin tocar el core |

Cada ADR debería expandirse en su propio archivo (`docs/adr/00X-*.md`) cuando sea necesario justificar a fondo.

---

## 8. Lo que **no** decidimos todavía

Pendientes de definir más adelante (no bloquean MVP):

- Vault de secrets concreto (Doppler / Infisical / 1Password).
- CDN para assets estáticos.
- Estrategia de backups (frecuencia, retención, off-site).
- Búsqueda full-text avanzada (Postgres FTS vs Meilisearch).
- Testing E2E (Playwright probablemente).
- Sistema de feature flags (probablemente OpenFeature + Postgres backend simple).

Cuando lleguen, se decide y se documenta acá.
