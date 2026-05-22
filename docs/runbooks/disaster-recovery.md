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
