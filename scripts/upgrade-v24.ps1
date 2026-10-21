$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$python = Join-Path $root 'backend\.venv\Scripts\python.exe'
if (!(Test-Path $python)) { throw 'Missing backend venv. Run scripts\install.ps1 first.' }
Push-Location (Join-Path $root 'backend')
try {
    & $python -m app.migrate_editor
    if ($LASTEXITCODE -ne 0) { throw 'Schema migration failed. Check MySQL is running and backend/.env settings.' }
} finally { Pop-Location }
Write-Host 'Migration complete. No Git operations and no data deletion.' -ForegroundColor Green
