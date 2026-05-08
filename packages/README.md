# packages/

Código compartido entre apps. Cada subcarpeta es un paquete reutilizable consumido vía `pnpm workspaces`.

## Packages previstos (ver `docs/02-arquitectura.md`)

- `types/` — Tipos TS compartidos entre frontend y backend.
- `ui/` — Componentes shadcn/ui + tokens del sistema de diseño.
- `db/` — Schema Drizzle + migraciones + cliente.
- `permissions/` — Catálogo de permisos atómicos + helpers de cálculo del set efectivo.
- `adapters/` — Adapters de proveedores externos:
  - `adapters/game-providers/` — `IGameProvider` + Mock + (futuro: Pragmatic, Evolution, etc.).
  - `adapters/payments/` — Pasarelas de pago.
  - `adapters/crm/` — Kommo, Chatwoot.
- `games-shared/` — Math primitives, provably fair, simulator (post-MVP).
- `config/` — ESLint, Prettier, Tailwind, tsconfig presets compartidos.

## Cómo agregar un package nuevo

1. Crear carpeta `packages/<nombre>/`.
2. `package.json` con `"name": "@casino/<nombre>"` y `"private": true`.
3. Apps que lo necesiten: agregar `"@casino/<nombre>": "workspace:*"` en sus deps.
4. Después correr `pnpm install` desde la raíz para que pnpm linkee el package.
