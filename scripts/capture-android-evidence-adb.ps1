param(
  [string]$Milestone = "m53",
  [string]$DeviceId = "",
  [switch]$ListDevices
)

$ErrorActionPreference = "Stop"

function Get-AdbCommand {
  if (Get-Command adb -ErrorAction SilentlyContinue) { return "adb" }
  if ($env:ANDROID_HOME) {
    $candidate = Join-Path $env:ANDROID_HOME "platform-tools\adb.exe"
    if (Test-Path $candidate) { return $candidate }
  }
  if ($env:ANDROID_SDK_ROOT) {
    $candidate = Join-Path $env:ANDROID_SDK_ROOT "platform-tools\adb.exe"
    if (Test-Path $candidate) { return $candidate }
  }
  throw "adb not found. Install Android platform-tools or add adb to PATH."
}

$adb = Get-AdbCommand

if ($ListDevices) {
  & $adb devices
  exit 0
}

$root = Resolve-Path "$PSScriptRoot\.."
$outDir = Join-Path $root "evidence\$Milestone\mobile\android"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$shots = @(
  "android-auth-login-01.png",
  "android-verification-submit-01.png",
  "android-verification-resubmit-01.png",
  "android-listing-submit-01.png",
  "android-property-manager-lock-01.png",
  "android-upgrade-intent-01.png",
  "android-reviewer-lifecycle-01.png"
)

Write-Host "Manual capture helper: position app on each required screen, press Enter to capture." -ForegroundColor Cyan

foreach ($name in $shots) {
  $target = Join-Path $outDir $name
  Read-Host "Ready to capture $name (press Enter)"

  $remote = "/sdcard/$name"
  if ($DeviceId) {
    & $adb -s $DeviceId shell screencap -p $remote
    & $adb -s $DeviceId pull $remote $target
    & $adb -s $DeviceId shell rm $remote
  } else {
    & $adb shell screencap -p $remote
    & $adb pull $remote $target
    & $adb shell rm $remote
  }

  Write-Host "Saved $target" -ForegroundColor Green
}

Write-Host "Android capture set complete: $outDir" -ForegroundColor Green
