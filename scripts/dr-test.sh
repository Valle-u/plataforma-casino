#!/usr/bin/env bash
# dr-test.sh — validación end-to-end del proceso de recovery.
#
# Simula el escenario "tenant DB perdida": hace dump, crea DB de
# restore con sufijo _drtest, restaura, valida counts mínimos,
# limpia. NO toca la DB original.
#
# Sirve para:
#   1. Validar que el backup más reciente está sano.
#   2. Cumplir la rutina semanal del runbook DR.
#   3. Smoke-test antes de migrar a otro host.
#
# Uso:
#   ./dr-test.sh <slug-del-tenant>
#   ./dr-test.sh control                   # para platform_control
#
# Env vars:
#   PGHOST, PGPORT, PGUSER, PGPASSWORD     (igual que backup-all.sh)
#   BACKUP_FILE                            opcional — si no, busca el
#                                          más reciente en BACKUP_DIR.
#   BACKUP_DIR                             default: /var/backups/postgres
#
# Exit codes:
#   0   restore validado OK
#   1   restore falló o counts inesperados (DB de prueba dejada para inspect)
#   2   uso incorrecto / DB no encontrada

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Uso: $0 <slug-del-tenant | control>"
  exit 2
fi

ARG="$1"
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/postgres}"

if [ "$ARG" = "control" ]; then
  SOURCE_DB="platform_control"
  PATTERN="control_*.dump"
  # Tablas mínimas esperadas en una control DB sana.
  EXPECTED_TABLES=("tenants" "platform_users")
else
  SOURCE_DB="tenant_$ARG"
  PATTERN="tenant_${ARG}_*.dump"
  # Tablas mínimas esperadas en cualquier tenant DB.
  EXPECTED_TABLES=("users" "wallets" "wallet_transactions")
fi

TEST_DB="${SOURCE_DB}_drtest_$(date +%s)"

echo "[dr-test] target=$SOURCE_DB testDB=$TEST_DB"

# ── 1. Encontrar backup (env override o más reciente) ───────────────
if [ -n "${BACKUP_FILE:-}" ]; then
  DUMP="$BACKUP_FILE"
else
  DUMP=$(find "$BACKUP_DIR" -maxdepth 1 -name "$PATTERN" -printf '%T@ %p\n' 2>/dev/null \
    | sort -rn | head -1 | cut -d' ' -f2-)
fi

if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "[dr-test] ✗ no encontré backup que matchee '$PATTERN' en $BACKUP_DIR"
  echo "[dr-test]   tip: pasar BACKUP_FILE=/path/to/file.dump como env."
  exit 2
fi

SIZE=$(stat -c%s "$DUMP" 2>/dev/null || stat -f%z "$DUMP")
echo "[dr-test] usando backup: $DUMP ($SIZE bytes)"

# ── 2. Crear DB de prueba ───────────────────────────────────────────
if createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$TEST_DB"; then
  echo "[dr-test] ✓ createdb $TEST_DB"
else
  echo "[dr-test] ✗ createdb falló"
  exit 1
fi

# Cleanup en exit (incluso error) — solo si NO fallamos en validación.
SHOULD_CLEANUP=1
trap 'if [ "$SHOULD_CLEANUP" -eq 1 ]; then
        echo "[dr-test] cleanup: dropdb $TEST_DB";
        dropdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$TEST_DB" || true;
      else
        echo "[dr-test] ⚠ DB $TEST_DB DEJADA para inspección manual";
      fi' EXIT

# ── 3. Restore ──────────────────────────────────────────────────────
START_RESTORE=$(date +%s)
if pg_restore -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$TEST_DB" \
    --no-owner --no-acl "$DUMP" 2>/tmp/dr-test-restore.log; then
  END_RESTORE=$(date +%s)
  echo "[dr-test] ✓ restore OK en $((END_RESTORE - START_RESTORE))s"
else
  # pg_restore puede devolver non-zero por warnings benignos. Lo
  # tratamos como warning, validamos counts igual.
  echo "[dr-test] ⚠ pg_restore devolvió warnings — validando counts igual"
  cat /tmp/dr-test-restore.log | tail -5
fi

# ── 4. Validar tablas esperadas ─────────────────────────────────────
ALL_OK=1
for TABLE in "${EXPECTED_TABLES[@]}"; do
  COUNT=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$TEST_DB" \
    -t -A -c "SELECT COUNT(*) FROM $TABLE;" 2>/dev/null || echo "ERR")
  if [ "$COUNT" = "ERR" ]; then
    echo "[dr-test] ✗ tabla $TABLE no existe o no se pudo contar"
    ALL_OK=0
  else
    echo "[dr-test] ✓ $TABLE: $COUNT filas"
  fi
done

if [ "$ALL_OK" -ne 1 ]; then
  echo "[dr-test] ✗ FALLA: alguna tabla esperada no existe"
  SHOULD_CLEANUP=0
  exit 1
fi

# ── 5. Smoke query — algo más sofisticado por DB type ───────────────
if [ "$ARG" = "control" ]; then
  # Para control: verificar que hay al menos 1 tenant activo.
  ACTIVE=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$TEST_DB" \
    -t -A -c "SELECT COUNT(*) FROM tenants WHERE status = 'active';")
  echo "[dr-test] smoke: tenants activos = $ACTIVE"
else
  # Para tenant: verificar consistencia wallet (suma de deltas = balance).
  # Si la DB es de pruebas con 0 transactions, esto pasa trivialmente.
  INCONSISTENT=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$TEST_DB" \
    -t -A -c "
      SELECT COUNT(*) FROM wallets w
      WHERE w.balance != COALESCE(
        (SELECT SUM(amount_delta) FROM wallet_transactions WHERE wallet_id = w.id), 0
      );
    " 2>/dev/null || echo "ERR")
  if [ "$INCONSISTENT" = "0" ]; then
    echo "[dr-test] smoke: wallet consistency OK (0 desbalances)"
  elif [ "$INCONSISTENT" = "ERR" ]; then
    echo "[dr-test] ⚠ smoke: no pude validar wallet consistency (schema viejo?)"
  else
    echo "[dr-test] ✗ smoke: $INCONSISTENT wallets desbalanceadas"
    SHOULD_CLEANUP=0
    exit 1
  fi
fi

echo "[dr-test] ✓ DONE — backup $DUMP está sano"
exit 0
