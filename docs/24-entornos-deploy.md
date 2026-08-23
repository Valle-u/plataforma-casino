# 24 · Entornos y deploy (staging + producción)

> Dos entornos, dos ramas. **Staging** para probar, **producción** para los usuarios.
> Ver también `docs/23-migracion-vps.md` (cómo se montó el VPS).

---

## Los dos entornos

| | **Staging (prueba)** | **Producción** |
|---|---|---|
| **Rama** | `staging` | `main` |
| **Infra** | Railway (API) + Vercel (web) | **VPS Hostinger + Dokploy** |
| **Deploy** | GitHub Actions (`.github/workflows/deploy.yml`) | **Dokploy** (autoDeploy via webhook) |
| **Casino (web)** | `plataforma-casino-web-ur4.vercel.app` | **`miamihub.vip`** |
| **Panel** | `admin.plataforma-casino-web-ur4.vercel.app` | **`admin.miamihub.vip`** |
| **API** | `plataforma-casino-production.up.railway.app` | **`api.miamihub.vip`** |
| **Migraciones** | automáticas (job `migrate` del Action) | **manuales** (ver abajo) |

---

## Flujo de trabajo

```
  programás  →  push a `staging`  →  se deploya a Railway/Vercel  →  probás
                                                                        │
                                                              todo OK   ▼
                        merge `staging` → `main`  →  se deploya al VPS (prod)
```

1. Trabajás y pusheás a **`staging`**. El Action buildea + migra + deploya a Railway/Vercel.
2. Probás en el entorno de staging.
3. Cuando está OK: **`git checkout main && git merge staging && git push`**. El push a `main` dispara los webhooks de Dokploy → el VPS rebuildeaa API + web.
4. Si el merge incluye **cambios de schema (migraciones)**, correlas a mano en el VPS (ver abajo) — el autoDeploy NO corre migraciones.

> Ambas ramas tienen los Dockerfiles (los ignora Railway/Vercel, los usa el VPS). `main` es la fuente de verdad de producción.

---

## Cómo deploya cada uno

### Staging → Railway/Vercel (GitHub Actions)
- `.github/workflows/deploy.yml` se dispara con **push a `staging`**.
- Jobs: `ci` (build+type-check) → `migrate` (control + tenants contra la DB de Railway) → `deploy` (Railway GraphQL + Vercel deploy hook) → `healthcheck`.
- Secrets/env: en Railway (API) y Vercel (web). Ver [[deploy-infra]].

### Producción → VPS (Dokploy autoDeploy)
- Cada app en Dokploy tiene `autoDeploy: true` + una **URL de webhook** con su `refreshToken`. Dokploy chequea la rama del payload: solo deploya si el push es a **`main`** (un push a `staging` da "Branch Not Match" y se ignora).
- **Webhooks (registrados en GitHub → Settings → Webhooks):**
  - API: `http://147.93.32.111:3000/api/deploy/<API_REFRESH_TOKEN>`
  - Web: `http://147.93.32.111:3000/api/deploy/<WEB_REFRESH_TOKEN>`
  - (Los tokens se obtienen de cada app en Dokploy → settings de Git, campo "Webhook URL", o via API `application.one`.)
- **Deploy manual** (sin push): en el panel de Dokploy, botón "Deploy" de cada app. O via API: `POST /api/application.deploy {applicationId}`.

---

## Migraciones en producción (VPS) — MANUAL

El autoDeploy del VPS **no corre migraciones**. Cuando un cambio toca el schema:

1. Abrir el puerto externo del Postgres temporalmente (Dokploy API):
   `POST /api/postgres.saveExternalPort {postgresId, externalPort: 5433}` + `POST /api/postgres.deploy`.
2. Desde local, con `DATABASE_URL_CONTROL` apuntando a `147.93.32.111:5433`:
   - `pnpm --filter @casino/db db:migrate:control`
   - `pnpm --filter @casino/db db:migrate:tenants` (corre contra cada tenant registrado).
3. **Cerrar el puerto** de nuevo: `saveExternalPort {externalPort: null}` + `postgres.deploy`.

> ⚠️ Área sensible (corre contra todas las DB de tenants). Probar en staging primero.
> A futuro: automatizar con un pre-deploy command en Dokploy o un job.

---

## Referencia rápida

- **VPS**: IP `147.93.32.111`, Dokploy en `http://147.93.32.111:3000` (token en env var `CASINO_DOKPLOY_TOKEN`, header `x-api-key`).
- **Proyecto Dokploy** `casino` (id `H6XsenvgAOoSaDbruVFyW`), env `production` (id `myIey9qLleUjGJbMacObN`).
- Apps buildean de **`main`** por Dockerfile (API: `Dockerfile` raíz; Web: `apps/web/Dockerfile`; context `.` los dos). Git source = HTTPS con `CASINO_GITHUB_TOKEN`.
- **Secrets de prod (VPS)**: en Dokploy (env de cada app). Se reusaron los de Railway. `STORAGE_PUBLIC_BASE_URL` quedó fuera (re-agregar si falla el storage).
- Más detalle e IDs en [[vps-migration-plan]] (memoria) y `docs/23-migracion-vps.md`.

---

## Setup manual pendiente (una sola vez)

1. **Agregar los 2 webhooks en GitHub** (el PAT no tiene permiso para crearlos por API): Repo → Settings → Webhooks → Add webhook, pegar cada URL de arriba, Content type = `application/json`, evento = `push`. Con eso, el auto-deploy a prod queda activo.
2. Cuando el VPS esté confirmado como prod, **apagar Railway/Vercel** (o dejarlos como staging).
