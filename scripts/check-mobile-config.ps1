$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$appJsonPath = Join-Path $repoRoot 'apps\mobile\app.json'

if (-not (Test-Path $appJsonPath)) {
  throw "Missing app.json at $appJsonPath"
}

$appJson = Get-Content $appJsonPath -Raw | ConvertFrom-Json
$runtimeVersion = $appJson.expo.runtimeVersion

if ($runtimeVersion -is [string]) {
  Write-Host "[check-mobile-config] runtimeVersion ok: $runtimeVersion"
  exit 0
}

if ($runtimeVersion -and $runtimeVersion.policy) {
  throw "Invalid runtimeVersion policy for bare workflow: $($runtimeVersion.policy). Use explicit string, e.g. '0.1.0'."
}

throw "Invalid runtimeVersion format. Use explicit string in apps/mobile/app.json"
