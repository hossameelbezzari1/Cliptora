$ErrorActionPreference='Stop'
$back=(Resolve-Path (Join-Path $PSScriptRoot '..\backend')).Path
$py=Join-Path $back '.venv\Scripts\python.exe'
if(-not (Test-Path $py)){throw 'Run scripts\install.ps1 first.'}
Push-Location $back
try{& $py -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000;if($LASTEXITCODE -ne 0){throw 'Backend exited with an error.'}}finally{Pop-Location}
