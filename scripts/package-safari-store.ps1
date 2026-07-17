# OpsGate — package Safari (préparation App Store / Xcode)
# Usage :
#   .\scripts\package-safari-store.ps1
#   .\scripts\package-safari-store.ps1 -SkipBuild
#
# Sortie :
#   dist/safari-store/                   (copie build + checklist)
#   dist/safari-store/SHA256SUMS.txt
#   dist/safari-store/listing/
#
# La conversion Xcode se fait sur macOS :
#   xcrun safari-web-extension-converter dist/safari-store/extension ...

param(
  [switch]$SkipBuild,
  [string]$Version = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
if (-not $Version) {
  $pkg = Get-Content (Join-Path $Root "package.json") -Raw | ConvertFrom-Json
  $Version = $pkg.version
}

$OutRoot = Join-Path $Root "dist\safari-store"
$BuildDir = Join-Path $Root "build\safari-mv3-prod"
$ExtCopy = Join-Path $OutRoot "extension"

Write-Host "=== OpsGate Safari store prep v$Version ===" -ForegroundColor Cyan

if (-not $SkipBuild) {
  Push-Location $Root
  try {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    pnpm build:safari 2>&1 | ForEach-Object { Write-Host $_ }
    $ec = $LASTEXITCODE
    $ErrorActionPreference = $prev
    if ($null -eq $ec) { $ec = 0 }
    if ($ec -ne 0 -and -not (Test-Path (Join-Path $BuildDir "manifest.json"))) {
      Write-Error "build:safari failed ($ec)"
    }
  } finally {
    Pop-Location
  }
}

$manifestPath = Join-Path $BuildDir "manifest.json"
if (-not (Test-Path $manifestPath)) {
  Write-Error "Build manquant: $BuildDir — lancez pnpm build:safari (ou skip si déjà build)"
}

if (Test-Path $OutRoot) {
  Remove-Item -Recurse -Force $OutRoot
}
$listing = Join-Path $OutRoot "listing"
New-Item -ItemType Directory -Force -Path $listing, $ExtCopy | Out-Null

# Copie extension (source pour converter)
Copy-Item -Recurse -Force (Join-Path $BuildDir "*") $ExtCopy
Copy-Item $manifestPath (Join-Path $OutRoot "manifest.json")

# ZIP archive (backup / partage Mac)
$ZipName = "opsgate-$Version-safari-mv3.zip"
$ZipPath = Join-Path $OutRoot $ZipName
Compress-Archive -Path (Join-Path $ExtCopy "*") -DestinationPath $ZipPath -Force
$hash = (Get-FileHash -Path $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
$sizeMb = [math]::Round((Get-Item $ZipPath).Length / 1MB, 2)
"$hash  $ZipName" | Set-Content (Join-Path $OutRoot "SHA256SUMS.txt") -Encoding ASCII

# Icons for App Store checklist
$iconsSrc = Join-Path $Root "assets\icons"
if (Test-Path $iconsSrc) {
  $iconsOut = Join-Path $OutRoot "icons"
  New-Item -ItemType Directory -Force -Path $iconsOut | Out-Null
  Copy-Item (Join-Path $iconsSrc "icon-*.png") $iconsOut -ErrorAction SilentlyContinue
}

$listingMd = @"
# OpsGate — Safari App Store prep (v$Version)

## Artefacts

| Fichier | Usage |
|---------|--------|
| ``extension/`` | Source pour ``safari-web-extension-converter`` |
| ``$ZipName`` | Archive partage Mac (SHA-256 ci-dessous) |
| SHA-256 | ``$hash`` |
| Taille | $sizeMb MB |

## Bundle (recommandé)

| Champ | Valeur |
|-------|--------|
| App name | OpsGate |
| Bundle ID | ``tech.dailyops.opsgate`` |
| Category | Productivity / Utilities |
| Privacy policy | HTTPS de ``docs/PRIVACY.md`` |

## Conversion Xcode (macOS uniquement)

``````bash
# Sur un Mac avec Xcode installé
cd ops-gate   # ou copier dist/safari-store
xcrun safari-web-extension-converter dist/safari-store/extension \
  --project-location ./build/safari-xcode \
  --app-name "OpsGate" \
  --bundle-identifier "tech.dailyops.opsgate" \
  --force

open build/safari-xcode/OpsGate/OpsGate.xcodeproj
``````

## Checklist App Store / notarisation

- [ ] Compte Apple Developer (99 USD/an)
- [ ] ``pnpm store:safari`` (ou ce script) a produit ``extension/``
- [ ] Conversion Xcode OK
- [ ] Signing Team + capabilities (App Groups si besoin)
- [ ] Run on Safari macOS → Enable extension
- [ ] Test ChatGPT banner + enroll (ATS exceptions localhost si lab)
- [ ] Archive → Distribute App (Mac App Store **ou** Developer ID + notarize)
- [ ] Screenshots Mac App Store (1280×800 min)
- [ ] Privacy nutrition labels (App Privacy)
- [ ] Review notes : local mode offline; org mode metadata only

## Limites

- Safari **non disponible sur Windows** — Chrome/Edge/Firefox pour le parc Windows
- Distribution enterprise : Apple Business Manager + force-install MDM Apple
- Voir ``docs/architecture/SAFARI-MV3.md`` et ``docs/PUBLICATION-STORES.md``
"@
Set-Content -Path (Join-Path $listing "README.md") -Value $listingMd -Encoding UTF8

$converterSh = @"
#!/bin/bash
# Run on macOS with Xcode
set -euo pipefail
ROOT="`$(cd "`$(dirname "`$0")/../.." && pwd)"
EXT="`$ROOT/dist/safari-store/extension"
if [[ ! -f "`$EXT/manifest.json" ]]; then
  echo "Missing `$EXT — run: pnpm store:safari" >&2
  exit 1
fi
xcrun safari-web-extension-converter "`$EXT" \
  --project-location "`$ROOT/build/safari-xcode" \
  --app-name "OpsGate" \
  --bundle-identifier "tech.dailyops.opsgate" \
  --force
echo "Open: `$ROOT/build/safari-xcode/OpsGate/OpsGate.xcodeproj"
"@
Set-Content -Path (Join-Path $OutRoot "convert-on-macos.sh") -Value $converterSh -Encoding UTF8

Write-Host @"

=== Safari store prep ready ===
  Extension : $ExtCopy
  ZIP       : $ZipPath  ($sizeMb MB)
  SHA256    : $hash
  Listing   : $listing

Next (macOS): bash dist/safari-store/convert-on-macos.sh
  or see docs/PUBLICATION-STORES.md

"@ -ForegroundColor Green
