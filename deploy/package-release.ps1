$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$outputDirectory = Join-Path $root 'reports/releases'
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$archive = Join-Path $outputDirectory "nau-ai-vps-$stamp.tar.gz"

$excludes = @(
  '--exclude=./.env',
  '--exclude=./.git',
  '--exclude=./node_modules',
  '--exclude=./.data',
  '--exclude=./reports',
  '--exclude=./test-results',
  '--exclude=./playwright-report',
  '--exclude=./backups',
  '--exclude=**/.next',
  '--exclude=**/dist',
  '--exclude=**/*.tsbuildinfo',
  '--exclude=**/*.log'
)

& tar '-czf' $archive @excludes '-C' $root '.'
if ($LASTEXITCODE -ne 0) {
  throw 'Could not create the VPS release archive.'
}

$entries = & tar '-tzf' $archive
if ($LASTEXITCODE -ne 0) {
  Remove-Item -LiteralPath $archive -Force
  throw 'Could not inspect the VPS release archive.'
}
$forbidden = $entries | Where-Object {
  $_ -eq './.env' -or
  $_ -match '(^|/)(node_modules|\.data|\.git|reports|backups)(/|$)' -or
  $_ -match '(^|/)(\.next|dist)(/|$)'
}
if ($forbidden) {
  Remove-Item -LiteralPath $archive -Force
  throw "Release archive contains a forbidden path: $($forbidden[0])"
}

$hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
$size = (Get-Item -LiteralPath $archive).Length
Write-Output "Archive: $archive"
Write-Output "Bytes: $size"
Write-Output "SHA256: $hash"
