# OpsGate — package tous les canaux store (Chrome + Firefox + Safari prep)
# Usage :
#   .\scripts\package-all-stores.ps1
#   .\scripts\package-all-stores.ps1 -SkipBuild
#   .\scripts\package-all-stores.ps1 -ChromeOnly
#   .\scripts\package-all-stores.ps1 -FirefoxOnly
#   .\scripts\package-all-stores.ps1 -SafariOnly

param(
  [switch]$SkipBuild,
  [switch]$ChromeOnly,
  [switch]$FirefoxOnly,
  [switch]$SafariOnly
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$all = -not ($ChromeOnly -or $FirefoxOnly -or $SafariOnly)

Write-Host "=== OpsGate package ALL stores ===" -ForegroundColor Cyan
Write-Host "Root: $Root"

$skip = @()
if ($SkipBuild) { $skip = @("-SkipBuild") }

$failed = @()

function Invoke-StoreScript([string]$Name, [string]$RelPath) {
  $path = Join-Path $Root $RelPath
  Write-Host "`n>>> $Name" -ForegroundColor Yellow
  & powershell -NoProfile -ExecutionPolicy Bypass -File $path @skip
  if ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE) {
    throw "$Name failed with exit $LASTEXITCODE"
  }
}

try {
  if ($all -or $ChromeOnly) {
    try {
      Invoke-StoreScript "Chrome Web Store" "scripts\package-chrome-store.ps1"
    } catch {
      $failed += "chrome: $_"
      Write-Host $_ -ForegroundColor Red
    }
  }
  if ($all -or $FirefoxOnly) {
    try {
      Invoke-StoreScript "Firefox AMO" "scripts\package-firefox-amo.ps1"
    } catch {
      $failed += "firefox: $_"
      Write-Host $_ -ForegroundColor Red
    }
  }
  if ($all -or $SafariOnly) {
    try {
      Invoke-StoreScript "Safari prep" "scripts\package-safari-store.ps1"
    } catch {
      $failed += "safari: $_"
      Write-Host $_ -ForegroundColor Red
    }
  }
} finally {
  # Index des artefacts
  $idx = Join-Path $Root "dist\STORES-INDEX.md"
  $pkg = Get-Content (Join-Path $Root "package.json") -Raw | ConvertFrom-Json
  $ver = $pkg.version
  $lines = @(
    "# OpsGate store packages — v$ver",
    "",
    "Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
    "",
    "| Canal | Dossier | ZIP / artefact |",
    "|-------|---------|----------------|"
  )
  $chromeZip = Get-ChildItem (Join-Path $Root "dist\chrome-store\*.zip") -ErrorAction SilentlyContinue | Select-Object -First 1
  $ffZip = Get-ChildItem (Join-Path $Root "dist\firefox-amo\*.zip") -ErrorAction SilentlyContinue | Select-Object -First 1
  $sfZip = Get-ChildItem (Join-Path $Root "dist\safari-store\*.zip") -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($chromeZip) {
    $h = (Get-FileHash $chromeZip.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $lines += "| Chrome CWS / Edge | ``dist/chrome-store/`` | ``$($chromeZip.Name)`` · ``$h`` |"
  } else {
    $lines += "| Chrome CWS / Edge | — | manquant |"
  }
  if ($ffZip) {
    $h = (Get-FileHash $ffZip.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $lines += "| Firefox AMO | ``dist/firefox-amo/`` | ``$($ffZip.Name)`` · ``$h`` |"
  } else {
    $lines += "| Firefox AMO | — | manquant |"
  }
  if ($sfZip) {
    $h = (Get-FileHash $sfZip.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $lines += "| Safari (prep) | ``dist/safari-store/`` | ``$($sfZip.Name)`` · ``$h`` |"
  } else {
    $lines += "| Safari (prep) | — | manquant |"
  }
  $lines += ""
  $lines += "Guide publication : ``docs/PUBLICATION-STORES.md``"
  $lines += ""
  $lines += "## Prochaines étapes ops"
  $lines += ""
  $lines += "1. Compte [Chrome Web Store Developer](https://chrome.google.com/webstore/devconsole) → upload ZIP chrome"
  $lines += "2. Compte [AMO](https://addons.mozilla.org/developers/) → Unlisted recommandé → upload ZIP firefox"
  $lines += "3. Mac + Xcode → ``dist/safari-store/convert-on-macos.sh`` → App Store / notarize"
  $lines += "4. Noter Extension ID CWS → renseigner ``packaging/chrome-store/mdm/``"
  $lines += "5. Privacy policy HTTPS publique (héberger ``docs/PRIVACY.md``)"
  New-Item -ItemType Directory -Force -Path (Split-Path $idx) | Out-Null
  Set-Content -Path $idx -Value ($lines -join "`n") -Encoding UTF8
  Write-Host "`nIndex: $idx" -ForegroundColor Cyan
}

if ($failed.Count -gt 0) {
  Write-Host "`nÉchecs: $($failed -join '; ')" -ForegroundColor Red
  exit 1
}

Write-Host "`n=== ALL store packages OK ===" -ForegroundColor Green
Write-Host "See dist/STORES-INDEX.md and docs/PUBLICATION-STORES.md"
