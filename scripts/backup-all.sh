#!/usr/bin/env bash
# backup-all.sh — backup completo de control DB + todas las tenant DBs.
#
# Diseñado para correr como cron diario en el servidor productivo.
# Genera dumps comprimidos formato custom (pg_restore-friendly) y
# sube a S3/R2 si rclone está configurado.
#
# Uso:
#   ./backup-all.sh
#
# Env vars requeridas:
#   PGHOST           Host de Postgres (default: localhost)
#   PGPORT           Puerto (default: 5432)
#   PGUSER           User con permisos REPLICATION o superuser (default: postgres)
#   PGPASSWORD       Password (usar .pgpass para evitar export en plain text)
#   BACKUP_DIR       Donde dejar los dumps locales (default: /var/backups/postgres)
#   RCLONE_REMOTE    Si está set, sube con `rclone copy` (ej: "r2:casino-backups")
#   RETENTION_DAYS   Cuántos días conservar localmente (default: 30)
#
# Convención de nombres:
#   control_YYYYMMDD_HHMM.dump
#   tenant_<slug>_YYYYMMDD_HHMM.dump
#
# Exit codes:
#   0  todos los backups OK
#   1  falló al menos un backup (parcial OK; reportar al log)
#   2  no se pudo enumerar tenants (fallo crítico)

set -euo pipefail

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"

DATE=$(date +%Y%m%d_%H%M)
LOG_PREFIX="[backup-all $DATE]"
FAILED=0

mkdir -p "$BACKUP_DIR"

echo "$LOG_PREFIX start. host=$PGHOST user=$PGUSER target=$BACKUP_DIR"

# ── 1. Control DB ───────────────────────────────────────────────────
CONTROL_FILE="$BACKUP_DIR/control_$DATE.dump"
if pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -F c -d platform_control \
    -f "$CONTROL_FILE" 2>>"$BACKUP_DIR/backup.log"; then
  SIZE=$(stat -c%s "$CONTROL_FILE" 2>/dev/null || stat -f%z "$CONTROL_FILE")
  echo "$LOG_PREFIX ✓ control_$DATE.dump ($SIZE bytes)"
else
  echo "$LOG_PREFIX ✗ control DB FAILED — ver $BACKUP_DIR/backup.log"
  FAILED=1
fi

# ── 2. Enumerar tenants y dumpearlos ────────────────────────────────
if ! TENANTS=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d platform_control \
    -t -A -c "SELECT slug FROM tenants WHERE status != 'deleted';" 2>>"$BACKUP_DIR/backup.log"); then
  echo "$LOG_PREFIX ✗ no se pudo enumerar tenants — abortando"
  exit 2
fi

for SLUG in $TENANTS; do
  [ -z "$SLUG" ] && continue
  TENANT_DB="tenant_$SLUG"
  TENANT_FILE="$BACKUP_DIR/${TENANT_DB}_$DATE.dump"
  if pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -F c -d "$TENANT_DB" \
      -f "$TENANT_FILE" 2>>"$BACKUP_DIR/backup.log"; then
    SIZE=$(stat -c%s "$TENANT_FILE" 2>/dev/null || stat -f%z "$TENANT_FILE")
    echo "$LOG_PREFIX ✓ ${TENANT_DB}_$DATE.dump ($SIZE bytes)"
  else
    echo "$LOG_PREFIX ✗ $TENANT_DB FAILED — ver $BACKUP_DIR/backup.log"
    FAILED=1
  fi
done

# ── 3. Offsite copy (opcional) ──────────────────────────────────────
if [ -n "$RCLONE_REMOTE" ]; then
  REMOTE_PATH="$RCLONE_REMOTE/$(date +%Y/%m/%d)/"
  if rclone copy --include "*_$DATE.dump" "$BACKUP_DIR" "$REMOTE_PATH" \
      2>>"$BACKUP_DIR/backup.log"; then
    echo "$LOG_PREFIX ✓ rclone copy → $REMOTE_PATH"
  else
    echo "$LOG_PREFIX ✗ rclone FAILED — backups local OK, offsite no subido"
    FAILED=1
  fi
fi

# ── 4. Retention: borrar locales > RETENTION_DAYS ───────────────────
find "$BACKUP_DIR" -maxdepth 1 -name "*.dump" -mtime "+$RETENTION_DAYS" -delete
echo "$LOG_PREFIX retention purga aplicada (>$RETENTION_DAYS días)"

if [ "$FAILED" -ne 0 ]; then
  echo "$LOG_PREFIX done WITH ERRORS — revisar log"
  exit 1
fi
echo "$LOG_PREFIX done OK"
exit 0
