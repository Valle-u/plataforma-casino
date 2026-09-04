# Disaster Recovery Runbook

> **Audiencia**: dueño + futuros operadores del sistema. **Status**: MVP — primera versión.
> Versionar cada vez que se agregue/cambie un proceso destructivo.

## Filosofía

Multi-tenant DB-per-tenant + DB de control. El "blast radius" de cualquier
incidente está acotado al tenant afectado (o a la DB de control si afecta
el provisioning). Recovery se hace por tenant, no por toda la plataforma.

Backups son `pg_dump` por DB (control + cada tenant), retenidos en R2 (o
local + offsite copy en MVP). RTO target: **<2h por tenant**. RPO target:
**24h** (backup diario; el incidente "perdimos las últimas N horas" es
aceptable en MVP).

---

## Inventario de DBs

| DB | Rol | Contenido |
|---|---|---|
| `platform_control` | Registro de tenants, planes, super-admins, commission settings. | Crítico. Sin esto el TenantResolver falla. |
| `tenant_<slug>` | Datos del tenant (users, wallet_transactions, deposits, games, etc.). Una DB por tenant. | Crítico per-tenant. La pérdida afecta solo a ese tenant. |

---

## Escenario 1: Tenant DB corrupta / pérdida total

**Síntoma**: API devuelve 500 en todos los endpoints del tenant X.
Postgres logs muestran corruption o "database does not exist".

**Procedimiento**:

1. **Diagnosticar primero, no actuar al pánico.**
   ```bash
   psql -h <host> -U postgres -d postgres -c "\l" | grep tenant_<slug>
   # ¿La DB existe? ¿Tiene tamaño razonable?
   ```

2. **Snapshot del estado actual** (incluso si está corrupto, por si después
   sirve para investigar):
   ```bash
   pg_dump -h <host> -U postgres -d tenant_<slug> -F c -f /tmp/corrupted_$(date +%s).dump
   # Si esto falla, anotalo. Continuar con restore desde backup limpio.
   ```

3. **Identificar el backup más reciente disponible** (R2 bucket / local
   filesystem). El nombre tiene la convención `tenant_<slug>_YYYYMMDD_HHMM.dump`.

4. **Restaurar a una DB temporal** primero para validar que el backup
   está sano:
   ```bash
   createdb -h <host> -U postgres tenant_<slug>_restore_test
   pg_restore -h <host> -U postgres -d tenant_<slug>_restore_test /path/to/backup.dump
   psql -h <host> -U postgres -d tenant_<slug>_restore_test -c "SELECT COUNT(*) FROM users;"
   # Verificar que el conteo es razonable.
   ```

5. **Si el restore test pasa**, hacer el swap atómico:
   ```bash
   # 1. Poner el tenant en suspended (UPDATE en platform_control).
   #    NOTA: el enum `tenant_status` actual no tiene 'maintenance' —
   #    usamos 'suspended' que también triggea 403 en el middleware.
   #    Si emerge necesidad de un estado dedicado (mensaje "estamos
   #    haciendo mantenimiento, volvé en 10 min"), agregar al enum.
   psql -d platform_control -c "UPDATE tenants SET status = 'suspended' WHERE slug = '<slug>';"
   # El TenantResolverMiddleware ahora devuelve 403 con error "Tenant suspendido".

   # 2. ESPERAR ~30s para que postgres-js drene las conexiones idle.
   #    El ALTER DATABASE RENAME falla si hay backends conectados a la
   #    DB ("database is being accessed by other users"). Postgres-js
   #    por default cierra conexiones idle tras ~30s.
   sleep 30
   # Para forzar el drain inmediato:
   #   psql -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='tenant_<slug>' AND state='idle';"

   # 3. Renombrar la DB rota como backup, restore la sana.
   psql -d postgres -c "ALTER DATABASE tenant_<slug> RENAME TO tenant_<slug>_broken_$(date +%s);"
   psql -d postgres -c "ALTER DATABASE tenant_<slug>_restore_test RENAME TO tenant_<slug>;"

   # 4. Smoke test mínimo: query a wallets, conteo de users.
   psql -d tenant_<slug> -c "SELECT COUNT(*) FROM wallets;"

   # 5. Reactivar.
   psql -d platform_control -c "UPDATE tenants SET status = 'active' WHERE slug = '<slug>';"

   # 6. Cache de conexiones (TenantConnectionCache):
   #    NO requiere acción manual. El pool de postgres-js abrió
   #    conexiones idle al OID viejo (ahora _broken). Después del idle
   #    timeout, abre nuevas conexiones que resuelven por DB name al
   #    nuevo OID (la DB restaurada). Validado E2E 2026-05-22.
   #    Si querés forzar reset inmediato sin esperar idle timeout,
   #    restart la API (Coolify/systemd: `systemctl restart casino-api`).
   ```

6. **Validar end-to-end** con un login real del admin del tenant +
   carga de `/dashboard`. Si algo falla, repetir desde paso 2 con
   un backup anterior.

7. **Post-mortem**: documentar qué pasó (corruption hardware? bug del
   código? deletes accidentales?) y agregar tests/guardas.

---

## Escenario 2: DB de control perdida

**Síntoma**: API arranca pero el TenantResolverMiddleware devuelve "no tenant
encontrado" para todos los hosts. Los tenants no pueden loguear, pero las
DBs de tenant siguen ahí.

**Procedimiento**:

1. **Confirmar el problema**:
   ```bash
   psql -d platform_control -c "SELECT count(*) FROM tenants;"
   # Si retorna 0 o error "DB no existe", la control DB está perdida.
   ```

2. **Restore control DB desde backup**:
   ```bash
   createdb -h <host> -U postgres platform_control_restore
   pg_restore -h <host> -U postgres -d platform_control_restore /path/to/control_backup.dump
   # Validar que los tenants enlistados son los esperados.
   psql -d platform_control_restore -c "SELECT slug, status FROM tenants;"
   ```

3. **Swap atómico** (similar al tenant):
   ```bash
   psql -d postgres -c "ALTER DATABASE platform_control RENAME TO platform_control_broken_$(date +%s);"
   psql -d postgres -c "ALTER DATABASE platform_control_restore RENAME TO platform_control;"
   ```

4. **Restart API** para reset el pool de conexiones a la control DB.

5. **Validar**: hacer login con un super-admin (`/platform/auth/login`).
   Si el super-admin está en el dump restore, debería andar. Si no,
   ver escenario 4.

---

## Escenario 3: Super-admin password perdido / lockout

**Síntoma**: No hay forma de loguearse como super-admin.

**Procedimiento**:

1. **Acceso directo a la DB de control** (necesitás credentials del Postgres
   admin, NO del super-admin app):
   ```bash
   psql -h <host> -U postgres -d platform_control
   ```

2. **Generar un password hash temporal** (Argon2id). Usar un script local
   o el helper `packages/db/src/utils/password.ts`:
   ```bash
   cd packages/db
   pnpm tsx -e "import('./src/utils/password').then(m => m.hashPassword('TempPass2026!').then(h => console.log(h)))"
   # Copiar el hash output.
   ```

3. **Reset el password de un super-admin existente** (NO crear nuevo —
   menos riesgo):
   ```sql
   UPDATE platform_users
   SET password_hash = '<hash que generaste>',
       updated_at = NOW()
   WHERE username = '<username del super-admin>';
   ```

4. **Login con el password temporal** + **cambiarlo inmediatamente** desde
   la UI del super-admin.

5. **Audit**: el super-admin recovery NO deja audit trail automático
   (es manual). Anotar en `docs/SESSION_LOG.md` quién hizo el reset
   y por qué.

---

## Escenario 3.5: Agregar / cambiar custom domain de un tenant

**Cuándo aplica**: el tenant piloto necesita un dominio propio (ej.
`casino-mooneymaker.com`) en vez del subdomain default
(`mooneymaker.localhost`).

**Procedimiento**:

```sql
-- 1. Insertar el dominio nuevo (NO toca el primario, suma).
INSERT INTO tenant_domains (id, tenant_id, domain, is_primary, verified_at)
SELECT
  gen_random_uuid(),
  id,
  'casino-mooneymaker.com',     -- el dominio custom
  false,                          -- secundario (el primario es el .localhost)
  NOW()                           -- marcado como verificado (DNS apunta OK)
FROM tenants
WHERE slug = 'mooneymaker';
```

Sin reiniciar la API. El `TenantResolverMiddleware` hace lookup en cada
request (no cachea `tenant_domains`), entonces el dominio nuevo está
activo inmediatamente.

**Verificación**:

```bash
curl -H "X-Tenant-Host: casino-mooneymaker.com" \
  http://localhost:3000/tenant/info
# Debe devolver el tenant correspondiente al slug.
```

**Para revertir** (eliminar un dominio):

```sql
DELETE FROM tenant_domains WHERE domain = 'casino-mooneymaker.com';
```

**Validación E2E ejecutada 2026-05-22** (Sprint 51.10):
- `casino-pro.test` insertado apuntando a demo tenant.
- 3 fetches: custom domain → resuelve OK, demo.localhost → mismo
  tenant, nonexistent.test → 404.
- Cleanup OK.

---

## Escenario 4: Provisioning de tenant nuevo (no DR, pero proceso común)

Ver `pnpm --filter @casino/db db:seed:dev-tenant` script como referencia.
Para un tenant productivo:

```bash
# 1. Crear DB
createdb -h <host> -U postgres tenant_<slug>

# 2. Aplicar migraciones
DATABASE_URL=postgresql://postgres@<host>/tenant_<slug> \
  pnpm --filter @casino/db drizzle-kit migrate --config=drizzle.tenant.config.ts

# 3. Seed (catálogo de perms + roles + admin user)
DATABASE_URL=postgresql://postgres@<host>/tenant_<slug> \
  pnpm --filter @casino/db db:seed:tenant <slug> <admin_user> <admin_email> <admin_password>

# 4. Registrar en control DB
psql -d platform_control -c "
INSERT INTO tenants (id, slug, name, status, plan_id)
VALUES (gen_random_uuid(), '<slug>', '<name>', 'active', '<plan_uuid>');

INSERT INTO tenant_domains (id, tenant_id, domain, is_primary)
VALUES (gen_random_uuid(), (SELECT id FROM tenants WHERE slug = '<slug>'), '<slug>.casino.com', true);
"
```

---

## Backup setup (operacional)

> **MVP**: el sistema NO tiene backup automático integrado. El dueño
> es responsable de configurar `pg_dump` cron + offsite copy.

Ejemplo de cron diario (server Linux con Postgres):

```cron
# Backup diario 03:00 UTC. Retención 30 días local + offsite a R2.
0 3 * * * /opt/casino/scripts/backup-all.sh >> /var/log/casino-backup.log 2>&1
```

Script `backup-all.sh` esqueleto:

```bash
#!/bin/bash
set -euo pipefail

BACKUP_DIR=/var/backups/postgres
S3_BUCKET=s3://casino-backups
DATE=$(date +%Y%m%d_%H%M)

mkdir -p "$BACKUP_DIR"

# Control DB
pg_dump -F c -d platform_control -f "$BACKUP_DIR/control_$DATE.dump"

# Cada tenant
for TENANT in $(psql -d platform_control -t -c "SELECT slug FROM tenants WHERE status != 'deleted';"); do
  pg_dump -F c -d "tenant_$TENANT" -f "$BACKUP_DIR/tenant_${TENANT}_$DATE.dump"
done

# Offsite a R2 (con rclone configurado)
rclone copy "$BACKUP_DIR" "$S3_BUCKET/$(date +%Y/%m/%d)/"

# Limpiar local > 30 días
find "$BACKUP_DIR" -name "*.dump" -mtime +30 -delete
```

---

## Validar el backup periódicamente

**Crítico**: un backup sin restore validado NO sirve. Cada **semana**,
elegir un tenant random + restaurar a una DB de pruebas + verificar:

- Conteo de `users`, `wallet_transactions`, `deposits`.
- Login funciona (super-admin del tenant).
- Wallet del admin tiene el balance esperado.

Documentar el resultado en `docs/SESSION_LOG.md` con la fecha del test.

### Ejecución verificada — 2026-05-22 (Sprint 51.10)

Primera ejecución end-to-end real del procedimiento backup → restore →
verificación sobre `tenant_demo_dev` (slug `demo` en control DB):

```bash
# Setup (Windows + PowerShell, paths Postgres 18)
export PATH="/c/Program Files/PostgreSQL/18/bin:$PATH"
export PGPASSWORD=admin

# 1. Backup
pg_dump -h localhost -U postgres -d tenant_demo_dev -F c \
  -f /tmp/casino-dr-test/tenant_demo_$(date +%s).dump
# Resultado: 4.3 MB, 1.3s wall time.

# 2. Restore a DB de pruebas
createdb -h localhost -U postgres tenant_demo_restore_test
pg_restore -h localhost -U postgres -d tenant_demo_restore_test "$DUMP_FILE"
# Resultado: 2.5s wall time. Sin warnings ni errores.

# 3. Verificación de conteos
# users: 1563 ✓ (igual al source)
# wallet_transactions: 14535 ✓
# deposits: 1146 ✓
# user_bonuses: 996 ✓
# leagues: 39 (11 activas)
# league_standings: 1950
# audit_log: 10809

# 4. Verificación de integridad
SELECT u.username, u.display_name, w.balance
FROM users u JOIN wallets w ON w.user_id = u.id
WHERE u.username='demo_admin';
# → demo_admin · Demo Admin · 20170938.50 ✓

# Orphans check:
# orphan_wallets (wallet sin user): 0
# orphan_tx (tx sin wallet):        0
# → FK integrity 100%.

# 5. Cleanup
dropdb -h localhost -U postgres tenant_demo_restore_test
```

**Conclusión**: el runbook §1 (escenario "Tenant DB corrupta") es
ejecutable end-to-end. Tiempos en dev local sirven de baseline; en
producción esperar 1-2 órdenes de magnitud más según tamaño de DB.

### SWAP atómico — ejecución verificada 2026-05-22 (Sprint 51.10)

Procedimiento §1.5 (rename broken → restore_test → original) probado
end-to-end sobre tenant throwaway `dr-swap`:

```bash
# Setup
pg_dump tenant_demo_dev → seed.dump
createdb tenant_dr_swap_test + pg_restore seed.dump
INSERT tenant (slug='dr-swap', db_name='tenant_dr_swap_test') + tenant_domain (dr-swap.test)
INSERT user 'dr-marker-PRE-swap' en tenant_dr_swap_test
pg_dump tenant_dr_swap_test → backup_v1.dump (con PRE)
INSERT user 'dr-marker-POST-swap'  # estado "actual" = 2 markers

# Warming cache
curl -H "X-Tenant-Host: dr-swap.test" /tenant/auth/login → TOKEN
curl /tenant/users?search=dr-marker → total: 2 ✓ (PRE + POST)

# SWAP (sin sleep — confiado en que las conexiones estaban idle desde
# hace minutos)
UPDATE tenants SET status='suspended' WHERE slug='dr-swap';
createdb tenant_dr_swap_restore_test
pg_restore tenant_dr_swap_restore_test < backup_v1.dump
ALTER DATABASE tenant_dr_swap_test RENAME TO tenant_dr_swap_broken_<ts>;
ALTER DATABASE tenant_dr_swap_restore_test RENAME TO tenant_dr_swap_test;
UPDATE tenants SET status='active' WHERE slug='dr-swap';

# Verificación
curl /tenant/users?search=dr-marker → total: 1 ✓ (solo PRE)
INSERT user 'dr-marker-POST-restore' en tenant_dr_swap_test
curl /tenant/users?search=dr-marker → PRE + POST-restore ✓ (escrituras
  post-swap van al lugar correcto)
SELECT username FROM tenant_dr_swap_broken_<ts>.users WHERE username LIKE
  'dr-marker-%' → PRE + POST-swap (la DB vieja preserva el estado pre-restore
  para forensics) ✓

# Cleanup
DELETE FROM tenant_domains WHERE domain='dr-swap.test';
DELETE FROM tenants WHERE slug='dr-swap';
dropdb tenant_dr_swap_test
dropdb tenant_dr_swap_broken_<ts>
```

**Hallazgos del test**:

1. **El enum `tenant_status` no tenía 'maintenance'** — el runbook
   original lo asumía. Fix aplicado: usar `suspended` (mismo efecto en
   middleware). Si emerge necesidad de un estado dedicado con mensaje
   específico, agregar al enum.

2. **El pool de postgres-js se auto-recupera tras el RENAME**. No
   requiere reset manual del `TenantConnectionCache`. Las conexiones
   idle se cierran tras ~30s (default) y el pool abre nuevas que
   resuelven por DB name al nuevo OID.

3. **Si hay tráfico activo en la DB durante el RENAME, falla**:
   "database is being accessed by other users". El paso `suspended`
   + sleep 30s evita esto (el middleware bloquea requests nuevos, los
   pools drenan, después RENAME pasa).

4. **DB renombrada `_broken_<ts>` queda preservada**: útil para
   investigación post-mortem. Borrarla manualmente tras 7-30 días.

---

## Checklist de respuesta a incidente

Cuando algo falla, **antes de tocar nada**:

1. [ ] ¿Cuál es el síntoma exacto? (status code, mensaje, scope)
2. [ ] ¿A qué tenant/usuarios afecta?
3. [ ] ¿Cuándo empezó? (correlar con últimos deploys / cambios)
4. [ ] ¿Hay backup reciente disponible? (validar fecha)
5. [ ] ¿Se puede aislar el problema sin downtime (rollback feature flag)
      o requiere intervención DB?
6. [ ] **Notificar al usuario** del tenant afectado ANTES de cambios
      destructivos (si tiene email/teléfono en `tenants.contact_*`).
7. [ ] Procedimiento elegido (ver escenarios arriba).
8. [ ] Smoke test post-recovery.
9. [ ] Post-mortem escrito en `docs/SESSION_LOG.md` (mismo día).

---

## ✅ Restauración probada — 2026-09-04

**Primera restauración real desde que existen los backups.** Antes nunca se había
probado ninguno, y un backup no probado no es un backup.

### Resultado

Se restauró el backup de producción del **2026-09-04 06:00 UTC** en bases
temporales locales (Postgres 18.6, las mismas versiones):

| | |
|---|---|
| `control` | 5 tablas · 1 tenant (`miamihub`, active) |
| `tenant_miamihub` | 67 tablas · 18 users · 2.743 wallet_tx · 1.884 rondas · 572 audit |
| `pg_restore` | exit 0, **sin errores ni warnings** |
| **Invariante del ledger** | ✅ **todas las wallets cuadran con su último `balance_after`** |
| Supply total | 286.128,67 fichas |
| Último movimiento | 2026-09-03 17:24 AR |

Lo importante no es que **cargue** sino que sea **consistente**: se verificó el
invariante, no sólo el conteo de filas.

### ⚠️ Tres cosas que este doc decía mal

**1. El backup que corre NO es `backup-all.sh`.** Son los **backups nativos de
Dokploy**, configurados sobre el servicio `casino-postgres-ribula`:

| Base | Prefijo | Schedule | Retención |
|---|---|---|---|
| `platform_control` | `control/` | `0 6 * * *` | 14 |
| `tenant_miamihub` | `tenant_miamihub/` | `0 6 * * *` | 14 |

Este runbook describía el script con cron a las 03:00 y retención 30. Eso no es
lo que está corriendo.

**2. ⚠️ Los archivos dicen `.sql.gz` pero NO son SQL.** Adentro son formato
**custom de `pg_dump`** (empiezan con `PGDMP`). Se restauran con **`pg_restore`**,
no con `psql`. Descubrirlo en medio de una caída cuesta minutos que no se tienen:

```bash
# Bajar de R2 (bucket casino-backups), descomprimir y restaurar:
gunzip -k <archivo>.sql.gz
createdb -h <host> -U postgres <db_destino>
pg_restore -h <host> -U postgres -d <db_destino> --no-owner --no-privileges <archivo>.sql
```

**3. ⚠️ Hay un SEGUNDO juego de backups, y no cubre producción.** En el mismo
bucket, bajo `YYYY/MM/DD/`, aparecen dumps con el formato de nombre de
`backup-all.sh` — pero de **`tenant_demo_casino`**, no de `tenant_miamihub`:

```
2026/09/04/tenant_demo_casino_20260904_1555.dump   2.77 MB
2026/09/04/control_20260904_1555.dump              0.02 MB
```

El control de producción tiene **un solo tenant, `miamihub`** (verificado en el
backup restaurado), así que ese script **no está corriendo contra producción** —
sale de otro lado con otra base.

**Son más frecuentes y más grandes que los buenos**, así que a simple vista dan
una sensación de cobertura que es falsa: en una emergencia, agarrar el archivo
equivocado es peor que no tener nada.

#### ✅ Resuelto el 2026-09-04 — salían de un GitHub Action

Del workflow **`.github/workflows/backup.yml`** de este mismo repo, escrito el
2026-08-20 cuando producción era **Railway**. Al mudar al VPS **nunca se
repuntaron los secrets `BACKUP_PG*`**, así que siguió corriendo cada 6 horas
contra Railway.

La clave es que `scripts/backup-all.sh` **no recibe la lista de bases: se la
pregunta a la DB** (`SELECT slug FROM tenants`). Dumpeaba lo que hubiera en el
`platform_control` de `BACKUP_PGHOST` — y el de Railway tiene un solo tenant,
`demo_casino` (DEVLOG 2026-08-14: *"único tenant en prod"*).

**El workflow quedó apagado** (schedule comentado, sólo `workflow_dispatch`). No
se repuntó al VPS a propósito: ahí el puerto de Postgres está **cerrado** y se
abre a mano y temporalmente (`docs/24-entornos-deploy.md`), así que repuntarlo
exigiría exponerlo a internet 24/7 para duplicar un backup que Dokploy ya hace
bien y ya manda offsite. Mal negocio.

**Lo que se pierde:** el scheduler ahora vive en el mismo host que la DB, así que
si el VPS muere no se generan backups *nuevos*. Los viejos siguen en R2, que es
lo que importa.

**Historial verificado** (`gh run list --workflow=backup.yml`): **20 de 20
corridas en verde**, todas disparadas por `schedule`. O sea que Railway estuvo
respondiendo sin fallar hasta el último minuto — no es una instancia moribunda
que se pueda ignorar, hay que darla de baja a propósito.

#### 📦 Dump final de `demo_casino` — hecho el 2026-09-04 18:07 UTC

Disparado a mano (`gh workflow run backup.yml`, run `33904179080`, exit 0) para
tener una última copia de la producción vieja **antes de dar de baja Railway**:

| Archivo | Tamaño |
|---|---|
| `_final-railway/tenant_demo_casino_20260904_1807.dump` | 2.903.555 B (2,77 MB) |
| `_final-railway/control_20260904_1807.dump` | 15.841 B |

De paso confirma el diagnóstico desde adentro: el script enumeró los tenants de
ese `platform_control` y dumpeó **uno solo**, `demo_casino`.

> ### 🚨 ESTOS DOS ARCHIVOS NO SE BORRAN
>
> Cayeron en `2026/09/04/`, o sea **dentro del prefijo que hay que purgar**, así
> que purgar `YYYY/MM/DD/` entero se hubiera llevado puesto el dump final —
> justo lo que se guardó para poder apagar Railway tranquilo.
>
> **✅ Movidos el 2026-09-04 a `_final-railway/`** (copy → verificación de tamaño
> y ETag → borrado del original). Ya están fuera de la zona de purga.

#### ✅ Bucket limpiado — 2026-09-04

Se borraron los **106 objetos** obsoletos bajo `YYYY/MM/DD/` (53 pares
`control` + `tenant_demo_casino`, del 2026-08-21 al 2026-09-04).

Antes de borrar se corrió un **dry-run que exige que cada key matchee un patrón
exacto** (`YYYY/MM/DD/(control|tenant_demo_casino)_########_####.dump`) y aborta
si aparece cualquier otra cosa. 0 objetos raros. Un borrado por prefijo sin ese
chequeo es como se pierden backups buenos por accidente.

| | Antes | Después |
|---|---:|---:|
| Objetos | 133 | **27** |
| Tamaño | 159,4 MB | **12,0 MB** |

Estado final del bucket, que ahora sí se lee de un vistazo:

| Prefijo | Objetos | Tamaño | Qué es |
|---|---:|---:|---|
| `casino-postgres-ribula/` | 25 | 9,2 MB | ✅ Dokploy → producción (`control` + `tenant_miamihub`) |
| `_final-railway/` | 2 | 2,8 MB | 📦 Dump final de la producción vieja |

El desglose del borrado dejó una confirmación más del diagnóstico: **53 pares
exactos**, `control` y `tenant_demo_casino` y nada más. Ese `platform_control`
nunca tuvo otro tenant.

**Y Railway sigue prendida.** Respondió sin fallar en las 20 últimas corridas, o
sea que está viva con la copia de la producción vieja adentro.
`docs/23-migracion-vps.md` decía apagarla "cuando esté confirmado, dejar en
standby unos días" y ningún log registra que se haya hecho. **El dump final ya
está hecho y a salvo**, así que no queda nada esperando: se puede dar de baja.
Ojo: con el workflow apagado, si hiciera falta otro dump hay que dispararlo a
mano (`workflow_dispatch`) **mientras Railway siga viva**.

> **⚠️ Al apagar Railway se rompe `.github/workflows/deploy.yml`.** Ese workflow
> deploya a Railway/Vercel en cada push a `staging`, así que va a empezar a
> fallar en rojo. Conviene apagarlo **en la misma tanda**, no después — de todas
> formas queda obsoleto por la mudanza del staging a Dokploy (2026-09-04).
>
> Y **borrar los secrets** que quedan sin uso: `BACKUP_PGHOST`, `BACKUP_PGPORT`,
> `BACKUP_PGUSER`, `BACKUP_PGPASSWORD` (apuntan a Railway) más los de
> Railway/Vercel del deploy. Un secret vivo que apunta a infra muerta es
> exactamente la trampa que causó todo esto.

### ⚠️ El cron de GitHub Actions llega tarde — hasta 5 horas

Encontrado al revisar el historial de este workflow. El cron era `0 */6 * * *`
(00/06/12/18 UTC) y las corridas reales caían así:

| Cron | Real | Retraso |
|---|---|---|
| 00:00 UTC | ~03:24 | +3h24 |
| 06:00 UTC | ~10:48 | +4h48 |
| 12:00 UTC | ~15:56 | +3h56 |
| 18:00 UTC | ~20:39 | +2h39 |

GitHub encola el cron de los runners compartidos y lo despacha cuando puede; dos
a cinco horas tarde es normal en horas pico. Esto costó un rato de diagnóstico:
el archivo de las 15:55 no coincidía con ningún slot y parecía disparo manual.

**Regla para el futuro:** un cron de GitHub Actions **no sirve para nada que
dependa de correr a una hora**. Para backups da igual. Para cierres contables,
cortes de comisión o cualquier cosa atada a un corte horario del negocio, ese
retraso es un problema real — eso va en el host, no en Actions.

### Lo que sigue sin probarse

- **Restaurar sobre producción** (el swap real). Sólo se probó restaurar a una DB
  temporal, que es el paso 4 del procedimiento de arriba.
- **El backup de R2/uploads** (comprobantes, imágenes): sólo se respaldan las
  bases de datos.
