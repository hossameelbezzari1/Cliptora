param(
    [switch]$Build
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $projectRoot 'docker-compose.yml'
$envFile = Join-Path $projectRoot '.env.docker'
$envExample = Join-Path $projectRoot '.env.docker.example'

if (-not (Test-Path -LiteralPath $envFile)) {
    Copy-Item -LiteralPath $envExample -Destination $envFile
}

$dockerEnv = Get-Content -LiteralPath $envFile -Raw
if ($dockerEnv -notmatch '(?m)^CLIPTORA_N8N_SSO_SECRET=.+$') {
    $secretBytes = New-Object byte[] 48
    $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $random.GetBytes($secretBytes)
    }
    finally {
        $random.Dispose()
    }
    $ssoSecret = [Convert]::ToBase64String($secretBytes)
    Add-Content -LiteralPath $envFile -Value "`nCLIPTORA_N8N_SSO_SECRET=$ssoSecret"
}

Push-Location $projectRoot
try {
    # Replace only CLIPTORA development servers started from this checkout.
    # This lets Docker own the public ports without terminating unrelated apps.
    foreach ($port in 5173, 8000) {
        $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        foreach ($listener in $listeners) {
            $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
            if ($process.CommandLine -and $process.CommandLine.Contains($projectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
                Write-Host "Stopping the old CLIPTORA process on port $port..."
                Stop-Process -Id $listener.OwningProcess -Force
            }
        }
    }

    $baseArgs = @('compose', '--env-file', $envFile, '-f', $composeFile)
    & docker @baseArgs up -d mysql
    if ($LASTEXITCODE -ne 0) { throw 'Could not start the CLIPTORA MySQL container.' }

    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        & docker @baseArgs exec -T mysql sh -c 'mysqladmin ping -h 127.0.0.1 -uroot -p"$MYSQL_ROOT_PASSWORD" --silent' 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Seconds 2
    }
    if (-not $ready) { throw 'MySQL did not become ready.' }

    $projectCount = & docker @baseArgs exec -T mysql sh -c 'mysql -N -uroot -p"$MYSQL_ROOT_PASSWORD" -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=\"cliptora_v2\";"'
    $xamppDump = 'C:\xampp\mysql\bin\mysqldump.exe'
    if ([int]$projectCount -eq 0 -and (Test-Path -LiteralPath $xamppDump)) {
        Write-Host 'Importing the existing XAMPP cliptora_v2 database into Docker...'
        & $xamppDump -u root --single-transaction --routines --triggers --databases cliptora_v2 |
            & docker @baseArgs exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD"'
        if ($LASTEXITCODE -ne 0) { throw 'The XAMPP database import failed.' }
    }

    $upArgs = $baseArgs + @('up', '-d')
    if ($Build) { $upArgs += '--build' }
    & docker @upArgs
    if ($LASTEXITCODE -ne 0) { throw 'The CLIPTORA Docker stack failed to start.' }
    & docker @baseArgs ps
}
finally {
    Pop-Location
}
