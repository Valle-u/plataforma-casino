param(
  [switch]$NoNgrok,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Definition)

$wt = Get-Command wt.exe -ErrorAction SilentlyContinue

if (-not $wt) {
  Write-Host "Windows Terminal no está instalado." -ForegroundColor Red
  Write-Host "Descargalo de: https://github.com/microsoft/terminal/releases" -ForegroundColor Yellow
  exit 1
}

function Open-Tab($title, $command) {
  Start-Process wt -ArgumentList @(
    '-w', '0', 'new-tab', '--title', $title, '--suppressApplicationTitle',
    'pwsh', '-NoExit', '-Command', $command
  ) -WorkingDirectory $root
  Start-Sleep 1.5
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Plataforma Casino - Modo Desarrollo" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Existe alguna instancia de WT? Si no, abrimos una ventana primero
$existing = Get-Process wt -ErrorAction SilentlyContinue
if (-not $existing) {
  Start-Process wt -WindowStyle Maximized
  Start-Sleep 3
}

Write-Host "[1/3] Iniciando servidor API (NestJS) ..." -ForegroundColor Yellow
Open-Tab "API (puerto 3000)" "pnpm --filter @casino/api dev"

Write-Host "[2/3] Iniciando frontend (Next.js) ..." -ForegroundColor Yellow
Open-Tab "Web (puerto 3001)" "pnpm --filter @casino/web dev"

if (-not $NoNgrok) {
  Write-Host "[3/3] Iniciando ngrok (túnel público) ..." -ForegroundColor Yellow
  Open-Tab "Ngrok" "ngrok http 3000"
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Todo listo!" -ForegroundColor Green
Write-Host "  Frontend: http://localhost:3001" -ForegroundColor Green
Write-Host "  API:      http://localhost:3000" -ForegroundColor Green
Write-Host "  Ngrok:    https://<url>.ngrok.io" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Cerrando esta ventana no afecta las terminales abiertas." -ForegroundColor Gray

if (-not $NoBrowser) {
  Start-Sleep 3
  Start-Process "http://localhost:3001"
}
