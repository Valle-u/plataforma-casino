# @casino/db

Schemas Drizzle ORM + clientes para la plataforma. Multi-tenant físico: una DB de control + una DB por tenant.

## Estructura

```
packages/db/
├── src/
│   ├── control/                # Schemas de DB de control (super-admin)
│   │   ├── tenant-plans.ts
│   │   ├── tenants.ts
│   │   ├── tenant-domains.ts
│   │   ├── platform-users.ts
│   │   └── index.ts            # barrel
│   ├── tenant/                 # Schemas de DB de tenant (placeholder MVP)
│   │   └── index.ts
│   ├── utils/
│   │   ├── uuid.ts             # generateUuidV7()
│   │   └── index.ts
│   ├── scripts/
│   │   ├── setup-control.ts    # CREATE DATABASE platform_control
│   │   └── seed-control.ts     # datos de prueba
│   ├── client.ts               # createControlDb(), createTenantDb()
│   └── index.ts                # re-exports público
├── migrations/
│   ├── control/                # Migraciones SQL generadas por drizzle-kit
│   └── tenant/                 # (placeholder)
├── drizzle.control.config.ts
├── drizzle.tenant.config.ts
├── tsconfig.json
└── package.json
```

## Setup inicial (primera vez)

Necesitás Postgres corriendo en local + `apps/api/.env.local` con `DATABASE_URL_CONTROL` configurado.

```bash
# 1. Crear la DB platform_control si no existe
pnpm --filter @casino/db db:setup:control

# 2. Generar migraciones desde los schemas TypeScript
pnpm --filter @casino/db db:gen:control

# 3. Aplicar las migraciones a la DB
pnpm --filter @casino/db db:migrate:control

# 4. Insertar datos de seed (idempotente — no falla si ya existen)
pnpm --filter @casino/db db:seed:control
```

## Workflow al cambiar un schema

```bash
# 1. Editás el archivo .ts en src/control/ o src/tenant/
# 2. Generás la migración
pnpm --filter @casino/db db:gen:control

# 3. Revisás el SQL generado en migrations/control/<timestamp>_<name>.sql
# 4. Si está bien, aplicás
pnpm --filter @casino/db db:migrate:control
```

## GUI visual (Drizzle Studio)

Para inspeccionar/editar datos:

```bash
pnpm --filter @casino/db db:studio:control
```

Abre un panel web en localhost (puerto que indique) con todas las tablas navegables.

## Build

El package se compila a `dist/` (consumido por `apps/api`):

```bash
pnpm --filter @casino/db build
# o en modo watch durante desarrollo:
pnpm --filter @casino/db dev
```

## Decisiones técnicas

- **Driver**: `postgres` (postgres.js) — más rápido que `pg`.
- **UUIDs v7** generados en TypeScript (`generateUuidV7()`), no en Postgres.
- **Migraciones SQL** revisables: drizzle-kit las escribe a archivos `.sql`.
- **Multi-tenant físico**: cada tenant tiene su propia DB. Pool de pools con LRU se implementa cuando haya múltiples tenants activos.

Ver detalles en `docs/02-arquitectura.md`, `docs/04-modelo-datos.md` y `docs/DEVLOG.md`.
