$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root ".agent.pid"

if (Test-Path $pidFile) {
  $id = (Get-Content $pidFile -ErrorAction SilentlyContinue).Trim()
  if ($id) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

$listeners = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue
foreach ($c in $listeners) {
  Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
}

Write-Host "Support & Ops Agent stopped."
