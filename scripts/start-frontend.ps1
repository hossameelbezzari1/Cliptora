$ErrorActionPreference='Stop'
$front=(Resolve-Path (Join-Path $PSScriptRoot '..\frontend')).Path
Push-Location $front
try{if(-not (Test-Path 'node_modules')){throw 'Run scripts\install.ps1 first.'};& npm run dev;if($LASTEXITCODE -ne 0){throw 'Vite server exited with an error.'}}finally{Pop-Location}
