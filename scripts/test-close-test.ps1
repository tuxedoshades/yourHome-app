$ErrorActionPreference = 'Stop'
$closeScript = Join-Path $PSScriptRoot 'test-close.ps1'
if (-not (Test-Path $closeScript)) {
  throw "Missing Test close launcher: $closeScript"
}

$source = Get-Content $closeScript -Raw
$readme = Get-Content (Join-Path $PSScriptRoot '..\README.md') -Raw
$required = @(
  '[switch]$DryRun',
  '[switch]$AuditOnly',
  '[switch]$KeepDatabase',
  '[switch]$KeepEmulator',
  '.hermes\test-run-processes.json',
  'function Resolve-CanonicalRepoRoot',
  'TerminalStartedAt',

  'LaunchedByLauncher',
  'AvdName',
  'Serial',
  'ProcessTree',
  'taskkill.exe',

  'function Wait-RecordedProcessExit',
  'function Wait-AdbSerialAbsent',
  '[DateTime]::UtcNow.AddSeconds($seconds)',
  'force-stop $androidPackage',
  'emu kill',
  'docker compose',
  'git status --short --branch',
  'git for-each-ref --format=',
  'git rev-list --left-right --count',
  'does not commit or push automatically'
)
foreach ($expected in $required) {
  if (-not $source.Contains($expected)) {
    throw "Test close is missing required behavior '$expected'."
  }
}

if ($source -match "`$androidSerial = 'emulator-5554'") {
  throw 'Test close must use the launcher-recorded emulator serial rather than a hard-coded serial.'
}

if ($source -notmatch '(?s)LaunchedByLauncher.*?emu kill') {
  throw 'Test close may close an emulator only when launcher ownership was recorded.'
}

if ($source -notmatch '(?s)emu kill.*?Wait-AdbSerialAbsent.*?Stop-RecordedProcessTree.*?statusAfterCleanup.*?Save-ProcessState') {
  throw 'Test close must verify ADB identity and the persisted exact process tree before rewriting ownership state.'
}

if ($source -notmatch '(?s)function Get-RecordedEmulatorStatus.*?\$ErrorActionPreference = ''Continue''.*?get-state.*?emu avd name.*?boot_id.*?finally.*?\$ErrorActionPreference = \$previousErrorAction') {
  throw 'Emulator identity probes must make native ADB errors non-terminating without weakening exact identity checks.'
}
if ($source -notmatch '(?s)function Get-RecordedEmulatorStatus.*?''Match''' -or
    $source -notmatch '(?s)function Get-RecordedEmulatorStatus.*?''Different''' -or
    $source -notmatch '(?s)function Get-RecordedEmulatorStatus.*?''Absent''' -or
    $source -notmatch '(?s)function Get-RecordedEmulatorStatus.*?''Unavailable''') {
  throw 'Test close must distinguish exact identity, different boot, verified serial absence, and unavailable ADB identity.'
}
if ($source -notmatch '(?s)''Unavailable''.*?ProcessTree.*?Stop-RecordedProcessTree.*?statusAfterCleanup.*?''Unavailable''.*?throw' -or
    $source -notmatch '(?s)Wait-AdbSerialAbsent.*?Stop-RecordedProcessTree.*?Save-ProcessState') {
  throw 'Unavailable ADB identity must verify the persisted exact process tree and retain state unless cleanup is provable.'
}

if ($source -notmatch 'function Stop-RecordedProcessTree' -or
    $source -notmatch '(?s)Stop-RecordedProcessTree.*?ProcessTree.*?Test-RecordedProcess.*?throw') {
  throw 'Test close must terminate and verify every persisted exact emulator process-tree identity.'
}

if ($source -notmatch 'function Save-ProcessState' -or
    $source -notmatch '(?s)if \(\$KeepEmulator\).*?Save-ProcessState.*?\$emulatorEntry' -or
    $source -notmatch 'ownership state was retained') {
  throw 'Test close must retain emulator ownership state when keeping it or when cleanup cannot be verified.'
}
if ($source -notmatch '(?s)foreach \(\$entry in.*?Merge-RecordedProcessTrees.*?ProcessTree.*?Save-ProcessState.*?Stop-RecordedProcess') {
  throw 'Test close must durably persist freshly discovered terminal/listener descendants before termination.'
}
if ($source -notmatch '(?s)\$emulatorProcessTree =.*?Merge-RecordedProcessTrees.*?\$emulatorEntry\.ProcessTree.*?Save-ProcessState.*?Get-RecordedEmulatorStatus') {
  throw 'Test close must durably persist freshly discovered emulator descendants before ADB or process termination.'
}

if (-not $readme.Contains('closes `Pixel_7` only when this launcher started its current emulator boot')) {
  throw 'README must explain ownership-dependent emulator shutdown.'
}


$repoRoot = Split-Path -Parent $PSScriptRoot
$output = & powershell -NoProfile -ExecutionPolicy Bypass -File $closeScript -DryRun 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) { throw "Test close dry run failed:`n$output" }
foreach ($expected in @('YourHome Test close plan:', 'launcher-owned terminals', 'PostgreSQL', 'Android emulator', 'Repository preservation audit')) {
  if (-not $output.Contains($expected)) { throw "Test close dry run did not report '$expected'." }
}

$branch = (& git -C $repoRoot branch --show-current | Out-String).Trim()
$configuredMissingUpstream = $false
if ($branch) {
  $env:GIT_CONFIG_COUNT = '2'
  $env:GIT_CONFIG_KEY_0 = "branch.$branch.remote"
  $env:GIT_CONFIG_VALUE_0 = '__yourhome_missing_remote__'
  $env:GIT_CONFIG_KEY_1 = "branch.$branch.merge"
  $env:GIT_CONFIG_VALUE_1 = 'refs/heads/__yourhome_missing_upstream__'
  $configuredMissingUpstream = $true
}
try {
  $auditOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $closeScript -AuditOnly 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { throw "Test close audit-only mode failed on a branch without an upstream:`n$auditOutput" }
} finally {
  if ($configuredMissingUpstream) {
    Remove-Item Env:GIT_CONFIG_COUNT, Env:GIT_CONFIG_KEY_0, Env:GIT_CONFIG_VALUE_0, Env:GIT_CONFIG_KEY_1, Env:GIT_CONFIG_VALUE_1 -ErrorAction SilentlyContinue
  }
}
if ($auditOutput -notmatch 'Current branch has no upstream|configured upstream .* is unavailable') {
  throw 'Test close audit-only mode did not report the missing or unavailable upstream safely.'
}

Write-Host '[test-close-test] PASS: scoped shutdown and preservation audit are present.' -ForegroundColor Green
