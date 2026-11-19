param(
  [string]$Milestone = "m51",
  [switch]$AllowMissing
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\.."
$iosDir = Join-Path $root "evidence\$Milestone\mobile\ios"
$androidDir = Join-Path $root "evidence\$Milestone\mobile\android"
$docTag = $Milestone.ToUpper()
$reportPath = Join-Path $root "docs\${docTag}_MOBILE_EVIDENCE_REPORT.md"

New-Item -ItemType Directory -Force -Path $iosDir | Out-Null
New-Item -ItemType Directory -Force -Path $androidDir | Out-Null

$requiredFlows = @(
  "auth-login-01.png",
  "verification-submit-01.png",
  "verification-resubmit-01.png",
  "listing-submit-01.png",
  "property-manager-lock-01.png",
  "upgrade-intent-01.png",
  "reviewer-lifecycle-01.png"
)

function Check-Platform($platform, $dir) {
  $missing = @()
  foreach ($file in $requiredFlows) {
    $expected = Join-Path $dir "$platform-$file"
    if (-not (Test-Path $expected)) { $missing += $expected }
  }
  return $missing
}

$missingIos = Check-Platform -platform "ios" -dir $iosDir
$missingAndroid = Check-Platform -platform "android" -dir $androidDir
$allMissing = @($missingIos + $missingAndroid)

$lines = @()
$lines += "# $docTag Mobile Evidence Report"
$lines += ""
$lines += ("Generated: " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz"))
$lines += ""
$lines += ("Milestone folder: evidence/" + $Milestone + "/mobile")
$lines += ""
$lines += "## iOS"
if ($missingIos.Count -eq 0) { $lines += "- PASS: all required screenshots present" } else { $lines += "- Missing:"; $missingIos | ForEach-Object { $lines += "  - $($_.Replace($root.Path + '\\', ''))" } }
$lines += ""
$lines += "## Android"
if ($missingAndroid.Count -eq 0) { $lines += "- PASS: all required screenshots present" } else { $lines += "- Missing:"; $missingAndroid | ForEach-Object { $lines += "  - $($_.Replace($root.Path + '\\', ''))" } }

Set-Content -Path $reportPath -Value ($lines -join "`r`n") -Encoding UTF8
Write-Host "Wrote $reportPath"

if ($allMissing.Count -gt 0 -and -not $AllowMissing) {
  Write-Error "Missing required mobile evidence files."
}
