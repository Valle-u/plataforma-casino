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

## Migraciones en producción (VPS)

### Automático — `MIGRATE_ON_BOOT` (default, desde 2026-08-25)

El **api migra solo al arrancar** si su env tiene **`MIGRATE_ON_BOOT=1`** (seteado
en el env de la app `api` en Dokploy). En el boot (`apps/api/src/main.ts`, antes
de servir tráfico) corre `migrateAllDatabases()` (`@casino/db`): aplica las
migraciones pendientes de **control + todos los tenants** reusando el `migrate()`
de drizzle-orm. Idempotente (saltea las aplicadas) y **fail-fast** (si una falla,
el api NO arranca → se ve en los logs de Dokploy). Llega a la DB por la **red
interna** de Docker (no abre el firewall) y usa el `DATABASE_URL_CONTROL` que la
app ya tiene. **Cada redeploy del api aplica lo pendiente** — no hay paso manual.

> ⚠️ Pensado para **1 réplica** del api. Con >1 réplica hay que agregar un lock
> (advisory lock) para que dos boots no migren en paralelo.
> Apagar: borrar `MIGRATE_ON_BOOT` (o `=0`) → vuelve al modo manual de abajo.

### Manual (fallback / si `MIGRATE_ON_BOOT` está OFF)

1. Abrir el puerto externo del Postgres temporalmente (Dokploy API):
   `POST /api/postgres.saveExternalPort {postgresId, externalPort: 5433}` + `POST /api/postgres.deploy`.
2. Desde local, con `DATABASE_URL_CONTROL` apuntando a `147.93.32.111:5433`:
   - `pnpm --filter @casino/db db:migrate:control`
   - `pnpm --filter @casino/db db:migrate:tenants` (corre contra cada tenant registrado).
3. **Cerrar el puerto** de nuevo: `saveExternalPort {externalPort: null}` + `postgres.deploy`.

> ⚠️ Área sensible (corre contra todas las DB de tenants). Probar en staging primero.

---

## API de Dokploy — cómo consultarla (verificado 2026-08-28)

**Base URL:** `https://dokploy.miamihub.vip/api` — el `:3000` que figuraba antes
está muerto.

**Autenticación: header `x-api-key`.** No `Authorization: Bearer`. Es la fuente de
la mitad de los 401 que se arrastraron durante días: el otro header devuelve 401
aunque el token sea válido.

```bash
curl -s -H "x-api-key: $CASINO_DOKPLOY_TOKEN" \
  "https://dokploy.miamihub.vip/api/project.all"
```

> ⚠️ **Un 401 NO significa "token inválido".** El muro de autenticación está
> montado sobre el prefijo `/api`, así que **cualquier** ruta ahí abajo devuelve
> 401 sin autenticar, exista o no. No se puede distinguir token malo de ruta mala
> por el código de respuesta. Para diagnosticar, probar primero un endpoint que
> se sabe que existe (`project.all`) con un token recién generado.

### Endpoints útiles

| Endpoint | Para qué |
|---|---|
| `project.all` | Lista de proyectos (shallow — los servicios NO vienen acá). |
| `project.one?projectId=…` | Detalle. **Los servicios cuelgan de `environments[]`**, no del proyecto. |
| `deployment.all?applicationId=…` | Historial de deploys con estado, commit y fecha. Sirve para responder "¿esto ya deployó?" sin adivinar. |
| `application.one?applicationId=…` | Config y estado de una app. |
| `docker.getServiceContainersByAppName?appName=…` | Contenedores, con su `containerId` y si están `running`. |
| `docker.getConfig?containerId=…` | Config del contenedor. |

### IDs del proyecto

Proyecto `casino` = `H6XsenvgAOoSaDbruVFyW` · entorno `production` =
`myIey9qLleUjGJbMacObN`.

| Servicio | ID | `appName` (contenedor) |
|---|---|---|
| api | `vuHpnpqQpHNWtn3hx2OiL` | `casino-api-hnwmew` |
| web | `nhixQ81wm-GcO1UOSeZom` | `casino-web-0rym78` |
| postgres | `9x70ajiK4nG_IiJIznaLd` | `casino-postgres-ribula` |
| redis | `Cb9em-JqPrDxOhJPZDJQd` | `casino-redis-32f1iv` |

### Los logs NO salen por la API REST

`docker.getContainerLogs`, `docker.getLogs` y `/docker-container-logs` por HTTP
dan **404**. Dokploy transmite los logs por **WebSocket**, no por REST.

El WS `/docker-container-logs?containerId=…&tail=N` acepta el upgrade (HTTP 101)
pero cierra sin mandar datos. Se probaron cinco combinaciones de parámetros
(`runType=swarm|native`, nombre de contenedor en vez de id, `appName`,
`serviceType`) y ninguna devolvió nada; con `appName` cierra con código 4000.
**No se determinó si falta autenticación o parámetros.**

Para retomarlo haría falta un cliente WebSocket que mande headers en el
handshake: el `WebSocket` nativo de Node no los soporta y el paquete `ws` no está
instalado en el repo. Mientras tanto, los logs se bajan desde el panel.

## Referencia rápida

- **VPS**: IP `147.93.32.111`, Dokploy en `https://dokploy.miamihub.vip` (token en
  env var `CASINO_DOKPLOY_TOKEN`, header `x-api-key` — ver arriba).
- Apps buildean de **`main`** por Dockerfile (API: `Dockerfile` raíz; Web: `apps/web/Dockerfile`; context `.` los dos). Git source = HTTPS con `CASINO_GITHUB_TOKEN`.
- **Secrets de prod (VPS)**: en Dokploy (env de cada app). Se reusaron los de Railway. `STORAGE_PUBLIC_BASE_URL` quedó fuera (re-agregar si falla el storage).
- Más detalle e IDs en [[vps-migration-plan]] (memoria) y `docs/23-migracion-vps.md`.

---

## Setup manual pendiente (una sola vez)

1. **Agregar los 2 webhooks en GitHub** (el PAT no tiene permiso para crearlos por API): Repo → Settings → Webhooks → Add webhook, pegar cada URL de arriba, Content type = `application/json`, evento = `push`. Con eso, el auto-deploy a prod queda activo.
2. Cuando el VPS esté confirmado como prod, **apagar Railway/Vercel** (o dejarlos como staging).
