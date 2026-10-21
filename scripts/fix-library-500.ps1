$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$backend = Join-Path $root 'backend'
$python = Join-Path $backend '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) {
    throw 'Backend Python environment not found. Check backend\.venv and your existing installation.'
}
Push-Location $backend
try {
    & $python -m app.repair_library
    if ($LASTEXITCODE -ne 0) { throw 'Library check failed: read the detailed Python traceback above.' }
} finally { Pop-Location }
Write-Host 'My Library schema verified. No existing data deleted.' -ForegroundColor Green
