[CmdletBinding()]
param(
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$portableRepository = $repository.Replace('\', '/')
$wslRepository = (& wsl wslpath -a $portableRepository)
if ($wslRepository) {
    $wslRepository = $wslRepository.Trim()
}
if ($LASTEXITCODE -ne 0 -or -not $wslRepository) {
    throw 'Could not map the repository path into WSL.'
}

$cleanCommand = if ($Clean) { 'pebble clean && ' } else { '' }
$command = @"
set -e
command -v pebble >/dev/null || { echo 'Pebble CLI is not installed in WSL.' >&2; exit 127; }
cd '$wslRepository'
${cleanCommand}pebble build
"@

& wsl bash -lc $command
if ($LASTEXITCODE -ne 0) {
    throw "Pebble build failed with exit code $LASTEXITCODE."
}

Write-Host "Built $repository\build\rain-radar.pbw"
