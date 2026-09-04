# 24 · Entornos y deploy (staging + producción)

> Dos entornos, dos ramas. **Staging** para probar, **producción** para los usuarios.
> **Los dos viven en el mismo VPS con Dokploy** desde el 2026-09-04.
> Ver también `docs/23-migracion-vps.md` (cómo se montó el VPS).

---

## Los dos entornos

| | **Staging (prueba)** | **Producción** |
|---|---|---|
| **Rama** | `staging` | `main` |
| **Infra** | **VPS + Dokploy**, entorno `staging` | **VPS + Dokploy**, entorno `production` |
| **Deploy** | Dokploy (autoDeploy via webhook) | Dokploy (autoDeploy via webhook) |
| **Casino (web)** | `staging.miamihub.vip` | `miamihub.vip` |
| **Panel** | `admin-staging.miamihub.vip` | `admin.miamihub.vip` |
| **API** | `api-staging.miamihub.vip` | `api.miamihub.vip` |
| **WebSocket** | `ws-staging.miamihub.vip` | `ws.miamihub.vip` |
| **Postgres** | `casino-postgres-staging-7qarjo` | `casino-postgres-ribula` |
| **Redis** | `casino-redis-staging-n61anc` | `casino-redis-32f1iv` |
| **Migraciones** | automáticas (`MIGRATE_ON_BOOT=1`) | automáticas (`MIGRATE_ON_BOOT=1`) |
| **Backups** | ninguno (a propósito) | Dokploy → R2, `0 6 * * *` |

> **Railway y Vercel salieron de escena** el 2026-09-04. El staging viejo corría en
> otro runtime que producción (ignoraban los Dockerfiles), así que había una clase
> entera de bugs que no podía aparecer hasta prod. Ahora los dos entornos usan la
> **misma imagen, el mismo Postgres, el mismo Redis y el mismo proxy**.

### Lo que staging NO comparte con producción

Aislado **a propósito**, no por omisión:

| | Por qué |
|---|---|
| **Postgres y Redis propios** | Contenedores y volúmenes separados. Una migración que traba tablas o una prueba de carga no puede tocar prod. |
| **`JWT_ACCESS_SECRET` / `REFRESH` distintos** | Un token emitido en staging **no debe valer en producción**. Es la separación más importante de todas. |
| **`STORAGE_DRIVER=local`** | Si apuntara a `casino-uploads`, los comprobantes de prueba se mezclarían con los reales (que son documentos financieros). En staging los archivos son efímeros. |
| **Sin `TELEGRAM_*`** | Staging no despierta al dueño a las 3 AM. Si algún día hay que probar las alertas, se agregan con **otro** `chat_id`. |
| **`AXIOM_DATASET=casino-api-staging`** | Para no ensuciar los logs de prod. ⚠️ **Falta crear ese dataset en Axiom**: hasta entonces staging no envía logs (no rompe nada, sólo no llegan). |
| **`SENTRY_ENVIRONMENT=staging`** | Mismo DSN, pero los errores quedan separados. |
| **`LOG_LEVEL=debug`** | En prod es `info`. |

---

## Flujo de trabajo

```
  programás  →  push a `staging`  →  Dokploy deploya staging  →  probás
                                                                     │
                                                           todo OK   ▼
                     merge `staging` → `main`  →  Dokploy deploya producción
```

1. Trabajás y pusheás a **`staging`**. El webhook dispara el build del entorno staging.
2. Probás en `staging.miamihub.vip` / `admin-staging.miamihub.vip`.
3. Cuando está OK: **`git checkout main && git merge staging && git push`**.
4. Las migraciones corren solas en los dos entornos (`MIGRATE_ON_BOOT=1`).

> **`ci.yml` corre en las dos ramas** (`main` y `staging`): lint, build, type-check
> y la suite de tests con Postgres y Redis reales.

---

## Cómo deploya cada uno

Los dos igual: **Dokploy autoDeploy**. Cada app tiene `autoDeploy: true`, un
`refreshToken` propio y un webhook registrado en GitHub. **Dokploy filtra por
rama** — compara la rama del payload con el `customGitBranch` de la app, así que
un push a `staging` no toca producción y viceversa (los que no matchean quedan
como "Branch Not Match" y se ignoran).

**4 webhooks** en GitHub → Settings → Webhooks, todos a
`https://dokploy.miamihub.vip/api/deploy/<refreshToken>`: api-prod, web-prod,
api-staging, web-staging. El `refreshToken` de cada uno sale de
`application.one?applicationId=…`, campo `refreshToken`.

**Deploy manual** (sin push): botón "Deploy" en el panel, o
`POST /api/application.deploy {applicationId}`.

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

> ## 🛑 El método de "abrir el puerto externo" NO FUNCIONA
>
> Probado el 2026-09-04 contra el Postgres de staging: se abrió el puerto por
> API (`saveExternalPort` + `deploy`, ambos 200, `externalPort` confirmado en
> `postgres.one`) y **la conexión desde afuera igual da `ETIMEDOUT`**. Se probó
> con 5433 y 5434. **Lo bloquea el firewall del VPS**, que no se administra desde
> Dokploy sino desde el panel de Hostinger.
>
> El procedimiento que estaba escrito acá era teórico: nunca se había ejecutado.

**Lo que sí funciona: entrar al contenedor.** La imagen de la API es de una sola
etapa, así que adentro está **todo el workspace** — `packages/db`, sus
`node_modules`, `pnpm` y `tsx` — y las env vars con las URLs de las DBs ya
resueltas. Desde una terminal en el VPS:

```bash
docker exec -it $(docker ps -q -f name=casino-api-staging) \
  sh -c 'cd /app && pnpm --filter @casino/db db:migrate:control'
```

Cambiar `casino-api-staging` por `casino-api-hnwmew` para producción.

> ⚠️ Área sensible (corre contra todas las DB de tenants). Probar en staging primero.

### Los "Schedules" de Dokploy tampoco sirvieron

Se intentó correr el seed con `schedule.create` + `schedule.runManually`
(`scheduleType: application`, con y sin `serviceName`). Devuelve
`{"status":"error"}` a los ~110 ms, **sin `errorMessage`**, y el log queda en un
archivo del host (`/etc/dokploy/schedules/…`) que **no se puede leer por la API**
(`settings.readFile` y `settings.getLogFile` dan 404; `settings.readDirectories`
sólo lista `/etc/dokploy/traefik`).

O sea: falla y no dice por qué. **No perder tiempo ahí** — usar `docker exec`.


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

Proyecto `casino` = `H6XsenvgAOoSaDbruVFyW`.
Entornos: `production` = `myIey9qLleUjGJbMacObN` · `staging` = `ylHvTv-aGH_qIhvENgxIu`.

> **Los servicios cuelgan del ENTORNO, no del proyecto.** En
> `project.one?projectId=…` hay que mirar `environments[].applications`,
> `environments[].postgres`, etc. Buscarlos en la raíz del proyecto da vacío y
> parece que no hay nada.

**Producción** (`myIey9qLleUjGJbMacObN`):

| Servicio | ID | `appName` (contenedor) |
|---|---|---|
| api | `vuHpnpqQpHNWtn3hx2OiL` | `casino-api-hnwmew` |
| web | `nhixQ81wm-GcO1UOSeZom` | `casino-web-0rym78` |
| postgres | `9x70ajiK4nG_IiJIznaLd` | `casino-postgres-ribula` |
| redis | `Cb9em-JqPrDxOhJPZDJQd` | `casino-redis-32f1iv` |

**Staging** (`ylHvTv-aGH_qIhvENgxIu`, creado 2026-09-04):

| Servicio | ID | `appName` (contenedor) |
|---|---|---|
| api | `6_TpWKImdtRCCrewRL2mF` | `casino-api-staging-ss8ssp` |
| web | `PdF0IrGKk-rEm-rGI8ghU` | `casino-web-staging-3d2ikw` |
| postgres | `TuNmz8cDDJFc3-5hQ5jRo` | `casino-postgres-staging-7qarjo` |
| redis | `v5TKmV0ZS-v5FoaT6fxLu` | `casino-redis-staging-n61anc` |

### Crear servicios por API (verificado 2026-09-04)

Todo el staging se armó por API. Los endpoints de creación existen aunque no
figuren en ningún `openapi.json` (`/api/openapi.json` da 404).

| Endpoint | Campos obligatorios |
|---|---|
| `environment.create` | `name`, `projectId` |
| `postgres.create` | `name`, `databaseName`, `databaseUser`, `databasePassword`, `environmentId` |
| `redis.create` | `name`, `databasePassword`, `environmentId` |
| `application.create` | `name`, `environmentId` |
| `application.update` | `applicationId` + los campos a cambiar |
| `domain.create` | `host` (+ `applicationId`, `port`, `https`, `certificateType`) |

**Truco para descubrir campos:** mandar `POST` con `{}`. El 400 devuelve un
`zodError.fieldErrors` con exactamente lo que falta. Más rápido que adivinar.

⚠️ **`application.create` no configura el repo.** Hay que seguirlo con un
`application.update` que setee `sourceType: 'git'`, `customGitUrl`,
`customGitBranch`, `buildType`, `dockerfile` y `dockerContextPath`. Sin eso la app
queda creada pero sin nada que buildear.

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

- **VPS**: Hostinger KVM 4 (4 vCPU, 16 GB RAM, ~200 GB NVMe), IP `147.93.32.111`.
  Dokploy en `https://dokploy.miamihub.vip` (token en `CASINO_DOKPLOY_TOKEN`,
  header `x-api-key`).
- Prod buildea de **`main`**, staging de **`staging`**, las dos por Dockerfile
  (API: `Dockerfile` raíz; Web: `apps/web/Dockerfile`; context `.`). Git source =
  HTTPS con un PAT embebido en la URL del repo.
- **Secrets**: en Dokploy, en el env de cada app. Dokploy es la fuente de verdad —
  no hay copia de esas contraseñas en ningún otro lado.
- **DNS**: Cloudflare, zona `miamihub.vip` (`c22276d0757c66b8c450c9af7ceeadfa`).
  Todos los registros son `A → 147.93.32.111` **proxied** (nube naranja).
- Más detalle en `docs/23-migracion-vps.md`.

---

## Pendientes

1. **Crear el dataset `casino-api-staging` en Axiom.** Hasta entonces staging no
   manda logs. No rompe nada, sólo no llegan.
2. **Decidir con qué datos arranca staging.** Hoy el `platform_control` de staging
   está **migrado pero vacío**: no hay ningún tenant. Ver más abajo.
3. **Dar de baja Railway y Vercel**, y borrar los secrets huérfanos de GitHub
   (`BACKUP_PG*`, `DATABASE_URL_CONTROL`). Ver `docs/runbooks/disaster-recovery.md`.

### Con qué datos arranca staging

La DB de staging existe y está migrada, pero **sin tenants**. Se decidió sembrar
un **tenant nuevo y vacío** con `db:seed:pilot` (crea tenant + admin, nada más:
ni métodos de pago, ni bonos, ni saldos falsos).

**No se copia producción.** Es lo más realista y lo más peligroso: son datos
reales de jugadores en un entorno con menos protecciones. Si algún día hace
falta, hay que anonimizar primero.

El comando, desde una terminal en el VPS (elegir una contraseña propia):

```bash
docker exec -it $(docker ps -q -f name=casino-api-staging) sh -c 'cd /app && pnpm --filter @casino/db db:seed:pilot -- --slug=staging --name=Staging --host=staging.miamihub.vip --admin-user=admin --admin-email=admin@staging.miamihub.vip --admin-pass=PONER_UNA'
```

Es idempotente: si ya existe, refresca los datos y re-setea el password.

Después hay que agregar el dominio del panel, porque el seed inserta uno solo:

```bash
docker exec -i $(docker ps -q -f name=casino-postgres-staging) psql -U postgres -d platform_control -c "INSERT INTO tenant_domains (id, tenant_id, domain, is_primary, verified_at) SELECT gen_random_uuid(), id, 'admin-staging.miamihub.vip', false, now() FROM tenants WHERE slug='staging' ON CONFLICT (domain) DO NOTHING;"
```

> Ojo con dos cosas del schema de `tenant_domains`, que es fácil errarle:
> **`id` no tiene default en la DB** (Drizzle lo genera del lado JS), así que hay
> que pasarlo explícito; y **la verificación es `verified_at` (timestamp), no un
> booleano `verified`**.
