# Variables de entorno para Railway

## Rails a configurar en Railway Dashboard

### Desde Railway (PostgreSQL + Redis plugins)
Railway inyecta automáticamente `DATABASE_URL`, `REDIS_URL` cuando agregás los plugins.

### Manuales (setear en Railway → Variables)
| Variable | Valor | Notas |
|---|---|---|
| `NODE_ENV` | `production` | |
| `DATABASE_URL_CONTROL` | `postgresql://<user>:<pass>@<host>:5432/platform_control` | Usar la URL que Railway da para Postgres, cambiar el database name a `platform_control` |
| `DATABASE_URL_TENANT_TEMPLATE` | `postgresql://<user>:<pass>@<host>:5432/<tenant_db>` | Misma URL pero con placeholder `<tenant_db>` |
| `JWT_ACCESS_SECRET` | `<random 64 hex>` | `openssl rand -hex 64` |
| `JWT_REFRESH_SECRET` | `<random 64 hex>` | `openssl rand -hex 64` |
| `JWT_ACCESS_TTL` | `15m` | |
| `JWT_REFRESH_TTL` | `30d` | |
| `TWO_FA_POLICY_ENABLED` | `false` | Temporal hasta que configuremos 2FA en prod |
| `LOG_LEVEL` | `info` | |
| `LEAGUES_RECOMPUTE_ENABLED` | `false` | Deshabilitado |
| `LEAGUES_CLOSE_ENABLED` | `false` | Deshabilitado |
| `BONUSES_EXPIRE_ENABLED` | `false` | Deshabilitado |
| `BONUSES_CASHBACK_ENABLED` | `false` | Deshabilitado |
| `STORAGE_DRIVER` | `r2` | |
| `R2_ENDPOINT` | (tu endpoint R2) | Solo si usás R2 |
| `R2_ACCESS_KEY_ID` | (tu key) | |
| `R2_SECRET_ACCESS_KEY` | (tu secret) | |
| `R2_BUCKET` | `plataforma-casino-uploads` | |

## Setup inicial de la DB (una sola vez)
1. Conectate via `railway connect` al Postgres
2. Creá la DB: `CREATE DATABASE platform_control;`
3. Corré migraciones: desde el proyecto local, configurá `DATABASE_URL_CONTROL` con la URL de Railway y ejecutá `pnpm --filter @casino/db db:migrate:control`
4. Seed: `pnpm --filter @casino/db db:seed:control`
