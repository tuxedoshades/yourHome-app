param()

$ErrorActionPreference = 'Stop'
$launcher = Join-Path $PSScriptRoot 'test-run.ps1'
$topologyTest = Join-Path $PSScriptRoot 'workspace-topology-test.cjs'
$androidFingerprintTest = Join-Path $PSScriptRoot 'android-dev-client-fingerprint.cjs'
$readme = Get-Content (Join-Path $PSScriptRoot '..\README.md') -Raw
$npmrcPath = Join-Path $PSScriptRoot '..\.npmrc'
$iosSetupGuide = Get-Content (Join-Path $PSScriptRoot '..\docs\IOS_DEV_CLIENT_SETUP.md') -Raw
$iosDevelopmentBuildGuide = Get-Content (Join-Path $PSScriptRoot '..\docs\IOS_DEVELOPMENT_BUILD.md') -Raw
$mobileDevRunbook = Get-Content (Join-Path $PSScriptRoot '..\docs\MOBILE_DEV_RUNBOOK.md') -Raw

if (-not (Test-Path $launcher)) {
  throw "Launcher does not exist: $launcher"
}
if (-not (Test-Path $topologyTest)) {
  throw "Missing workspace dependency topology test: $topologyTest"
}
if (-not (Test-Path $androidFingerprintTest)) {
  throw "Missing Android development-client fingerprint helper: $androidFingerprintTest"
}
if (-not (Test-Path $npmrcPath)) {
  throw 'Repository must persist the hoisted copy-based pnpm topology in .npmrc.'
}
$npmrc = Get-Content $npmrcPath -Raw
if ($npmrc -notmatch '(?m)^node-linker=hoisted\s*$' -or $npmrc -notmatch '(?m)^package-import-method=copy\s*$') {
  throw '.npmrc must configure node-linker=hoisted and package-import-method=copy.'
}

$output = (& $launcher -DryRun 2>&1 | Out-String)
$stateOutput = (& $launcher -StateSelfTest 2>&1 | Out-String)
if ($stateOutput -notmatch 'Process-state self-test PASS') {
  throw "Launcher process-state self-test failed. Output:`n$stateOutput"
}
if ($stateOutput -notmatch 'Exact process-tree rollback self-test PASS' -or
    $stateOutput -notmatch 'Retry-safe process-tree persistence self-test PASS' -or
    $stateOutput -notmatch 'PostgreSQL unavailable-ownership self-test PASS' -or
    $stateOutput -notmatch 'Dependency cleanup reparse-point self-test PASS') {
  throw "Launcher exact-tree, PostgreSQL ownership, or reparse-point self-test failed. Output:`n$stateOutput"
}

foreach ($documentationContract in @(
  'configured AVD named `Pixel_7`',
  'installed SDK 55 YourHome iOS development client',
  'automatically rebuilds the development client when that identity changes',
  'repository `.npmrc` applies the required copy-based hoisted pnpm topology'
)) {
  if (-not $readme.Contains($documentationContract)) {
    throw "README is missing launcher prerequisite or lifecycle guidance '$documentationContract'."
  }
}

if ($iosSetupGuide -match 'npm i -g eas-cli' -or $iosSetupGuide -match '(?m)^\s*- `eas login`') {
  throw 'iOS development-client setup must use the repository-pinned EAS CLI rather than a global install.'
}
if ($iosSetupGuide -notmatch 'pnpm --filter mobile exec eas login') {
  throw 'iOS development-client setup must document login through the repository-pinned EAS CLI.'
}
if ($readme -match 'pnpm dev:api') {
  throw 'README must not advertise a missing root dev:api script.'
}
if ($readme -notmatch 'pnpm --filter api dev') {
  throw 'README must document the supported API development command.'
}
if ($mobileDevRunbook -match 'Expo Go, Stable' -or $mobileDevRunbook -match 'iPhone and Android both show') {
  throw 'The SDK 55 mobile runbook must not present Expo Go as the physical-iPhone acceptance workflow.'
}
foreach ($mobileContract in @('development client', 'pnpm test:run', 'Apple Developer')) {
  if (-not $mobileDevRunbook.Contains($mobileContract)) {
    throw "The mobile runbook is missing development-client guidance '$mobileContract'."
  }
}
foreach ($iosContract in @('IOS_DEVELOPMENT_BUILD.md', 'RNMAPBOX_MAPS_DOWNLOAD_TOKEN', 'Apple Developer Program', 'physical-iPhone')) {
  if (-not $iosSetupGuide.Contains($iosContract)) {
    throw "The iOS setup guide is missing required build/install guidance '$iosContract'."
  }
}

$required = @(
  'Docker Desktop',
  'PostgreSQL',
  'YourHome API',
  'Android emulator',
  'Android dev client',
  'iOS development client QR',
  'YourHome web',
  'http://localhost:3000/health'
)

foreach ($text in $required) {
  if ($output -notmatch [regex]::Escape($text)) {
    throw "Dry-run output is missing '$text'. Output:`n$output"
  }
}

$source = Get-Content $launcher -Raw
$requiredSource = @(
  "`$shortRepo = 'Y:\'",
  "`$virtualStore = 'Y:\node_modules\.pnpm'",
  "`$topologyTest = 'Y:\scripts\workspace-topology-test.cjs'",
  "`$shortExpo = 'Y:\node_modules\.bin\expo.cmd'",
  ".hermes\test-run-processes.json",
  'TerminalStartedAt',
  'ListenerStartedAt',

  'System.Threading.Mutex',
  'function Resolve-CanonicalRepoRoot',
  'function Test-DescendantProcess',

  'function Find-AndroidSerialByAvd',
  '$androidAvd = ''Pixel_7''',
  'LaunchedByLauncher',
  '[DateTime]::UtcNow.AddSeconds',
  "Stop-YourHomeRole 'YourHome API'",
  "Stop-YourHomeRole 'YourHome Android Dev Client'",
  "Stop-YourHomeRole 'YourHome iOS QR + Web'",
  'up -d --wait --wait-timeout 120',
  'function Test-DockerReady',
  'function Get-AndroidDataFreeBytes',
  'function Get-AndroidPackagePath',
  'function Wait-AndroidPackagePath',
  'function Get-AndroidPackageSha256',
  '$androidPackage = ''com.yourhome.app''',
  'function Test-AndroidBootComplete',
  '$androidClientInstalled',
  'if ($Reset -or -not $androidClientReusable)',
  'android-dev-client-fingerprint.cjs',
  '.hermes\android-dev-client.json',
  'InputFingerprint',
  'PackageSha256',
  'BootId',
  'Serial',
  'Reusing the installed Android dev client',
  'uninstall $androidPackage',
  'trim-caches 2147483648',
  "@('-avd', `$androidDeviceName, '-wipe-data')",
  'Resetting only the designated Android test AVD',
  '--node-linker=hoisted',
  'workspace-topology-test.cjs',
  'apps\mobile\node_modules',
  'apps\api\node_modules',
  'apps\reviewer-web\node_modules',
  '& pnpm @installArgs',
  '& pnpm --filter api prisma:generate',
  '& pnpm --filter api prisma:deploy',
  '& pnpm --filter api test:prisma:read',
  'emu avd name',
  "'--device', `$androidDeviceName",
  '$env:ANDROID_SERIAL = $serial',
  '$env:YOURHOME_PHYSICAL_ROOT = $repoRoot',
  "`$hostUri -notmatch '\.exp\.direct$'",
  'Invoke-WebRequest -Uri $launchAsset',
  '$launchResponse.StatusCode -eq 200',
  '$launchContentType -match',
  '$launchContentLength -gt 0',
  '[System.Text.Encoding]::UTF8.GetString',
  '$iosRuntimeVersion = [string]',
  '([string]$manifest.runtimeVersion) -ne $iosRuntimeVersion',
  'Test-ExpoTunnel } 360',
  "& '`$shortExpo' start --dev-client",
  "& '`$physicalExpo' start --dev-client --tunnel",
  'Expo tunnel attempt',
  '$attempt -lt 3',
  'Waiting for ngrok process cleanup before retry',
  'Cooling down after replacing the previous Expo tunnel',
  'Start-Sleep -Seconds 15',
  'ios-expo-failed',
  'All Expo tunnel attempts failed',
  'Start-Transcript -Path'
)

foreach ($text in $requiredSource) {
  if ($source -notmatch [regex]::Escape($text)) {
    throw "Launcher is missing the short-path/direct-Expo safeguard '$text'."
  }
}

if ($source -match '\$topologyTest\s*=\s*Join-Path\s+\$shortRepo') {
  throw 'Launcher must not resolve a Y: path before it has created or validated the short-path mapping.'
}

$androidFingerprint = (& node $androidFingerprintTest 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $androidFingerprint -notmatch '^[a-f0-9]{64}$') {
  throw "Android development-client fingerprint helper failed: $androidFingerprint"
}

$fingerprintProbeFiles = @(
  (Join-Path $PSScriptRoot '..\apps\mobile\android\.kotlin\sessions\yourhome-fingerprint-self-test.tmp'),
  (Join-Path $PSScriptRoot '..\apps\mobile\android\app\.cxx\yourhome-fingerprint-self-test.tmp'),
  (Join-Path $PSScriptRoot '..\apps\mobile\android\yourhome-fingerprint-self-test.log')
)
try {
  foreach ($probeFile in $fingerprintProbeFiles) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $probeFile) -Force | Out-Null
    [System.IO.File]::WriteAllText($probeFile, [Guid]::NewGuid().ToString('N'))
  }
  $fingerprintWithGeneratedOutputs = (& node $androidFingerprintTest 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $fingerprintWithGeneratedOutputs -ne $androidFingerprint) {
    throw 'Android development-client fingerprint must ignore generated .kotlin, .cxx, and build-log outputs.'
  }
} finally {
  foreach ($probeFile in $fingerprintProbeFiles) {
    Remove-Item -LiteralPath $probeFile -Force -ErrorAction SilentlyContinue
  }
}

if ($source -notmatch '(?s)InputFingerprint.*?PackageSha256.*?BootId.*?Serial.*?\$androidClientReusable') {
  throw 'Android reuse must require the recorded native-input, APK, boot, and serial identities.'
}

if ($source -notmatch '(?s)\$acquisitionsThisRun.*?try \{.*?catch \{.*?Rollback-YourHomeInvocation \$acquisitionsThisRun') {
  throw 'Failed Test-run startup must roll back only resources acquired by that invocation.'
}

if ($source -notmatch '\$acquisitionsThisRun\s*=\s*\[System\.Collections\.Generic\.List\[object\]\]') {
  throw 'Test-run must maintain one acquisition-ordered rollback ledger.'
}
if ($source -match 'rolesStartedThisRun|startedPostgresThisRun') {
  throw 'Separate role/PostgreSQL rollback collections must not bypass the ordered acquisition ledger.'
}
if ($source -notmatch '(?s)function Start-YourHomeTerminal.*?\$acquisitionLedger\.Add.*?Start-Process.*?StartTime.*?Save-YourHomeProcessState') {
  throw 'Terminal acquisition must enter the rollback ledger before Start-Process and identity/state capture.'
}
if ($source -match '(?s)function Start-YourHomeTerminal.*?elseif \(\$terminal -and -not \$terminal\.HasExited\).*?\$terminal\.Kill\(\)') {
  throw 'Terminal acquisition fallback must terminate the new process tree, not only the immediate process.'
}
if ($source -notmatch '(?s)function Stop-AcquiredProcess.*?if \(-not \$acquisition\.ProcessId -and \$process\).*?\$process\.Id' -or
    $source -notmatch '(?s)function Start-YourHomeTerminal.*?\$acquisition\.Process = Start-Process') {
  throw 'Pre-identity cleanup must retain the returned process handle and derive its PID before tree termination.'
}
if ($source -notmatch '(?s)function Start-AcquiredEmulatorProcess.*?\$acquisitionLedger\.Add.*?Start-Process -FilePath \$emulator.*?-PassThru.*?StartTime') {
  throw 'Emulator acquisition must enter the rollback ledger before Start-Process, start-time, or ADB identity capture.'
}
if ($source -notmatch '(?s)function Rollback-YourHomeInvocation.*?for \(\$index = \$acquisitions\.Count - 1.*?Kind') {
  throw 'Rollback must unwind the single acquisition ledger in strict reverse order.'
}

if ($source -notmatch '(?s)Start-AcquiredEmulatorProcess.*?\$startedEmulatorThisRun = \$true.*?Wait-Until') {
  throw 'A newly launched emulator must be owned by exact process identity before ADB registration can fail.'
}

if ($source -notmatch '(?s)function Rollback-YourHomeInvocation.*?''Emulator''.*?Stop-AcquiredProcess \$acquisition') {
  throw 'Startup rollback must stop the exact ledger-owned emulator process before ADB boot identity exists.'
}
if ($source -notmatch '(?s)function Get-AdbSerialStatus.*?''Absent''.*?''Unavailable''' -or
    $source -notmatch '(?s)function Get-AndroidBootId.*?\$ErrorActionPreference = ''Continue''.*?finally.*?\$ErrorActionPreference = \$previousErrorAction') {
  throw 'Emulator rollback must distinguish verified ADB absence from an unavailable probe and protect boot-ID reads.'
}
if ($source -notmatch '(?s)function Find-AndroidSerialByAvd.*?\$ErrorActionPreference = ''Continue''.*?\^\(emulator-\\d\+\)\\s\+device.*?\$LASTEXITCODE -eq 0.*?finally') {
  throw 'Emulator discovery must tolerate ADB offline transitions and require successful identity probes.'
}
if ($source -notmatch '(?s)function Set-AndroidEmulatorState.*?ProcessId.*?ProcessStartedAt' -or
    $source -notmatch '(?s)function Rollback-YourHomeInvocation.*?''Emulator''.*?Stop-AcquiredProcess.*?Save-YourHomeProcessState') {
  throw 'Emulator process identity must remain available for rollback until cleanup is verified and state is removed.'
}
$emulatorPersistenceOrder = [regex]::Matches(
  $source,
  '(?m)^\s*Set-AndroidEmulatorState[^\r\n]*\r?\n\s*(?:if \(\$emulatorAcquisition\) \{\s*)?\$emulatorAcquisition\.StatePersisted = \$true'
)
if ($emulatorPersistenceOrder.Count -ne 2 -or
    $source -match '(?s)\$emulatorAcquisition\.StatePersisted = \$true\s*\r?\n\s*Set-AndroidEmulatorState') {
  throw 'Emulator acquisitions must be marked state-persisted only after the durable state write succeeds.'
}

if ($source -notmatch 'Pre-ADB emulator rollback self-test PASS') {
  throw 'Launcher self-test must exercise exact-process rollback before ADB identity exists.'
}

if ($source -notmatch '(?s)function Start-YourHomeTerminal.*?try \{.*?Save-YourHomeProcessState.*?catch \{.*?Stop-AcquiredProcess') {
  throw 'Terminal acquisition must stop its exact process when identity validation or state persistence fails.'
}
if ($source -match '(?s)function Start-AcquiredEmulatorProcess.*?catch \{.*?finally \{ \[void\]\$acquisitionLedger\.Remove\(\$acquisition\)' -or
    $source -match '(?s)function Start-YourHomeTerminal.*?catch \{.*?finally \{.*?\[void\]\$acquisitionLedger\.Remove\(\$acquisition\)') {
  throw 'Failed local acquisition cleanup must retain its ledger identity so outer rollback can retry.'
}
if ($source -notmatch '(?s)function Start-AcquiredEmulatorProcess.*?catch \{.*?Stop-AcquiredProcess.*?\$acquisitionLedger\.Remove' -or
    $source -notmatch '(?s)function Start-YourHomeTerminal.*?catch \{.*?Stop-AcquiredProcess.*?\$acquisitionLedger\.Remove') {
  throw 'Acquisition helpers may remove ledger identities only after exact local cleanup succeeds.'
}

if ($source -notmatch 'Terminal acquisition rollback self-test PASS') {
  throw 'Launcher self-test must exercise terminal cleanup after state persistence fails.'
}
if ($source -notmatch 'Exact process-tree rollback self-test PASS' -or
    $source -notmatch 'PostgreSQL unavailable-ownership self-test PASS') {
  throw 'Launcher self-test must exercise descendant cleanup and fail-closed PostgreSQL ownership probing.'
}
if ($source -notmatch 'YOURHOME_TEST_FAIL_TERMINAL_START_TIME' -or $source -notmatch 'Terminal pre-identity rollback self-test PASS') {
  throw 'Launcher self-test must exercise process-tree cleanup before terminal start-time capture.'
}
if ($source -notmatch 'YOURHOME_TEST_FAIL_BEFORE_PROCESS_TREE_TERMINATION') {
  throw 'Launcher self-test must exercise durable descendant persistence before a failed termination attempt.'
}

if ($source -notmatch 'function Get-PostgresContainerStatus' -or
    $source -notmatch '(?s)function Get-PostgresContainerStatus.*?''Running''.*?''Stopped''.*?''Unavailable''') {
  throw 'Launcher must distinguish running, stopped, and unavailable PostgreSQL ownership probes.'
}

if ($source -notmatch '(?s)\$postgresStatus = Get-PostgresContainerStatus.*?if \(\$postgresStatus -eq ''Unavailable''\).*?throw.*?if \(\$postgresStatus -eq ''Stopped''\).*?\$acquisitionsThisRun\.Add.*?Kind = ''Postgres''.*?docker compose.*?up -d') {
  throw 'Launcher must fail closed on unavailable PostgreSQL ownership and acquire only a verified-stopped container.'
}

if ($source -notmatch '(?s)function Rollback-YourHomeInvocation.*?''Postgres''.*?docker compose.*?stop postgres.*?Get-PostgresContainerStatus') {
  throw 'Startup rollback must stop and verify PostgreSQL through its invocation-owned ledger entry.'
}

if ($source -notmatch 'function Get-AndroidAvdProcesses' -or
    $source -notmatch 'An Android emulator process for.*is already present but unavailable through ADB' -or
    $source -notmatch '(?s)Wait-Until.*?Find-AndroidSerialByAvd.*?Test-RecordedProcess \$emulatorProcessId \$emulatorProcessStartedAt') {
  throw 'Launcher must fence offline/reused AVD processes and prove the acquired emulator process survived registration.'
}

if ($source -notmatch 'function Get-RecordedProcessTree' -or
    $source -notmatch 'function Stop-RecordedProcessTree' -or
    $source -notmatch '(?s)function Stop-RecordedProcessTree.*?taskkill\.exe.*?foreach.*?Test-RecordedProcess.*?throw') {
  throw 'Windows cleanup must snapshot and verify every exact PID/start-time identity in the owned process tree.'
}

if ($source -notmatch '(?s)function Set-AndroidEmulatorState.*?ProcessTree' -or
    $source -notmatch '(?s)function Rollback-YourHomeInvocation.*?''Emulator''.*?Stop-AcquiredProcess' -or
    $source -notmatch '(?s)function Stop-AcquiredProcess.*?ProcessTree.*?Stop-RecordedProcessTree') {
  throw 'Launcher-owned emulator state and rollback must retain and verify its exact process tree.'
}

if ($source -notmatch '\$androidInputFingerprintBeforeBuild' -or
    $source -notmatch '(?s)\$androidInputFingerprintAfterBuild.*?-ne \$androidInputFingerprintBeforeBuild.*?throw') {
  throw 'Android installation must reject native inputs that change between pre-build fingerprinting and post-install recording.'
}

if ($source -notmatch 'YOURHOME_TEST_FAIL_AFTER_POSTGRES_START') {
  throw 'Launcher must expose a deterministic post-PostgreSQL failure point for rollback verification.'
}

if ($source -notmatch '(?s)\$launchAsset -notmatch.*?Invoke-WebRequest -Uri \$launchAsset.*?StatusCode -eq 200.*?launchContentType.*?launchContentLength -gt 0') {
  throw 'iOS tunnel readiness must fetch and validate the exact manifest launch asset.'
}

if ($source -notmatch '(?s)\$workspaceModuleAllowlist = @\(.*?apps\\mobile\\node_modules.*?apps\\api\\node_modules.*?apps\\reviewer-web\\node_modules.*?Stop-YourHomeRole ''YourHome API''.*?Stop-YourHomeRole ''YourHome Android Dev Client''.*?Stop-YourHomeRole ''YourHome iOS QR \+ Web''.*?foreach \(\$workspaceModules in \$workspaceModuleAllowlist\).*?Remove-Item') {
  throw 'Launcher must stop all owned dependency consumers before repairing generated workspace node_modules.'
}

if ($source -notmatch '(?s)Stop-YourHomeRole ''YourHome API''.*?Stop-YourHomeRole ''YourHome Android Dev Client''.*?Stop-YourHomeRole ''YourHome iOS QR \+ Web''.*?& pnpm @installArgs') {
  throw 'Launcher must stop every owned dependency consumer before every pnpm install.'
}

if ($source -notmatch '(?s)function Stop-RecordedProcessTree.*?taskkill\.exe.*?\$remaining = @\(\$owned \| Where-Object \{ Test-RecordedProcess.*?throw') {
  throw 'Launcher must verify every captured PID/start-time identity after process-tree termination.'
}
if ($source -notmatch '(?s)function Persist-AcquiredProcessTree.*?Save-YourHomeProcessState' -or
    $source -notmatch '(?s)function Stop-AcquiredProcess.*?Persist-AcquiredProcessTree.*?Stop-RecordedProcessTree') {
  throw 'Launcher rollback must durably persist freshly discovered descendants before attempting exact-tree termination.'
}
if ($source -notmatch '(?s)function Stop-YourHomeRole.*?Merge-RecordedProcessTrees.*?ProcessTree.*?Save-YourHomeProcessState.*?Stop-RecordedProcess') {
  throw 'Launcher stale-role cleanup must persist its merged listener and terminal identities before any termination attempt.'
}

if ($source -match 'Remove-Item -LiteralPath \$normalizedWorkspaceModules[^\r\n]*ErrorAction SilentlyContinue') {
  throw 'Generated workspace dependency removal must fail closed instead of suppressing errors.'
}

if ($source -notmatch 'Refusing dependency cleanup outside the fixed workspace allowlist') {
  throw 'Generated dependency cleanup must validate each target against a fixed allowlist.'
}
if ($source -notmatch 'function Assert-NoReparsePointInPath' -or
    $source -notmatch '(?s)function Assert-NoReparsePointInPath.*?ReparsePoint.*?throw' -or
    $source -notmatch '(?s)foreach \(\$workspaceModules in \$workspaceModuleAllowlist\).*?Assert-NoReparsePointInPath.*?Remove-Item') {
  throw 'Generated dependency cleanup must reject reparse-point targets or ancestors before recursive deletion.'
}

if ($source -notmatch '(?s)& node \$topologyTest.*?& pnpm @installArgs.*?& node \$topologyTest') {
  throw 'Launcher must probe dependency topology before install and assert it again after install.'
}

$topologyOutput = & node $topologyTest 2>&1 | Out-String
if ($LASTEXITCODE -ne 0 -or $topologyOutput -notmatch 'workspace-topology-test.*PASS') {
  throw "Workspace dependency topology probe failed:`n$topologyOutput"
}

if ($source -match [regex]::Escape('C:\.pnpm\yourhome')) {
  throw 'Launcher must not use the external pnpm virtual store that breaks Expo module resolution.'
}

if ($source -match 'pnpm --filter mobile exec expo start') {
  throw 'Launcher must invoke Expo directly from Y:\apps\mobile to avoid mixed C:/Y: Metro paths.'
}

if ($source -notmatch '(?s)Start-YourHomeTerminal ''YourHome iOS QR \+ Web''.*?\$physicalMobile') {
  throw 'The iOS Expo tunnel must use the physical mobile working directory to avoid the ngrok Y: path failure.'
}

if ($source -notmatch "(?s)Start-YourHomeTerminal 'YourHome iOS QR \+ Web'.*?start --dev-client --tunnel --port 8082") {
  throw 'The iOS tunnel must target the installed YourHome development client.'
}

if ($source -notmatch "(?s)Start-YourHomeTerminal 'YourHome Android Dev Client'.*?Remove-Item Env:YOURHOME_EXPO_GO -ErrorAction SilentlyContinue.*?start --dev-client --host lan --port 8081") {
  throw 'The Android development-client terminal must clear any ambient Expo Go mode.'
}

if ($source -notmatch "(?s)Start-YourHomeTerminal 'YourHome iOS QR \+ Web'.*?Remove-Item Env:YOURHOME_EXPO_GO -ErrorAction SilentlyContinue.*?start --dev-client --tunnel --port 8082") {
  throw 'The iOS development-client terminal must clear any ambient Expo Go mode.'
}

if ($source -match '(?s)Start-YourHomeTerminal ''YourHome iOS QR \+ Web''.*?YOURHOME_EXPO_GO\s*=\s*[''"]?1[''"]?.*?--port 8082') {
  throw 'The iOS development-client tunnel must retain native EAS runtime configuration instead of activating Expo Go mode.'
}

if ($source -match 'CommandLine -match \$escapedTitle') {
  throw 'Launcher must not identify process ownership from a terminal-title substring.'
}

if ($source -match '\$avds\[0\]') {
  throw 'Launcher must never fall back to an arbitrary first AVD.'
}

if ($source -notmatch '(?s)if \(-not \$Reset\).*?throw.*?-wipe-data') {
  throw 'Wiping the designated AVD must require an explicit reset run.'
}

if ($source -notmatch '(?s)-wipe-data.*?\$startedEmulatorThisRun = \$true.*?Set-AndroidEmulatorState') {
  throw 'A replacement emulator started during an explicit reset must be owned by the current invocation for failure rollback.'
}

if ($source -notmatch '(?s)Set-YourHomeListener.*?Test-DescendantProcess') {
  throw 'Listener ownership must be validated against the launcher terminal process tree.'
}

if ($source -notmatch '(?s)function Stop-YourHomeRole.*?listenerTree.*?Merge-RecordedProcessTrees.*?Save-YourHomeProcessState.*?Stop-RecordedProcessTree') {
  throw 'Launcher must include the recorded listener in the durably persisted exact tree before unified termination.'
}


if ($source -notmatch "(?s)Stop-YourHomeRole 'YourHome API'.*?pnpm --filter api prisma:generate") {
  throw 'The stale API must stop before Prisma regenerates the source client so no owned process uses outdated generated code.'
}

$apiPackage = Get-Content (Join-Path $PSScriptRoot '..\apps\api\package.json') -Raw | ConvertFrom-Json
if ($apiPackage.scripts.dev -notmatch '--env-file=.env') {
  throw 'The API dev command must load apps/api/.env explicitly.'
}
if ($apiPackage.scripts.build -notmatch '^pnpm prisma:generate && tsc') {
  throw 'The API build must generate Prisma before TypeScript compilation.'
}
if ($apiPackage.scripts.'prisma:deploy' -ne 'prisma migrate deploy') {
  throw 'The API prisma:deploy command must apply existing migrations exactly.'
}
if (-not $apiPackage.scripts.'test:prisma' -or -not $apiPackage.scripts.'test:prisma:read') {
  throw 'The API must expose the live Prisma adapter contract.'
}

if ($source -match '& pnpm --filter api test:prisma(?:\s|[''"])') {
  throw 'The launcher must not run the write-capable Prisma contract against the persistent development database.'
}

$composeSource = Get-Content (Join-Path $PSScriptRoot '..\infra\docker-compose.yml') -Raw
if ($composeSource -notmatch 'pg_isready') {
  throw 'PostgreSQL must have a healthcheck before the launcher uses docker compose --wait.'
}

$buildSource = Get-Content (Join-Path $PSScriptRoot 'build-mobile.mjs') -Raw
if ($buildSource -notmatch [regex]::Escape('"--output-dir"') -or $buildSource -notmatch [regex]::Escape('"dist", platform')) {
  throw 'Mobile exports must use separate dist/ios and dist/android output directories.'
}
if (
  -not $buildSource.Contains('let toolRoot = repoRoot;') -or
  -not $buildSource.Contains('toolRoot = `${shortDrive}\\`;') -or
  $buildSource -notmatch 'const expo = path\.join\(\s*toolRoot,'
) {
  throw 'Mobile exports must resolve Expo CLI from the hoisted repository root on every platform.'
}

$androidBuildSource = Get-Content (Join-Path $PSScriptRoot '..\apps\mobile\android\app\build.gradle') -Raw
if ($androidBuildSource -notmatch [regex]::Escape('YOURHOME_PHYSICAL_ROOT')) {
  throw 'Android dependency tools must resolve from one canonical drive root to avoid mixed C:/Y: codegen paths.'
}
$androidSettingsSource = Get-Content (Join-Path $PSScriptRoot '..\apps\mobile\android\settings.gradle') -Raw
if ($androidSettingsSource -notmatch [regex]::Escape('YOURHOME_PHYSICAL_ROOT')) {
  throw 'Android Gradle plugins must resolve from the canonical drive root used by native packages.'
}

$mobilePackage = Get-Content (Join-Path $PSScriptRoot '..\apps\mobile\package.json') -Raw | ConvertFrom-Json
if (-not $mobilePackage.devDependencies.'@expo/ngrok') {
  throw 'Mobile devDependencies must include @expo/ngrok for the iOS Expo tunnel.'
}
if ($mobilePackage.devDependencies.'eas-cli' -ne '21.0.2') {
  throw 'Mobile devDependencies must pin EAS CLI 21.0.2 for reproducible iOS development builds.'
}

$expoGoConfigTest = Join-Path $PSScriptRoot 'expo-go-config-test.cjs'
& node $expoGoConfigTest
if ($LASTEXITCODE -ne 0) {
  throw 'Expo Go must omit the app-specific EAS runtime while native builds retain it.'
}

$workspaceSource = Get-Content (Join-Path $PSScriptRoot '..\pnpm-workspace.yaml') -Raw
$expoCliPatchRegistration = [regex]::Match(
  $workspaceSource,
  "'@expo/cli@[^']+':\s*(?<path>[^\r\n]+)"
)
if (-not $expoCliPatchRegistration.Success) {
  throw 'pnpm-workspace.yaml must register the Expo CLI ngrok retry patch.'
}
$expoCliPatchPath = Join-Path $PSScriptRoot "..\$($expoCliPatchRegistration.Groups['path'].Value.Trim())"
if (-not (Test-Path $expoCliPatchPath)) {
  throw 'The Expo CLI ngrok retry patch is missing.'
}
$expoCliPatch = Get-Content $expoCliPatchPath -Raw
foreach ($patchText in @('const errorBody', 'errorBody.error_code')) {
  if (-not $expoCliPatch.Contains($patchText)) {
    throw "The Expo CLI ngrok retry patch is missing '$patchText'."
  }
}

$expoNgrokPatchPath = Join-Path $PSScriptRoot '..\patches\@expo__ngrok@4.1.3.patch'
if (-not (Test-Path $expoNgrokPatchPath)) {
  throw 'The @expo/ngrok missing-response patch is missing.'
}
$expoNgrokPatch = Get-Content $expoNgrokPatchPath -Raw
foreach ($patchText in @('function createClientError', 'error && error.response', '{ msg: message }')) {
  if (-not $expoNgrokPatch.Contains($patchText)) {
    throw "The @expo/ngrok missing-response patch is missing '$patchText'."
  }
}

Write-Host '[test-run-test] PASS: service plan, restart cleanup, short-path safeguards, and iOS development-client tunnel are present.'
