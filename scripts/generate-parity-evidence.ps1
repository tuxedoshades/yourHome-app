$ErrorActionPreference = "Stop"

$root = Resolve-Path "$PSScriptRoot\.."
$evidenceRoot = Join-Path $root "evidence\m48"
$webOut = Join-Path $evidenceRoot "web"
$mobileOut = Join-Path $evidenceRoot "mobile"

New-Item -ItemType Directory -Force -Path $webOut | Out-Null
New-Item -ItemType Directory -Force -Path $mobileOut | Out-Null

Write-Host "Running platform gates..." -ForegroundColor Cyan
pnpm check:platform-gates

$reviewerDist = Join-Path $root "apps\reviewer-web\dist"
$mobileDist = Join-Path $root "apps\mobile\dist"

if (Test-Path $reviewerDist) {
  Copy-Item -Path (Join-Path $reviewerDist "*") -Destination $webOut -Recurse -Force
}
if (Test-Path $mobileDist) {
  Copy-Item -Path (Join-Path $mobileDist "*") -Destination $mobileOut -Recurse -Force
}

$manifestPath = Join-Path $root "docs\M48_EVIDENCE_MANIFEST.md"
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz"

$webFiles = if (Test-Path $webOut) { Get-ChildItem -Recurse -File $webOut } else { @() }
$mobileFiles = if (Test-Path $mobileOut) { Get-ChildItem -Recurse -File $mobileOut } else { @() }

$lines = @()
$lines += "# M48 Evidence Manifest"
$lines += ""
$lines += "Generated: $timestamp"
$lines += ""
$lines += "## Web Artifacts"
if ($webFiles.Count -eq 0) {
  $lines += "- None"
} else {
  foreach ($f in $webFiles) {
    $rel = $f.FullName.Replace($root.Path + "\", "")
    $lines += "- $rel ($([math]::Round($f.Length / 1KB, 2)) KB)"
  }
}
$lines += ""
$lines += "## Mobile Artifacts"
if ($mobileFiles.Count -eq 0) {
  $lines += "- None"
} else {
  foreach ($f in $mobileFiles) {
    $rel = $f.FullName.Replace($root.Path + "\", "")
    $lines += "- $rel ($([math]::Round($f.Length / 1KB, 2)) KB)"
  }
}
$lines += ""
$lines += "## Notes"
$lines += "- This manifest captures build/export parity artifacts for iOS/Android/Web."
$lines += "- Device screenshots/video evidence should be attached in follow-up capture sessions."

Set-Content -Path $manifestPath -Value ($lines -join "`r`n") -Encoding UTF8
Write-Host "Wrote $manifestPath" -ForegroundColor Green
