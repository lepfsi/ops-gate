# OpsGate Proxy — build MSI (WiX 3.14 binaries auto-téléchargés si besoin)
# Usage (admin non requis pour le build) :
#   .\scripts\build-proxy-msi.ps1
#   .\scripts\build-proxy-msi.ps1 -SkipStage   # réutilise dist\proxy-stage
#   .\scripts\build-proxy-msi.ps1 -SkipUi      # MSI sans UI WixUI (plus simple)
#
# Sortie : dist\opsgate-proxy-<version>.msi + ZIP stage

param(
  [switch]$SkipStage,
  [switch]$SkipUi,
  [string]$Version = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Stage = Join-Path $Root "dist\proxy-stage"
$Packaging = Join-Path $Root "packaging\proxy"
$WixDir = Join-Path $Root "tools\wix314"
$OutDir = Join-Path $Root "dist"

if (-not $Version) {
  $pkg = Get-Content (Join-Path $Root "package.json") -Raw | ConvertFrom-Json
  $Version = $pkg.version
}
# WiX Version = major.minor.build.revision (max 255.255.65535.65535)
$wixVer = if ($Version -match '^\d+\.\d+\.\d+$') { "$Version.0" } else { "1.2.0.0" }

Write-Host "=== Build MSI OpsGate Proxy v$Version (WiX $wixVer) ===" -ForegroundColor Cyan

if (-not $SkipStage) {
  & (Join-Path $PSScriptRoot "package-proxy-stage.ps1") -OutDir $Stage -Version $Version
}

if (-not (Test-Path (Join-Path $Stage "bin\opsgate-proxy.mjs"))) {
  Write-Error "Stage incomplet: $Stage"
}

# ── WiX 3.14 binaries ──
$candle = Join-Path $WixDir "candle.exe"
$light = Join-Path $WixDir "light.exe"
$heat = Join-Path $WixDir "heat.exe"

if (-not (Test-Path $candle)) {
  Write-Host "Telechargement WiX 3.14 binaries..." -ForegroundColor DarkCyan
  New-Item -ItemType Directory -Force -Path $WixDir | Out-Null
  $zip = Join-Path $env:TEMP "wix314-binaries.zip"
  $url = "https://github.com/wixtoolset/wix3/releases/download/wix3141rtm/wix314-binaries.zip"
  try {
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
  } catch {
    Write-Error "Echec telechargement WiX: $_. Installez manuellement dans tools\wix314"
  }
  Expand-Archive -Path $zip -DestinationPath $WixDir -Force
  Remove-Item $zip -Force -ErrorAction SilentlyContinue
}
if (-not (Test-Path $candle)) {
  Write-Error "candle.exe introuvable dans $WixDir"
}

# ── Icon placeholder (exe dummy pour WiX Icon) : utiliser un .ico si present ──
$iconPath = Join-Path $Packaging "proxy.ico"
if (-not (Test-Path $iconPath)) {
  # Minimal 16x16 ICO (1 bit) — bytes valides pour WiX
  $icoBytes = [byte[]](
    0x00,0x00,0x01,0x00,0x01,0x00,0x10,0x10,0x00,0x00,0x01,0x00,0x20,0x00,
    0x68,0x04,0x00,0x00,0x16,0x00,0x00,0x00,
    0x28,0x00,0x00,0x00,0x10,0x00,0x00,0x00,0x20,0x00,0x00,0x00,0x01,0x00,0x20,0x00,
    0x00,0x00,0x00,0x00,0x00,0x04,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00
  )
  # pad to valid AND+XOR masks roughly
  $pad = New-Object byte[] (0x468 - $icoBytes.Length)
  [System.IO.File]::WriteAllBytes($iconPath, ($icoBytes + $pad))
}

$license = Join-Path $Packaging "License.rtf"
$buildDir = Join-Path $Root "dist\msi-build"
if (Test-Path $buildDir) { Remove-Item -Recurse -Force $buildDir }
New-Item -ItemType Directory -Force -Path $buildDir | Out-Null

# ── Heat : harvest stage files ──
$harvested = Join-Path $buildDir "Harvested.wxs"
& $heat dir $Stage -cg ProxyFiles -gg -sfrag -srd -dr INSTALLFOLDER -var var.StageDir -out $harvested
if ($LASTEXITCODE -ne 0) { Write-Error "heat failed" }

# ── Product.wxs (optionnellement avec UI) ──
$productSrc = Join-Path $Packaging "Product.wxs"
$productBuild = Join-Path $buildDir "Product.wxs"
$productXml = Get-Content $productSrc -Raw -Encoding UTF8
if (-not $SkipUi) {
  $uiBlock = @"
    <UIRef Id="WixUI_InstallDir" />
    <Property Id="WIXUI_INSTALLDIR" Value="INSTALLFOLDER" />
    <WixVariable Id="WixUILicenseRtf" Value="$license" />
"@
  $productXml = $productXml -replace '<!--WIXUI_PLACEHOLDER-->', $uiBlock
} else {
  $productXml = $productXml -replace '<!--WIXUI_PLACEHOLDER-->', '<!-- UI skipped -->'
}
# Write ASCII-safe (strip remaining non-1252 if any)
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($productBuild, $productXml, $utf8NoBom)

$extUi = Join-Path $WixDir "WixUIExtension.dll"
$candleArgs = @(
  "-nologo",
  "-dProductVersion=$wixVer",
  "-dStageDir=$Stage",
  "-out", (Join-Path $buildDir "\"),
  $productBuild,
  $harvested
)
Write-Host "candle..." -ForegroundColor DarkCyan
& $candle @candleArgs
if ($LASTEXITCODE -ne 0) { Write-Error "candle failed" }

$wixobj = @(Get-ChildItem $buildDir -Filter *.wixobj | ForEach-Object { $_.FullName })
$msi = Join-Path $OutDir "opsgate-proxy-$Version.msi"
if (Test-Path $msi) { Remove-Item -Force $msi }

function Invoke-Light([switch]$WithUi) {
  $argsLight = @(
    "-nologo",
    "-out", $msi,
    "-spdb",
    "-sval",
    "-cultures:en-us"
  )
  if ($WithUi -and (Test-Path $extUi)) {
    $argsLight += @("-ext", $extUi)
  }
  $argsLight += $wixobj
  Write-Host "light (ui=$WithUi)..." -ForegroundColor DarkCyan
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & $light @argsLight 2>&1 | ForEach-Object { Write-Host $_ }
  $ec = $LASTEXITCODE
  $ErrorActionPreference = $prev
  if ($null -eq $ec) { $ec = 0 }
  return [int]$ec
}

$code = 1
if (-not $SkipUi) {
  $code = Invoke-Light -WithUi
  if ($code -ne 0 -and -not (Test-Path $msi)) {
    Write-Host "light with UI failed (exit $code) — trying without UI..." -ForegroundColor Yellow
    $code = Invoke-Light
  }
} else {
  $code = Invoke-Light
}

# light may print warnings but still produce MSI
if (-not (Test-Path $msi)) {
  Write-Error "light failed (exit $code). MSI non produit."
}
if ($code -ne 0) {
  Write-Host "light exit=$code but MSI exists — OK" -ForegroundColor Yellow
}

$size = [math]::Round((Get-Item $msi).Length / 1MB, 2)
Write-Host @"

=== MSI ready ===
  $msi  ($size MB)
  Stage : $Stage
  ZIP   : $(Join-Path $OutDir "opsgate-proxy-$Version-win-x64.zip")

Install (admin) :
  msiexec /i `"$msi`" /qn
  msiexec /i `"$msi`"

Post-install if custom action skipped :
  powershell -ExecutionPolicy Bypass -File `"C:\Program Files\OpsGate\Proxy\scripts\post-install.ps1`"

"@ -ForegroundColor Green
