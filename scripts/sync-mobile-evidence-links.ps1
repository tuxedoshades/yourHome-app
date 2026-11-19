param(
  [string]$Milestone = "m51"
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path "$PSScriptRoot\.."
$iosDir = Join-Path $root "evidence\$Milestone\mobile\ios"
$androidDir = Join-Path $root "evidence\$Milestone\mobile\android"
$docTag = $Milestone.ToUpper()
$outDoc = Join-Path $root "docs\${docTag}_MOBILE_EVIDENCE_LINKS.md"

New-Item -ItemType Directory -Force -Path $iosDir | Out-Null
New-Item -ItemType Directory -Force -Path $androidDir | Out-Null

$rows = @(
  @{ key = "auth-login-01.png"; flow = "Register / Login / Logout" },
  @{ key = "verification-submit-01.png"; flow = "Verification submit (new)" },
  @{ key = "verification-resubmit-01.png"; flow = "Verification resubmit (needs more info)" },
  @{ key = "listing-submit-01.png"; flow = "Listing submit (new)" },
  @{ key = "property-manager-lock-01.png"; flow = "Property Manager lock state (premium gate)" },
  @{ key = "upgrade-intent-01.png"; flow = "Upgrade intent submit" },
  @{ key = "reviewer-lifecycle-01.png"; flow = "Reviewer lifecycle visibility touchpoint" }
)

function RelPath([string]$fullPath) {
  return $fullPath.Replace(($root.Path + "\\"), "")
}

$lines = @()
$lines += "# $docTag Mobile Evidence Links"
$lines += ""
$lines += ("Generated: " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz"))
$lines += ""
$lines += ("Milestone folder: evidence/" + $Milestone + "/mobile")
$lines += ""
$lines += "| Flow | iOS | Android |"
$lines += "|---|---|---|"

foreach ($row in $rows) {
  $iosPath = Join-Path $iosDir ("ios-" + $row.key)
  $androidPath = Join-Path $androidDir ("android-" + $row.key)

  $iosCell = if (Test-Path $iosPath) { (RelPath $iosPath) } else { "missing" }
  $androidCell = if (Test-Path $androidPath) { (RelPath $androidPath) } else { "missing" }

  $lines += "| $($row.flow) | $iosCell | $androidCell |"
}

$lines += ""
$lines += "## How to close gaps"
$lines += "1) Capture missing images per docs/M50_MOBILE_PARITY_CAPTURE_RUNBOOK.md."
$lines += ("2) Save files under evidence/" + $Milestone + "/mobile/ios and evidence/" + $Milestone + "/mobile/android using required names.")
$lines += "3) Re-run: pnpm evidence:mobile:verify and pnpm evidence:mobile:sync."

Set-Content -Path $outDoc -Value ($lines -join "`r`n") -Encoding UTF8
Write-Host "Wrote $outDoc" -ForegroundColor Green
