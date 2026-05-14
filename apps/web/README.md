# @casino/web — Panel administrativo

Frontend del operador. Next.js 15 (App Router) + Tailwind v4 + design system propio.

## Levantar en dev

```bash
# 1. Una sola vez: provisionar el tenant "demo" en la control DB de dev.
#    Crea el tenant + domain + DB + migrations + admin user.
pnpm --filter @casino/db db:seed:dev-tenant

# 2. Copiar env de ejemplo del web
cp apps/web/.env.local.example apps/web/.env.local

# 3. Levantar API backend en otra terminal (puerto 3000)
pnpm --filter api dev

# 4. Levantar el frontend (puerto 3001)
pnpm --filter @casino/web dev
```

Abrir <http://localhost:3001>. Te lleva a `/login`.

Credenciales del tenant demo (creadas por el seed dev):

- **Usuario**: `demo_admin`
- **Password**: `demo-pwd-2026` (override con env `DEMO_ADMIN_PASSWORD`)

El frontend habla con el backend via rewrite de Next (`/api/*` → `http://localhost:3000`). El header `X-Forwarded-Host` se setea en el client con el valor de `NEXT_PUBLIC_TENANT_HOST` (default `demo.localhost`) para que el `TenantResolverMiddleware` del backend resuelva al tenant correcto.

## Estructura

```
apps/web/
├── app/
│   ├── (admin)/         # Rutas autenticadas del operador
│   │   ├── layout.tsx   # Sidebar + header shell
│   │   └── dashboard/
│   ├── (auth)/          # Rutas públicas (login, etc.)
│   │   ├── layout.tsx   # Split panel atmosfera + form
│   │   └── login/
│   ├── globals.css      # Design tokens + reset
│   ├── layout.tsx       # Root (fonts, providers)
│   └── page.tsx         # Redirect a /dashboard o /login
├── components/
│   ├── ui/              # Primitives (Button, Input, Card, StatTile, …)
│   ├── admin/           # Componentes específicos del admin (Sidebar, Header)
│   └── auth/            # Componentes del flow de auth
└── lib/
    ├── api-client.ts    # Fetch wrapper + token + X-Forwarded-Host
    ├── auth-context.tsx # React context con user + login/logout
    └── cn.ts            # Helper clsx + tailwind-merge
```

## Design system: "Casino Noir"

Paleta:

| Token              | Hex        | Uso                              |
| ------------------ | ---------- | -------------------------------- |
| `--color-bg`       | `#0a0a0a`  | Fondo principal                  |
| `--color-bg-elevated` | `#121212` | Cards, paneles                   |
| `--color-bg-subtle` | `#1a1a1a` | Inputs, hover bg                 |
| `--color-border`   | `#262626`  | Separadores                      |
| `--color-fg`       | `#fafafa`  | Texto principal                  |
| `--color-fg-muted` | `#a1a1a1`  | Texto secundario                 |
| `--color-accent`   | `#dc2626`  | CTA, activos, errores (rojo-600) |

Tipografía:

- **Display** (`--font-display`): Fraunces variable, axes opsz+SOFT.
- **UI** (`--font-sans`): Geist.
- **Mono** (`--font-mono`): Geist Mono — montos, IDs, hashes.

Detalles distintivos:

- Esquinas duras (radius máximo 6px).
- Bordes 1px finos, sin sombras blandas.
- Tabular nums en todos los números.
- Border-l rojo 2px en items activos (sidebar, cards hover).
- Grain texture sutil en backgrounds (SVG noise inline).
- Labels en caps tracking ancho (estilo terminal).

## Próximos sprints

- `/users` — CRUD de usuarios del tenant.
- `/wallet` — Mint/burn + balance + transactions.
- `/deposits` + `/withdrawals` — Aprobación/rechazo + audit timeline.
- `/bonuses` + `/promotions` + `/leagues` — Engagement.
- `/fraud` — Panel antifraude.
- `/notifications` + `/templates` — Templates editables + cola.
- `/settings` + `/audit` — Configuración + auditoría.
- Panel end-user (jugador) — Aparte, vibe distinto.
