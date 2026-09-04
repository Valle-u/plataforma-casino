# 23 · Migración a VPS (Hostinger + Dokploy)

> Runbook para mudar la plataforma de **Railway (API) + Vercel (web)** a un **VPS
> de Hostinger con Dokploy** (proxy Traefik). Estado y análisis previo en la
> memoria `vps-migration-plan`. Este doc es el paso a paso concreto.

---

## Decisiones tomadas (2026-08-23)

1. **VPS**: Hostinger **KVM 4** (4 vCPU, 16 GB RAM, **~96 GB** de disco).
   Postgres + API + web + Traefik + Redis + el propio Dokploy. Se puede escalar.

   > **⚠️ Corregido el 2026-09-04: son 95,82 GB, no los ~200 GB que decía acá.**
   > Lo dice el banner del propio servidor al entrar por SSH
   > (*"Usage of /: 14.1% of 95.82GB"*). El número viejo salió del plan de
   > compra, no de mirar la máquina, y **el margen real es la mitad de lo que
   > se creía**.
   >
   > Importa más de lo que parece: el disco se llena con imágenes y caché de
   > Docker de **cada build** (ver `docs/26` §4.6), y **si se llena, Postgres
   > deja de escribir**.

2. **Arranque = atajo de dominio fijo**: 1 solo casino (**MIAMI HUB**) en un
   dominio fijo + subdominios. Traefik se configura a mano por dominio y se
   **difiere toda la automatización de TLS multi-tenant** (el bloqueante mayor).
3. **Storage**: seguir con **Cloudflare R2** (`STORAGE_DRIVER=r2`). Sin cambio de
   código; los uploads sobreviven redeploys.

---

## Qué comprar / preparar (antes de tocar nada)

- [ ] **VPS Hostinger KVM 4**. Si ofrece **template de Dokploy** (1-click), usarlo;
      si no, **Ubuntu 24.04 LTS** e instalar Dokploy a mano (Fase 1).
- [ ] **1 dominio** (el del casino). Se puede registrar en Hostinger o donde sea.
- [ ] **DNS en Cloudflare** (recomendado, gratis — y ya usamos R2 ahí). Facilita
      certificados wildcard a futuro y da proxy/caché/DDoS. Alternativa: DNS de
      Hostinger (alcanza para el atajo con TLS por-dominio HTTP-01).
- [ ] Tener a mano los **secrets actuales** (los mismos JWT/Palace/R2 que hoy) —
      se reusan para no invalidar sesiones ni romper el callback del proveedor.

---

## Esquema de dominios (atajo — 1 casino)

Todos apuntan a la **IP del VPS** (registro A). Reusa el modelo actual
(player + admin conviven en el mismo web, separados por subdominio; API aparte):

| Subdominio | Sirve | Servicio |
|---|---|---|
| `midominio.com` (+ `www`) | Casino (jugador) | **web** (Next) |
| `admin.midominio.com` | Panel del operador | **web** (mismo, `X-Panel` por ruta) |
| `api.midominio.com` | API REST | **api** (NestJS) |
| `ws.midominio.com` | WebSocket del CRM | **api** (socket.io) |
| `soporte.midominio.com` | Inbox del CRM (futuro, §11 doc 22) | **web** (diferido) |

**En `tenant_domains`** (DB de control): registrar `midominio.com` **y**
`admin.midominio.com` apuntando al tenant MIAMI HUB (el resolver de tenant es por
host). `api.`/`ws.` no van a `tenant_domains` (el tenant lo resuelve el header
`X-Tenant-Host` que manda el web).

---

## Fase 0 — Preparación del repo ✅ HECHA (rama `chore/vps-prep`, commit `7a89ef7`)

Sin mergear a main (main sigue deployando a Railway+Vercel). Todo
backward-compatible. Incluye:
- `Dockerfile` (API, raíz) y `apps/web/Dockerfile` (Next `output: 'standalone'`).
- `/api/health` (web) + `GET /health` (API) para el healthcheck de Traefik.
- `start` del web respeta `$PORT` (antes 3001 fijo).
- CORS por env `CORS_ORIGINS` (fallback a Vercel) — sale el hardcode de `main.ts`.
- Validación de env con zod al bootear (`apps/api/src/config/env.validation.ts`).
- `normalizeStorageUrl` toma orígenes de env; fix de `backup-all.sh`.
- `.env.example` de api y web regenerados.

**Pendiente de Fase 0**: **build-testear las imágenes Docker** (nunca se buildearon).
→ Se hace en el VPS, o instalando **Docker Desktop** en Windows para probarlas antes
(recomendado; es el riesgo sin verificar más grande). `docker-compose.yml` del repo
es **solo para dev local** (Postgres + Redis), NO el stack de prod.

---

## Fase 1 — Stack en el VPS

1. **Apuntar DNS**: registros A de los subdominios → IP del VPS. (Con Cloudflare,
   arrancar en modo "DNS only"/gris para que Let's Encrypt HTTP-01 valide; se
   puede prender el proxy naranja después.)
2. **Instalar Dokploy** (si no vino por template): `curl -sSL https://dokploy.com/install.sh | sh`.
   Entrar al panel de Dokploy (`http://IP:3000`), crear usuario admin.
3. **Postgres**: crear el servicio Postgres 18 en Dokploy (o docker-compose) con
   **volumen persistente**. Crear el rol de la app con **`CREATEDB`** (la API crea
   las DB de tenant en runtime). Ideal: rol de *provisioning* (CREATEDB) separado
   del de *runtime*. Crear la DB de control `platform_control`.
4. **Redis**: servicio Redis (para rate-limit y, a futuro, el adapter de socket.io
   multi-instancia).
5. **Deploy API**: app Dokploy desde el repo (branch de deploy), Dockerfile raíz.
   Cargar todas las env (ver checklist abajo). Health: `GET /health`.
6. **Deploy web**: app Dokploy, `apps/web/Dockerfile`. ⚠️ Los `NEXT_PUBLIC_*` son
   **build args** (se hornean en el bundle) — setearlos en la config de build de
   Dokploy, no solo como env de runtime.
7. **Correr migraciones**: `pnpm --filter @casino/db db:migrate:control` +
   `db:migrate:tenants` (una vez, contra el Postgres del VPS). Decidir si va como
   job manual o step del deploy.

---

## Fase 2 — TLS + dominios (atajo)

- En Dokploy, asignar cada dominio a su app → Dokploy pide el **cert Let's Encrypt
  por-dominio (HTTP-01)** automáticamente. Con pocos dominios fijos alcanza y
  sobra; **no** automatizamos alta de cert por tenant todavía.
- **Opción wildcard** (más prolijo, opcional): si el DNS está en Cloudflare,
  configurar Traefik con **DNS-01 + token de Cloudflare** para un cert
  `*.midominio.com` único que cubre todos los subdominios.
- **Anti-spoofing**: el borde (Traefik) debe **sanear/limpiar `X-Tenant-Host` y
  `X-Forwarded-*`** entrantes del cliente (que no puedan falsear el tenant). Hoy en
  dev se confía; en el VPS hay que enforcarlo.

---

## Fase 3 — Cutover (migrar datos + DNS + verificar)

1. **Dump de Railway**: `pg_dump` de `platform_control` **y de cada `tenant_<slug>`**
   (Postgres de prod es **v18** → usar `pg_dump` ≥ 18). Reusa la lógica de
   `scripts/backup-all.sh` (ojo el fix del slug con guión vs dbName con `_`).
2. **Restore en el VPS**: `pg_restore`/`psql` de cada dump en el Postgres nuevo.
3. **Verificar ANTES de cortar DNS**: probar el VPS con el dominio real vía
   `/etc/hosts` (o un dominio de staging) → login, wallet, un juego (Palace),
   depósito, y el CRM. Que todo ande contra los datos migrados.
4. **Callback de Palace**: actualizar en el panel de Palace la **URL del callback**
   al nuevo `https://api.midominio.com/...` (seamless). Sin esto, los juegos no
   liquidan. (Ídem cualquier webhook externo.)
5. **Cambiar DNS**: apuntar los dominios a la IP del VPS (bajar el TTL antes para
   que propague rápido).
6. **Verificar en vivo** + monitorear (Sentry).
7. **Apagar Railway/Vercel** recién cuando esté confirmado (dejar en standby unos
   días como red de seguridad).

**Rollback**: volver el DNS a Vercel/Railway. Los datos viejos siguen en Railway
hasta confirmar la migración → no se pierde nada.

---

## Checklist de env vars (ver `apps/api/.env.example` y `apps/web/.env.example`)

**API** (runtime, en Dokploy):
- `DATABASE_URL_CONTROL`, `DATABASE_URL_TENANT_TEMPLATE` (con `<tenant_db>`)
- `JWT_ACCESS_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_SECRET`, `JWT_REFRESH_TTL`
  (⚠️ **reusar los actuales** para no invalidar sesiones)
- `REDIS_URL`
- `STORAGE_DRIVER=r2` + `R2_*` (mismas credenciales que hoy)
- `PALACE_CALLBACK_TOKEN` + config del proveedor
- `CORS_ORIGINS=https://midominio.com,https://admin.midominio.com` (nuevo, Fase 0)
- `CRM_ENABLED=1` (si se deja el CRM prendido) · `SSR_AUTH=1`
- VAPID (`VAPID_*`) para push

**Web** (build args, en la config de build de Dokploy):
- `NEXT_PUBLIC_API_URL=https://api.midominio.com`
- `NEXT_PUBLIC_TENANT_HOST=midominio.com`
- `NEXT_PUBLIC_CRM_ENABLED=1` (si va el CRM)
- `NEXT_PUBLIC_SENTRY_*` si aplica

---

## Pendientes/decisiones que NO bloquean comprar, pero sí el cutover

- **CI/CD nuevo**: hoy el deploy es GitHub Actions → Railway/Vercel. Rehacer para
  Dokploy (webhook de deploy de Dokploy, o `git push` a la app de Dokploy).
- **Dónde corren las migraciones** en el nuevo pipeline (Fase 1.7).
- **Email**: sigue `ConsoleEmailProvider` (no envía). No bloquea login/reset
  (reset es admin-driven). Integrar un provider real solo si se necesitan mails.
- **Pool de DB**: calibrado para ~2 tenants; con más, evaluar LRU/PgBouncer.

---

## Próximos pasos concretos (sin comprar todavía)

1. (Opcional, recomendado) Instalar **Docker Desktop** en Windows → build-testear
   `Dockerfile` y `apps/web/Dockerfile` localmente para de-riesgar Fase 0.
2. Escribir el **`docker-compose` de PROD** (api + web + traefik + postgres + redis
   con labels de Traefik) en la rama `chore/vps-prep`, listo para Dokploy.
3. Escribir el **script de dump/restore** (Railway → VPS) reusando `backup-all.sh`.
4. Comprar VPS + dominio → ejecutar Fase 1.
