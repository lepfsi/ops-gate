# OpsGate Proxy — stage d'installation portable (prérequis MSI)
# Usage (depuis racine monorepo) :
#   .\scripts\package-proxy-stage.ps1
#   .\scripts\package-proxy-stage.ps1 -OutDir dist\proxy-stage
#
# Produit : layout installable (bin bundle + scripts) sans dépendre du monorepo.

param(
  [string]$OutDir = "",
  [string]$Version = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
if (-not $OutDir) { $OutDir = Join-Path $Root "dist\proxy-stage" }
if (-not $Version) {
  $pkg = Get-Content (Join-Path $Root "package.json") -Raw | ConvertFrom-Json
  $Version = $pkg.version
}

Write-Host "=== OpsGate Proxy stage v$Version ===" -ForegroundColor Cyan
Write-Host "Out: $OutDir"

if (Test-Path $OutDir) {
  Remove-Item -Recurse -Force $OutDir
}
$bin = Join-Path $OutDir "bin"
$scripts = Join-Path $OutDir "scripts"
New-Item -ItemType Directory -Force -Path $bin, $scripts, (Join-Path $OutDir "data\logs") | Out-Null

# ── Bundle esbuild (CJS-compat ESM + createRequire pour node-forge) ──
$entry = Join-Path $Root "packages\proxy\src\index.ts"
$outfile = Join-Path $bin "opsgate-proxy.mjs"
if (-not (Test-Path $entry)) { Write-Error "Entry manquante: $entry" }

$banner = "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);"
Push-Location $Root
try {
  npx --yes esbuild@0.23.1 $entry `
    --bundle `
    --platform=node `
    --format=esm `
    --target=node20 `
    --outfile=$outfile `
    --banner:js=$banner
  if ($LASTEXITCODE -ne 0) { Write-Error "esbuild failed ($LASTEXITCODE)" }
} finally {
  Pop-Location
}

# Smoke
$smoke = & node $outfile status 2>&1 | Out-String
if ($smoke -notmatch "ca_ready") {
  Write-Error "Smoke test failed: $smoke"
}
Write-Host "Smoke status OK" -ForegroundColor Green

# ── run-proxy.cmd (service / tâche) ──
$runCmd = Join-Path $OutDir "run-proxy.cmd"
@"
@echo off
setlocal
set INSTALL_ROOT=%~dp0
set INSTALL_ROOT=%INSTALL_ROOT:~0,-1%
set OPSGATE_PROXY_HOST=127.0.0.1
set OPSGATE_PROXY_PORT=8888
set OPSGATE_PROXY_USE_PROGRAMDATA=1
if not defined OPSGATE_API_URL set OPSGATE_API_URL=http://127.0.0.1:8787
if not defined OPSGATE_ORG_CODE set OPSGATE_ORG_CODE=DEMO-OPSGATE
if not defined PROGRAMDATA set PROGRAMDATA=C:\ProgramData
set LOGDIR=%PROGRAMDATA%\OpsGate\Proxy\logs
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
where node >nul 2>&1
if errorlevel 1 (
  echo [OpsGate] Node.js introuvable dans PATH. Installez Node 20+ LTS.
  exit /b 1
)
cd /d "%INSTALL_ROOT%"
node "%INSTALL_ROOT%\bin\opsgate-proxy.mjs" serve >> "%LOGDIR%\service-stdout.log" 2>> "%LOGDIR%\service-stderr.log"
"@ | Set-Content -Path $runCmd -Encoding ASCII

# ── post-install helpers ──
$postInstall = Join-Path $scripts "post-install.ps1"
@'
# OpsGate Proxy — post-install (CA + tache planifiee + enroll optionnel)
param(
  [string]$InstallRoot = "",
  [string]$ApiUrl = "",
  [string]$OrgCode = "",
  [switch]$SkipEnroll,
  [switch]$SkipTask,
  [switch]$SkipCaTrust
)
$ErrorActionPreference = "Stop"
if (-not $InstallRoot) { $InstallRoot = Split-Path -Parent $PSScriptRoot }
$bin = Join-Path $InstallRoot "bin\opsgate-proxy.mjs"
$run = Join-Path $InstallRoot "run-proxy.cmd"
if (-not (Test-Path $bin)) { Write-Error "Bundle introuvable: $bin" }

$env:OPSGATE_PROXY_USE_PROGRAMDATA = "1"
if ($ApiUrl) { $env:OPSGATE_API_URL = $ApiUrl }
if ($OrgCode) { $env:OPSGATE_ORG_CODE = $OrgCode }

Write-Host "InstallRoot: $InstallRoot" -ForegroundColor Cyan

# 1) CA
Write-Host "Generating local CA..." -ForegroundColor DarkCyan
& node $bin gen-ca
$caStatus = & node $bin status | ConvertFrom-Json
$caCert = $caStatus.ca_cert
if (-not $SkipCaTrust -and $caCert -and (Test-Path $caCert)) {
  Write-Host "Trust CA (user Root): $caCert"
  certutil -addstore -user Root $caCert | Out-Null
}

# 2) Enroll
if (-not $SkipEnroll) {
  try {
    Write-Host "Enroll proxy agent..."
    & node $bin enroll
  } catch {
    Write-Host "Enroll echoue (API down?) — relancer: node bin\opsgate-proxy.mjs enroll" -ForegroundColor Yellow
  }
}

# 3) Scheduled task at logon
if (-not $SkipTask) {
  $taskName = "OpsGateProxy"
  $action = New-ScheduledTaskAction -Execute $run
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
  Write-Host "Tache planifiee: $taskName" -ForegroundColor Green
  try { Start-ScheduledTask -TaskName $taskName } catch { }
}

Write-Host @"

OK — OpsGate Proxy poste-install.
  Status : node `"$bin`" status
  Health : http://127.0.0.1:8888/opsgate-proxy/health
  PAC    : http://127.0.0.1:8888/opsgate-proxy.pac
  Soft-mask on-wire : set OPSGATE_PROXY_SOFT_MASK=1 (systeme / tache)

"@ -ForegroundColor Green
'@ | Set-Content -Path $postInstall -Encoding UTF8

$uninstall = Join-Path $scripts "uninstall-service.ps1"
@'
param([string]$TaskName = "OpsGateProxy")
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
sc.exe stop $TaskName 2>$null | Out-Null
sc.exe delete $TaskName 2>$null | Out-Null
Write-Host "Service/tache $TaskName retire(e)."
'@ | Set-Content -Path $uninstall -Encoding UTF8

# ── README stage ──
@"
# OpsGate Proxy — package v$Version

## Contenu

- ``bin/opsgate-proxy.mjs`` — proxy standalone (Node 20+)
- ``run-proxy.cmd`` — lance le service (logs ProgramData)
- ``scripts/post-install.ps1`` — CA + trust + enroll + tache planifiee
- ``scripts/uninstall-service.ps1``

## Prefs data

Par defaut en install (Program Files) ou avec ``OPSGATE_PROXY_USE_PROGRAMDATA=1`` :

``%ProgramData%\OpsGate\Proxy\`` (ca, agent.json, logs)

## Install manuelle (sans MSI)

``````powershell
# Copier ce dossier vers C:\Program Files\OpsGate\Proxy
powershell -ExecutionPolicy Bypass -File scripts\post-install.ps1 -InstallRoot `$PWD
``````

## MSI

``.\scripts\build-proxy-msi.ps1`` produit ``dist\opsgate-proxy-$Version.msi``.

## Env utiles

| Variable | Defaut |
|----------|--------|
| OPSGATE_API_URL | http://127.0.0.1:8787 |
| OPSGATE_ORG_CODE | DEMO-OPSGATE |
| OPSGATE_PROXY_SOFT_MASK | off / 1 (onwire) / local |
| OPSGATE_PROXY_MODE | enforce |
"@ | Set-Content -Path (Join-Path $OutDir "README.md") -Encoding UTF8

# Version stamp
@{
  name = "opsgate-proxy"
  version = $Version
  built_at = (Get-Date).ToUniversalTime().ToString("o")
  node = (node -v)
} | ConvertTo-Json | Set-Content (Join-Path $OutDir "version.json") -Encoding UTF8

# ZIP portable
$zip = Join-Path $Root "dist\opsgate-proxy-$Version-win-x64.zip"
if (Test-Path $zip) { Remove-Item -Force $zip }
Compress-Archive -Path (Join-Path $OutDir "*") -DestinationPath $zip -Force
Write-Host "ZIP: $zip" -ForegroundColor Green
Write-Host "Stage pret: $OutDir" -ForegroundColor Green
