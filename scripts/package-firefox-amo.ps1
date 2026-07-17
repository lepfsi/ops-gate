# OpsGate — package Firefox AMO (addons.mozilla.org)
# Usage (racine monorepo) :
#   .\scripts\package-firefox-amo.ps1
#   .\scripts\package-firefox-amo.ps1 -SkipBuild
#
# Sortie :
#   dist/firefox-amo/opsgate-<ver>-firefox.zip   (upload AMO)
#   dist/firefox-amo/SHA256SUMS.txt
#   dist/firefox-amo/listing/                    (checklist + copy)
#   dist/firefox-amo/source-notes.md             (review notes)

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

$OutRoot = Join-Path $Root "dist\firefox-amo"
$BuildDir = Join-Path $Root "build\firefox-mv3-prod"
$ZipName = "opsgate-$Version-firefox.zip"
$ZipPath = Join-Path $OutRoot $ZipName

Write-Host "=== OpsGate Firefox AMO package v$Version ===" -ForegroundColor Cyan

if (-not $SkipBuild) {
  Push-Location $Root
  try {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    pnpm build:firefox 2>&1 | ForEach-Object { Write-Host $_ }
    $ec = $LASTEXITCODE
    $ErrorActionPreference = $prev
    if ($null -eq $ec) { $ec = 0 }
    if ($ec -ne 0 -and -not (Test-Path (Join-Path $Root "build\firefox-mv3-prod\manifest.json"))) {
      Write-Error "build:firefox failed ($ec)"
    }
  } finally {
    Pop-Location
  }
}

$manifestPath = Join-Path $BuildDir "manifest.json"
if (-not (Test-Path $manifestPath)) {
  Write-Error "Build manquant: $BuildDir — lancez pnpm build:firefox"
}

# Validate gecko id
$man = Get-Content $manifestPath -Raw | ConvertFrom-Json
$geckoId = $man.browser_specific_settings.gecko.id
if (-not $geckoId) {
  Write-Error "manifest.browser_specific_settings.gecko.id manquant"
}
$minVer = $man.browser_specific_settings.gecko.strict_min_version
Write-Host "Gecko id: $geckoId (min $minVer)" -ForegroundColor DarkCyan

if (Test-Path $OutRoot) {
  Remove-Item -Recurse -Force $OutRoot
}
$listing = Join-Path $OutRoot "listing"
New-Item -ItemType Directory -Force -Path $listing | Out-Null

# ZIP AMO : contenu de firefox-mv3-prod à la racine du zip
if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }
Compress-Archive -Path (Join-Path $BuildDir "*") -DestinationPath $ZipPath -Force

$hash = (Get-FileHash -Path $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
$sizeMb = [math]::Round((Get-Item $ZipPath).Length / 1MB, 2)
"$hash  $ZipName" | Set-Content (Join-Path $OutRoot "SHA256SUMS.txt") -Encoding ASCII

Copy-Item $manifestPath (Join-Path $OutRoot "manifest.json")

# Optional plasmo package zip if present under build/
Get-ChildItem (Join-Path $Root "build") -Filter "*.zip" -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match "firefox|opsgate" } |
  ForEach-Object {
    Copy-Item $_.FullName (Join-Path $OutRoot $_.Name) -ErrorAction SilentlyContinue
  }

$listingMd = @"
# OpsGate — Firefox AMO listing (v$Version)

## Package

| Champ | Valeur |
|-------|--------|
| ZIP | ``$ZipName`` |
| SHA-256 | ``$hash`` |
| Taille | $sizeMb MB |
| Manifest | 3 |
| Gecko id | ``$geckoId`` |
| Min Firefox | $minVer |
| Build | ``build/firefox-mv3-prod`` |

## Champs AMO (copier-coller)

| Champ | Texte |
|-------|--------|
| **Name** | OpsGate |
| **Summary** | Protect company data in AI chats — detect secrets and PII before they leave the browser. |
| **Description** | Voir ``store-description.txt`` |
| **Categories** | Privacy & Security, Productivity |
| **Support email** | support IT / produit |
| **Homepage** | URL produit OpsGate |
| **Privacy policy** | HTTPS de ``docs/PRIVACY.md`` |
| **License** | Selon licence produit (privé enterprise / MIT partiel) |

## Permissions (justifications EN)

| Permission | Justification |
|------------|----------------|
| storage | Local journal, enrollment token, policy cache. |
| alarms | Periodic org policy sync (~2 min). |
| host AI sites | Content scripts only on listed generative-AI sites. |
| host 127.0.0.1:8787 | Optional local control-plane API (enterprise pilot). |

## Checklist publication

- [ ] Compte [addons.mozilla.org](https://addons.mozilla.org/developers/)
- [ ] Type : **Listed** (public) ou **Unlisted** (enterprise only — recommandé pilote)
- [ ] Upload ``$ZipName``
- [ ] Privacy policy URL HTTPS
- [ ] Screenshots (popup + banner)
- [ ] Notes de review : voir ``source-notes.md``
- [ ] Si code minifié : fournir source monorepo (tag git v$Version) ou lien GitHub
- [ ] Après signature : noter URL / UUID AMO

## Distribution enterprise (unlisted)

1. Publish **Unlisted** → télécharger le XPI signé  
2. Distribuer via GPO / Intune / script (``policies.json`` Firefox)  
3. Voir ``packaging/firefox-amo/enterprise-policies.json.template``

## Dev local (sans AMO)

```
about:debugging → Charger un module temporaire
→ build/firefox-mv3-prod/manifest.json
```
"@
Set-Content -Path (Join-Path $listing "README.md") -Value $listingMd -Encoding UTF8

$desc = @"
OpsGate protects your organization when employees use ChatGPT, Claude, Gemini, Copilot, Perplexity and other AI sites in Firefox.

Features
• Scans prompts and file uploads in the browser before send
• Detects secrets, API keys, PII, cards, IBAN, infrastructure configs
• Clear banner: mask & send, send anyway, or cancel
• Optional enterprise enrollment: central policy and metadata-only event reporting (not full prompts by default)

Privacy
• Local mode: 100% on-device
• Org mode: detection metadata only unless your admin configures otherwise

Requires Firefox 121+.
"@
Set-Content -Path (Join-Path $listing "store-description.txt") -Value $desc -Encoding UTF8

$sourceNotes = @"
# AMO reviewer notes — OpsGate v$Version

## Build from source

``````bash
git checkout v$Version   # or main @ package version $Version
pnpm install
pnpm build:firefox
# Output: build/firefox-mv3-prod/
``````

## Architecture

- Plasmo MV3 framework
- Content script on AI site allowlist only
- Background scripts (Firefox) + alarms for policy sync
- Shared detection engine ``@opsgate/engine`` (regex/rules, local)

## Network

- Default local_only: no OpsGate network
- Optional enroll to org API (configurable URL, often on-prem)
- No sale of user data; no ads

## Minification

Production bundle is minified by Plasmo/Parcel. Source is the public monorepo (or private enterprise tag provided to reviewers).
"@
Set-Content -Path (Join-Path $OutRoot "source-notes.md") -Value $sourceNotes -Encoding UTF8

# Copy enterprise templates
$tplSrc = Join-Path $Root "packaging\firefox-amo"
$ent = Join-Path $OutRoot "enterprise"
New-Item -ItemType Directory -Force -Path $ent | Out-Null
if (Test-Path $tplSrc) {
  Get-ChildItem $tplSrc -File | ForEach-Object {
    Copy-Item -Force $_.FullName $ent
  }
}

# Common store materials
$common = Join-Path $Root "packaging\store-common"
if (Test-Path $common) {
  Copy-Item (Join-Path $common "review-notes-en.txt") (Join-Path $listing "review-notes-en.txt") -ErrorAction SilentlyContinue
  Copy-Item (Join-Path $common "privacy-policy-hosting.md") (Join-Path $listing "privacy-policy-hosting.md") -ErrorAction SilentlyContinue
}

$icon128 = Join-Path $Root "assets\icons\icon-128.png"
if (Test-Path $icon128) {
  Copy-Item $icon128 (Join-Path $listing "icon-128.png")
}

Write-Host @"

=== Firefox AMO package ready ===
  ZIP    : $ZipPath  ($sizeMb MB)
  SHA256 : $hash
  Gecko  : $geckoId
  Listing: $listing

Upload: https://addons.mozilla.org/developers/addon/submit/
Enterprise unlisted + policies.json recommended for corps.
Full guide: docs/PUBLICATION-STORES.md

"@ -ForegroundColor Green
