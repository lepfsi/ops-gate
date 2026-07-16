# OpsGate — configure le proxy système Windows via PAC (silencieux, sans flags Chrome)
# Usage (PowerShell utilisateur) :
#   .\scripts\set-system-proxy-pac.ps1
#   .\scripts\set-system-proxy-pac.ps1 -Off
# Prérequis : proxy en cours (pnpm proxy:dev) pour servir le PAC.

param(
  [switch]$Off,
  [string]$PacUrl = "http://127.0.0.1:8888/opsgate-proxy.pac"
)

$ErrorActionPreference = "Stop"
$path = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings"

if ($Off) {
  Set-ItemProperty -Path $path -Name ProxyEnable -Value 0
  Set-ItemProperty -Path $path -Name AutoConfigURL -Value ""
  Write-Host "Proxy systeme desactive (PAC retire)." -ForegroundColor Yellow
  Write-Host "Redemarrez Chrome/Edge pour appliquer."
  exit 0
}

# Active auto-config PAC (seul le trafic IA passe par OpsGate, le reste DIRECT)
Set-ItemProperty -Path $path -Name ProxyEnable -Value 0
Set-ItemProperty -Path $path -Name AutoConfigURL -Value $PacUrl
Write-Host "PAC systeme active : $PacUrl" -ForegroundColor Green
Write-Host "Le navigateur par defaut (Chrome/Edge) utilisera le PAC au prochain demarrage."
Write-Host "Verifier : ouvrir http://127.0.0.1:8888/opsgate-proxy/health puis un site IA."
Write-Host "Desactiver : .\scripts\set-system-proxy-pac.ps1 -Off"
