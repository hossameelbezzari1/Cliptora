$ErrorActionPreference='Stop'
$front=Join-Path $PSScriptRoot 'start-frontend.ps1'
$back=Join-Path $PSScriptRoot 'start-backend.ps1'
Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoExit','-ExecutionPolicy','Bypass','-File',('"'+$back+'"'))
Start-Sleep -Seconds 2
Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoExit','-ExecutionPolicy','Bypass','-File',('"'+$front+'"'))
Write-Host 'Backend and Vite frontend launched in separate PowerShell windows.' -ForegroundColor Green
Write-Host 'Open the Local or Network URL printed by Vite. Dynamic port is supported.'
