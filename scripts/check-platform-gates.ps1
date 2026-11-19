param(
  [switch]$SkipMobile
)

$ErrorActionPreference = "Stop"

function Run-Step {
  param(
    [string]$Name,
    [string]$Command
  )

  Write-Host "`n=== $Name ===" -ForegroundColor Cyan
  Write-Host "> $Command"
  Invoke-Expression $Command
}

Run-Step -Name "API build" -Command "pnpm --filter api build"
Run-Step -Name "Reviewer Web build" -Command "pnpm --filter reviewer-web build"

if (-not $SkipMobile) {
  Run-Step -Name "Mobile export (Expo)" -Command "pnpm --filter mobile build"
} else {
  Write-Host "`n=== Mobile gate skipped by flag ===" -ForegroundColor Yellow
}

Write-Host "`nAll requested platform gates passed." -ForegroundColor Green
