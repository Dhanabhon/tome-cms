$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RootDir = Split-Path -Parent $PSScriptRoot
foreach ($CommandName in @('node', 'npm.cmd', 'docker')) {
    if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
        throw "Missing '$CommandName'. Install it and run this command again."
    }
}

& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is not running.' }

Push-Location $RootDir
try {
    if (-not (Test-Path 'node_modules/astro/package.json')) {
        & npm.cmd ci
        if ($LASTEXITCODE -ne 0) { throw 'npm dependency installation failed.' }
    }
    & node scripts/bootstrap-core.mjs @args
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & npm.cmd run dev
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
