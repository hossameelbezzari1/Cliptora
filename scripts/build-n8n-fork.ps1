param(
    [switch]$NoCache
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $projectRoot 'docker-compose.n8n.yml'

Push-Location $projectRoot
try {
    $arguments = @('compose', '-f', $composeFile, 'build')
    if ($NoCache) {
        $arguments += '--no-cache'
    }
    $arguments += 'n8n'

    & docker @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "The CLIPTORA n8n fork build failed with exit code $LASTEXITCODE."
    }

    & docker compose -f $composeFile up -d --force-recreate n8n
    if ($LASTEXITCODE -ne 0) {
        throw "The CLIPTORA n8n fork could not be started (exit code $LASTEXITCODE)."
    }

    & docker compose -f $composeFile ps n8n
}
finally {
    Pop-Location
}
