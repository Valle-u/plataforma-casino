# Plataforma Casino

Plataforma de casino virtual multi-tenant white-label, diseñada para venderse como producto a múltiples operadores. Modelo de negocio: comisión sobre el netwin de cada cliente.

## Estado actual

**Fase: Planificación / Arquitectura**. Aún no hay código. Toda la documentación de diseño vive en `/docs`.

## Cómo entrar al proyecto

1. **Humanos nuevos** → leer en orden: `docs/00-vision.md` → `docs/01-glosario.md` → `docs/02-arquitectura.md` → `docs/03-jerarquia-roles.md`.
2. **Agentes IA (opencode, Claude Code, Cursor)** → leer primero `AGENTS.md` y `CLAUDE.md`. Esos archivos indican qué leer según la tarea.

## Stack (resumen)

- **Monorepo**: Turborepo + pnpm
- **Frontend**: Next.js 15 (App Router) + TypeScript + TailwindCSS + shadcn/ui
- **Backend**: NestJS + TypeScript
- **BD**: PostgreSQL 16 + Drizzle ORM (multi-tenant: 1 DB por cliente + DB de control)
- **Cache/Colas**: Redis + BullMQ
- **Real-time**: Socket.io
- **Storage**: S3-compatible
- **Deploy**: Docker Compose (dev) → Coolify sobre VPS (staging/prod)

Detalle completo en `docs/02-arquitectura.md`.

## Estructura del repositorio (objetivo)

```
/
├── apps/
│   ├── web/              # Next.js — sitio público + cliente jugador
│   │   └── games/        # clientes de juegos propios (Phaser 3 por juego)
│   ├── panel/            # Next.js — panel de control (admin, socio, cajero, etc.)
│   ├── api/              # NestJS — backend
│   └── rgs/              # Node.js — Remote Game Server (juegos propios, post-MVP)
├── packages/
│   ├── types/            # tipos TS compartidos
│   ├── ui/               # componentes shadcn compartidos
│   ├── db/               # esquema Drizzle + migraciones
│   ├── permissions/      # catálogo de permisos atómicos + helpers
│   ├── games-shared/     # math primitives, provably fair, simulator
│   ├── adapters/         # adapters de proveedores externos (game, payment, CRM)
│   └── config/           # eslint, tsconfig, tailwind compartidos
├── docs/                 # toda la documentación de diseño
│   └── own-games/        # documentación del módulo de juegos propios
├── docker/               # Dockerfiles y compose
├── AGENTS.md             # guía para agentes IA en general
├── CLAUDE.md             # guía específica para Claude Code
└── README.md             # este archivo
```

## Convenciones rápidas

- Idioma del código: **inglés** (variables, funciones, tablas).
- Idioma de la documentación: **español**.
- Commits: Conventional Commits (`feat:`, `fix:`, `docs:`, etc.).
- Branch principal: `main`. Trabajo en feature branches.

## Roadmap

Ver `docs/14-roadmap.md` (a crear).
