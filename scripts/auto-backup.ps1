$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

function Invoke-Native {
  param(
    [Parameter(Mandatory = $true)]
    [scriptblock]$Command,
    [Parameter(Mandatory = $true)]
    [string]$Label
  )

  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "yourhome: $Label failed (exit $LASTEXITCODE)"
  }
}

Invoke-Native -Label 'git add -A' -Command { git add -A }

# No changes -> skip noisy empty commits
& git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  Write-Host 'yourhome: no changes to backup.'
  exit 0
}
if ($LASTEXITCODE -ne 1) {
  throw "yourhome: git diff --cached --quiet failed (exit $LASTEXITCODE)"
}

$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Invoke-Native -Label 'git commit' -Command { git commit -m "backup: hourly auto snapshot $stamp" }
Invoke-Native -Label 'git push' -Command { git push }

# Verify remote matches local after push
Invoke-Native -Label 'git fetch origin' -Command { git fetch origin --quiet }
$localHead = (git rev-parse HEAD).Trim()
$remoteHead = (git rev-parse origin/master).Trim()
if ($localHead -ne $remoteHead) {
  throw "yourhome: post-push verification failed (local $localHead != origin/master $remoteHead)"
}

Write-Host "yourhome: backup push complete ($localHead)."
