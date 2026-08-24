# 25 — Seguridad: Cloudflare (anti-DDoS) + roadmap de hardening

> Runbook creado el 2026-08-24. Estado: **Cloudflare en propagación** (esperando que los
> nameservers apunten a CF). Cuando el dominio quede **Active**, seguir el checklist de abajo.

---

## Contexto

`miamihub.vip` se puso detrás de **Cloudflare (plan Free)** para anti-DDoS + WAF básico +
esconder la IP del origen. Cuenta Cloudflare: **`5627e3f2c291921ece435f3cca6463c5`** (la
misma de R2/backups). El origen es el VPS **`147.93.32.111`** (Traefik + Let's Encrypt).

### Estado actual (2026-08-24) — Fase 1 casi lista
- **Zona creada** en Cloudflare, plan **Free**.
- **Nameservers** de CF: `ainsley.ns.cloudflare.com` + `miles.ns.cloudflare.com` — ya
  cargados en Hostinger (reemplazan `helios/aster.dns-parking.com`). **Propagando.**
- **Registros DNS** (6):
  | Registro | Proxy | Motivo |
  |---|---|---|
  | `miamihub.vip` (@) | 🟠 Proxied | jugador |
  | `www` (CNAME→@) | 🟠 Proxied | jugador |
  | `admin` | 🟠 Proxied | panel |
  | `api` | 🟠 Proxied | API |
  | `ws` | 🟠 Proxied | WebSocket CRM (CF soporta WS en Free) |
  | `dokploy` | ⚪ **Solo DNS (gris)** | acceso directo a deploys/panel — NO por CF |
- **SSL/TLS = Full (strict)** ✅ (CF cifra hasta el origen y valida el cert LE existente).
- **DNSSEC**: desactivado (dejar así hasta que active; se puede reactivar por CF después).

> ⚠️ **`dokploy` quedó directo (gris)** a propósito, para que el auto-deploy y el acceso a
> la API de Dokploy (`https://dokploy.miamihub.vip/api`) NO dependan de CF. Ver [[deploy-infra]]
> y `docs/23`. Esto tiene una consecuencia para la Fase 2 (ver abajo).

---

## ✅ Checklist AL ACTIVAR (Fase 1 — verificación)

Cuando CF marque el dominio **Active** (email + dashboard):

1. Verificar que los proxeados respondan **por CF** (header `cf-ray` presente) y HTTPS OK:
   `miamihub.vip/play`, `www`, `admin.miamihub.vip/login`, `api.miamihub.vip/health`.
2. Verificar **WebSocket del CRM** por `wss://ws.miamihub.vip` (abrir el widget/bandeja y ver
   que conecte en tiempo real).
3. Verificar que **`dokploy.miamihub.vip`** siga **directo** (sin `cf-ray`) y que el
   auto-deploy siga andando (push a `main` → deploy).
4. Verificar que el **cert de perímetro (Universal SSL)** de CF ya cubra `miamihub.vip` +
   `*.miamihub.vip` (SSL/TLS → Edge Certificates). Puede tardar minutos tras activar.
5. Login del jugador y del panel + API health OK end-to-end.

---

## 🎯 Roadmap de hardening (post-activación, por prioridad)

Todo lo de abajo es **aditivo** y casi todo **gratis**. El usuario eligió arrancar por
**Turnstile + Bot Fight Mode** apenas active, y después el resto.

### 1. ⭐ Turnstile (CAPTCHA de Cloudflare) en login / registro / retiros
- Gratis, nativo de CF. Frena bots, cuentas falsas, abuso de bonos, credential-stuffing.
- Hay skill `turnstile-spin` para el setup end-to-end (crear widget vía API CF + embeber +
  verificar server-side con siteverify).
- **Dónde**: formularios de **login del jugador**, **registro**, y idealmente **solicitud de
  retiro** (punto sensible de plata). El panel/admin es secundario (acceso interno).
- Requiere: sitekey + secret (crear el widget en CF), componente en el front, y validación en
  el endpoint del backend (NestJS) antes de procesar. Mantener detrás de un flag para poder
  apagarlo si molesta.

### 2. Rate limiting en login / API
- **Cloudflare**: reglas de rate limiting (Free tiene un tier básico) sobre `/…/auth/login`.
- **App**: ya hay bloqueo por `failed_login_attempts` + `locked_until` en `users`. Reforzar
  con throttling por IP en los endpoints de auth si hace falta (`@nestjs/throttler`).

### 3. Forzar 2FA para admin y operadores (staff)
- La capacidad existe (`TWO_FA_POLICY_ENABLED`, `two_fa_*` en `users`). Exigir 2FA al staff
  (roles que tocan plata/permisos), no opcional. Ver `docs/12-seguridad-compliance.md`.

### 4. 🔒 Fase 2 — Blindar el firewall del VPS a IPs de Cloudflare
**Objetivo**: que el origen (`147.93.32.111`) SOLO acepte tráfico de Cloudflare en 80/443,
para que nadie pueda saltarse CF pegándole a la IP directa.
- ⚠️ **HACER SOLO DESPUÉS de verificar que CF está activo y todo anda por CF** (si se hace
  antes, se cae la plataforma).
- **Cómo**: en el firewall de red de Hostinger, permitir en 80/443 solo los rangos de CF
  (https://www.cloudflare.com/ips-v4 y `/ips-v6`, ~15 CIDRs v4 + v6). Mantener **SSH (22)**
  abierto (idealmente restringido a la IP del dueño).
- ⚠️ **Problema del `dokploy` gris**: si cerramos 443 a solo-CF, `dokploy.miamihub.vip`
  (directo) queda **bloqueado** → se pierde el acceso al panel y a la API de deploys.
  Opciones a decidir cuando lleguemos:
  - (a) **Proxear `dokploy` por CF también** (naranja) → queda cubierto por el allow de CF.
    Requiere confirmar que el panel (WebSocket de logs en vivo) y el webhook de GitHub andan
    por CF. Es lo más limpio.
  - (b) Dejar `dokploy` gris y **agregar la IP del dueño** como origen permitido en 443 (o un
    puerto propio para el panel).
- 💡 **Recomendado junto con la Fase 2**: cambiar el cert del origen (Traefik) a un
  **Cloudflare Origin Certificate** (15 años, no renueva por HTTP-01) para los hosts
  proxeados. Así el `next()` de Let's Encrypt (challenge HTTP-01 por puerto 80) deja de ser
  una dependencia y no hay riesgo de que el firewall/CF rompa la renovación. Requiere tocar la
  config de Traefik en Dokploy. (Con LE actual + CF proxy la renovación *debería* seguir
  andando mientras el puerto 80 llegue al origen y NO se active "Always Use HTTPS" en CF sin
  excepción para `/.well-known/acme-challenge/*`.)

### 5. Bot Fight Mode
- SSL/TLS → Security / Bots → **Bot Fight Mode** ON. Gratis, bloquea bots maliciosos
  automáticamente. Solo actúa con CF activo.

### 6. Higiene (importante, menos urgente)
- **Monitoreo/alertas** (se pospuso): Sentry (los env `NEXT_PUBLIC_SENTRY_*` ya existen —
  confirmar si está configurado), un uptime monitor externo, y alertas de Dokploy
  (Telegram/Discord) para deploys caídos / server saturado.
- **Rotar secretos expuestos**: las credenciales de R2 se vieron en chat durante setup →
  crear token nuevo + actualizar. Ver [[deploy-infra]].
- **Probar restauración** de un backup (tenemos backups diarios pero sin prueba de restore).
- **"Always Use HTTPS"** en CF: NO activar sin una excepción para
  `/.well-known/acme-challenge/*`, o romper la renovación de LE del origen (salvo que se pase
  a Origin Certificate, ver #4).

---

## Notas operativas
- **Under Attack Mode**: botón en CF (Overview → Quick Actions). Prenderlo SOLO durante un
  ataque activo (mete un desafío a cada visitante; molesta en uso normal).
- La protección anti-DDoS **ya queda funcionando con la Fase 1** (apenas active). La Fase 2 es
  blindaje extra, no un requisito para estar protegido.
- Monitor de propagación de esta sesión: background task que checkea los NS hasta que apunten
  a CF (o timeout ~45 min).
