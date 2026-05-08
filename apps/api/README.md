# @casino/api

Backend NestJS de la plataforma. Multi-tenant, TypeScript estricto, Drizzle ORM (cuando lo agreguemos), JWT + 2FA (cuando lo agreguemos).

## Estado actual

**Fase 0 — esqueleto inicial.** Tiene 2 endpoints:

- `GET /` → mensaje de bienvenida.
- `GET /health` → health check con uptime y timestamp.

## Arrancar en local

Desde la **raíz del monorepo**:

```bash
# Instalar dependencias (solo la primera vez o cuando cambian)
pnpm install

# Levantar el server en modo dev (recarga automática al guardar cambios)
pnpm --filter @casino/api dev
```

El server queda corriendo en `http://localhost:3000`.

Probar:

```bash
curl http://localhost:3000          # mensaje de bienvenida
curl http://localhost:3000/health   # health check JSON
```

O abriendo esas URLs en el browser.

## Variables de entorno

1. Copiá `.env.example` → `.env.local` (no se sube a git).
2. Reemplazá los valores placeholder.

## Estructura

```
src/
├── main.ts             # Entry point — levanta el server
├── app.module.ts       # Módulo raíz
├── app.controller.ts   # Endpoints / y /health
└── app.service.ts      # Lógica de bienvenida
```

A medida que sumemos features (auth, wallet, deposits, etc.), van a aparecer carpetas nuevas adentro de `src/`, una por módulo de dominio. Ver `docs/02-arquitectura.md`.

## Scripts

| Script | Qué hace |
|---|---|
| `pnpm dev` | Levanta server en modo desarrollo con hot reload |
| `pnpm build` | Compila TypeScript a JavaScript en `dist/` |
| `pnpm start` | Corre la versión compilada (production-like) |
| `pnpm lint` | Corre ESLint |
| `pnpm type-check` | Verifica tipos sin emitir archivos |
| `pnpm test` | Corre tests (todavía no hay) |
