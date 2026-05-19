# scripts/

Scripts operacionales del sistema casino. **No son código de runtime** —
son herramientas para el dueño/operador del sistema.

| Script | Cuándo correrlo | Requiere |
|---|---|---|
| `backup-all.sh` | Cron diario en server productivo | bash + pg_dump/psql + rclone (opcional) |
| `dr-test.sh` | Semanal (validación de backup) | bash + pg_dump/pg_restore/psql/createdb/dropdb |
| `dr-test.ps1` | Equivalente Windows del dr-test | PowerShell + PostgreSQL client tools |

---

## `backup-all.sh`

Hace `pg_dump` de la control DB + cada tenant DB activa.

```bash
# Cron diario (Linux server):
0 3 * * * /opt/casino/scripts/backup-all.sh >> /var/log/casino-backup.log 2>&1

# Manual con override:
BACKUP_DIR=/tmp/test PGUSER=admin ./backup-all.sh

# Con offsite a R2:
RCLONE_REMOTE=r2:casino-backups ./backup-all.sh
```

### Env vars

- `PGHOST` (default `localhost`)
- `PGPORT` (default `5432`)
- `PGUSER` (default `postgres`)
- `PGPASSWORD` — preferible usar `~/.pgpass` (más seguro)
- `BACKUP_DIR` (default `/var/backups/postgres`)
- `RCLONE_REMOTE` — si está set, sube con `rclone copy` (ej. `r2:bucket/path`)
- `RETENTION_DAYS` (default `30`)

### Salida

Exit `0` = todos los backups OK. Exit `1` = alguno falló (parcial OK, log
en `$BACKUP_DIR/backup.log`). Exit `2` = no se pudo enumerar tenants
(falla crítica — la control DB está inaccesible).

---

## `dr-test.sh` / `dr-test.ps1`

Valida que un backup se puede restaurar y la data está sana.

**Crítico**: un backup nunca probado NO es un backup. Hacé esto **cada
semana** con un tenant random.

```bash
# Linux/Mac — busca el backup más reciente del tenant "dev":
./dr-test.sh dev

# Override del backup específico:
BACKUP_FILE=/path/to/tenant_dev_20260519.dump ./dr-test.sh dev

# Control DB:
./dr-test.sh control
```

```powershell
# Windows — equivalente:
.\dr-test.ps1 -Target dev

# Si Postgres está en lugar no estándar:
$env:PG_BIN = 'C:\PGSQL\17\bin'; .\dr-test.ps1 -Target dev

# Genera un backup nuevo si no hay uno previo:
.\dr-test.ps1 -Target dev  # (sin -NoBackup, lo crea)
```

### Qué hace

1. Encuentra el backup más reciente (o el especificado por `BACKUP_FILE`).
2. Crea DB temporal `<source>_drtest_<timestamp>`.
3. Hace `pg_restore` a la DB temporal.
4. Valida que las tablas esperadas existen y tienen filas:
   - **Control DB**: `tenants`, `platform_users`.
   - **Tenant DB**: `users`, `wallets`, `wallet_transactions`.
5. **Smoke query**:
   - **Control**: cuenta tenants activos.
   - **Tenant**: verifica que `SUM(wallet_transactions.amount_delta) ==
     wallets.balance` para cada wallet (invariante crítica).
6. Limpia la DB temporal si todo OK. Si falló, la **deja para inspect**.

### Exit codes

- `0` — backup validado OK.
- `1` — restore falló o counts inesperados. **DB temporal queda viva**
  para que puedas hacer `psql` y diagnosticar.
- `2` — uso incorrecto o tools faltantes.

---

## Validación en este repo

Estos scripts están **escritos pero no auto-validados en CI** porque
requieren un Postgres con `pg_dump` accesible. El dueño debe:

1. Correr `./dr-test.sh dev` al menos una vez después del primer deploy
   prod, y documentar en `docs/SESSION_LOG.md` el output.
2. Agendar la validación semanal (cron o recordatorio).

Si en el futuro hay un servicio CI con Postgres y client tools, agregar
un job `test-dr` en `.github/workflows/ci.yml` que arme una DB sintética,
corra el dr-test contra ella, y publique el output.

---

## Conventions

- Scripts terminan con `exit 0/1/2` semánticamente significativos.
- Logs con prefix `[script-name]` para `grep` fácil en logs.
- Todos los `pg_*` aceptan override por env var (`PGHOST`, etc).
- Cleanup en `trap EXIT` (bash) o `finally` (PowerShell) — nunca
  dejar DBs huérfanas.
