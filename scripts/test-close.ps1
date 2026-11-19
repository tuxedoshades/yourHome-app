param(
  [switch]$DryRun,
  [switch]$AuditOnly,
  [switch]$KeepDatabase,
  [switch]$KeepEmulator
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

$repoRoot = Resolve-CanonicalRepoRoot (Split-Path -Parent $PSScriptRoot)
$normalizedRepoRoot = $repoRoot
$stateFile = Join-Path $repoRoot '.hermes\test-run-processes.json'
$composeFile = Join-Path $repoRoot 'infra\docker-compose.yml'
$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
$androidPackage = 'com.yourhome.app'

function Write-Step([string]$message) {
  Write-Host "[test-close] $message" -ForegroundColor Cyan
}

function Show-Plan {
  Write-Output 'YourHome Test close plan:'
  Write-Output '  1. Stop launcher-owned terminals and their process trees'
  Write-Output '  2. Force-stop the YourHome Android app'
  if ($KeepEmulator) {
    Write-Output '  3. Keep the Android emulator running by request'
  } else {
    Write-Output '  3. Close the designated Android emulator only if this launcher started its current boot'
  }
  if ($KeepDatabase) {
    Write-Output '  4. Keep YourHome PostgreSQL running by request'
  } else {
    Write-Output '  4. Stop YourHome PostgreSQL while preserving its Docker volume'
  }
  Write-Output '  5. Run a Repository preservation audit (status plus ahead/behind); this does not commit or push automatically'
}

function Get-ProcessState {
  if (-not (Test-Path $stateFile)) { return @() }
  try {
    $parsed = Get-Content $stateFile -Raw | ConvertFrom-Json
    return @($parsed | Where-Object {
      $_.PSObject.Properties.Name -contains 'Role' -and
      $_.RepoRoot -eq $normalizedRepoRoot
    })
  } catch {
    throw "Could not read launcher process state '$stateFile': $($_.Exception.Message)"
  }
}

function Save-ProcessState([object[]]$entries) {
  if ($entries.Count -eq 0) {
    Remove-Item $stateFile -Force -ErrorAction SilentlyContinue
    Remove-Item "$stateFile.tmp" -Force -ErrorAction SilentlyContinue
    return
  }
  $stateDirectory = Split-Path -Parent $stateFile
  New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
  $temporary = "$stateFile.tmp"
  ConvertTo-Json -InputObject @($entries) -Depth 6 | Set-Content $temporary -Encoding UTF8
  Move-Item $temporary $stateFile -Force
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

function Wait-RecordedProcessExit([int]$processId, [string]$startedAt, [int]$seconds = 5) {
  $deadline = [DateTime]::UtcNow.AddSeconds($seconds)
  while ((Test-RecordedProcess $processId $startedAt) -and [DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 100
  }
  return -not (Test-RecordedProcess $processId $startedAt)
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

function Stop-RecordedProcessTree([object[]]$processTree, [string]$description, [switch]$BestEffort) {
  $owned = @(Merge-RecordedProcessTrees $processTree)
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
    if ($BestEffort) {
      Write-Warning "Could not stop every exact process in $description; its launcher-owned terminal tree will be stopped next."
      return
    }
    throw "Could not stop every exact process in ${description}: $($remaining.ProcessId -join ', ')."
  }
}


function Stop-RecordedProcess([int]$processId, [string]$startedAt, [string]$description, [switch]$BestEffort) {
  $ownedTree = @(Get-RecordedProcessTree $processId $startedAt)
  if ($ownedTree.Count -eq 0) { return }
  Stop-RecordedProcessTree $ownedTree $description -BestEffort:$BestEffort
}

function Get-AdbSerialStatus([string]$serial) {
  if (-not $serial -or -not (Test-Path $adb)) { return 'Unavailable' }
  $previousErrorAction = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $devices = (& $adb devices 2>$null | Out-String)
    if ($LASTEXITCODE -ne 0) { return 'Unavailable' }
    if ($devices -match "(?m)^$([regex]::Escape($serial))\s+") { return 'Present' }
    return 'Absent'
  } catch {
    return 'Unavailable'
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
}

function Get-RecordedEmulatorStatus([object]$entry) {
  if (-not $entry) { return 'Absent' }
  foreach ($property in @('Serial', 'AvdName', 'BootId', 'LaunchedByLauncher')) {
    if ($entry.PSObject.Properties.Name -notcontains $property) { return 'Unavailable' }
  }
  $serialStatus = Get-AdbSerialStatus $entry.Serial
  if ($serialStatus -eq 'Absent') { return 'Absent' }
  if ($serialStatus -eq 'Unavailable') { return 'Unavailable' }

  $previousErrorAction = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $state = (& $adb -s $entry.Serial get-state 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $state -ne 'device') { return 'Unavailable' }
    $avdName = ((& $adb -s $entry.Serial emu avd name 2>$null |
      Where-Object { $_ -and $_.Trim() -ne 'OK' } |
      Select-Object -First 1 | Out-String).Trim())
    if ($LASTEXITCODE -ne 0) { return 'Unavailable' }
    $bootId = ((& $adb -s $entry.Serial shell cat /proc/sys/kernel/random/boot_id 2>$null | Out-String).Trim())
    if ($LASTEXITCODE -ne 0 -or -not $bootId) { return 'Unavailable' }
    if ($avdName -eq $entry.AvdName -and $bootId -eq $entry.BootId) { return 'Match' }
    return 'Different'
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
}

function Test-RecordedEmulator([object]$entry) {
  return (Get-RecordedEmulatorStatus $entry) -eq 'Match'
}

function Wait-AdbSerialAbsent([string]$serial, [int]$seconds = 60) {
  $deadline = [DateTime]::UtcNow.AddSeconds($seconds)
  while ((Get-AdbSerialStatus $serial) -ne 'Absent' -and [DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 250
  }
  return (Get-AdbSerialStatus $serial) -eq 'Absent'
}

function Show-RepositoryAudit {
  Write-Step 'Repository preservation audit'
  Set-Location $repoRoot
  & git status --short --branch
  if ($LASTEXITCODE -ne 0) { throw 'Could not read repository status.' }

  $branch = (& git branch --show-current | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Could not identify the current repository branch.' }
  $upstream = if ($branch) {
    (& git for-each-ref --format='%(upstream:short)' "refs/heads/$branch" | Out-String).Trim()
  } else {
    ''
  }
  if ($LASTEXITCODE -ne 0) { throw "Could not inspect the upstream for branch '$branch'." }
  if ($upstream) {
    $previousErrorAction = $ErrorActionPreference
    try {
      $ErrorActionPreference = 'Continue'
      $counts = (& git rev-list --left-right --count "$upstream...HEAD" 2>$null | Out-String).Trim()
      $upstreamAvailable = $LASTEXITCODE -eq 0
    } finally {
      $ErrorActionPreference = $previousErrorAction
    }
    if ($upstreamAvailable) {
      $parts = $counts -split '\s+'
      Write-Host "[test-close] Upstream: $upstream; behind=$($parts[0]); ahead=$($parts[1])"
    } else {
      Write-Warning "The configured upstream '$upstream' is unavailable. Local commits may not be pushed."
    }
  } else {
    Write-Warning 'Current branch has no upstream. Local commits may not be pushed.'
  }

  $changes = (& git status --porcelain=v1 | Out-String).Trim()
  if ($changes) {
    Write-Warning 'The working tree contains uncommitted work. Test close preserved it on disk but did not commit or push it.'
  } else {
    Write-Step 'Working tree is clean.'
  }
  Write-Host '[test-close] Persistence policy: this operation does not commit or push automatically; primary-model verification and explicit user approval are required.'
}

if ($AuditOnly) {
  Show-RepositoryAudit
  exit 0
}

Show-Plan
if ($DryRun) { exit 0 }

$sha256 = [System.Security.Cryptography.SHA256]::Create()
$mutexSuffix = [BitConverter]::ToString($sha256.ComputeHash([Text.Encoding]::UTF8.GetBytes($normalizedRepoRoot))).Replace('-', '')
$sha256.Dispose()
$mutex = [System.Threading.Mutex]::new($false, "Local\YourHome-TestRun-$mutexSuffix")
$mutexAcquired = $mutex.WaitOne(0)
if (-not $mutexAcquired) {
  $mutex.Dispose()
  throw 'A YourHome Test run or Test close operation is already active.'
}

try {
  $states = @(Get-ProcessState)
  $emulatorEntry = $states | Where-Object { $_.Role -eq 'YourHome Android Emulator' } | Select-Object -First 1
  foreach ($entry in @($states | Where-Object { $_.Role -ne 'YourHome Android Emulator' })) {
    $persistedTree = if ($entry.PSObject.Properties.Name -contains 'ProcessTree') { @($entry.ProcessTree) } else { @() }
    $listenerTree = @(Get-RecordedProcessTree $entry.ListenerPid $entry.ListenerStartedAt)
    $liveTree = @(Get-RecordedProcessTree $entry.TerminalPid $entry.TerminalStartedAt)
    $ownedTree = @(Merge-RecordedProcessTrees @($persistedTree + $listenerTree + $liveTree))
    if ($entry.PSObject.Properties.Name -contains 'ProcessTree') {
      $entry.ProcessTree = @($ownedTree)
    } else {
      $entry | Add-Member -NotePropertyName ProcessTree -NotePropertyValue @($ownedTree)
    }
    Save-ProcessState $states
    Stop-RecordedProcessTree $ownedTree "'$($entry.Role)' owned process tree"
    if (Test-RecordedProcess $entry.ListenerPid $entry.ListenerStartedAt) {
      throw "The '$($entry.Role)' listener remained active after its launcher-owned terminal tree was stopped."
    }
    $states = @($states | Where-Object { $_ -ne $entry })
    Save-ProcessState $states
  }

  $retainEmulatorState = $false
  $emulatorProcessTree = if ($emulatorEntry) {
    $persistedTree = if ($emulatorEntry.PSObject.Properties.Name -contains 'ProcessTree') { @($emulatorEntry.ProcessTree) } else { @() }
    $liveTree = if ($emulatorEntry.PSObject.Properties.Name -contains 'ProcessId' -and $emulatorEntry.PSObject.Properties.Name -contains 'ProcessStartedAt') {
      @(Get-RecordedProcessTree $emulatorEntry.ProcessId $emulatorEntry.ProcessStartedAt)
    } else {
      @()
    }
    @(Merge-RecordedProcessTrees @($persistedTree + $liveTree))
  } else {
    @()
  }
  if ($emulatorEntry) {
    if ($emulatorEntry.PSObject.Properties.Name -contains 'ProcessTree') {
      $emulatorEntry.ProcessTree = @($emulatorProcessTree)
    } else {
      $emulatorEntry | Add-Member -NotePropertyName ProcessTree -NotePropertyValue @($emulatorProcessTree)
    }
  }
  Save-ProcessState $states
  $emulatorStatus = Get-RecordedEmulatorStatus $emulatorEntry
  if ($emulatorStatus -eq 'Match') {
    Write-Step 'Force-stopping the YourHome Android app'
    & $adb -s $emulatorEntry.Serial shell am force-stop $androidPackage
    if ($LASTEXITCODE -ne 0) { throw 'Could not force-stop the YourHome Android app.' }
    if ($KeepEmulator) {
      $retainEmulatorState = $true
      Write-Step 'Keeping the Android emulator and its ownership state by request.'
    } elseif ([bool]$emulatorEntry.LaunchedByLauncher) {
      Write-Step "Closing launcher-owned Android emulator $($emulatorEntry.Serial) ($($emulatorEntry.AvdName))"
      $previousErrorAction = $ErrorActionPreference
      try {
        $ErrorActionPreference = 'Continue'
        & $adb -s $emulatorEntry.Serial emu kill *> $null
        $adbKillSucceeded = $LASTEXITCODE -eq 0
      } finally {
        $ErrorActionPreference = $previousErrorAction
      }
      if ($adbKillSucceeded) { [void](Wait-AdbSerialAbsent $emulatorEntry.Serial) }
      if ($emulatorProcessTree.Count -eq 0) {
        throw "Launcher-owned Android emulator $($emulatorEntry.Serial) has no persisted exact process tree; ownership state was retained."
      }
      Stop-RecordedProcessTree $emulatorProcessTree 'launcher-owned Android emulator'
      $statusAfterCleanup = Get-RecordedEmulatorStatus $emulatorEntry
      if ($statusAfterCleanup -in @('Match', 'Unavailable')) {
        throw "Launcher-owned Android emulator $($emulatorEntry.Serial) cleanup could not be verified (status=$statusAfterCleanup); ownership state was retained."
      }
    } else {
      Write-Step "Leaving reused Android emulator $($emulatorEntry.Serial) running because this launcher did not start its current boot."
    }
  } elseif ($emulatorStatus -eq 'Unavailable' -and $emulatorEntry) {
    if ($KeepEmulator) {
      $retainEmulatorState = $true
      Write-Warning 'Recorded Android emulator identity is unavailable; preserving it and its ownership state because -KeepEmulator was requested.'
    } elseif ([bool]$emulatorEntry.LaunchedByLauncher) {
      if ($emulatorProcessTree.Count -eq 0) {
        throw 'Recorded launcher-owned Android emulator identity is unavailable and has no exact process tree; ownership state was retained.'
      }
      Stop-RecordedProcessTree $emulatorProcessTree 'launcher-owned Android emulator'
      $statusAfterCleanup = Get-RecordedEmulatorStatus $emulatorEntry
      if ($statusAfterCleanup -in @('Match', 'Unavailable')) {
        throw "Launcher-owned Android emulator cleanup could not be verified (status=$statusAfterCleanup); ownership state was retained."
      }
    } else {
      Write-Warning 'Recorded reused Android emulator identity is unavailable; no emulator process was touched.'
    }
  } elseif ($emulatorStatus -eq 'Different') {
    if ($emulatorEntry -and [bool]$emulatorEntry.LaunchedByLauncher -and $emulatorProcessTree.Count -gt 0) {
      Stop-RecordedProcessTree $emulatorProcessTree 'superseded launcher-owned Android emulator'
    }
    Write-Warning 'Recorded Android emulator identity no longer matches the current serial/AVD/boot; only its exact superseded launcher tree was eligible for cleanup, and the different current boot was not touched.'
  } elseif ($emulatorStatus -eq 'Absent' -and $emulatorEntry) {
    if ([bool]$emulatorEntry.LaunchedByLauncher) {
      if ($emulatorProcessTree.Count -eq 0) {
        throw 'Launcher-owned Android emulator serial is absent but no exact process tree was persisted; ownership state was retained.'
      }
      Stop-RecordedProcessTree $emulatorProcessTree 'launcher-owned Android emulator'
    }
    Write-Step 'The launcher-recorded Android emulator serial and exact process tree are absent.'
  } else {
    Write-Step 'No launcher-recorded Android emulator is active; no emulator process was touched.'
  }

  if ($KeepEmulator -and $emulatorEntry) { $retainEmulatorState = $true }
  if ($retainEmulatorState) {
    Save-ProcessState @($emulatorEntry)
  } else {
    Save-ProcessState @()
  }

  if (-not $KeepDatabase) {
    Write-Step 'Stopping YourHome PostgreSQL container (data volume is preserved)'
    & docker compose -f $composeFile stop
    if ($LASTEXITCODE -ne 0) { throw 'Could not stop the YourHome PostgreSQL container.' }
  }

  Show-RepositoryAudit
  Write-Host 'YourHome Test close completed.' -ForegroundColor Green
} finally {
  if ($mutexAcquired) { $mutex.ReleaseMutex() | Out-Null }
  $mutex.Dispose()
}
