param(
  [switch]$Reset
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$mobileDir = Join-Path $repoRoot 'apps\mobile'
$buildId = Get-Date -Format "yyyyMMdd-HHmmss"

Write-Host "[go-android] Repo: $repoRoot"
Write-Host "[go-android] Mobile app: $mobileDir"

if (-not (Test-Path $mobileDir)) {
  throw "Mobile app directory not found: $mobileDir"
}

Write-Host "[go-android] Build stamp: $buildId"
if ($Reset) { Write-Host "[go-android] Mode: reset" } else { Write-Host "[go-android] Mode: normal" }
Write-Host "[go-android] Running mobile config preflight..."
& (Join-Path $PSScriptRoot 'check-mobile-config.ps1')

# 1) Avoid global node kills so unrelated local processes keep running. Expo -c handles Metro cache reset safely.
Write-Host "[go-android] Skipping global node.exe kill (safety: keep unrelated local processes alive)."

# 2) Android SDK env bootstrap
if (-not $env:ANDROID_HOME -or -not (Test-Path $env:ANDROID_HOME)) {
  $defaultSdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
  if (Test-Path $defaultSdk) {
    $env:ANDROID_HOME = $defaultSdk
  }
}

if (-not $env:ANDROID_HOME -or -not (Test-Path $env:ANDROID_HOME)) {
  throw "ANDROID_HOME not set and default SDK path missing. Install Android SDK (Android Studio)."
}

$platformTools = Join-Path $env:ANDROID_HOME 'platform-tools'
$emulatorDir = Join-Path $env:ANDROID_HOME 'emulator'
$adb = Join-Path $platformTools 'adb.exe'
$emulatorExe = Join-Path $emulatorDir 'emulator.exe'

if (-not (Test-Path $adb)) {
  throw "adb not found at $adb"
}

$env:Path = "$platformTools;$emulatorDir;" + $env:Path

# 3) Start ADB and ensure one emulator/device is online + fully booted
Write-Host "[go-android] Starting ADB server..."
& $adb start-server | Out-Null

$devicesOutput = & $adb devices
$onlineDevices = @($devicesOutput | Select-String -Pattern "\tdevice$" | ForEach-Object { ($_ -split "\t")[0].Trim() })

$targetSerial = $null
if ($onlineDevices.Count -gt 0) {
  # Prefer emulator for deterministic Expo Go flow
  $targetSerial = ($onlineDevices | Where-Object { $_ -like 'emulator-*' } | Select-Object -First 1)
  if (-not $targetSerial) { $targetSerial = $onlineDevices[0] }
  Write-Host "[go-android] Found online device: $targetSerial"
} else {
  if (-not (Test-Path $emulatorExe)) {
    throw "No connected Android device and emulator.exe not found at $emulatorExe"
  }

  Write-Host "[go-android] No online device found. Launching AVD..."
  $avds = & $emulatorExe -list-avds | Where-Object { $_ -and $_.Trim().Length -gt 0 }

  if (-not $avds -or $avds.Count -eq 0) {
    throw "No AVDs found. Create one in Android Studio > Device Manager."
  }

  $preferred = $avds | Where-Object { $_ -match '^Pixel_7$' } | Select-Object -First 1
  if (-not $preferred) {
    $preferred = $avds | Where-Object { $_ -match '^Medium_Phone_API_36\.1$' } | Select-Object -First 1
  }
  $avd = if ($preferred) { $preferred.Trim() } else { $avds[0].Trim() }

  Write-Host "[go-android] Starting AVD: $avd"
  Start-Process -FilePath $emulatorExe -ArgumentList "-avd `"$avd`""

  Write-Host "[go-android] Waiting for emulator to register in ADB..."
  for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Seconds 1
    $devicesNow = & $adb devices
    $emulatorOnline = @($devicesNow | Select-String -Pattern "^emulator-\d+\tdevice$" | ForEach-Object { ($_ -split "\t")[0].Trim() })
    if ($emulatorOnline.Count -gt 0) {
      $targetSerial = $emulatorOnline[0]
      break
    }
  }

  if (-not $targetSerial) {
    throw "Emulator failed to come online in ADB."
  }
}

Write-Host "[go-android] Waiting for full Android boot on $targetSerial ..."
$booted = $false
for ($i = 0; $i -lt 120; $i++) {
  Start-Sleep -Seconds 1
  try {
    $boot = (& $adb -s $targetSerial shell getprop sys.boot_completed 2>$null | Out-String).Trim()
    $bootanim = (& $adb -s $targetSerial shell getprop init.svc.bootanim 2>$null | Out-String).Trim()
    if ($boot -eq '1' -and $bootanim -eq 'stopped') {
      $booted = $true
      break
    }
  } catch { }
}
if (-not $booted) {
  throw "Android boot did not complete in time on $targetSerial."
}

Write-Host "[go-android] Verifying Android package/settings services..."
$servicesReady = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 1
  try {
    $cmdList = & $adb -s $targetSerial shell cmd -l 2>$null
    if (($cmdList | Select-String -Pattern "\bpackage\b") -and ($cmdList | Select-String -Pattern "\bsettings\b")) {
      $servicesReady = $true
      break
    }
  } catch { }
}
if (-not $servicesReady) {
  throw "Android services are not ready (package/settings missing) on $targetSerial."
}

# 4) Force Expo Go path on device (best effort)
Write-Host "[go-android] Removing installed native app shell (com.yourhome.app) to avoid stale UI launches..."
try { & $adb -s $targetSerial uninstall com.yourhome.app | Out-Null } catch { }

if ($Reset) {
  Write-Host "[go-android] Clearing Expo Go cache (best effort)..."
  try { & $adb -s $targetSerial shell am force-stop host.exp.exponent | Out-Null } catch { }
  try { & $adb -s $targetSerial shell pm clear host.exp.exponent | Out-Null } catch { }
}

# 5) Force-clear stale Metro listeners to avoid 8081/8082 drift
try {
  $listeners8081 = netstat -ano | Select-String -Pattern ':8081\s+.*LISTENING'
  $listenerPids = @()
  foreach ($line in $listeners8081) {
    $parts = ($line -split '\s+') | Where-Object { $_ -ne '' }
    if ($parts.Count -ge 5) {
      $procId = $parts[-1]
      if ($procId -match '^[1-9][0-9]*$') { $listenerPids += [int]$procId }
    }
  }
  $listenerPids = $listenerPids | Select-Object -Unique
  if ($listenerPids.Count -gt 0) {
    Write-Host "[go-android] Killing stale Metro listener(s) on 8081: $($listenerPids -join ', ')"
    foreach ($procId in $listenerPids) {
      try { taskkill /PID $procId /F | Out-Null } catch { }
    }
    Start-Sleep -Seconds 1
  }
} catch { }

# 6) Ensure API is running (required for directory/search flows)
$apiListening = $false
try {
  $tcp3000 = netstat -ano | Select-String -Pattern ':3000\s+.*LISTENING'
  if ($tcp3000) { $apiListening = $true }
} catch { }

if (-not $apiListening) {
  Write-Host "[go-android] API not detected on :3000, launching API dev server..."
  $apiCommand = "title YourHome API && cd /d `"$repoRoot`" && pnpm --filter api dev"
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', $apiCommand
} else {
  Write-Host "[go-android] API already listening on :3000"
}

# 6) Start Expo and auto-open Android in Expo Go
$expoArgs = if ($Reset) { "--host lan --go --android -c" } else { "--host lan --go --android" }
$expoTitle = if ($Reset) { "Expo GO Android (reset)" } else { "Expo GO Android" }
$expoCommand = "title $expoTitle && cd /d `"$mobileDir`" && set YOURHOME_EXPO_GO=1 && set EXPO_PUBLIC_BUILD_ID=$buildId && npx expo start $expoArgs"
Write-Host "[go-android] Launching Expo (new terminal): $expoCommand"
Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', $expoCommand

Write-Host ""
Write-Host "[go-android] Done."
Write-Host "- Emulator/device should be up ($targetSerial)"
Write-Host "- Expo Metro started in a new terminal"
Write-Host "- Build stamp: $buildId"
Write-Host "- If QR is needed, press 'c' in Expo terminal"
