# OpsGate — backup Postgres (fondamental sécu)
# Usage:
#   $env:DATABASE_URL = "postgresql://user:pass@localhost:5432/opsgate"
#   .\scripts\backup-db.ps1
#   .\scripts\backup-db.ps1 -OutDir D:\backups\opsgate
#
# Restauration (exemple) :
#   $env:PGPASSWORD = "..."
#   psql $env:DATABASE_URL -f backup-opsgate-YYYYMMDD.sql

param(
  [string]$OutDir = (Join-Path (Split-Path $PSScriptRoot -Parent) "backups"),
  [string]$DatabaseUrl = $env:DATABASE_URL
)

$ErrorActionPreference = "Stop"

if (-not $DatabaseUrl) {
  Write-Error "DATABASE_URL manquant. Exemple: postgresql://opsgate:opsgate@127.0.0.1:5432/opsgate"
}

$pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue
if (-not $pgDump) {
  Write-Error "pg_dump introuvable. Installez PostgreSQL client tools et ajoutez-les au PATH."
}

if (-not (Test-Path $OutDir)) {
  New-Item -ItemType Directory -Path $OutDir | Out-Null
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outFile = Join-Path $OutDir "backup-opsgate-$stamp.sql"

Write-Host "[opsgate-backup] pg_dump → $outFile"
& pg_dump $DatabaseUrl --no-owner --no-acl -F p -f $outFile
if ($LASTEXITCODE -ne 0) {
  Write-Error "pg_dump a échoué (code $LASTEXITCODE)"
}

$sha = (Get-FileHash -Algorithm SHA256 -Path $outFile).Hash
$hashFile = "$outFile.sha256"
"$sha  $(Split-Path $outFile -Leaf)" | Set-Content -Path $hashFile -Encoding ascii

Write-Host "[opsgate-backup] OK · $([math]::Round((Get-Item $outFile).Length / 1MB, 2)) Mo"
Write-Host "[opsgate-backup] SHA256: $sha"
Write-Host "[opsgate-backup] Hash file: $hashFile"
Write-Host ""
Write-Host "Planifiez ce script (Planificateur de tâches Windows) quotidiennement."
Write-Host "Backup config org (console) : Paramètres → Général → Export backup."
