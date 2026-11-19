param(
  [switch]$DryRun,
  [switch]$Reset,
  [switch]$NoOpen,
  [switch]$StateSelfTest
)

$ErrorActionPreference = 'Stop'

function Resolve-CanonicalRepoRoot([string]$path) {
  $fullPath = [System.IO.Path]::GetFullPath($path).TrimEnd('\')
  $driveRoot = [System.IO.Path]::GetPathRoot($fullPath)
  $driveName = $driveRoot.TrimEnd('\')
  $substPattern = '^' + [regex]::Escape($driveName) + '\\:'
  $substLine = @(& subst.exe) | Where-Object { $_ -match $substPattern } | Select-Object -First 1
  if (-not $substLine) { return $fullPath }
  $target = ($substLine -split '=>', 2)[1].Trim().TrimEnd('\')
  $relative = $fullPath.Substring($driveRoot.Length)
  return [System.IO.Path]::GetFullPath((Join-Path $target $relative)).TrimEnd('\')
}

function Assert-NoReparsePointInPath([string]$targetPath, [string]$allowedRoot) {
  $target = [System.IO.Path]::GetFullPath($targetPath).TrimEnd('\')
  $root = [System.IO.Path]::GetFullPath($allowedRoot).TrimEnd('\')
  $rootPrefix = "$root\"
  if (-not $target.Equals($root, [StringComparison]::OrdinalIgnoreCase) -and
      -not $target.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing reparse-point inspection outside the allowed root: $target"
  }

  $cursor = $target
  while ($true) {
    if (Test-Path -LiteralPath $cursor) {
      $item = Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Refusing recursive dependency cleanup through reparse point: $cursor"
      }
    }
    if ($cursor.Equals($root, [StringComparison]::OrdinalIgnoreCase)) { return }
    $parent = [System.IO.Path]::GetDirectoryName($cursor)
    if (-not $parent -or $parent.Equals($cursor, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Could not prove dependency cleanup path containment beneath: $root"
    }
    $cursor = $parent.TrimEnd('\')
  }
}

$repoRoot = Resolve-CanonicalRepoRoot (Split-Path -Parent $PSScriptRoot)
$mobileDir = Join-Path $repoRoot 'apps\mobile'
$dockerDesktop = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
$androidHome = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$androidPackage = 'com.yourhome.app'
$androidAvd = 'Pixel_7'
$adb = Join-Path $androidHome 'platform-tools\adb.exe'
$emulator = Join-Path $androidHome 'emulator\emulator.exe'
$javaHome = 'C:\Program Files\Android\Android Studio\jbr'
$shortDrive = 'Y:'
$shortRepo = 'Y:\'
$shortMobile = 'Y:\apps\mobile'
$shortExpo = 'Y:\node_modules\.bin\expo.cmd'
$physicalMobile = Join-Path $repoRoot 'apps\mobile'
$physicalExpo = Join-Path $repoRoot 'node_modules\.bin\expo.cmd'
$appConfig = Get-Content (Join-Path $mobileDir 'app.json') -Raw | ConvertFrom-Json
$iosRuntimeVersion = [string]$appConfig.expo.runtimeVersion
if (-not $iosRuntimeVersion) { throw 'apps/mobile/app.json must define expo.runtimeVersion for the iOS development client.' }
$virtualStore = 'Y:\node_modules\.pnpm'
$topologyTest = 'Y:\scripts\workspace-topology-test.cjs'
$androidFingerprintScript = Join-Path $repoRoot 'scripts\android-dev-client-fingerprint.cjs'
$stateFile = Join-Path $repoRoot '.hermes\test-run-processes.json'
$androidClientStateFile = Join-Path $repoRoot '.hermes\android-dev-client.json'
$iosExpoLog = Join-Path $repoRoot '.hermes\ios-expo-terminal.log'
$iosExpoFailure = Join-Path $repoRoot '.hermes\ios-expo-failed'
$normalizedRepoRoot = [System.IO.Path]::GetFullPath($repoRoot).TrimEnd('\')

function Write-Step([string]$message) {
  Write-Host "[test-run] $message" -ForegroundColor Cyan
}

function Wait-Until([scriptblock]$condition, [int]$seconds, [string]$failureMessage) {
  $deadline = [DateTime]::UtcNow.AddSeconds($seconds)
  do {
    if (& $condition) { return }
    if ([DateTime]::UtcNow -ge $deadline) { break }
    Start-Sleep -Milliseconds 1000
  } while ([DateTime]::UtcNow -lt $deadline)
  throw $failureMessage
}

function Test-TcpPort([int]$port) {
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $task = $client.ConnectAsync('127.0.0.1', $port)
    if (-not $task.Wait(500)) { $client.Dispose(); return $false }
    $ok = $client.Connected
    $client.Dispose()
    return $ok
  } catch { return $false }
}

function Test-DockerReady {
  $previousErrorAction = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & docker info *> $null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
}

function Get-PostgresContainerStatus {
  $previousErrorAction = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $composeFile = Join-Path $repoRoot 'infra\docker-compose.yml'
    $containerId = ((& docker compose -f $composeFile ps -q postgres 2>$null | Out-String).Trim())
    if ($LASTEXITCODE -ne 0) { return 'Unavailable' }
    if (-not $containerId) { return 'Stopped' }
    $running = ((& docker inspect --format '{{.State.Running}}' $containerId 2>$null | Out-String).Trim())
    if ($LASTEXITCODE -ne 0 -or $running -notin @('true', 'false')) { return 'Unavailable' }
    if ($running -eq 'true') { return 'Running' }
    return 'Stopped'
  } catch {
    return 'Unavailable'
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
}

function Get-AndroidDataFreeBytes([string]$adbPath, [string]$serial) {
  $previousErrorAction = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = & $adbPath -s $serial shell df -k /data 2>&1
    if ($LASTEXITCODE -ne 0) { return [long]0 }
    $line = (($output | Where-Object { "$_" -match '^/\S+\s+\d+' } | Select-Object -Last 1 | Out-String).Trim())
    $columns = @($line -split '\s+' | Where-Object { $_ })
    if ($columns.Count -lt 4) { return [long]0 }
    return ([long]$columns[3]) * 1KB
  } catch {
    return [long]0
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
}

function Get-AndroidPackagePath([string]$adbPath, [string]$serial, [string]$packageName) {
  $previousErrorAction = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = & $adbPath -s $serial shell pm path $packageName 2>&1
    if ($LASTEXITCODE -ne 0) { return '' }
    return (($output | Where-Object { "$_" -like 'package:*' } | Out-String).Trim())
  } catch {
    return ''
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
}

function Wait-AndroidPackagePath([string]$adbPath, [string]$serial, [string]$packageName, [int]$seconds = 10) {
  for ($i = 0; $i -lt $seconds; $i++) {
    $packagePath = Get-AndroidPackagePath $adbPath $serial $packageName
    if ($packagePath.StartsWith('package:')) { return $packagePath }
    if ($i -lt ($seconds - 1)) { Start-Sleep -Seconds 1 }
  }
  return ''
}

function Get-AndroidPackageSha256([string]$adbPath, [string]$serial, [string]$packagePath) {
  $firstPackageLine = @($packagePath -split "`r?`n" | Where-Object { $_ -like 'package:*' } | Select-Object -First 1)
  if ($firstPackageLine.Count -ne 1) { return '' }
  $remotePath = ([string]$firstPackageLine[0]).Substring('package:'.Length).Trim()
  if ($remotePath -notmatch '^/data/app/[A-Za-z0-9_./=+~-]+\.apk$') { return '' }
  $previousErrorAction = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = (& $adbPath -s $serial shell sha256sum $remotePath 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $output -notmatch '^([a-fA-F0-9]{64})\s') { return '' }
    return $Matches[1].ToLowerInvariant()
  } catch {
    return ''
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
}

function Test-AndroidBootComplete([string]$adbPath, [string]$serial) {
  $previousErrorAction = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $completed = (& $adbPath -s $serial shell getprop sys.boot_completed 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { return $false }
    $bootAnimation = (& $adbPath -s $serial shell getprop init.svc.bootanim 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { return $false }
    return $completed -eq '1' -and $bootAnimation -eq 'stopped'
  } catch {
    return $false
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
}

function Get-AndroidBootId([string]$adbPath, [string]$serial) {
  $previousErrorAction = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $bootId = ((& $adbPath -s $serial shell cat /proc/sys/kernel/random/boot_id 2>$null | Out-String).Trim())
    if ($LASTEXITCODE -ne 0) { return '' }
    return $bootId
  } catch {
    return ''
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
}

function Get-AdbSerialStatus([string]$adbPath, [string]$serial) {
  if (-not $serial -or -not (Test-Path $adbPath)) { return 'Unavailable' }
  $previousErrorAction = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $devices = (& $adbPath devices 2>$null | Out-String)
    if ($LASTEXITCODE -ne 0) { return 'Unavailable' }
    if ($devices -match "(?m)^$([regex]::Escape($serial))\s+") { return 'Present' }
    return 'Absent'
  } catch {
    return 'Unavailable'
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
}

function Get-AndroidEmulatorIdentityStatus([string]$adbPath, [string]$serial, [string]$avdName, [string]$bootId) {
  $serialStatus = Get-AdbSerialStatus $adbPath $serial
  if ($serialStatus -eq 'Absent') { return 'Absent' }
  if ($serialStatus -eq 'Unavailable') { return 'Unavailable' }

  $previousErrorAction = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $currentAvd = ((& $adbPath -s $serial emu avd name 2>$null |
      Where-Object { $_ -and $_.Trim() -ne 'OK' } |
      Select-Object -First 1 | Out-String).Trim())
    if ($LASTEXITCODE -ne 0) { return 'Unavailable' }
    $currentBootId = Get-AndroidBootId $adbPath $serial
    if (-not $currentBootId) { return 'Unavailable' }
    if ($currentAvd -eq $avdName -and $currentBootId -eq $bootId) { return 'Match' }
    return 'Different'
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
}

function Wait-AdbSerialAbsent([string]$adbPath, [string]$serial, [int]$seconds = 60) {
  $deadline = [DateTime]::UtcNow.AddSeconds($seconds)
  while ((Get-AdbSerialStatus $adbPath $serial) -ne 'Absent' -and [DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 250
  }
  return (Get-AdbSerialStatus $adbPath $serial) -eq 'Absent'
}

function Find-AndroidSerialByAvd([string]$adbPath, [string]$avdName) {
  $previousErrorAction = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $deviceOutput = (& $adbPath devices 2>$null | Out-String)
    if ($LASTEXITCODE -ne 0) { return '' }
    $serials = @($deviceOutput -split "`r?`n" | ForEach-Object {
      if ($_ -match '^(emulator-\d+)\s+device\s*$') { $Matches[1] }
    })
    foreach ($candidate in $serials) {
      $candidateAvd = ((& $adbPath -s $candidate emu avd name 2>$null |
        Where-Object { $_ -and $_.Trim() -ne 'OK' } |
        Select-Object -First 1 | Out-String).Trim())
      if ($LASTEXITCODE -eq 0 -and $candidateAvd -eq $avdName) { return $candidate }
    }
    return ''
  } catch {
    return ''
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
}

function Test-ExpoTunnel {
  try {
    $response = Invoke-WebRequest 'http://127.0.0.1:8082' -UseBasicParsing -TimeoutSec 5 -Headers @{
      Accept = 'application/expo+json,application/json'
      'Expo-Platform' = 'ios'
    }
    $manifestJson = if ($response.Content -is [byte[]]) {
      [System.Text.Encoding]::UTF8.GetString($response.Content)
    } else {
      [string]$response.Content
    }
    $manifest = $manifestJson | ConvertFrom-Json
    $hostUri = [string]$manifest.extra.expoClient.hostUri
    $launchAsset = [string]$manifest.launchAsset.url
    if ($hostUri -notmatch '\.exp\.direct$' -or
      $launchAsset -notmatch '^https?://[^/]+\.exp\.direct/' -or
      ([string]$manifest.runtimeVersion) -ne $iosRuntimeVersion) {
      return $false
    }
    $launchResponse = Invoke-WebRequest -Uri $launchAsset -UseBasicParsing -TimeoutSec 15 -Headers @{
      Accept = 'application/javascript,text/javascript;q=0.9,*/*;q=0.1'
      'Expo-Platform' = 'ios'
    }
    $launchContentType = [string]$launchResponse.Headers['Content-Type']
    $launchContentLength = if ($launchResponse.Content -is [byte[]]) {
      $launchResponse.Content.Length
    } else {
      [System.Text.Encoding]::UTF8.GetByteCount([string]$launchResponse.Content)
    }
    return $launchResponse.StatusCode -eq 200 -and
      $launchContentType -match '^(application|text)/(x-)?javascript(?:;|$)' -and
      $launchContentLength -gt 0
  } catch {
    return $false
  }
}

function Get-LanIPv4 {
  $route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
    Where-Object { $_.NextHop -ne '0.0.0.0' } |
    Sort-Object RouteMetric, InterfaceMetric |
    Select-Object -First 1
  if ($route) {
    $address = Get-NetIPAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object { $_.IPAddress -notlike '169.254.*' } |
      Select-Object -First 1 -ExpandProperty IPAddress
    if ($address) { return $address }
  }
  throw 'Could not determine the LAN IPv4 address required by the iPhone.'
}

function Get-YourHomeProcessState {
  if (-not (Test-Path $stateFile)) { return @() }
  try {
    $parsed = Get-Content $stateFile -Raw | ConvertFrom-Json
    return @($parsed | Where-Object { $_.PSObject.Properties.Name -contains 'Role' })
  } catch {
    throw "Could not read launcher process state '$stateFile': $($_.Exception.Message)"
  }
}

function Save-YourHomeProcessState([object[]]$entries) {
  $stateDirectory = Split-Path -Parent $stateFile
  New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
  if ($entries.Count -eq 0) {
    Remove-Item $stateFile -Force -ErrorAction SilentlyContinue
    return
  }
  $temporary = "$stateFile.tmp"
  ConvertTo-Json -InputObject @($entries) -Depth 6 | Set-Content $temporary -Encoding UTF8
  Move-Item $temporary $stateFile -Force
}

function Set-AndroidEmulatorState(
  [string]$serial,
  [string]$avdName,
  [string]$bootId,
  [bool]$launchedByLauncher,
  [int]$processId,
  [string]$processStartedAt,
  [object[]]$processTree
) {
  $states = @(Get-YourHomeProcessState)
  $remaining = @($states | Where-Object { $_.Role -ne 'YourHome Android Emulator' -or $_.RepoRoot -ne $normalizedRepoRoot })
  $entry = [pscustomobject]@{
    Role = 'YourHome Android Emulator'
    RepoRoot = $normalizedRepoRoot
    Serial = $serial
    AvdName = $avdName
    BootId = $bootId
    LaunchedByLauncher = $launchedByLauncher
    ProcessId = $processId
    ProcessStartedAt = $processStartedAt
    ProcessTree = @($processTree)
    TerminalPid = $null
    TerminalStartedAt = $null
    ListenerPid = $null
    ListenerStartedAt = $null
    Port = $null
  }
  Save-YourHomeProcessState @($remaining + $entry)
}

function Test-RecordedProcess([int]$processId, [string]$startedAt) {
  if (-not $processId -or -not $startedAt) { return $false }
  try {
    $process = Get-Process -Id $processId -ErrorAction Stop
    $actual = $process.StartTime.ToUniversalTime()
    $recorded = [DateTime]::Parse($startedAt).ToUniversalTime()
    return $actual.Ticks -eq $recorded.Ticks
  } catch {
    return $false
  }
}

function Get-RecordedProcessTree([int]$rootProcessId, [string]$rootStartedAt) {
  if (-not (Test-RecordedProcess $rootProcessId $rootStartedAt)) { return @() }
  $records = @(Get-CimInstance Win32_Process -ErrorAction Stop)
  $childrenByParent = @{}
  foreach ($record in $records) {
    $parentId = [int]$record.ParentProcessId
    if (-not $childrenByParent.ContainsKey($parentId)) {
      $childrenByParent[$parentId] = [System.Collections.Generic.List[int]]::new()
    }
    $childrenByParent[$parentId].Add([int]$record.ProcessId)
  }

  $queue = [System.Collections.Generic.Queue[int]]::new()
  $queue.Enqueue($rootProcessId)
  $seen = [System.Collections.Generic.HashSet[int]]::new()
  $tree = [System.Collections.Generic.List[object]]::new()
  while ($queue.Count -gt 0) {
    $processId = $queue.Dequeue()
    if (-not $seen.Add($processId)) { continue }
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($process) {
      $tree.Add([pscustomobject]@{
        ProcessId = $processId
        ProcessStartedAt = $process.StartTime.ToUniversalTime().ToString('O')
      })
    }
    if ($childrenByParent.ContainsKey($processId)) {
      foreach ($childId in $childrenByParent[$processId]) { $queue.Enqueue($childId) }
    }
  }
  return @($tree)
}

function Merge-RecordedProcessTrees([object[]]$identities) {
  $merged = [System.Collections.Generic.List[object]]::new()
  $seen = [System.Collections.Generic.HashSet[string]]::new()
  foreach ($identity in @($identities)) {
    if (-not $identity -or -not $identity.ProcessId -or -not $identity.ProcessStartedAt) { continue }
    $key = "$($identity.ProcessId)|$($identity.ProcessStartedAt)"
    if ($seen.Add($key)) {
      $merged.Add([pscustomobject]@{
        ProcessId = [int]$identity.ProcessId
        ProcessStartedAt = [string]$identity.ProcessStartedAt
      })
    }
  }
  return @($merged)
}

function Stop-RecordedProcessTree([object[]]$processTree, [string]$description) {
  $owned = @(Merge-RecordedProcessTrees $processTree)
  if ($env:YOURHOME_TEST_FAIL_BEFORE_PROCESS_TREE_TERMINATION -eq '1') {
    throw 'Test-only failure before exact process-tree termination.'
  }
  foreach ($identity in $owned) {
    if (-not (Test-RecordedProcess $identity.ProcessId $identity.ProcessStartedAt)) { continue }
    Write-Step "Stopping $description process tree member (PID $($identity.ProcessId))"
    $previousErrorAction = $ErrorActionPreference
    try {
      $ErrorActionPreference = 'Continue'
      & taskkill.exe /PID $identity.ProcessId /T /F *> $null
    } finally {
      $ErrorActionPreference = $previousErrorAction
    }
  }

  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  do {
    $remaining = @($owned | Where-Object { Test-RecordedProcess $_.ProcessId $_.ProcessStartedAt })
    if ($remaining.Count -eq 0) { return }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  $remaining = @($owned | Where-Object { Test-RecordedProcess $_.ProcessId $_.ProcessStartedAt })
  if ($remaining.Count -gt 0) {
    throw "Could not stop every exact process in ${description}: $($remaining.ProcessId -join ', ')."
  }
}

function Get-AndroidAvdProcesses([string]$avdName) {
  $escaped = [regex]::Escape($avdName)
  $pattern = '(?i)(?:^|\s)-avd(?:\s+|=)"?{0}"?(?:\s|$)' -f $escaped
  return @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
    $_.Name -in @('emulator.exe', 'qemu-system-x86_64.exe') -and
    [string]$_.CommandLine -match $pattern
  })
}

function Test-DescendantProcess([int]$childProcessId, [int]$ancestorProcessId, [string]$ancestorStartedAt) {
  if (-not (Test-RecordedProcess $ancestorProcessId $ancestorStartedAt)) { return $false }
  $currentId = $childProcessId
  for ($depth = 0; $depth -lt 32 -and $currentId; $depth++) {
    if ($currentId -eq $ancestorProcessId) {
      return Test-RecordedProcess $ancestorProcessId $ancestorStartedAt
    }
    $processRecord = Get-CimInstance Win32_Process -Filter "ProcessId = $currentId" -ErrorAction SilentlyContinue
    if (-not $processRecord) { return $false }
    $currentId = [int]$processRecord.ParentProcessId
  }
  return $false
}

function Persist-AcquiredProcessTree([object]$acquisition, [object[]]$processTree) {
  $ownedTree = @(Merge-RecordedProcessTrees $processTree)
  if ($acquisition.PSObject.Properties.Name -contains 'ProcessTree') {
    $acquisition.ProcessTree = @($ownedTree)
  } else {
    $acquisition | Add-Member -NotePropertyName ProcessTree -NotePropertyValue @($ownedTree)
  }
  if (-not $acquisition.StatePersisted) { return }

  $states = @(Get-YourHomeProcessState)
  $entry = $states | Where-Object {
    $_.Role -eq $acquisition.Role -and
    $_.RepoRoot -eq $normalizedRepoRoot -and
    (-not $acquisition.Serial -or $_.Serial -eq $acquisition.Serial) -and
    (-not $acquisition.BootId -or $_.BootId -eq $acquisition.BootId)
  } | Select-Object -First 1
  if (-not $entry) {
    throw "Could not durably update the exact process tree for '$($acquisition.Role)' before cleanup."
  }
  if ($entry.PSObject.Properties.Name -contains 'ProcessTree') {
    $entry.ProcessTree = @($ownedTree)
  } else {
    $entry | Add-Member -NotePropertyName ProcessTree -NotePropertyValue @($ownedTree)
  }
  Save-YourHomeProcessState $states
}

function Stop-AcquiredProcess([object]$acquisition) {
  $process = $acquisition.Process
  if (-not $acquisition.ProcessId -and $process) { $acquisition.ProcessId = $process.Id }
  if (-not $acquisition.StartedAt -and $process) {
    try { $acquisition.StartedAt = $process.StartTime.ToUniversalTime().ToString('O') } catch { }
  }
  $persistedTree = if ($acquisition.PSObject.Properties.Name -contains 'ProcessTree') { @($acquisition.ProcessTree) } else { @() }
  $liveTree = if ($acquisition.StartedAt) { @(Get-RecordedProcessTree $acquisition.ProcessId $acquisition.StartedAt) } else { @() }
  $ownedTree = @(Merge-RecordedProcessTrees @($persistedTree + $liveTree))
  if ($ownedTree.Count -eq 0) { return }
  Persist-AcquiredProcessTree $acquisition $ownedTree
  Stop-RecordedProcessTree $ownedTree $acquisition.Description
}

function Remove-YourHomeRoleState([string]$title) {
  $states = @(Get-YourHomeProcessState)
  $remaining = @($states | Where-Object { $_.Role -ne $title -or $_.RepoRoot -ne $normalizedRepoRoot })
  Save-YourHomeProcessState $remaining
}

function Start-AcquiredEmulatorProcess(
  [string[]]$arguments,
  [string]$description,
  [System.Collections.Generic.List[object]]$acquisitionLedger
) {
  $acquisition = [pscustomobject]@{
    Kind = 'Emulator'
    Description = $description
    Role = 'YourHome Android Emulator'
    Process = $null
    ProcessId = 0
    StartedAt = ''
    ProcessTree = @()
    StatePersisted = $false
    Serial = ''
    BootId = ''
  }
  $acquisitionLedger.Add($acquisition)
  try {
    $acquisition.Process = Start-Process -FilePath $emulator -ArgumentList $arguments -PassThru
    $process = $acquisition.Process
    $acquisition.ProcessId = $process.Id
    $acquisition.StartedAt = $process.StartTime.ToUniversalTime().ToString('O')
    $acquisition.ProcessTree = @(Get-RecordedProcessTree $acquisition.ProcessId $acquisition.StartedAt)
    return $acquisition
  } catch {
    $acquisitionError = $_
    try {
      Stop-AcquiredProcess $acquisition
    } catch {
      throw "$($acquisitionError.Exception.Message) Emulator acquisition cleanup also failed; its ledger identity was retained for outer rollback: $($_.Exception.Message)"
    }
    [void]$acquisitionLedger.Remove($acquisition)
    throw $acquisitionError
  }
}

function Start-YourHomeTerminal(
  [string]$title,
  [string]$command,
  [string]$workingDirectory = $repoRoot,
  [System.Collections.Generic.List[object]]$acquisitionLedger
) {
  $safeTitle = $title.Replace("'", "''")
  $safeDirectory = $workingDirectory.Replace("'", "''")
  $safeRoot = $normalizedRepoRoot.Replace("'", "''")
  $wrapped = "`$env:YOURHOME_TEST_RUN_ROLE='$safeTitle'; `$env:YOURHOME_TEST_RUN_ROOT='$safeRoot'; `$Host.UI.RawUI.WindowTitle='$safeTitle'; Set-Location '$safeDirectory'; $command"
  $terminal = $null
  $terminalStartedAt = ''
  $acquisition = [pscustomobject]@{
    Kind = 'Terminal'
    Description = "'$title' terminal"
    Role = $title
    Process = $null
    ProcessId = 0
    StartedAt = ''
    ProcessTree = @()
    StatePersisted = $false
    Serial = ''
    BootId = ''
  }
  $acquisitionLedger.Add($acquisition)
  try {
    $acquisition.Process = Start-Process powershell.exe -ArgumentList @('-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', $wrapped) -PassThru
    $terminal = $acquisition.Process
    $acquisition.ProcessId = $terminal.Id
    if ($env:YOURHOME_TEST_FAIL_TERMINAL_START_TIME -eq '1') {
      throw "Test-only failure before '$title' terminal start-time capture."
    }
    $terminalStartedAt = $terminal.StartTime.ToUniversalTime().ToString('O')
    $acquisition.StartedAt = $terminalStartedAt
    $acquisition.ProcessTree = @(Get-RecordedProcessTree $terminal.Id $terminalStartedAt)
    Wait-Until { Test-RecordedProcess $terminal.Id $terminalStartedAt } 5 "Could not record the '$title' terminal process."
    $entry = [pscustomobject]@{
      Role = $title
      RepoRoot = $normalizedRepoRoot
      TerminalPid = $terminal.Id
      TerminalStartedAt = $terminalStartedAt
      ListenerPid = $null
      ListenerStartedAt = $null
      ProcessTree = @($acquisition.ProcessTree)
      Port = $null
    }
    $remaining = @(Get-YourHomeProcessState | Where-Object { $_.Role -ne $title -or $_.RepoRoot -ne $normalizedRepoRoot })
    Save-YourHomeProcessState @($remaining + $entry)
    $acquisition.StatePersisted = $true
  } catch {
    $acquisitionError = $_
    try {
      Stop-AcquiredProcess $acquisition
      if ($acquisition.StatePersisted) { Remove-YourHomeRoleState $title }
    } catch {
      throw "$($acquisitionError.Exception.Message) Terminal acquisition cleanup also failed; its ledger identity was retained for outer rollback: $($_.Exception.Message)"
    }
    [void]$acquisitionLedger.Remove($acquisition)
    throw $acquisitionError
  }
}

function Set-YourHomeListener([string]$title, [int]$port) {
  $states = @(Get-YourHomeProcessState)
  $entry = $states | Where-Object { $_.Role -eq $title -and $_.RepoRoot -eq $normalizedRepoRoot } | Select-Object -First 1
  if (-not $entry) { throw "No launcher state exists for '$title'." }
  $connections = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop)
  $listener = $connections |
    ForEach-Object { Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue } |
    Where-Object { Test-DescendantProcess $_.Id $entry.TerminalPid $entry.TerminalStartedAt } |
    Select-Object -First 1
  if (-not $listener) {
    throw "Port $port is not owned by a descendant of the launcher terminal for '$title'."
  }
  $entry.ListenerPid = $listener.Id
  $entry.ListenerStartedAt = $listener.StartTime.ToUniversalTime().ToString('O')
  $entry.ProcessTree = @(Get-RecordedProcessTree $entry.TerminalPid $entry.TerminalStartedAt)
  $entry.Port = $port
  Save-YourHomeProcessState $states
}


function Stop-RecordedProcess([int]$processId, [string]$startedAt, [string]$description) {
  $ownedTree = @(Get-RecordedProcessTree $processId $startedAt)
  if ($ownedTree.Count -eq 0) { return }
  Stop-RecordedProcessTree $ownedTree "stale $description"
}

function Stop-YourHomeRole([string]$title) {
  $states = @(Get-YourHomeProcessState)
  $entry = $states | Where-Object { $_.Role -eq $title -and $_.RepoRoot -eq $normalizedRepoRoot } | Select-Object -First 1
  if ($entry) {
    $persistedTree = if ($entry.PSObject.Properties.Name -contains 'ProcessTree') { @($entry.ProcessTree) } else { @() }
    $listenerTree = @(Get-RecordedProcessTree $entry.ListenerPid $entry.ListenerStartedAt)
    $liveTree = @(Get-RecordedProcessTree $entry.TerminalPid $entry.TerminalStartedAt)
    $ownedTree = @(Merge-RecordedProcessTrees @($persistedTree + $listenerTree + $liveTree))
    if ($entry.PSObject.Properties.Name -contains 'ProcessTree') {
      $entry.ProcessTree = @($ownedTree)
    } else {
      $entry | Add-Member -NotePropertyName ProcessTree -NotePropertyValue @($ownedTree)
    }
    Save-YourHomeProcessState $states
    Stop-RecordedProcessTree $ownedTree "stale '$title' process tree"
    $remaining = @($states | Where-Object { $_ -ne $entry })
    Save-YourHomeProcessState $remaining
  }
}

function Rollback-YourHomeInvocation([System.Collections.Generic.List[object]]$acquisitions) {
  $rollbackErrors = [System.Collections.Generic.List[string]]::new()
  for ($index = $acquisitions.Count - 1; $index -ge 0; $index--) {
    $acquisition = $acquisitions[$index]
    try {
      switch ($acquisition.Kind) {
        'Terminal' {
          Stop-AcquiredProcess $acquisition
          Remove-YourHomeRoleState $acquisition.Role
        }
        'Emulator' {
          $identityStatus = if ($acquisition.Serial -and $acquisition.BootId) {
            Get-AndroidEmulatorIdentityStatus $adb $acquisition.Serial $androidAvd $acquisition.BootId
          } else {
            'Unavailable'
          }
          if ($identityStatus -eq 'Match') {
            Write-Step "Closing Android emulator $($acquisition.Serial) started by the failed Test run"
            $previousErrorAction = $ErrorActionPreference
            try {
              $ErrorActionPreference = 'Continue'
              & $adb -s $acquisition.Serial emu kill *> $null
              $adbKillSucceeded = $LASTEXITCODE -eq 0
            } finally {
              $ErrorActionPreference = $previousErrorAction
            }
            if ($adbKillSucceeded) {
              [void](Wait-AdbSerialAbsent $adb $acquisition.Serial)
            }
          }
          Stop-AcquiredProcess $acquisition
          $identityAfterProcessStop = if ($acquisition.Serial -and $acquisition.BootId) {
            Get-AndroidEmulatorIdentityStatus $adb $acquisition.Serial $androidAvd $acquisition.BootId
          } else {
            'Absent'
          }
          if ($identityAfterProcessStop -in @('Match', 'Unavailable')) {
            throw "Android emulator $($acquisition.Serial) cleanup could not be verified after exact-process startup rollback (status=$identityAfterProcessStop); ownership state was retained."
          }

          $states = @(Get-YourHomeProcessState)
          $remaining = @($states | Where-Object {
            $_.Role -ne 'YourHome Android Emulator' -or
            $_.RepoRoot -ne $normalizedRepoRoot -or
            ($acquisition.Serial -and $_.Serial -ne $acquisition.Serial) -or
            ($acquisition.BootId -and $_.BootId -ne $acquisition.BootId)
          })
          Save-YourHomeProcessState $remaining
        }
        'Postgres' {
          Write-Step 'Stopping PostgreSQL started by the failed Test run'
          & docker compose -f (Join-Path $repoRoot 'infra\docker-compose.yml') stop postgres
          if ($LASTEXITCODE -ne 0) { throw 'Docker Compose could not stop PostgreSQL.' }
          if ((Get-PostgresContainerStatus) -ne 'Stopped') { throw 'PostgreSQL stop could not be verified after startup rollback.' }
        }
        default { throw "Unknown rollback acquisition kind '$($acquisition.Kind)'." }
      }
    } catch {
      $rollbackErrors.Add("$($acquisition.Kind): $($_.Exception.Message)")
    }
  }

  if ($rollbackErrors.Count -gt 0) {
    throw "Startup rollback was incomplete: $($rollbackErrors -join '; ')"
  }
}

function Show-Plan {
  Write-Output 'YourHome Test run plan:'
  Write-Output '  1. Start Docker Desktop'
  Write-Output '  2. Start PostgreSQL and apply Prisma migrations'
  Write-Output '  3. Start YourHome API and verify http://localhost:3000/health'
  Write-Output '  4. Start Android emulator'
  Write-Output '  5. Build/install Android dev client when needed'
  Write-Output '  6. Start Android dev client Metro on port 8081'
  Write-Output '  7. Start iOS development client QR terminal through an Expo tunnel on port 8082'
  Write-Output '  8. Open YourHome web at http://localhost:8082'
}

if ($StateSelfTest) {
  $stateFile = Join-Path $env:TEMP "yourhome-test-run-state-$PID.json"
  $rollbackProcess = $null
  $rollbackStartedAt = ''
  $rollbackChildProcessId = 0
  $rollbackChildStartedAt = ''
  $rollbackChildPidFile = Join-Path $env:TEMP "yourhome-test-run-child-$PID.txt"
  $reparseTestRoot = Join-Path $env:TEMP "yourhome-reparse-self-test-$PID"
  $reparseTestOutside = Join-Path $env:TEMP "yourhome-reparse-outside-$PID"
  $reparseTestLink = Join-Path $reparseTestRoot 'node_modules'
  $emulatorRollbackProcess = $null
  $emulatorRollbackStartedAt = ''
  $selfTestAcquisitions = [System.Collections.Generic.List[object]]::new()
  $acquisitionProcessesBefore = @(Get-Process powershell -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  $blockedStateParent = Join-Path $env:TEMP "yourhome-terminal-state-block-$PID"
  try {
    $sample = [pscustomobject]@{
      Role = 'state-self-test'
      RepoRoot = $normalizedRepoRoot
      TerminalPid = 123
      TerminalStartedAt = '2026-01-01T00:00:00.0000000Z'
      ListenerPid = 456
      ListenerStartedAt = '2026-01-01T00:00:01.0000000Z'
      Port = 8081
    }
    Save-YourHomeProcessState @($sample)
    $loaded = @(Get-YourHomeProcessState)
    if ($loaded.Count -ne 1 -or $loaded[0].Role -ne $sample.Role -or $loaded[0].ListenerPid -ne 456) {
      throw 'Launcher process-state round trip failed.'
    }
    Write-Output '[test-run] Process-state self-test PASS.'

    $escapedChildPidFile = $rollbackChildPidFile.Replace("'", "''")
    $rollbackProcess = Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
      '-NoProfile',
      '-Command',
      "`$child = Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile','-Command','Start-Sleep -Seconds 300') -PassThru; Set-Content -LiteralPath '$escapedChildPidFile' -Value `$child.Id; Start-Sleep -Seconds 300"
    ) -PassThru
    $rollbackStartedAt = $rollbackProcess.StartTime.ToUniversalTime().ToString('O')
    Wait-Until {
      Test-RecordedProcess $rollbackProcess.Id $rollbackStartedAt
    } 5 'Could not start the failure-rollback self-test process.'
    Wait-Until { Test-Path $rollbackChildPidFile } 5 'Could not record the failure-rollback self-test child process.'
    $rollbackChildProcessId = [int](Get-Content $rollbackChildPidFile -Raw).Trim()
    $rollbackChild = Get-Process -Id $rollbackChildProcessId -ErrorAction Stop
    $rollbackChildStartedAt = $rollbackChild.StartTime.ToUniversalTime().ToString('O')
    $rollbackEntry = [pscustomobject]@{
      Role = 'state-self-test'
      RepoRoot = $normalizedRepoRoot
      TerminalPid = $rollbackProcess.Id
      TerminalStartedAt = $rollbackStartedAt
      ListenerPid = $null
      ListenerStartedAt = $null
      Port = $null
    }
    Save-YourHomeProcessState @($rollbackEntry)
    $rollbackAcquisition = [pscustomobject]@{
      Kind = 'Terminal'
      Description = 'state self-test terminal'
      Role = 'state-self-test'
      Process = $rollbackProcess
      ProcessId = $rollbackProcess.Id
      StartedAt = $rollbackStartedAt
      StatePersisted = $true
      Serial = ''
      BootId = ''
    }
    $selfTestAcquisitions.Add($rollbackAcquisition)
    $env:YOURHOME_TEST_FAIL_BEFORE_PROCESS_TREE_TERMINATION = '1'
    $terminationFailed = $false
    try {
      Stop-AcquiredProcess $rollbackAcquisition
    } catch {
      $terminationFailed = $_.Exception.Message -match 'Test-only failure before exact process-tree termination'
    } finally {
      Remove-Item Env:YOURHOME_TEST_FAIL_BEFORE_PROCESS_TREE_TERMINATION -ErrorAction SilentlyContinue
    }
    $retryState = @(Get-YourHomeProcessState | Where-Object { $_.Role -eq 'state-self-test' })
    $persistedChild = @($retryState[0].ProcessTree | Where-Object {
      $_.ProcessId -eq $rollbackChildProcessId -and $_.ProcessStartedAt -eq $rollbackChildStartedAt
    })
    if (-not $terminationFailed -or $retryState.Count -ne 1 -or $persistedChild.Count -ne 1 -or
        -not (Test-RecordedProcess $rollbackProcess.Id $rollbackStartedAt) -or
        -not (Test-RecordedProcess $rollbackChildProcessId $rollbackChildStartedAt)) {
      throw 'Freshly discovered descendant identities were not durable before the injected termination failure.'
    }
    Write-Output '[test-run] Retry-safe process-tree persistence self-test PASS.'
    Rollback-YourHomeInvocation $selfTestAcquisitions
    if ((Test-RecordedProcess $rollbackProcess.Id $rollbackStartedAt) -or
      (Test-RecordedProcess $rollbackChildProcessId $rollbackChildStartedAt) -or
      @(Get-YourHomeProcessState | Where-Object { $_.Role -eq 'state-self-test' }).Count -ne 0) {
      throw 'Failure rollback did not stop every exact self-test process-tree identity and clear its state.'
    }
    Write-Output '[test-run] Exact process-tree rollback self-test PASS.'

    function docker {
      $global:LASTEXITCODE = 1
    }
    if ((Get-PostgresContainerStatus) -ne 'Unavailable') {
      throw 'PostgreSQL ownership probe did not fail closed when Docker inspection was unavailable.'
    }
    Write-Output '[test-run] PostgreSQL unavailable-ownership self-test PASS.'

    New-Item -ItemType Directory -Path $reparseTestRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $reparseTestOutside -Force | Out-Null
    New-Item -ItemType Junction -Path $reparseTestLink -Target $reparseTestOutside | Out-Null
    $reparseRejected = $false
    try {
      Assert-NoReparsePointInPath $reparseTestLink $reparseTestRoot
    } catch {
      $reparseRejected = $_.Exception.Message -match 'reparse point'
    }
    if (-not $reparseRejected) {
      throw 'Dependency cleanup reparse-point self-test did not fail closed.'
    }
    Write-Output '[test-run] Dependency cleanup reparse-point self-test PASS.'

    $emulatorRollbackProcess = Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
      '-NoProfile',
      '-Command',
      'Start-Sleep -Seconds 300'
    ) -PassThru
    $emulatorRollbackStartedAt = $emulatorRollbackProcess.StartTime.ToUniversalTime().ToString('O')
    Wait-Until {
      Test-RecordedProcess $emulatorRollbackProcess.Id $emulatorRollbackStartedAt
    } 5 'Could not start the pre-ADB emulator rollback self-test process.'
    $selfTestAcquisitions.Clear()
    $selfTestAcquisitions.Add([pscustomobject]@{
      Kind = 'Emulator'
      Description = 'pre-ADB emulator self-test'
      Role = 'YourHome Android Emulator'
      Process = $emulatorRollbackProcess
      ProcessId = $emulatorRollbackProcess.Id
      StartedAt = $emulatorRollbackStartedAt
      StatePersisted = $false
      Serial = ''
      BootId = ''
    })
    Rollback-YourHomeInvocation $selfTestAcquisitions
    if (Test-RecordedProcess $emulatorRollbackProcess.Id $emulatorRollbackStartedAt) {
      throw 'Failure rollback did not stop the exact pre-ADB emulator process.'
    }
    Write-Output '[test-run] Pre-ADB emulator rollback self-test PASS.'

    $selfTestAcquisitions.Clear()
    $env:YOURHOME_TEST_FAIL_TERMINAL_START_TIME = '1'
    $preIdentityFailedClosed = $false
    try {
      Start-YourHomeTerminal 'terminal-pre-identity-self-test' 'Start-Sleep -Seconds 300' $repoRoot $selfTestAcquisitions
    } catch {
      $preIdentityFailedClosed = $true
    } finally {
      Remove-Item Env:YOURHOME_TEST_FAIL_TERMINAL_START_TIME -ErrorAction SilentlyContinue
    }
    $preIdentityProcessesAfter = @(Get-Process powershell -ErrorAction SilentlyContinue | Where-Object {
      $_.Id -notin $acquisitionProcessesBefore
    })
    if (-not $preIdentityFailedClosed -or $preIdentityProcessesAfter.Count -ne 0 -or $selfTestAcquisitions.Count -ne 0) {
      throw 'Terminal pre-identity failure did not stop the newly acquired process tree and clear its ledger entry.'
    }
    Write-Output '[test-run] Terminal pre-identity rollback self-test PASS.'

    Set-Content -LiteralPath $blockedStateParent -Value 'block state directory creation' -Encoding UTF8
    $originalStateFile = $stateFile
    $stateFile = Join-Path $blockedStateParent 'state.json'
    $acquisitionFailedClosed = $false
    $selfTestAcquisitions.Clear()
    try {
      Start-YourHomeTerminal 'terminal-acquisition-self-test' 'Start-Sleep -Seconds 300' $repoRoot $selfTestAcquisitions
    } catch {
      $acquisitionFailedClosed = $true
    } finally {
      $stateFile = $originalStateFile
    }
    $acquisitionProcessesAfter = @(Get-Process powershell -ErrorAction SilentlyContinue | Where-Object {
      $_.Id -notin $acquisitionProcessesBefore
    })
    if (-not $acquisitionFailedClosed -or $acquisitionProcessesAfter.Count -ne 0 -or $selfTestAcquisitions.Count -ne 0) {
      throw 'Terminal acquisition failure did not stop the exact newly created terminal.'
    }
    Write-Output '[test-run] Terminal acquisition rollback self-test PASS.'
  } finally {
    if ($rollbackProcess -and (Test-RecordedProcess $rollbackProcess.Id $rollbackStartedAt)) {
      & taskkill.exe /PID $rollbackProcess.Id /T /F *> $null
    }
    if ($rollbackChildProcessId -and (Test-RecordedProcess $rollbackChildProcessId $rollbackChildStartedAt)) {
      & taskkill.exe /PID $rollbackChildProcessId /T /F *> $null
    }
    if ($emulatorRollbackProcess -and (Test-RecordedProcess $emulatorRollbackProcess.Id $emulatorRollbackStartedAt)) {
      & taskkill.exe /PID $emulatorRollbackProcess.Id /T /F *> $null
    }
    Remove-Item -LiteralPath $blockedStateParent -Force -ErrorAction SilentlyContinue
    Remove-Item $rollbackChildPidFile -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $reparseTestLink) { & cmd.exe /d /c rmdir $reparseTestLink *> $null }
    Remove-Item $reparseTestRoot -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $reparseTestOutside -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $stateFile -Force -ErrorAction SilentlyContinue
    Remove-Item "$stateFile.tmp" -Force -ErrorAction SilentlyContinue
  }
  exit 0
}

if ($DryRun) {
  Show-Plan
  exit 0
}

$sha256 = [System.Security.Cryptography.SHA256]::Create()
$mutexSuffix = [BitConverter]::ToString($sha256.ComputeHash([Text.Encoding]::UTF8.GetBytes($normalizedRepoRoot))).Replace('-', '')
$sha256.Dispose()
$mutex = [System.Threading.Mutex]::new($false, "Local\YourHome-TestRun-$mutexSuffix")
$mutexAcquired = $mutex.WaitOne(0)
if (-not $mutexAcquired) {
  $mutex.Dispose()
  throw 'Another YourHome Test run launcher is already running.'
}

$acquisitionsThisRun = [System.Collections.Generic.List[object]]::new()
$startedEmulatorThisRun = $false
$serial = ''
$androidBootId = ''
$emulatorProcessId = 0
$emulatorProcessStartedAt = ''
$emulatorAcquisition = $null
try {
Set-Location $repoRoot
Show-Plan

if (-not (Test-Path $dockerDesktop)) { throw "Docker Desktop not found: $dockerDesktop" }
if (-not (Test-Path $adb)) { throw "ADB not found: $adb" }
if (-not (Test-Path $emulator)) { throw "Android emulator not found: $emulator" }
if (-not (Test-Path $javaHome)) { throw "Android Studio JDK not found: $javaHome" }

$env:ANDROID_HOME = $androidHome
$env:JAVA_HOME = $javaHome
$env:Path = "$(Join-Path $javaHome 'bin');$(Join-Path $androidHome 'platform-tools');$(Join-Path $androidHome 'emulator');$env:Path"

$substLine = @(& subst.exe) | Where-Object { $_ -match '^Y:\\:' } | Select-Object -First 1
if ($substLine) {
  $substTarget = ($substLine -split '=>', 2)[1].Trim()
  $normalizedSubstTarget = [System.IO.Path]::GetFullPath($substTarget).TrimEnd('\')
  if (-not $normalizedSubstTarget.Equals($normalizedRepoRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Drive Y: is already mapped somewhere else: $substLine"
  }
}
if (-not $substLine) {
  Write-Step "Mapping Y: to $repoRoot for short Android/Metro paths"
  & subst.exe $shortDrive $repoRoot
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the Y: short-path mapping.' }
}
Set-Location $shortRepo

$workspaceModuleAllowlist = @(
  [System.IO.Path]::GetFullPath((Join-Path $shortRepo 'apps\mobile\node_modules')),
  [System.IO.Path]::GetFullPath((Join-Path $shortRepo 'apps\api\node_modules')),
  [System.IO.Path]::GetFullPath((Join-Path $shortRepo 'apps\reviewer-web\node_modules'))
)

Stop-YourHomeRole 'YourHome API'
Stop-YourHomeRole 'YourHome Android Dev Client'
Stop-YourHomeRole 'YourHome iOS QR + Web'
Wait-Until { -not (Test-TcpPort 3000) } 10 'Port 3000 is occupied by a process not owned by this launcher.'
Wait-Until { -not (Test-TcpPort 8081) } 10 'Port 8081 is occupied by a process not owned by this launcher.'
Wait-Until { -not (Test-TcpPort 8082) } 10 'Port 8082 is occupied by a process not owned by this launcher.'

$modulesFile = Join-Path $shortRepo 'node_modules\.modules.yaml'
$topologyReady = $false
if (Test-Path $shortExpo) {
  & node $topologyTest *> $null
  $topologyReady = $LASTEXITCODE -eq 0
}
if (-not $topologyReady) {
  Write-Step 'Repairing stale workspace dependency topology'
  foreach ($workspaceModules in $workspaceModuleAllowlist) {
    $normalizedWorkspaceModules = [System.IO.Path]::GetFullPath($workspaceModules)
    if ($normalizedWorkspaceModules -notin $workspaceModuleAllowlist) {
      throw "Refusing dependency cleanup outside the fixed workspace allowlist: $normalizedWorkspaceModules"
    }
    Assert-NoReparsePointInPath $normalizedWorkspaceModules $shortRepo
    if (Test-Path -LiteralPath $normalizedWorkspaceModules) {
      Remove-Item -LiteralPath $normalizedWorkspaceModules -Recurse -Force -ErrorAction Stop
    }
    if (Test-Path -LiteralPath $normalizedWorkspaceModules) {
      throw "Generated workspace dependency directory still exists after removal: $normalizedWorkspaceModules"
    }
  }
}
$dependenciesReady = (Test-Path $shortExpo) -and
  (Test-Path $modulesFile) -and
  ((Get-Content $modulesFile -Raw) -match [regex]::Escape("virtualStoreDir: $virtualStore")) -and
  ((Get-Content $modulesFile -Raw) -match 'nodeLinker: hoisted') -and
  $topologyReady
Write-Step 'Validating dependencies through Y: with a frozen lockfile'
$installArgs = @('install', '--frozen-lockfile', '--package-import-method=copy', '--node-linker=hoisted', "--virtual-store-dir=$virtualStore")
if (-not $dependenciesReady) { $installArgs += '--force' }
& pnpm @installArgs
if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed.' }
& node $topologyTest
if ($LASTEXITCODE -ne 0) { throw 'Workspace dependency topology remains mixed after pnpm install.' }

Write-Step 'Starting Docker Desktop when needed'
if (-not (Test-DockerReady)) {
  Start-Process -FilePath $dockerDesktop | Out-Null
  Wait-Until { Test-DockerReady } 120 'Docker did not become ready within 120 seconds.'
}

Write-Step 'Starting PostgreSQL'
$postgresStatus = Get-PostgresContainerStatus
if ($postgresStatus -eq 'Unavailable') {
  throw 'Could not determine whether PostgreSQL was already running; refusing to claim container ownership.'
}
if ($postgresStatus -eq 'Stopped') {
  $acquisitionsThisRun.Add([pscustomobject]@{
    Kind = 'Postgres'
    Description = 'PostgreSQL container'
    Role = ''
    Process = $null
    ProcessId = 0
    StartedAt = ''
    StatePersisted = $false
    Serial = ''
    BootId = ''
  })
}
& docker compose -f (Join-Path $repoRoot 'infra\docker-compose.yml') up -d --wait --wait-timeout 120
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL startup failed.' }
if ($env:YOURHOME_TEST_FAIL_AFTER_POSTGRES_START -eq '1') {
  throw 'Test-only failure after PostgreSQL startup.'
}

Stop-YourHomeRole 'YourHome API'
Wait-Until { -not (Test-TcpPort 3000) } 10 'Port 3000 is still occupied after closing the previous YourHome API terminal.'

Write-Step 'Preparing Prisma and applying migrations'
Push-Location $repoRoot
& pnpm --filter api prisma:generate
if ($LASTEXITCODE -ne 0) { throw 'Prisma client generation failed.' }
& pnpm --filter api prisma:deploy
if ($LASTEXITCODE -ne 0) { throw 'Prisma migration failed.' }
& pnpm --filter api test:prisma:read
if ($LASTEXITCODE -ne 0) { throw 'Read-only Prisma adapter preflight failed.' }
Pop-Location

Write-Step 'Opening a fresh YourHome API terminal'
Start-YourHomeTerminal 'YourHome API' 'pnpm --filter api dev' $repoRoot $acquisitionsThisRun
Wait-Until { Test-TcpPort 3000 } 120 'YourHome API did not open port 3000.'
Set-YourHomeListener 'YourHome API' 3000
try {
  $health = Invoke-RestMethod 'http://localhost:3000/health' -TimeoutSec 5
  if (-not $health.ok) { throw 'Health response did not report ok=true.' }
} catch {
  throw "YourHome API health check failed: $($_.Exception.Message)"
}

Write-Step 'Ensuring Android emulator is ready'
& $adb start-server | Out-Null
$previousEmulatorState = @(Get-YourHomeProcessState | Where-Object {
  $_.Role -eq 'YourHome Android Emulator' -and $_.RepoRoot -eq $normalizedRepoRoot
} | Select-Object -First 1)[0]
$serial = Find-AndroidSerialByAvd $adb $androidAvd
$startedEmulatorThisRun = $false
if (-not $serial) {
  $existingAvdProcesses = @(Get-AndroidAvdProcesses $androidAvd)
  if ($existingAvdProcesses.Count -gt 0) {
    throw "An Android emulator process for '$androidAvd' is already present but unavailable through ADB; refusing to launch or claim another emulator."
  }
  $avds = @(& $emulator -list-avds | Where-Object { $_ -and $_.Trim() })
  if ($androidAvd -notin $avds) { throw "Required Android test AVD '$androidAvd' is not configured." }
  Write-Step "Starting designated Android emulator: $androidAvd"
  $emulatorAcquisition = Start-AcquiredEmulatorProcess @('-avd', $androidAvd) 'Android emulator started by the Test run' $acquisitionsThisRun
  $emulatorProcess = $emulatorAcquisition.Process
  $startedEmulatorThisRun = $true
  $emulatorProcessId = $emulatorProcess.Id
  $emulatorProcessStartedAt = $emulatorAcquisition.StartedAt
  Wait-Until {
    if (-not (Test-RecordedProcess $emulatorProcessId $emulatorProcessStartedAt)) {
      throw "The acquired Android emulator process exited before '$androidAvd' registered with ADB."
    }
    $script:serial = Find-AndroidSerialByAvd $adb $androidAvd
    [bool]$script:serial
  } 120 "Android test AVD '$androidAvd' did not register with ADB."
  $serial = $script:serial
}
Wait-Until { Test-AndroidBootComplete $adb $serial } 120 'Android did not finish booting.'
$androidBootId = Get-AndroidBootId $adb $serial
if (-not $androidBootId) { throw "Could not read the boot identity for Android emulator $serial." }
$emulatorProcessTree = @()
$emulatorProcessTree = if ($emulatorAcquisition) {
  @(Merge-RecordedProcessTrees @($emulatorAcquisition.ProcessTree + @(Get-RecordedProcessTree $emulatorProcessId $emulatorProcessStartedAt)))
} elseif ($previousEmulatorState -and $previousEmulatorState.PSObject.Properties.Name -contains 'ProcessTree') {
  @($previousEmulatorState.ProcessTree)
} else {
  @()
}
$emulatorLaunchedByLauncher = $startedEmulatorThisRun -or (
  $previousEmulatorState -and
  [bool]$previousEmulatorState.LaunchedByLauncher -and
  $previousEmulatorState.Serial -eq $serial -and
  $previousEmulatorState.AvdName -eq $androidAvd -and
  $previousEmulatorState.BootId -eq $androidBootId
)
if (-not $emulatorAcquisition -and $emulatorLaunchedByLauncher) {
  if ($previousEmulatorState.PSObject.Properties.Name -contains 'ProcessId') {
    $emulatorProcessId = [int]$previousEmulatorState.ProcessId
  }
  if ($previousEmulatorState.PSObject.Properties.Name -contains 'ProcessStartedAt') {
    $emulatorProcessStartedAt = [string]$previousEmulatorState.ProcessStartedAt
  }
}
if ($emulatorAcquisition) {
  $emulatorAcquisition.Serial = $serial
  $emulatorAcquisition.BootId = $androidBootId
  $emulatorAcquisition.ProcessTree = @($emulatorProcessTree)
}
Set-AndroidEmulatorState $serial $androidAvd $androidBootId $emulatorLaunchedByLauncher $emulatorProcessId $emulatorProcessStartedAt $emulatorProcessTree
if ($emulatorAcquisition) { $emulatorAcquisition.StatePersisted = $true }
$env:ANDROID_SERIAL = $serial
$env:YOURHOME_PHYSICAL_ROOT = $repoRoot
$androidDeviceName = $androidAvd

$existingAndroidPackage = Wait-AndroidPackagePath $adb $serial $androidPackage
$androidClientInstalled = $existingAndroidPackage.StartsWith('package:')
$androidInputFingerprint = (& node $androidFingerprintScript 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $androidInputFingerprint -notmatch '^[a-f0-9]{64}$') {
  throw "Could not calculate the Android development-client input fingerprint: $androidInputFingerprint"
}
$installedPackageSha256 = if ($androidClientInstalled) { Get-AndroidPackageSha256 $adb $serial $existingAndroidPackage } else { '' }
$androidClientRecord = $null
if (Test-Path $androidClientStateFile) {
  try {
    $androidClientRecord = Get-Content $androidClientStateFile -Raw | ConvertFrom-Json
  } catch {
    Write-Step 'Ignoring an unreadable Android development-client identity record; a rebuild is required'
  }
}
$androidClientReusable = [bool](
  $androidClientInstalled -and
  $androidClientRecord -and
  $androidClientRecord.InputFingerprint -eq $androidInputFingerprint -and
  $androidClientRecord.PackageSha256 -eq $installedPackageSha256 -and
  $androidClientRecord.BootId -eq $androidBootId -and
  $androidClientRecord.Serial -eq $serial
)
Write-Step "Android dev-client state: installed=$androidClientInstalled identityVerified=$androidClientReusable reset=$([bool]$Reset)"

if ($Reset -or -not $androidClientReusable) {
  $androidInputFingerprintBeforeBuild = $androidInputFingerprint
  $androidFreeBytes = Get-AndroidDataFreeBytes $adb $serial
  if ($androidFreeBytes -gt 0 -and $androidFreeBytes -lt 1GB -and $existingAndroidPackage.StartsWith('package:')) {
    Write-Step 'Android storage is low; removing only the previous YourHome dev client before reinstalling'
    & $adb -s $serial uninstall $androidPackage
    if ($LASTEXITCODE -ne 0) { throw 'Could not remove the previous YourHome Android dev client to reclaim install space.' }
  }

  if ($androidFreeBytes -gt 0 -and $androidFreeBytes -lt 1GB) {
    Write-Step 'Trimming disposable Android package caches before installing the dev client'
    $previousErrorAction = $ErrorActionPreference
    try {
      $ErrorActionPreference = 'Continue'
      & $adb -s $serial shell pm trim-caches 2147483648 2>&1 | Out-Null
    } finally {
      $ErrorActionPreference = $previousErrorAction
    }
    $androidFreeBytes = Get-AndroidDataFreeBytes $adb $serial
    if ($androidFreeBytes -gt 0 -and $androidFreeBytes -lt 750MB) {
      if (-not $Reset) {
        throw "Android test AVD '$androidDeviceName' has only $([Math]::Round($androidFreeBytes / 1MB)) MB free. Ordinary Test runs never wipe emulator data; rerun pnpm test:run:reset only if resetting this designated AVD is acceptable."
      }
      Write-Step "Resetting only the designated Android test AVD '$androidDeviceName' because $([Math]::Round($androidFreeBytes / 1MB)) MB is not enough for a native install"
      & $adb -s $serial emu kill | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "Could not stop Android emulator $serial before its scoped data reset." }
      if (-not (Wait-AdbSerialAbsent $adb $serial)) {
        throw "Android emulator $serial did not stop before its scoped data reset."
      }
      if ($emulatorAcquisition) {
        Stop-AcquiredProcess $emulatorAcquisition
      } else {
        Wait-Until { @(Get-AndroidAvdProcesses $androidDeviceName).Count -eq 0 } 30 "Android emulator process for '$androidDeviceName' remained after ADB shutdown; refusing to start the reset replacement."
      }

      $serial = ''
      $androidBootId = ''
      $emulatorAcquisition = Start-AcquiredEmulatorProcess @('-avd', $androidDeviceName, '-wipe-data') 'reset Android emulator started by the Test run' $acquisitionsThisRun
      $emulatorProcess = $emulatorAcquisition.Process
      $startedEmulatorThisRun = $true
      $emulatorProcessId = $emulatorProcess.Id
      $emulatorProcessStartedAt = $emulatorAcquisition.StartedAt
      Wait-Until {
        if (-not (Test-RecordedProcess $emulatorProcessId $emulatorProcessStartedAt)) {
          throw "The acquired reset emulator process exited before '$androidDeviceName' registered with ADB."
        }
        $script:serial = Find-AndroidSerialByAvd $adb $androidDeviceName
        [bool]$script:serial
      } 120 'Reset Android emulator did not register with ADB.'
      $serial = $script:serial
      $env:ANDROID_SERIAL = $serial
      Wait-Until { Test-AndroidBootComplete $adb $serial } 180 'Reset Android emulator did not finish booting.'
      $androidBootId = Get-AndroidBootId $adb $serial
      if (-not $androidBootId) { throw "Could not read the boot identity after resetting '$androidDeviceName'." }
      $emulatorAcquisition.Serial = $serial
      $emulatorAcquisition.BootId = $androidBootId
      $emulatorProcessTree = @(Merge-RecordedProcessTrees @($emulatorAcquisition.ProcessTree + @(Get-RecordedProcessTree $emulatorProcessId $emulatorProcessStartedAt)))
      $emulatorAcquisition.ProcessTree = @($emulatorProcessTree)
      Set-AndroidEmulatorState $serial $androidDeviceName $androidBootId $true $emulatorProcessId $emulatorProcessStartedAt $emulatorProcessTree
      $emulatorAcquisition.StatePersisted = $true

      $androidFreeBytes = Get-AndroidDataFreeBytes $adb $serial
      if ($androidFreeBytes -gt 0 -and $androidFreeBytes -lt 750MB) {
        throw "Android emulator storage remains too low after resetting only '$androidDeviceName' ($([Math]::Round($androidFreeBytes / 1MB)) MB free). Expand the AVD data partition before retrying."
      }
    }
  }

  Write-Step 'Incrementally building and installing the current Android dev client'
  Push-Location $physicalMobile
  $runAndroidArgs = @('run:android', '--device', $androidDeviceName, '--no-bundler')
  if ($Reset) { $runAndroidArgs += '--no-build-cache' }
  & $physicalExpo @runAndroidArgs
  Pop-Location
  if ($LASTEXITCODE -ne 0) { throw 'Android dev-client build/install failed.' }
  $installedAndroidPackage = Wait-AndroidPackagePath $adb $serial $androidPackage 30
  if (-not $installedAndroidPackage.StartsWith('package:')) { throw 'Android dev-client package was not present after installation.' }
  $installedPackageSha256 = Get-AndroidPackageSha256 $adb $serial $installedAndroidPackage
  if ($installedPackageSha256 -notmatch '^[a-f0-9]{64}$') { throw 'Could not hash the installed Android development-client APK.' }
  $androidInputFingerprintAfterBuild = (& node $androidFingerprintScript 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $androidInputFingerprintAfterBuild -notmatch '^[a-f0-9]{64}$') {
    throw "Could not recalculate the Android development-client input fingerprint after installation: $androidInputFingerprintAfterBuild"
  }
  if ($androidInputFingerprintAfterBuild -ne $androidInputFingerprintBeforeBuild) {
    throw 'Android native inputs changed during build/install; refusing to record the installed APK as reusable.'
  }
  $androidClientStateDirectory = Split-Path -Parent $androidClientStateFile
  New-Item -ItemType Directory -Path $androidClientStateDirectory -Force | Out-Null
  $androidClientStateTemporary = "$androidClientStateFile.tmp"
  [pscustomobject]@{
    InputFingerprint = $androidInputFingerprintAfterBuild
    PackageSha256 = $installedPackageSha256
    BootId = $androidBootId
    Serial = $serial
  } | ConvertTo-Json | Set-Content $androidClientStateTemporary -Encoding UTF8
  Move-Item $androidClientStateTemporary $androidClientStateFile -Force
} else {
  Write-Step 'Reusing the installed Android dev client after native-input and device-APK identity verification'
}

Stop-YourHomeRole 'YourHome Android Dev Client'
$hadPreviousIosTunnel = [bool](Get-YourHomeProcessState | Where-Object {
  $_.Role -eq 'YourHome iOS QR + Web' -and $_.RepoRoot -eq $normalizedRepoRoot
} | Select-Object -First 1)
Stop-YourHomeRole 'YourHome iOS QR + Web'
Wait-Until { -not (Test-TcpPort 8081) } 10 'Port 8081 is occupied by a process not owned by this launcher.'
Wait-Until { -not (Test-TcpPort 8082) } 10 'Port 8082 is occupied by a process not owned by this launcher.'
if ($hadPreviousIosTunnel) {
  Write-Step 'Cooling down after replacing the previous Expo tunnel'
  Start-Sleep -Seconds 15
}
$lanIp = Get-LanIPv4
Write-Step "Using LAN API URL for iPhone: http://${lanIp}:3000"

Write-Step 'Opening Android dev client terminal'
Start-YourHomeTerminal 'YourHome Android Dev Client' "Remove-Item Env:YOURHOME_EXPO_GO -ErrorAction SilentlyContinue; `$env:ANDROID_SERIAL='$serial'; `$env:EXPO_PUBLIC_API_BASE_URL_ANDROID='http://10.0.2.2:3000'; & '$shortExpo' start --dev-client --host lan --port 8081 --android" $shortMobile $acquisitionsThisRun
Wait-Until { Test-TcpPort 8081 } 90 'Android Metro did not start on port 8081.'
Set-YourHomeListener 'YourHome Android Dev Client' 8081

Write-Step 'Opening iOS development client QR terminal'
Remove-Item $iosExpoFailure -Force -ErrorAction SilentlyContinue
Start-YourHomeTerminal 'YourHome iOS QR + Web' "Start-Transcript -Path '$iosExpoLog' -Force | Out-Null; try { Write-Host 'IPHONE: Scan this terminal QR and open it in the installed yourHome development client. Do not open the raw LAN HTTP address in Safari.' -ForegroundColor Yellow; Remove-Item Env:YOURHOME_EXPO_GO -ErrorAction SilentlyContinue; `$env:EXPO_PUBLIC_API_BASE_URL_IOS='http://${lanIp}:3000'; `$attempt = 0; do { `$attempt++; Write-Host ('Expo tunnel attempt {0} of 3' -f `$attempt) -ForegroundColor Cyan; & '$physicalExpo' start --dev-client --tunnel --port 8082; if (`$LASTEXITCODE -eq 0) { break }; if (`$attempt -lt 3) { Write-Host 'Waiting for ngrok process cleanup before retry' -ForegroundColor DarkCyan; Start-Sleep -Seconds 15 } } while (`$attempt -lt 3); if (`$LASTEXITCODE -ne 0) { Set-Content -Path '$iosExpoFailure' -Value 'All Expo tunnel attempts failed.' -Encoding UTF8; throw 'All Expo tunnel attempts failed.' } } finally { Stop-Transcript | Out-Null }" $physicalMobile $acquisitionsThisRun
Wait-Until { if (Test-Path $iosExpoFailure) { throw "All Expo tunnel attempts failed. See $iosExpoLog" }; Test-TcpPort 8082 } 90 'iOS/web Metro did not start on port 8082.'
Set-YourHomeListener 'YourHome iOS QR + Web' 8082
Wait-Until { if (Test-Path $iosExpoFailure) { throw "All Expo tunnel attempts failed. See $iosExpoLog" }; Test-ExpoTunnel } 360 'Expo Metro started, but its YourHome development-client public tunnel did not become ready.'

if (-not $NoOpen) {
  Write-Step 'Opening YourHome web app'
  Start-Process 'http://localhost:8082' | Out-Null
}

Write-Host ''
Write-Host 'YourHome Test run is ready.' -ForegroundColor Green
Write-Host "- API:     http://localhost:3000/health"
Write-Host "- Web:     http://localhost:8082"
Write-Host "- Android: $serial (dev client via Metro :8081)"
Write-Host "- iPhone:  scan the Expo tunnel QR in the 'YourHome iOS QR + Web' terminal and open it in the installed yourHome development client"
Write-Host "- Safari:  do not open the raw HTTP LAN address; iOS HTTPS-Only mode blocks it"
Write-Host "- Phone API URL: http://${lanIp}:3000"
} catch {
  $startupError = $_
  try {
    Rollback-YourHomeInvocation $acquisitionsThisRun
  } catch {
    throw "$($startupError.Exception.Message) Startup rollback also failed: $($_.Exception.Message)"
  }
  throw $startupError
} finally {
  if ($mutexAcquired) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
