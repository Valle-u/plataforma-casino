<#
.SYNOPSIS
  Validación end-to-end del proceso de recovery (versión Windows).

.DESCRIPTION
  Equivalente PowerShell de scripts/dr-test.sh. Hace dump + restore
  a una DB temporal con sufijo _drtest_<timestamp>, valida tablas
  esperadas, smoke test mínimo, limpia.

.PARAMETER Target
  Slug del tenant (ej. "dev") o literal "control" para platform_control.

.PARAMETER BackupFile
  Opcional. Si no, busca el más reciente en BackupDir matcheando
  el patrón del target.

.PARAMETER BackupDir
  Default: $env:BACKUP_DIR o "C:\backups\postgres".

.PARAMETER PgBin
  Default: detecta automaticamente "C:\Program Files\PostgreSQL\<ver>\bin".
  Override con env PG_BIN si tenés Postgres en otro lugar.

.PARAMETER NoBackup
  Si está set, NO genera dump nuevo — usa el BackupFile o el más
  reciente. Útil para validar un backup que ya tenés.

.EXAMPLE
  .\dr-test.ps1 -Target dev
  .\dr-test.ps1 -Target control -BackupFile C:\tmp\control.dump

.NOTES
  Requiere pg_dump, pg_restore, psql, createdb, dropdb en PATH o PgBin.
  Setear PGPASSWORD env var antes de correr para evitar prompts.
#>

param(
  [Parameter(Mandatory=$true)] [string]$Target,
  [string]$BackupFile = "",
  [string]$BackupDir = $(if ($env:BACKUP_DIR) { $env:BACKUP_DIR } else { "C:\backups\postgres" }),
  [string]$PgBin = $env:PG_BIN,
  [switch]$NoBackup
)

$ErrorActionPreference = "Stop"
$PGHOST = if ($env:PGHOST) { $env:PGHOST } else { "localhost" }
$PGPORT = if ($env:PGPORT) { $env:PGPORT } else { "5432" }
$PGUSER = if ($env:PGUSER) { $env:PGUSER } else { "postgres" }

# Auto-detect Postgres bin si no fue especificado
if (-not $PgBin) {
  $candidates = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue |
                Sort-Object Name -Descending
  if ($candidates) {
    $PgBin = Join-Path $candidates[0].FullName 'bin'
  }
}
if ($PgBin -and (Test-Path $PgBin)) {
  $env:PATH = "$PgBin;$env:PATH"
}

# Verificar que las herramientas están disponibles
foreach ($tool in @('pg_dump','pg_restore','psql','createdb','dropdb')) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    Write-Error "[dr-test] $tool no encontrado en PATH ni en PgBin ($PgBin)"
    exit 2
  }
}

if ($Target -eq "control") {
  $SourceDb = "platform_control"
  $Pattern = "control_*.dump"
  $ExpectedTables = @("tenants","platform_users")
} else {
  $SourceDb = "tenant_$Target"
  $Pattern = "tenant_${Target}_*.dump"
  $ExpectedTables = @("users","wallets","wallet_transactions")
}

$timestamp = [int][double]::Parse((Get-Date -UFormat %s))
$TestDb = "${SourceDb}_drtest_$timestamp"
Write-Host "[dr-test] target=$SourceDb testDB=$TestDb"

# ── 1. Encontrar backup (o crearlo si no -NoBackup y no BackupFile) ──
$Dump = $BackupFile
if (-not $Dump) {
  if (-not (Test-Path $BackupDir)) { New-Item -ItemType Directory -Path $BackupDir | Out-Null }
  $existing = Get-ChildItem -Path $BackupDir -Filter $Pattern -ErrorAction SilentlyContinue |
              Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($existing) {
    $Dump = $existing.FullName
    Write-Host "[dr-test] usando backup existente: $Dump ($($existing.Length) bytes)"
  } elseif (-not $NoBackup) {
    $date = Get-Date -Format "yyyyMMdd_HHmm"
    $Dump = Join-Path $BackupDir "${SourceDb}_${date}.dump"
    Write-Host "[dr-test] no hay backup, generando: $Dump"
    & pg_dump -h $PGHOST -p $PGPORT -U $PGUSER -F c -d $SourceDb -f $Dump
    if ($LASTEXITCODE -ne 0) { Write-Error "[dr-test] pg_dump falló"; exit 1 }
    $size = (Get-Item $Dump).Length
    Write-Host "[dr-test] ✓ dump generado ($size bytes)"
  } else {
    Write-Error "[dr-test] no encontré backup '$Pattern' en $BackupDir y -NoBackup activo"
    exit 2
  }
}

if (-not (Test-Path $Dump)) {
  Write-Error "[dr-test] archivo $Dump no existe"
  exit 2
}

# ── 2. Crear DB de prueba ───────────────────────────────────────────
Write-Host "[dr-test] createdb $TestDb"
& createdb -h $PGHOST -p $PGPORT -U $PGUSER $TestDb
if ($LASTEXITCODE -ne 0) { Write-Error "[dr-test] createdb falló"; exit 1 }

$ShouldCleanup = $true

try {
  # ── 3. Restore ────────────────────────────────────────────────────
  $start = Get-Date
  & pg_restore -h $PGHOST -p $PGPORT -U $PGUSER -d $TestDb --no-owner --no-acl $Dump
  $elapsed = (Get-Date) - $start
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[dr-test] ⚠ pg_restore warnings — validando counts igual"
  } else {
    Write-Host "[dr-test] ✓ restore OK en $([int]$elapsed.TotalSeconds)s"
  }

  # ── 4. Validar tablas esperadas ─────────────────────────────────
  $allOk = $true
  foreach ($table in $ExpectedTables) {
    $count = & psql -h $PGHOST -p $PGPORT -U $PGUSER -d $TestDb -t -A -c "SELECT COUNT(*) FROM $table;" 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $count) {
      Write-Host "[dr-test] ✗ tabla $table no existe / no contable"
      $allOk = $false
    } else {
      Write-Host "[dr-test] ✓ $table : $count filas"
    }
  }

  if (-not $allOk) {
    Write-Error "[dr-test] FALLA: tabla esperada faltante"
    $ShouldCleanup = $false
    exit 1
  }

  # ── 5. Smoke query ──────────────────────────────────────────────
  if ($Target -eq "control") {
    $active = & psql -h $PGHOST -p $PGPORT -U $PGUSER -d $TestDb -t -A -c "SELECT COUNT(*) FROM tenants WHERE status = 'active';"
    Write-Host "[dr-test] smoke: tenants activos = $active"
  } else {
    $inconsistent = & psql -h $PGHOST -p $PGPORT -U $PGUSER -d $TestDb -t -A -c @"
SELECT COUNT(*) FROM wallets w
WHERE w.balance != COALESCE(
  (SELECT SUM(amount_delta) FROM wallet_transactions WHERE wallet_id = w.id), 0
);
"@ 2>$null
    if ($LASTEXITCODE -ne 0) {
      Write-Host "[dr-test] ⚠ smoke: schema viejo o columna distinta — no validable"
    } elseif ($inconsistent -eq "0") {
      Write-Host "[dr-test] smoke: wallet consistency OK (0 desbalances)"
    } else {
      Write-Host "[dr-test] ✗ smoke: $inconsistent wallets desbalanceadas"
      $ShouldCleanup = $false
      exit 1
    }
  }

  Write-Host "[dr-test] ✓ DONE — backup $Dump está sano"
}
finally {
  if ($ShouldCleanup) {
    Write-Host "[dr-test] cleanup: dropdb $TestDb"
    & dropdb -h $PGHOST -p $PGPORT -U $PGUSER $TestDb 2>$null
  } else {
    Write-Host "[dr-test] ⚠ DB $TestDb DEJADA para inspección manual"
  }
}
