# OpsGate — package Chrome Web Store + artefacts enterprise
# Usage (racine monorepo) :
#   .\scripts\package-chrome-store.ps1
#   .\scripts\package-chrome-store.ps1 -SkipBuild
#
# Sortie :
#   dist/chrome-store/opsgate-<ver>-chrome.zip     (upload CWS)
#   dist/chrome-store/SHA256SUMS.txt
#   dist/chrome-store/listing/                     (checklist + copy)
#   dist/chrome-store/mdm/                         (copies policies)

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

$OutRoot = Join-Path $Root "dist\chrome-store"
$BuildDir = Join-Path $Root "build\chrome-mv3-prod"
$ZipName = "opsgate-$Version-chrome.zip"
$ZipPath = Join-Path $OutRoot $ZipName

Write-Host "=== OpsGate Chrome Web Store package v$Version ===" -ForegroundColor Cyan

if (-not $SkipBuild) {
  Push-Location $Root
  try {
    pnpm build:chrome
    if ($LASTEXITCODE -ne 0) { Write-Error "build:chrome failed" }
  } finally {
    Pop-Location
  }
}

if (-not (Test-Path (Join-Path $BuildDir "manifest.json"))) {
  Write-Error "Build manquant: $BuildDir — lancez pnpm build:chrome"
}

if (Test-Path $OutRoot) {
  Remove-Item -Recurse -Force $OutRoot
}
$listing = Join-Path $OutRoot "listing"
$mdmOut = Join-Path $OutRoot "mdm"
New-Item -ItemType Directory -Force -Path $listing, $mdmOut | Out-Null

# ZIP sans dossier parent (racine = contenu extension)
if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }
Compress-Archive -Path (Join-Path $BuildDir "*") -DestinationPath $ZipPath -Force

$hash = (Get-FileHash -Path $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
$sizeMb = [math]::Round((Get-Item $ZipPath).Length / 1MB, 2)
@"
$hash  $ZipName
"@ | Set-Content (Join-Path $OutRoot "SHA256SUMS.txt") -Encoding ASCII

# Manifest snapshot
Copy-Item (Join-Path $BuildDir "manifest.json") (Join-Path $OutRoot "manifest.json")

# Listing copy
$listingMd = @"
# OpsGate — Chrome Web Store listing (v$Version)

## Package

| Champ | Valeur |
|-------|--------|
| ZIP | ``$ZipName`` |
| SHA-256 | ``$hash`` |
| Taille | $sizeMb MB |
| Manifest | 3 |
| Build | ``build/chrome-mv3-prod`` |

## Champs store (copier-coller)

| Champ | Texte |
|-------|--------|
| **Name** | OpsGate |
| **Summary** (132 car. max) | Protect company data in AI chats — detect secrets, PII and infra configs before they leave the browser. |
| **Description** | Voir ``store-description.txt`` |
| **Category** | Productivity / Workflow & Planning (ou Privacy & Security si dispo) |
| **Language** | French + English |
| **Privacy policy** | URL publique de ``docs/PRIVACY.md`` (héberger sur site produit) |
| **Single purpose** | Prevent accidental leakage of sensitive data into generative AI web apps. |
| **Homepage** | URL produit OpsGate / DailyOps |
| **Support** | Email support IT |

## Assets graphiques

| Asset | Source repo | Store |
|-------|-------------|-------|
| Icon 128 | ``assets/icons/icon-128.png`` | Requis |
| Promo small 440x280 | à générer | Optionnel |
| Promo marquee 1400x560 | ``assets/brand/opsgate-banner-1280.png`` (recadrer) | Optionnel |
| Screenshots 1280x800 | à capturer (popup + banner + options) | Min 1 |

## Permissions justifications (CWS)

| Permission | Justification EN |
|------------|------------------|
| storage | Save local journal, enrollment token and policy cache on device. |
| alarms | Periodic policy sync (every 2 minutes) with the org control plane. |
| host_permissions (AI sites) | Inject content scripts only on known generative-AI web apps to scan prompts before send. |
| host 127.0.0.1:8787 | Optional local control-plane API for enterprise enrollment (dev/pilot). |

## Checklist publication

- [ ] Compte Chrome Web Store Developer (one-time fee)
- [ ] Privacy policy URL HTTPS publique
- [ ] Screenshots capturés
- [ ] ZIP uploadé (``$ZipName``)
- [ ] Review notes : offline local mode; org mode sends metadata only (no prompt body)
- [ ] Après publish : noter **Extension ID** pour MDM force-install
- [ ] Mettre à jour ``packaging/chrome-store/mdm/extension-id.placeholder``

## Après publication

1. Copier l'Extension ID (32 lettres a-p)
2. Renseigner dans GPO / Intune (voir ``mdm/``)
3. Update URL store : ``https://clients2.google.com/service/update2/crx``
"@
Set-Content -Path (Join-Path $listing "README.md") -Value $listingMd -Encoding UTF8

$desc = @"
OpsGate protects your organization when employees use ChatGPT, Claude, Gemini, Copilot, Perplexity and other AI sites.

What it does
• Scans prompts and file uploads in the browser before they are sent
• Detects secrets, API keys, PII, credit cards, IBAN, infrastructure configs (Fortinet, WireGuard, cloud keys…)
• Shows a clear banner: mask & send, send anyway, or cancel
• Optional enterprise mode: enroll with an org code, central policy, and metadata-only event reporting (never the full prompt by default)

Privacy
• Local mode: 100% on-device, no OpsGate network calls
• Org mode: only detection metadata (rule types, decision, hostname) — not conversation content

For IT teams: pair with OpsGate control plane (API + console) and optional local HTTPS proxy for defense in depth.

Support: contact your OpsGate administrator.
"@
Set-Content -Path (Join-Path $listing "store-description.txt") -Value $desc -Encoding UTF8

# Copy MDM templates from packaging/
$mdmSrc = Join-Path $Root "packaging\chrome-store\mdm"
if (Test-Path $mdmSrc) {
  Copy-Item -Recurse -Force (Join-Path $mdmSrc "*") $mdmOut
}

Write-Host @"

=== Chrome Store package ready ===
  ZIP    : $ZipPath  ($sizeMb MB)
  SHA256 : $hash
  Listing: $listing
  MDM    : $mdmOut

Upload ZIP to https://chrome.google.com/webstore/devconsole
Then configure ExtensionInstallForcelist with the published Extension ID.

"@ -ForegroundColor Green
