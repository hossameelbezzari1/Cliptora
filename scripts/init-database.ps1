$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$backend = Join-Path $root 'backend'
$python = Join-Path $backend '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) {
    throw 'Python environment not found. Run scripts\install.ps1 first.'
}
if (-not (Test-Path (Join-Path $backend '.env'))) {
    throw 'backend/.env is missing. Run scripts\install.ps1 first.'
}
Push-Location $backend
try {
    & $python -m app.init_db
    if ($LASTEXITCODE -ne 0) {
        throw 'MySQL database initialization failed. Verify XAMPP MySQL is running and backend/.env credentials.'
    }
}
finally {
    Pop-Location
}
Write-Host 'Cliptora MySQL database initialized. No Git commands were executed.' -ForegroundColor Green
