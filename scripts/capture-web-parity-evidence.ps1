$ErrorActionPreference = "Stop"

$root = Resolve-Path "$PSScriptRoot\.."
$outDir = Join-Path $root "evidence\m49\web"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

Write-Host "Building reviewer-web..." -ForegroundColor Cyan
pnpm --filter reviewer-web build

$previewCmd = "pnpm --filter reviewer-web exec vite preview --host 127.0.0.1 --port 4173"
Write-Host "Starting preview server: $previewCmd" -ForegroundColor Cyan
$preview = Start-Process -FilePath "powershell" -ArgumentList "-NoProfile", "-Command", $previewCmd -PassThru -WindowStyle Hidden

try {
  Start-Sleep -Seconds 4

  $edgeCandidates = @(
    "$Env:ProgramFiles (x86)\Microsoft\Edge\Application\msedge.exe",
    "$Env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
  )
  $edge = $edgeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $edge) {
    throw "msedge.exe not found. Install Microsoft Edge to use screenshot automation."
  }

  $url = "http://127.0.0.1:4173"
  $shot = Join-Path $outDir "reviewer-login.png"

  Write-Host "Capturing screenshot: $shot" -ForegroundColor Cyan
  & $edge --headless --disable-gpu --window-size=1440,900 --screenshot="$shot" $url | Out-Null

  if (-not (Test-Path $shot)) {
    throw "Screenshot capture failed: $shot"
  }

  Write-Host "Web parity screenshot captured." -ForegroundColor Green
}
finally {
  if ($preview -and -not $preview.HasExited) {
    Stop-Process -Id $preview.Id -Force
  }
}
