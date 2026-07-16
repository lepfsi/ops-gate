# OpsGate Proxy — stage d'installation portable (prérequis MSI)
# Usage (depuis racine monorepo) :
#   .\scripts\package-proxy-stage.ps1
#   .\scripts\package-proxy-stage.ps1 -OutDir dist\proxy-stage
#   .\scripts\package-proxy-stage.ps1 -SkipEmbeddedNode   # system node only
#   .\scripts\package-proxy-stage.ps1 -NodeVersion 22.14.0
#
# Produit : layout installable (bin bundle + Node portable + scripts).

param(
  [string]$OutDir = "",
  [string]$Version = "",
  [string]$NodeVersion = "",
  [switch]$SkipEmbeddedNode
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
if (-not $OutDir) { $OutDir = Join-Path $Root "dist\proxy-stage" }
if (-not $Version) {
  $pkg = Get-Content (Join-Path $Root "package.json") -Raw | ConvertFrom-Json
  $Version = $pkg.version
}
# Node LTS pin (reproductible) — surcharge : -NodeVersion ou OPSGATE_EMBED_NODE_VERSION
if (-not $NodeVersion) {
  $NodeVersion = $env:OPSGATE_EMBED_NODE_VERSION
}
if (-not $NodeVersion) {
  $NodeVersion = "22.14.0"
}
$NodeVersion = $NodeVersion.TrimStart("v")

Write-Host "=== OpsGate Proxy stage v$Version ===" -ForegroundColor Cyan
Write-Host "Out: $OutDir"
Write-Host "Embedded Node: $(if ($SkipEmbeddedNode) { 'SKIP' } else { "v$NodeVersion win-x64" })"

if (Test-Path $OutDir) {
  Remove-Item -Recurse -Force $OutDir
}
$bin = Join-Path $OutDir "bin"
$scripts = Join-Path $OutDir "scripts"
$runtime = Join-Path $OutDir "runtime\node"
New-Item -ItemType Directory -Force -Path $bin, $scripts, (Join-Path $OutDir "data\logs") | Out-Null

# ── Bundle esbuild (ESM + createRequire pour node-forge) ──
$entry = Join-Path $Root "packages\proxy\src\index.ts"
$outfile = Join-Path $bin "opsgate-proxy.mjs"
if (-not (Test-Path $entry)) { Write-Error "Entry manquante: $entry" }

$banner = "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);"
Push-Location $Root
try {
  # esbuild écrit des stats sur stderr → ne pas traiter comme erreur native
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & npx --yes esbuild@0.23.1 $entry `
    --bundle `
    --platform=node `
    --format=esm `
    --target=node20 `
    --outfile=$outfile `
    --banner:js=$banner 2>&1 | ForEach-Object { Write-Host $_ }
  $ec = $LASTEXITCODE
  $ErrorActionPreference = $prevEap
  if ($ec -ne 0) { Write-Error "esbuild failed ($ec)" }
} finally {
  Pop-Location
}

# ── Node portable win-x64 ──
$embeddedNodeExe = $null
$embeddedNodeVer = $null

if (-not $SkipEmbeddedNode) {
  $cacheRoot = Join-Path $Root "tools\cache"
  $nodeDistName = "node-v$NodeVersion-win-x64"
  $cacheDir = Join-Path $cacheRoot $nodeDistName
  $cacheZip = Join-Path $cacheRoot "$nodeDistName.zip"
  $cacheNode = Join-Path $cacheDir "node.exe"

  if (-not (Test-Path $cacheNode)) {
    New-Item -ItemType Directory -Force -Path $cacheRoot | Out-Null
    $url = "https://nodejs.org/dist/v$NodeVersion/$nodeDistName.zip"
    Write-Host "Downloading Node $NodeVersion win-x64..." -ForegroundColor DarkCyan
    Write-Host "  $url"
    try {
      # Progress can be slow on IWR; disable for speed
      $ProgressPreference = "SilentlyContinue"
      Invoke-WebRequest -Uri $url -OutFile $cacheZip -UseBasicParsing
    } catch {
      Write-Error "Echec telechargement Node: $_. Verifiez la version ($NodeVersion) ou -SkipEmbeddedNode."
    }
    if ((Get-Item $cacheZip).Length -lt 1MB) {
      Write-Error "ZIP Node trop petit — telechargement invalide"
    }
    if (Test-Path $cacheDir) { Remove-Item -Recurse -Force $cacheDir }
    Expand-Archive -Path $cacheZip -DestinationPath $cacheRoot -Force
    # Zip contains top folder node-vX-win-x64/
    if (-not (Test-Path $cacheNode)) {
      Write-Error "node.exe introuvable apres extract: $cacheNode"
    }
    Write-Host "Node cache: $cacheDir" -ForegroundColor Green
  } else {
    Write-Host "Node cache hit: $cacheDir" -ForegroundColor DarkGreen
  }

  # Layout runtime: only what we need to run (slim)
  New-Item -ItemType Directory -Force -Path $runtime | Out-Null
  Copy-Item -Force (Join-Path $cacheDir "node.exe") (Join-Path $runtime "node.exe")
  # Optional license for redistribution compliance
  foreach ($f in @("LICENSE", "LICENSE.md", "README.md")) {
    $src = Join-Path $cacheDir $f
    if (Test-Path $src) {
      Copy-Item -Force $src (Join-Path $runtime $f)
    }
  }
  # Keep a tiny marker
  @{
    version = $NodeVersion
    arch = "win-x64"
    source = "https://nodejs.org/dist/v$NodeVersion/$nodeDistName.zip"
    slim = $true
    files = @("node.exe")
  } | ConvertTo-Json | Set-Content (Join-Path $runtime "opsgate-node.json") -Encoding UTF8

  $embeddedNodeExe = Join-Path $runtime "node.exe"
  $verOut = & $embeddedNodeExe -v 2>&1 | Out-String
  $embeddedNodeVer = $verOut.Trim()
  Write-Host "Embedded node: $embeddedNodeVer ($embeddedNodeExe)" -ForegroundColor Green
}

# Resolve node for smoke + scripts
function Resolve-StageNode {
  if ($embeddedNodeExe -and (Test-Path $embeddedNodeExe)) { return $embeddedNodeExe }
  $sys = (Get-Command node -ErrorAction SilentlyContinue)
  if ($sys) { return $sys.Source }
  Write-Error "Aucun Node disponible (ni embarque ni PATH)"
}

$nodeExe = Resolve-StageNode

# Smoke with target runtime
$smoke = & $nodeExe $outfile status 2>&1 | Out-String
if ($smoke -notmatch "ca_ready") {
  Write-Error "Smoke test failed: $smoke"
}
Write-Host "Smoke status OK ($nodeExe)" -ForegroundColor Green

# ── run-proxy.cmd (service / tâche) — préfère runtime\node\node.exe ──
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

rem Prefer embedded portable Node
set NODE_EXE=%INSTALL_ROOT%\runtime\node\node.exe
if not exist "%NODE_EXE%" (
  where node >nul 2>&1
  if errorlevel 1 (
    echo [OpsGate] Node introuvable (ni runtime embarque ni PATH).
    exit /b 1
  )
  set NODE_EXE=node
)

cd /d "%INSTALL_ROOT%"
"%NODE_EXE%" "%INSTALL_ROOT%\bin\opsgate-proxy.mjs" serve >> "%LOGDIR%\service-stdout.log" 2>> "%LOGDIR%\service-stderr.log"
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
$proxyJs = Join-Path $InstallRoot "bin\opsgate-proxy.mjs"
$run = Join-Path $InstallRoot "run-proxy.cmd"
$embedded = Join-Path $InstallRoot "runtime\node\node.exe"
if (-not (Test-Path $proxyJs)) { Write-Error "Bundle introuvable: $proxyJs" }

function Get-OpsGateNode {
  if (Test-Path $embedded) { return $embedded }
  $sys = Get-Command node -ErrorAction SilentlyContinue
  if ($sys) { return $sys.Source }
  throw "Node introuvable (runtime embarque manquant et PATH vide)"
}

$node = Get-OpsGateNode
Write-Host "Using Node: $node" -ForegroundColor Cyan

$env:OPSGATE_PROXY_USE_PROGRAMDATA = "1"
if ($ApiUrl) { $env:OPSGATE_API_URL = $ApiUrl }
if ($OrgCode) { $env:OPSGATE_ORG_CODE = $OrgCode }

Write-Host "InstallRoot: $InstallRoot" -ForegroundColor Cyan

# 1) CA
Write-Host "Generating local CA..." -ForegroundColor DarkCyan
& $node $proxyJs gen-ca
$caStatus = & $node $proxyJs status | ConvertFrom-Json
$caCert = $caStatus.ca_cert
if (-not $SkipCaTrust -and $caCert -and (Test-Path $caCert)) {
  Write-Host "Trust CA (user Root): $caCert"
  certutil -addstore -user Root $caCert | Out-Null
}

# 2) Enroll
if (-not $SkipEnroll) {
  try {
    Write-Host "Enroll proxy agent..."
    & $node $proxyJs enroll
  } catch {
    Write-Host "Enroll echoue (API down?) — relancer: & `"$node`" `"$proxyJs`" enroll" -ForegroundColor Yellow
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

OK — OpsGate Proxy post-install.
  Node   : $node
  Status : & `"$node`" `"$proxyJs`" status
  Health : http://127.0.0.1:8888/opsgate-proxy/health
  PAC    : http://127.0.0.1:8888/opsgate-proxy.pac
  Soft-mask on-wire : set OPSGATE_PROXY_SOFT_MASK=1

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

# Helper CLI wrapper
$cliCmd = Join-Path $OutDir "opsgate-proxy.cmd"
@"
@echo off
setlocal
set INSTALL_ROOT=%~dp0
set INSTALL_ROOT=%INSTALL_ROOT:~0,-1%
set NODE_EXE=%INSTALL_ROOT%\runtime\node\node.exe
if not exist "%NODE_EXE%" set NODE_EXE=node
"%NODE_EXE%" "%INSTALL_ROOT%\bin\opsgate-proxy.mjs" %*
"@ | Set-Content -Path $cliCmd -Encoding ASCII

# ── README stage ──
$nodeSection = if ($SkipEmbeddedNode) {
  @"
## Runtime

Node systeme requis (20+ LTS) dans le PATH.
"@
} else {
  @"
## Runtime (Node portable embarque)

- ``runtime/node/node.exe`` — Node.js **v$NodeVersion** win-x64 (officiel nodejs.org)
- Aucun Node systeme requis
- Fallback PATH si ``runtime\node\node.exe`` absent
"@
}

@"
# OpsGate Proxy — package v$Version

## Contenu

- ``bin/opsgate-proxy.mjs`` — proxy standalone (esbuild)
- ``runtime/node/node.exe`` — Node portable (si embarque)
- ``run-proxy.cmd`` — service / tache (logs ProgramData)
- ``opsgate-proxy.cmd`` — CLI (status, enroll, gen-ca, serve)
- ``scripts/post-install.ps1`` — CA + trust + enroll + tache planifiee
- ``scripts/uninstall-service.ps1``

$nodeSection

## Prefs data

Avec ``OPSGATE_PROXY_USE_PROGRAMDATA=1`` (defaut run-proxy) :

``%ProgramData%\OpsGate\Proxy\`` (ca, agent.json, logs)

## Install manuelle (sans MSI)

``````powershell
# Copier ce dossier vers C:\Program Files\OpsGate\Proxy
powershell -ExecutionPolicy Bypass -File scripts\post-install.ps1 -InstallRoot `$PWD
.\opsgate-proxy.cmd status
``````

## MSI

``pnpm proxy:msi`` ou ``.\scripts\build-proxy-msi.ps1``

## Env utiles

| Variable | Defaut |
|----------|--------|
| OPSGATE_API_URL | http://127.0.0.1:8787 |
| OPSGATE_ORG_CODE | DEMO-OPSGATE |
| OPSGATE_PROXY_SOFT_MASK | off / 1 (onwire) / local |
| OPSGATE_PROXY_MODE | enforce |
| OPSGATE_PROXY_HTTP2 | 1 |
"@ | Set-Content -Path (Join-Path $OutDir "README.md") -Encoding UTF8

# Version stamp
@{
  name = "opsgate-proxy"
  version = $Version
  built_at = (Get-Date).ToUniversalTime().ToString("o")
  node_build_host = (node -v)
  node_embedded = $embeddedNodeVer
  node_embedded_version = $(if ($SkipEmbeddedNode) { $null } else { $NodeVersion })
  node_embedded_path = $(if ($embeddedNodeExe) { "runtime/node/node.exe" } else { $null })
} | ConvertTo-Json | Set-Content (Join-Path $OutDir "version.json") -Encoding UTF8

# ZIP portable
New-Item -ItemType Directory -Force -Path (Join-Path $Root "dist") | Out-Null
$zip = Join-Path $Root "dist\opsgate-proxy-$Version-win-x64.zip"
if (Test-Path $zip) { Remove-Item -Force $zip }
Compress-Archive -Path (Join-Path $OutDir "*") -DestinationPath $zip -Force

$nodeSize = if ($embeddedNodeExe) {
  [math]::Round((Get-Item $embeddedNodeExe).Length / 1MB, 1)
} else { 0 }
$zipSize = [math]::Round((Get-Item $zip).Length / 1MB, 2)

Write-Host "ZIP: $zip ($zipSize MB)" -ForegroundColor Green
Write-Host "Stage pret: $OutDir (node.exe ~${nodeSize} MB)" -ForegroundColor Green
