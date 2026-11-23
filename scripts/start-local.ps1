param([switch]$Build)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if ($Build -or -not (Test-Path "dist/server.js")) {
  Write-Host "Building..."
  npm run build | Out-Host
}

$existing = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Already running on port 8787 (PID $($existing.OwningProcess))."
  Write-Host "Open http://localhost:8787"
  exit 0
}

$node = (Get-Command node).Source
$proc = Start-Process -FilePath $node -ArgumentList "dist/server.js" -WorkingDirectory $root -WindowStyle Hidden -PassThru
$proc.Id | Set-Content -Path (Join-Path $root ".agent.pid") -Force

Write-Host "Support & Ops Agent started (PID $($proc.Id))."
Write-Host "Chat UI:  http://localhost:8787"
Write-Host "API docs: http://localhost:8787/docs"
