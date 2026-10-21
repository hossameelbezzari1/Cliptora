$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root 'backend'
$python = Join-Path $backend '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) { throw 'Missing backend Python environment. Use the existing Cliptora install first.' }
Push-Location $backend
try {
    & $python -m app.init_db
    if ($LASTEXITCODE -ne 0) { throw 'Database upgrade failed. Review the Python traceback.' }
} finally { Pop-Location }
Write-Host 'Personal Library MySQL tables have been checked/created; old projects and clips were not deleted.' -ForegroundColor Green
