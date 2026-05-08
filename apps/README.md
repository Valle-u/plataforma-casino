# apps/

Aplicaciones desplegables del monorepo. Cada subcarpeta es un servicio o sitio independiente.

## Apps previstas (ver `docs/02-arquitectura.md`)

- `web/` — Sitio público + cliente jugador (Next.js 15).
- `panel/` — Panel de control (Next.js 15).
- `api/` — Backend (NestJS).
- `rgs/` — Remote Game Server para juegos propios (post-MVP, ver `docs/own-games/00-overview.md`).

## Cómo agregar una app nueva

1. Crear carpeta `apps/<nombre>/`.
2. Inicializar con `pnpm init` o el CLI del framework correspondiente.
3. Asegurar que el `package.json` tenga `"name": "@casino/<nombre>"`.
4. Sumar dependencias internas con `"@casino/<otra>": "workspace:*"`.

> Cada app tiene su propio `package.json`, su propio build, sus propios tests.
> Comparten config base vía `tsconfig.base.json` y dependencias vía pnpm workspaces.
