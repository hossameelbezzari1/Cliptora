$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$python = Join-Path $root 'backend\.venv\Scripts\python.exe'
$backend = Join-Path $root 'backend'
if (-not (Test-Path -LiteralPath $python)) { throw 'Python venv not found. Expected backend\.venv\Scripts\python.exe.' }
if (-not (Test-Path -LiteralPath (Join-Path $backend 'app\migrate_editor.py'))) { throw 'Missing backend\app\migrate_editor.py.' }
Push-Location $backend
try {
    Write-Host 'Checking/upgrading existing Cliptora timeline schema...' -ForegroundColor Cyan
    & $python -m app.migrate_editor
    if ($LASTEXITCODE -ne 0) { throw 'Timeline schema upgrade failed. Check XAMPP MySQL and backend\.env.' }
} finally { Pop-Location }
Write-Host 'Timeline database columns checked. Restart FastAPI now.' -ForegroundColor Green
Write-Host 'Your .git and existing rows were not changed by this script.'
