@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title CLIPTORA - React + FastAPI (One Console)
set "CLIPTORA_LAUNCHER=%~f0"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command ^
  "$source = [System.IO.File]::ReadAllText($env:CLIPTORA_LAUNCHER); $marker = 'REM ==== CLIPTORA POWERSHELL ===='; $offset = $source.LastIndexOf($marker); if ($offset -lt 0) { throw 'Launcher content is incomplete.' }; & ([ScriptBlock]::Create($source.Substring($offset + $marker.Length)))"

set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" (
    echo.
    echo The launcher stopped with an error. See the message above.
    pause
)
exit /b %RESULT%

REM ==== CLIPTORA POWERSHELL ====
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $env:CLIPTORA_LAUNCHER
$frontendDirectory = Join-Path $root 'frontend'
$backendDirectory = Join-Path $root 'backend'
$python = Join-Path $backendDirectory '.venv\Scripts\python.exe'
$vite = Join-Path $frontendDirectory 'node_modules\vite\bin\vite.js'

if (-not (Test-Path (Join-Path $backendDirectory 'app\main.py'))) {
    throw 'Missing backend\app\main.py. Put this BAT in the CLIPTORA root folder.'
}
if (-not (Test-Path (Join-Path $frontendDirectory 'package.json'))) {
    throw 'Missing frontend\package.json. Put this BAT in the CLIPTORA root folder.'
}
if (-not (Test-Path $python)) {
    throw 'Python environment is missing. Run scripts\install.ps1 first.'
}
if (-not (Test-Path $vite)) {
    throw 'Vite is not installed. Run npm install in the frontend folder first.'
}
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    throw 'Node.js was not found in PATH.'
}

function Stop-CliptoraProcess {
    param([System.Diagnostics.Process]$Process)
    if ($null -eq $Process) { return }
    try {
        if (-not $Process.HasExited) {
            $taskkill = Join-Path $env:SystemRoot 'System32\taskkill.exe'
            & $taskkill /PID $($Process.Id) /T /F 2>&1 | Out-Null
        }
    } catch {
    }
}

$backendProcess = $null
$frontendProcess = $null
try {
    Write-Host ''
    Write-Host '==============================================' -ForegroundColor Cyan
    Write-Host '       CLIPTORA - ONE CONSOLE LAUNCHER' -ForegroundColor Cyan
    Write-Host '==============================================' -ForegroundColor Cyan
    Write-Host 'Start MySQL in XAMPP before using the app.' -ForegroundColor Yellow
    Write-Host 'Backend: http://127.0.0.1:8000/docs'
    Write-Host 'Frontend: use the Local or Network URL below.'
    Write-Host 'Press Ctrl+C to stop both servers.'
    Write-Host ''

    $backendProcess = Start-Process -FilePath $python -ArgumentList '-m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000' -WorkingDirectory $backendDirectory -NoNewWindow -PassThru
    Start-Sleep -Seconds 2

    if ($backendProcess.HasExited) {
        throw ('FastAPI stopped during startup (exit code {0}). Check the output above.' -f $backendProcess.ExitCode)
    }

    $viteArguments = ('"{0}" --host 0.0.0.0' -f $vite)
    $frontendProcess = Start-Process -FilePath $nodeCommand.Source -ArgumentList $viteArguments -WorkingDirectory $frontendDirectory -NoNewWindow -PassThru

    while (-not $backendProcess.HasExited -and -not $frontendProcess.HasExited) {
        Start-Sleep -Milliseconds 500
    }

    if ($backendProcess.HasExited) {
        throw ('FastAPI stopped (exit code {0}). See the output above.' -f $backendProcess.ExitCode)
    }
    if ($frontendProcess.HasExited) {
        throw ('Vite stopped (exit code {0}). See the output above.' -f $frontendProcess.ExitCode)
    }
}
finally {
    Write-Host ''
    Write-Host 'Stopping CLIPTORA servers...' -ForegroundColor Yellow
    Stop-CliptoraProcess -Process $frontendProcess
    Stop-CliptoraProcess -Process $backendProcess
}
