param([switch]$Build)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# Startup-safe: put node on PATH even in minimal shells
$nodeDirs = @(
  (Split-Path (Get-Command node -ErrorAction SilentlyContinue).Source -ErrorAction SilentlyContinue),
  "C:\Program Files\nodejs",
  "$env:LOCALAPPDATA\Programs\nodejs"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique
if ($nodeDirs) { $env:PATH = ($nodeDirs -join ";") + ";" + $env:PATH }

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

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { foreach ($p in @("C:\Program Files\nodejs\node.exe", "$env:LOCALAPPDATA\Programs\nodejs\node.exe")) { if (Test-Path $p) { $node = $p; break } } }
if (-not $node) { throw "node.exe not found" }
$proc = Start-Process -FilePath $node -ArgumentList "dist/server.js" -WorkingDirectory $root -WindowStyle Hidden -PassThru
$proc.Id | Set-Content -Path (Join-Path $root ".agent.pid") -Force

Write-Host "Support & Ops Agent started (PID $($proc.Id))."
Write-Host "Chat UI:  http://localhost:8787"
Write-Host "API docs: http://localhost:8787/docs"
