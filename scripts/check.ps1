$ErrorActionPreference='Stop'
$front=(Resolve-Path (Join-Path $PSScriptRoot '..\frontend')).Path
$back=(Resolve-Path (Join-Path $PSScriptRoot '..\backend')).Path
Push-Location $front
try{& npm run build;if($LASTEXITCODE -ne 0){throw 'Frontend build failed.'}}finally{Pop-Location}
$py=Join-Path $back '.venv\Scripts\python.exe'
if(-not (Test-Path $py)){throw 'Run scripts\install.ps1 first.'}
Push-Location $back
try{& $py -m compileall -q app;if($LASTEXITCODE -ne 0){throw 'Backend syntax error.'}}finally{Pop-Location}
Write-Host 'Basic checks passed.' -ForegroundColor Green
