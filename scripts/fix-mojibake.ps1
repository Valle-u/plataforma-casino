<#
.SYNOPSIS
  Revierte doble encoding UTF-8 (mojibake) en archivos del repo.

.DESCRIPTION
  El bulk replace del Sprint 41 (a11y) uso PowerShell + .NET WriteAllText
  con encoding default, que en .NET Framework de PS 5.1 a veces lee como
  Windows-1252 y reescribe como UTF-8, generando doble encoding.

  Este script:
    1. Lista archivos candidatos (Path filter).
    2. Para cada uno: lee bytes, decodifica como UTF-8.
    3. Re-encodea ese string como CP1252 -> recupera bytes UTF-8 originales.
    4. Decodifica esos bytes como UTF-8 -> string correcto.
    5. Verifica que el resultado tiene MENOS chars mojibake que el original.
    6. Escribe el archivo en UTF-8 SIN BOM.

  Idempotente: correrlo dos veces no rompe nada.

.PARAMETER Path
  Carpeta raiz a procesar. Default: apps\web.

.PARAMETER DryRun
  Si esta, muestra que archivos cambiaria pero no escribe.
#>

param(
  [string]$Path = "apps\web",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

# Construir el regex de mojibake usando codes Unicode para evitar que el
# script mismo se mojibakee. Cubrimos:
#   - 'A-tilde' (U+00C3) seguido de chars latinos comunes (accents)
#   - 'a-circumflex + euro' (bytes U+00E2 U+20AC) que es como aparecen
#     em-dash, smart quotes, etc. cuando estan mojibake.
#   - 'A-circumflex' (U+00C2) seguido de char latin (Â· Â¿ etc.)
$Atilde      = [char]0x00C3
$acircEuro   = "$([char]0x00E2)$([char]0x20AC)"
$Acirc       = [char]0x00C2

# Lista de chars latinos que aparecen como segundo char en mojibake
# tipico (accents espanol y simbolos comunes).
$latinFollow = "[$([char]0x00A1)$([char]0x00A8)$([char]0x00A9)$([char]0x00AA)$([char]0x00AD)$([char]0x00B1)$([char]0x00B3)$([char]0x00B5)$([char]0x00B8)$([char]0x00BA)$([char]0x00BF)$([char]0x00ED)$([char]0x00B7)]"

$patternStr = "$Atilde$latinFollow|$acircEuro|$Acirc[ -¿]"
$mojibakePattern = [regex]$patternStr

# Encodings
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$cp1252 = [System.Text.Encoding]::GetEncoding(1252)
$utf8 = [System.Text.Encoding]::UTF8

# Recolectar archivos
$root = Resolve-Path -Path $Path
Write-Host "Escaneando $root ..."

$extensions = @('.tsx','.ts','.jsx','.js','.css','.md','.json','.html')
$files = Get-ChildItem -Path $root -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object {
    $_.Extension -in $extensions -and
    $_.FullName -notmatch '\\node_modules\\' -and
    $_.FullName -notmatch '\\\.next\\' -and
    $_.FullName -notmatch '\\dist\\' -and
    $_.FullName -notmatch '\\build\\' -and
    $_.FullName -notmatch '\\\.turbo\\'
  }

Write-Host "$($files.Count) archivos candidatos"

$modified = 0
$skipped = 0
$worsened = 0

foreach ($f in $files) {
  $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
  if ($bytes.Length -eq 0) { continue }

  # Remove BOM si presente
  $startIdx = 0
  $hadBom = $false
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    $startIdx = 3
    $hadBom = $true
  }
  $body = $bytes[$startIdx..($bytes.Length - 1)]

  # Decodificar como UTF-8
  try {
    $asUtf8 = $utf8.GetString($body)
  } catch {
    Write-Host "  skip $($f.FullName) - no es UTF-8 valido"
    $skipped++
    continue
  }

  # Detectar mojibake
  $originalMatches = $mojibakePattern.Matches($asUtf8).Count
  if ($originalMatches -eq 0 -and -not $hadBom) {
    # Sin mojibake y sin BOM - archivo limpio
    continue
  }

  # Intentar reconvertir
  $fixed = $null
  try {
    $reEncoded = $cp1252.GetBytes($asUtf8)
    $candidate = $utf8.GetString($reEncoded)
    $candidateMatches = $mojibakePattern.Matches($candidate).Count

    if ($candidateMatches -lt $originalMatches) {
      $fixed = $candidate
    } else {
      $worsened++
    }
  } catch [System.Text.EncoderFallbackException] {
    $skipped++
  } catch {
    $skipped++
  }

  $newBytes = $null
  if ($null -ne $fixed) {
    $newBytes = $utf8NoBom.GetBytes($fixed)
  } elseif ($hadBom) {
    $newBytes = $utf8NoBom.GetBytes($asUtf8)
  }

  if ($null -ne $newBytes) {
    $finalCount = if ($fixed) { $mojibakePattern.Matches($fixed).Count } else { 0 }
    $diff = if ($fixed) { "$originalMatches -> $finalCount" } else { "BOM strip" }
    $rel = $f.FullName.Substring($root.Path.Length + 1)
    Write-Host "  fix $rel  ($diff)"
    if (-not $DryRun) {
      [System.IO.File]::WriteAllBytes($f.FullName, $newBytes)
    }
    $modified++
  }
}

Write-Host ""
Write-Host "RESUMEN:"
Write-Host "  Modificados: $modified"
Write-Host "  Skipped:     $skipped"
Write-Host "  Sin mejora:  $worsened"
if ($DryRun) { Write-Host "  (DRY RUN - nada se escribio)" }
