# Checklist de deploy

> Reescrito el **2026-09-04**. La versión anterior describía Railway, Vercel y
> unos secrets de GitHub que ya no existen: los servicios se dieron de baja y
> los 13 secrets se borraron ese mismo día. Nada de lo que decía aplicaba.

Hoy **los dos entornos viven en el VPS con Dokploy**. Detalle completo en
`docs/24-entornos-deploy.md`; esto es la versión corta para el momento de
deployar.

---

## Antes de nada: no se pushea a `main`

`main` **es** producción: cada push la reconstruye y **reinicia el casino en
vivo**, aunque el cambio sólo toque `docs/`. El flujo obligatorio está en
`AGENTS.md` §4.1 y es:

```
trabajás → push a `staging` → probás → merge a `main` → producción
```

La excepción es un hotfix, y se dice en voz alta.

---

## Pre-requisitos

**Ninguno que haya que configurar antes de un deploy.** No hacen falta secrets
en GitHub: el pipeline de deploy no existe más. Dokploy buildea solo, avisado
por un webhook, con la config que ya tiene guardada.

Lo único que hay que tener a mano para diagnosticar:

| | |
|---|---|
| Panel | https://dokploy.miamihub.vip |
| API | header `x-api-key`, token en `CASINO_DOKPLOY_TOKEN` |
| IDs de apps y entornos | `docs/24-entornos-deploy.md` |

---

## 1. Antes de mergear a `main`

- [ ] **CI verde en `staging`.** `gh run list --branch staging -L 1`
- [ ] **Probado en staging de verdad**, no sólo compilado:
      `staging.miamihub.vip` y `admin-staging.miamihub.vip`.
- [ ] Si el cambio toca **wallet, permisos o migraciones**, revisar `docs/LEYES.md`
      y decir qué leyes aplica.
- [ ] Si agrega una **variable `NEXT_PUBLIC_*`**, va como **build arg**, no como
      env. Ver la trampa más abajo.

```bash
git checkout main
git merge --ff-only staging
git push origin main
```

`--ff-only` a propósito: si falla es que las ramas divergieron y hay que mirar
por qué, en vez de dejar que git arme un merge que nadie revisó.

---

## 2. Mientras deploya

El push dispara los webhooks. **Dokploy buildea de a UNA app por vez**: si el
cambio toca API y web, el segundo build **espera** al primero — tarda la suma,
no el máximo. Entre 4 y 8 minutos por app.

```bash
curl -s -H "x-api-key: $CASINO_DOKPLOY_TOKEN" \
  "https://dokploy.miamihub.vip/api/deployment.all?applicationId=<id>" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s)[0];console.log(d.status, d.title)})"
```

> **Si una app sigue con la versión vieja, no asumas que se rompió el webhook.**
> Probablemente está en cola. Para descartarlo: GitHub → Settings → Webhooks →
> Recent Deliveries, o `gh api repos/OWNER/REPO/hooks/<id>/deliveries`.

**Las migraciones corren solas** al arrancar (`MIGRATE_ON_BOOT=1`) en los dos
entornos. No hay paso manual.

---

## 3. Después de deployar

```bash
curl -s https://api.miamihub.vip/health
```

Tiene que devolver `"db":"connected"` y `"redis":"connected"`. Después:

- [ ] `https://miamihub.vip` → **307 a `/play`**
- [ ] `https://admin.miamihub.vip` → **200**
- [ ] Si tocaste el front: abrir y mirar, no sólo el status code.

---

## Rollback

**El camino confiable es `git`:**

```bash
git revert <sha>
git push origin main
```

Otro deploy completo (4-8 min), pero es el que se sabe que funciona y deja
registro de qué se revirtió y por qué.

**Deploy manual sin push**, para re-desplegar la misma rama:

```bash
curl -s -X POST -H "x-api-key: $CASINO_DOKPLOY_TOKEN" \
  -H 'content-type: application/json' -d '{"applicationId":"<id>"}' \
  "https://dokploy.miamihub.vip/api/application.deploy"
```

> ⚠️ Dokploy guarda historial de deploys y la API expone un campo `rollbackId`,
> así que **probablemente** tenga rollback por deploy. **No se probó nunca.** No
> lo uses por primera vez con producción caída: probalo antes en staging, y
> cuando funcione, documentá acá cómo. Este archivo ya describió una vez
> procedimientos que nadie había ejecutado — no repitamos eso.

---

## Trampas conocidas (todas costaron tiempo real)

**`NEXT_PUBLIC_*` va en `buildArgs`, no en `env`.** Se hornean en el bundle al
compilar; setearlas como env de runtime **no actualiza el bundle**. Faltaban en
staging y el login devolvía 502 porque el servidor se llamaba a sí mismo.
Cargarlas con `application.saveEnvironment`, que exige **los cuatro** campos
(`env`, `buildArgs`, `buildSecrets`, `createEnvFile`) — si mandás uno solo, los
otros se pisan. **Cambiar un buildArg exige rebuild.**

**Rutas nuevas con extensión.** El matcher del middleware deja pasar las rutas
con extensión; sin ella, en el host del jugador se las come el redirect a
`/play`. Por eso `/icons/tenant-icon.png` termina en `.png`.

**Hosts de panel.** El front reconoce `admin.` y `admin-`. Un host nuevo que no
empiece así sirve la interfaz de jugador, no el panel.

**No se puede ejecutar nada adentro del VPS por la API de Dokploy.** El puerto
de Postgres lo bloquea el firewall y los Schedules fallan sin dejar log. Para
seeds y mantenimiento: terminal del VPS y `docker exec`. Ver `docs/24`.

---

## Si algo se rompe

1. `docs/26-monitoreo-diagnostico.md` — qué mirar y en qué orden.
2. `docs/runbooks/disaster-recovery.md` — backups (restauración **probada** el
   2026-09-04, invariante del ledger incluido).
3. Los logs **no salen por la API REST** de Dokploy: se bajan del panel.
