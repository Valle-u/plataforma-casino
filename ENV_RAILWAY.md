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
| `VAPID_PUBLIC_KEY` | `<clave pública VAPID>` | **Requerida para las notificaciones push.** Sin las 3 VAPID, el backend usa `ConsolePushProvider` (no envía) y el endpoint `/tenant/push-subscriptions/vapid-public-key` devuelve `null` → el toggle "Activar notificaciones" queda deshabilitado ("no disponibles"). Generá el par con `npx web-push generate-vapid-keys`. |
| `VAPID_PRIVATE_KEY` | `<clave privada VAPID>` | NUNCA sale del server. Del mismo par generado. |
| `VAPID_SUBJECT` | `mailto:soporte@tudominio.com` | `mailto:` o `https:` de contacto (lo exige el protocolo web-push). |

> ⚠️ **Notificaciones push**: si el toggle "Activar notificaciones" tira error o
> dice "todavía no están disponibles" tanto en player como en panel, es porque
> faltan estas 3 variables VAPID en Railway. Generá el par
> (`npx web-push generate-vapid-keys`), cargá las 3 en Railway → Variables del
> servicio API, y Railway redeploya solo. Cambiar las claves invalida las
> suscripciones existentes (los usuarios vuelven a activarlas).

## Setup inicial de la DB (una sola vez)
1. Conectate via `railway connect` al Postgres
2. Creá la DB: `CREATE DATABASE platform_control;`
3. Corré migraciones: desde el proyecto local, configurá `DATABASE_URL_CONTROL` con la URL de Railway y ejecutá `pnpm --filter @casino/db db:migrate:control`
4. Seed: `pnpm --filter @casino/db db:seed:control`
