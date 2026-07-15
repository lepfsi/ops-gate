# OpsGate Proxy — helper install dev Windows (P3 foundations)
# Usage (depuis la racine monorepo) :
#   .\scripts\install-proxy-windows.ps1
#   .\scripts\install-proxy-windows.ps1 -SkipCertutil

param(
  [switch]$SkipCertutil
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $Root "package.json"))) {
  Write-Error "Lancer depuis le clone ops-gate (package.json racine introuvable)."
}

Set-Location $Root
Write-Host "== OpsGate Proxy install helper (dev) ==" -ForegroundColor Cyan
Write-Host "Root: $Root"

Write-Host "`n[1/3] Génération CA locale..." -ForegroundColor Yellow
pnpm proxy:gen-ca
$ca = Join-Path $Root "packages\proxy\data\ca\ca-cert.pem"
if (-not (Test-Path $ca)) {
  Write-Error "CA introuvable: $ca"
}
Write-Host "CA: $ca"

if (-not $SkipCertutil) {
  Write-Host "`n[2/3] Installation trust store utilisateur (certutil)..." -ForegroundColor Yellow
  Write-Host "Commande: certutil -addstore -user Root `"$ca`""
  $r = Start-Process -FilePath "certutil" -ArgumentList @("-addstore","-user","Root",$ca) -Wait -PassThru -NoNewWindow
  if ($r.ExitCode -ne 0) {
    Write-Warning "certutil exit $($r.ExitCode). Relancez en PowerShell utilisateur ou exécutez la commande manuellement."
  } else {
    Write-Host "CA installée dans le magasin Root utilisateur." -ForegroundColor Green
  }
} else {
  Write-Host "`n[2/3] Skip certutil (-SkipCertutil)" -ForegroundColor DarkYellow
}

Write-Host "`n[3/3] Prochaines étapes" -ForegroundColor Yellow
Write-Host @"

  1) API (autre terminal) :
       cd $Root
       pnpm api:dev

  2) Proxy :
       pnpm proxy:enroll
       pnpm proxy:dev

  3) Chrome de test (tout le trafic via proxy) :
       & "`$env:ProgramFiles\Google\Chrome\Application\chrome.exe" ``
         --user-data-dir="`$env:TEMP\opsgate-chrome-proxy-test" ``
         --proxy-server="127.0.0.1:8888" ``
         --disable-quic "https://chatgpt.com"

  PAC HTTP (si proxy déjà lancé) :
       --proxy-pac-url=http://127.0.0.1:8888/opsgate-proxy.pac

  Console : Agents → badge « Proxy » sur l'agent enrollé.

Doc: docs\architecture\PROXY-P3.md
"@

Write-Host "Done." -ForegroundColor Green
