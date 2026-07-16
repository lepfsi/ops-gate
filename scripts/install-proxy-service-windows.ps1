# OpsGate Proxy — installation service Windows (P1 prod foundations)
# Prérequis : Node.js + pnpm, CA générée, API joignable pour enroll.
# Usage (PowerShell admin recommandé pour service) :
#   .\scripts\install-proxy-service-windows.ps1
#   .\scripts\install-proxy-service-windows.ps1 -Uninstall
#   .\scripts\install-proxy-service-windows.ps1 -TaskOnly   # Planificateur de tâches (user logon)

param(
  [switch]$Uninstall,
  [switch]$TaskOnly,
  [string]$ServiceName = "OpsGateProxy",
  [string]$NssmPath = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $Root "packages\proxy\data\logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$node = (Get-Command node -ErrorAction Stop).Source
$tsxCli = Join-Path $Root "node_modules\tsx\dist\cli.mjs"
$entry = Join-Path $Root "packages\proxy\src\index.ts"
if (-not (Test-Path $tsxCli)) {
  Write-Error "tsx introuvable ($tsxCli). Lancez pnpm install à la racine."
}
if (-not (Test-Path $entry)) {
  Write-Error "Proxy entry introuvable: $entry"
}

$wrapper = Join-Path $Root "packages\proxy\data\run-proxy-service.cmd"
@"
@echo off
cd /d "$Root"
set OPSGATE_PROXY_HOST=127.0.0.1
set OPSGATE_PROXY_PORT=8888
"$node" "$tsxCli" "$entry" serve >> "$LogDir\service-stdout.log" 2>> "$LogDir\service-stderr.log"
"@ | Set-Content -Path $wrapper -Encoding ASCII

Write-Host "Wrapper: $wrapper" -ForegroundColor Cyan

if ($Uninstall) {
  if (-not $TaskOnly) {
    sc.exe stop $ServiceName 2>$null | Out-Null
    sc.exe delete $ServiceName 2>$null | Out-Null
    if ($NssmPath -and (Test-Path $NssmPath)) {
      & $NssmPath remove $ServiceName confirm 2>$null
    }
  }
  Unregister-ScheduledTask -TaskName $ServiceName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Service/tache $ServiceName retire(e)." -ForegroundColor Yellow
  exit 0
}

if ($TaskOnly) {
  $action = New-ScheduledTaskAction -Execute $wrapper
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
  Register-ScheduledTask -TaskName $ServiceName -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
  Write-Host "Tache planifiee '$ServiceName' au logon utilisateur." -ForegroundColor Green
  Write-Host "Demarrer maintenant: Start-ScheduledTask -TaskName $ServiceName"
  exit 0
}

# Prefer NSSM si fourni
if ($NssmPath -and (Test-Path $NssmPath)) {
  & $NssmPath install $ServiceName $wrapper
  & $NssmPath set $ServiceName AppDirectory $Root
  & $NssmPath set $ServiceName Start SERVICE_AUTO_START
  & $NssmPath start $ServiceName
  Write-Host "Service NSSM $ServiceName installe et demarre." -ForegroundColor Green
  exit 0
}

# Fallback : tache planifiee (pas de service SYSTEM sans nssm)
Write-Host "NSSM non fourni — installation en tache planifiee (user logon)." -ForegroundColor DarkYellow
Write-Host "Prod recommandee: telecharger NSSM et relancer avec -NssmPath."
$action = New-ScheduledTaskAction -Execute $wrapper
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive
Register-ScheduledTask -TaskName $ServiceName -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
Write-Host "Tache '$ServiceName' enregistree. Logs: $LogDir" -ForegroundColor Green
Write-Host @"

Prochaines etapes:
  1) CA trust: certutil -addstore -user Root packages\proxy\data\ca\ca-cert.pem
  2) Enroll:  pnpm proxy:enroll
  3) PAC:     .\scripts\set-system-proxy-pac.ps1
  4) Soft-mask (option): set OPSGATE_PROXY_SOFT_MASK=1 dans le wrapper
  5) GPO enterprise: ProxyPacUrl = http://127.0.0.1:8888/opsgate-proxy.pac

Doc: docs\architecture\PROXY-PROD-WINDOWS.md
"@
