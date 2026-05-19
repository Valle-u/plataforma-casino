# @casino/e2e — Playwright E2E

Browser-based tests para validar flujos críticos del producto end-to-end.

> **Status**: Sprint 36 introdujo setup + 3 specs base. Sprint 39
> (2026-05-19) validó runtime + sumó 3 specs más (withdrawal,
> responsible gaming, impersonate). **9/9 specs verified passing**
> en ~30s contra dev tenant local.

---

## Para correr

Requiere los servicios arriba en paralelo:

1. **Postgres** corriendo + tenant `demo` migrado y seedeado:
   ```bash
   pnpm --filter @casino/db db:migrate:tenants
   pnpm --filter @casino/db db:seed:dev-tenant
   ```

2. **Backend API** en `:3000`:
   ```bash
   pnpm --filter @casino/api dev
   ```

3. **Web** en `:3001`:
   ```bash
   pnpm --filter @casino/web dev
   ```

4. **Instalar browser** (primera vez):
   ```bash
   pnpm --filter @casino/e2e install:browsers
   ```

5. **Correr suite**:
   ```bash
   pnpm --filter @casino/e2e test            # headless
   pnpm --filter @casino/e2e test:headed     # con browser visible
   pnpm --filter @casino/e2e test:ui         # modo interactivo UI
   pnpm --filter @casino/e2e report          # abrir HTML report del último run
   ```

---

## Variables de entorno

Defaults razonables para dev local. Si necesitás overridear:

| Var | Default | Para qué |
|---|---|---|
| `E2E_WEB_BASE_URL` | `http://localhost:3001` | Base URL del web (Next). |
| `E2E_API_BASE_URL` | `http://localhost:3000` | API de NestJS. |
| `E2E_TENANT_HOST` | `demo.localhost` | Header `X-Tenant-Host`. |
| `E2E_ADMIN_USERNAME` | `demo_admin` | Login admin para crear test data. |
| `E2E_ADMIN_PASSWORD` | `demo-pwd-2026` | Password admin. |

---

## Estructura

```
apps/e2e/
├── playwright.config.ts          ← config principal (proyectos, retries, base URL).
├── tests/
│   ├── helpers/
│   │   ├── api.ts                ← ApiClient + create/login/fund helpers.
│   │   └── auth.ts               ← login via UI.
│   ├── 01-login.spec.ts             ← login player + credentials inválidas + logout.
│   ├── 02-deposit-flow.spec.ts      ← player crea deposit, admin aprueba via API, balance refleja.
│   ├── 03-game-loop.spec.ts         ← lobby → launch → spin → resultado visible.
│   ├── 04-withdrawal-flow.spec.ts   ← player crea retiro, admin aprueba + paga, balance refleja.
│   ├── 05-responsible-gaming.spec.ts ← setear caps + auto-excluirse + login bloqueado.
│   └── 06-impersonate.spec.ts       ← admin impersona desde drawer, ve banner, vuelve.
└── README.md (este file)
```

## Convenciones

- **Specs serializados** (workers: 1) — comparten DB del tenant demo.
  Si emerge necesidad de paralelismo, splittear en tenants distintos.
- **Cada spec crea sus propios users** con prefix `e2e_<label>_` +
  random suffix. NO se hace cleanup post-run (acceptable mientras la
  cantidad de users no afecte performance del seed).
- **`trace: 'retain-on-failure'`**: si un test falla, queda `.zip` con
  trace navegable (`playwright show-trace`). Útil para debugging.

## Limitaciones conocidas

- **Sin CI todavía**: no hay GitHub Actions workflow. Si emerge necesidad,
  crear `.github/workflows/e2e.yml` con `services:` (postgres) + steps
  que levanten api + web + corran tests. Complejidad media — para MVP
  basta con correr local antes de cada release.
- **Selectores frágiles**: específicamente el botón del lobby asume el
  texto del nombre del juego (regex flexible cubre los 10 mock games).
  Si el seed cambia los códigos, ajustar el filter del `getByRole`.
- **RNG no-determinístico en game loop**: el test de spin valida que
  un resultado aparece (win OR lose), no un specific outcome.
- **Sin smoke test del admin panel todavía**: los 3 specs cubren el
  player. Admin panel queda para Sprint 37+.
