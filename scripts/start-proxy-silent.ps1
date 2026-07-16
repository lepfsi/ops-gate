# OpsGate Proxy — demarrage silencieux (pas de terminal visible)
# Usage :
#   .\scripts\start-proxy-silent.ps1
#   .\scripts\start-proxy-silent.ps1 -Stop
# Production future : service Windows (NSSM / sc.exe) — ce script est le pont dev/prod legere.

param(
  [switch]$Stop
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $Root "packages\proxy\data\logs"
$PidFile = Join-Path $Root "packages\proxy\data\proxy.pid"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

if ($Stop) {
  if (Test-Path $PidFile) {
    $pid = [int](Get-Content $PidFile -Raw).Trim()
    try {
      Stop-Process -Id $pid -Force -ErrorAction Stop
      Write-Host "Proxy arrete (PID $pid)." -ForegroundColor Yellow
    } catch {
      Write-Host "Process deja arrete." -ForegroundColor DarkYellow
    }
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
  } else {
    Write-Host "Aucun PID enregistre." -ForegroundColor DarkYellow
  }
  exit 0
}

if (Test-Path $PidFile) {
  $old = [int](Get-Content $PidFile -Raw).Trim()
  $alive = Get-Process -Id $old -ErrorAction SilentlyContinue
  if ($alive) {
    Write-Host "Proxy deja en cours (PID $old)." -ForegroundColor Cyan
    exit 0
  }
}

$outLog = Join-Path $LogDir "proxy-stdout.log"
$errLog = Join-Path $LogDir "proxy-stderr.log"
$pnpm = (Get-Command pnpm -ErrorAction Stop).Source

$p = Start-Process -FilePath $pnpm `
  -ArgumentList @("--filter","@opsgate/proxy","serve") `
  -WorkingDirectory $Root `
  -WindowStyle Hidden `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog `
  -PassThru

$p.Id | Set-Content -Path $PidFile -Encoding ascii
Write-Host "Proxy demarre en arriere-plan (PID $($p.Id))." -ForegroundColor Green
Write-Host "Logs: $LogDir"
Write-Host "Arret: .\scripts\start-proxy-silent.ps1 -Stop"
