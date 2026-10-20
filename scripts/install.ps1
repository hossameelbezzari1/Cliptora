param([switch]$SkipDatabase)
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$front=Join-Path $root 'frontend'
$back=Join-Path $root 'backend'
if(-not (Test-Path (Join-Path $front 'package.json')) -or -not (Test-Path (Join-Path $back 'requirements.txt'))){throw 'Invalid project layout.'}
Write-Host 'CLIPTORA 2 - installing frontend and backend. Git and existing data are never reset.' -ForegroundColor Cyan
$frontendEnv=Join-Path $front '.env'
if(-not (Test-Path $frontendEnv)){Copy-Item (Join-Path $front '.env.example') $frontendEnv;Write-Host 'Created frontend/.env from example.'}
$backendEnv=Join-Path $back '.env'
if(-not (Test-Path $backendEnv)){Copy-Item (Join-Path $back '.env.example') $backendEnv;Write-Host 'Created backend/.env from example.'}
Push-Location $front
try{& npm install;if($LASTEXITCODE -ne 0){throw 'npm install failed.'}}finally{Pop-Location}
$py=Join-Path $back '.venv\Scripts\python.exe'
if(-not (Test-Path $py)){& py -m venv (Join-Path $back '.venv');if($LASTEXITCODE -ne 0){throw 'Python venv creation failed.'}}
Push-Location $back
try{& $py -m pip install -r requirements.txt;if($LASTEXITCODE -ne 0){throw 'pip install failed.'}
 if(-not $SkipDatabase){Write-Host 'Initializing MySQL Cliptora database. Start MySQL in XAMPP first.' -ForegroundColor Yellow;& $py -m app.init_db;if($LASTEXITCODE -ne 0){throw 'Database setup failed. Check MySQL is running and backend/.env credentials.'}}
}finally{Pop-Location}
Write-Host 'Install complete. Run scripts\start-all.ps1' -ForegroundColor Green
