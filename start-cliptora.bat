
@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title CLIPTORA - React + FastAPI + Scheduler
set "CLIPTORA_LAUNCHER=%~f0"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command ^
  "$source = [System.IO.File]::ReadAllText($env:CLIPTORA_LAUNCHER); $marker = 'REM ==== CLIPTORA POWERSHELL ===='; $offset = $source.LastIndexOf($marker); if ($offset -lt 0) { throw 'Launcher content is incomplete.' }; & ([ScriptBlock]::Create($source.Substring($offset + $marker.Length)))"

set "RESULT=%ERRORLEVEL%"

if not "%RESULT%"=="0" (
    echo.
    echo CLIPTORA stopped with an error.
    echo Review the messages above.
    pause
)

exit /b %RESULT%


REM ==== CLIPTORA POWERSHELL ====

$ErrorActionPreference = 'Stop'

# =====================================================
# CONFIGURATION
# =====================================================

$root = Split-Path -Parent $env:CLIPTORA_LAUNCHER
$backendDir = Join-Path $root 'backend'
$frontendDir = Join-Path $root 'frontend'

$vite = Join-Path $frontendDir 'node_modules\vite\bin\vite.js'

$backendPort = 8000
$frontendPort = 5173

$backendProcess = $null
$frontendProcess = $null
$schedulerProcess = $null
$python = $null
$exitCode = 0

# =====================================================
# HELPERS
# =====================================================

function Step {
    param([string]$Message)

    Write-Host ''
    Write-Host ">> $Message" -ForegroundColor Cyan
}

function Success {
    param([string]$Message)

    Write-Host "[OK] $Message" -ForegroundColor Green
}

function Require-File {
    param(
        [string]$Path,
        [string]$Description
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Description missing: $Path"
    }
}

function Test-Port {
    param([int]$Port)

    $listener = Get-NetTCPConnection `
        -LocalPort $Port `
        -State Listen `
        -ErrorAction SilentlyContinue

    return $null -ne $listener
}

function Check-Process {
    param(
        [string]$Name,
        [System.Diagnostics.Process]$Process
    )

    if ($null -eq $Process) {
        throw "$Name process was not created."
    }

    $Process.Refresh()

    if ($Process.HasExited) {
        throw "$Name stopped. Exit code: $($Process.ExitCode)"
    }
}

function Stop-ProcessTree {
    param(
        [string]$Name,
        [System.Diagnostics.Process]$Process
    )

    if ($null -eq $Process) {
        return
    }

    try {
        $Process.Refresh()

        if (-not $Process.HasExited) {
            Write-Host "Stopping $Name..." -ForegroundColor Yellow

            $taskkill = Join-Path $env:SystemRoot 'System32\taskkill.exe'

            & $taskkill /PID $($Process.Id) /T /F 2>&1 | Out-Null
        }
    }
    catch {
        # Process may already be stopped.
    }
}

# =====================================================
# PYTHON AUTO-DETECTION
# =====================================================

function Find-Python {

    $candidates = @(
        @{
            Path = Join-Path $backendDir '.venv\Scripts\python.exe'
            Name = 'backend\.venv'
        },
        @{
            Path = Join-Path $root '.venv\Scripts\python.exe'
            Name = 'project\.venv'
        },
        @{
            Path = Join-Path $backendDir 'venv\Scripts\python.exe'
            Name = 'backend\venv'
        },
        @{
            Path = Join-Path $root 'venv\Scripts\python.exe'
            Name = 'project\venv'
        }
    )

    $systemPython = Get-Command python.exe -ErrorAction SilentlyContinue

    if ($systemPython) {
        $candidates += @{
            Path = $systemPython.Source
            Name = 'Windows Python'
        }
    }

    $pyLauncher = Get-Command py.exe -ErrorAction SilentlyContinue

    if ($pyLauncher) {
        try {
            $pyPath = & $pyLauncher.Source -3 -c 'import sys; print(sys.executable)' 2>$null

            if ($LASTEXITCODE -eq 0 -and $pyPath) {
                $candidates += @{
                    Path = "$pyPath".Trim()
                    Name = 'Python Launcher'
                }
            }
        }
        catch {
        }
    }

    foreach ($candidate in $candidates) {

        if (-not (Test-Path -LiteralPath $candidate.Path -PathType Leaf)) {
            continue
        }

        Write-Host "Checking: $($candidate.Name)" -ForegroundColor DarkGray

        $valid = $false

        Push-Location $backendDir

        try {
            & $candidate.Path -c 'import fastapi, uvicorn' 2>$null | Out-Null
            $valid = $LASTEXITCODE -eq 0
        }
        catch {
            $valid = $false
        }
        finally {
            Pop-Location
        }

        if ($valid) {
            return $candidate
        }
    }

    return $null
}

# =====================================================
# MAIN
# =====================================================

try {

    Write-Host ''
    Write-Host '====================================================' -ForegroundColor Magenta
    Write-Host '                    CLIPTORA                        ' -ForegroundColor Magenta
    Write-Host '           DEVELOPMENT WORKFLOW STUDIO              ' -ForegroundColor Magenta
    Write-Host '====================================================' -ForegroundColor Magenta
    Write-Host ''
    Write-Host 'Mode: Native Windows' -ForegroundColor Green
    Write-Host 'React + FastAPI + MySQL + Schedule Runner'
    Write-Host 'Docker: Disabled' -ForegroundColor Green

    # -------------------------------------------------
    # 1. Validate project
    # -------------------------------------------------

    Step 'Checking project structure...'

    Require-File `
        (Join-Path $backendDir 'app\main.py') `
        'FastAPI main.py'

    Require-File `
        (Join-Path $frontendDir 'package.json') `
        'Frontend package.json'

    Require-File $vite 'Vite'

    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue

    if (-not $nodeCommand) {
        throw 'Node.js not found in PATH.'
    }

    Success 'CLIPTORA project found'
    Success 'Node.js available'
    Success 'Vite available'

    # -------------------------------------------------
    # 2. Detect Python
    # -------------------------------------------------

    Step 'Detecting Python...'

    $detected = Find-Python

    if (-not $detected) {
        throw 'No Python environment containing FastAPI and Uvicorn was found.'
    }

    $python = $detected.Path

    Success "Python found: $($detected.Name)"

    Write-Host "Executable: $python"

    & $python --version

    if ($LASTEXITCODE -ne 0) {
        throw 'Python version check failed.'
    }

    # -------------------------------------------------
    # 3. FFmpeg / FFprobe
    # -------------------------------------------------

    Step 'Checking FFmpeg...'

    $ffmpegBin = 'C:\ffmpeg\bin'

    if (Test-Path (Join-Path $ffmpegBin 'ffprobe.exe')) {
        $env:PATH = "$ffmpegBin;$env:PATH"
    }

    if (Get-Command ffmpeg.exe -ErrorAction SilentlyContinue) {
        Success 'FFmpeg available'
    }
    else {
        Write-Host '[WARNING] FFmpeg not found.' -ForegroundColor Yellow
    }

    if (Get-Command ffprobe.exe -ErrorAction SilentlyContinue) {
        Success 'FFprobe available'
    }
    else {
        Write-Host '[WARNING] FFprobe not found.' -ForegroundColor Yellow
    }

    # -------------------------------------------------
    # 4. Validate scheduler files
    # -------------------------------------------------

    Step 'Checking native Schedule Runner...'

    $scheduleFiles = @(
        'app\workers\ScheduleRunner.py'
        'app\workers\ScheduleRules.py'
        'app\workflows\nodes\Triggers.py'
        'app\workflows\Registry.py'
        'app\workflows\Discovery.py'
    )

    $schedulePaths = @()

    foreach ($file in $scheduleFiles) {

        $path = Join-Path $backendDir $file

        Require-File $path $file

        $schedulePaths += $path

        Success "$file found"
    }

    # -------------------------------------------------
    # 5. Python syntax validation
    # FIX: no multiline Python -c / quoting issues
    # -------------------------------------------------

    Step 'Validating Python scheduler files...'

    Push-Location $backendDir

    try {

        & $python -m py_compile @schedulePaths

        if ($LASTEXITCODE -ne 0) {
            throw 'Scheduler Python syntax validation failed.'
        }

    }
    finally {
        Pop-Location
    }

    Success 'Scheduler Python syntax verified'

    # -------------------------------------------------
    # 6. Check ports
    # -------------------------------------------------

    Step 'Checking server ports...'

    if (Test-Port $backendPort) {
        throw "Port $backendPort is already in use. Stop the existing FastAPI process."
    }

    if (Test-Port $frontendPort) {
        throw "Port $frontendPort is already in use. Stop the existing Vite process."
    }

    Success "Backend port $backendPort available"
    Success "Frontend port $frontendPort available"

    # -------------------------------------------------
    # 7. Check existing scheduler
    # -------------------------------------------------

    Step 'Checking existing Schedule Runner...'

    $existingSchedulers = @(
        Get-CimInstance Win32_Process `
            -Filter "Name = 'python.exe' OR Name = 'pythonw.exe'" `
            -ErrorAction SilentlyContinue |
        Where-Object {
            $_.CommandLine -match 'app\.workers\.ScheduleRunner'
        }
    )

    if ($existingSchedulers.Count -gt 0) {
        throw 'A Schedule Runner is already active. Stop it before launching CLIPTORA.'
    }

    Success 'No duplicate Schedule Runner detected'

    # -------------------------------------------------
    # 8. Start FastAPI
    # -------------------------------------------------

    Step 'Starting FastAPI...'

    $backendArguments = @(
        '-m'
        'uvicorn'
        'app.main:app'
        '--reload'
        '--host'
        '127.0.0.1'
        '--port'
        "$backendPort"
    )

    $backendProcess = Start-Process `
        -FilePath $python `
        -ArgumentList $backendArguments `
        -WorkingDirectory $backendDir `
        -NoNewWindow `
        -PassThru

    Start-Sleep -Seconds 2

    Check-Process 'FastAPI' $backendProcess

    Success "FastAPI started. PID: $($backendProcess.Id)"

    # -------------------------------------------------
    # 9. Start React / Vite
    # -------------------------------------------------

    Step 'Starting React / Vite...'

    $viteArguments = "`"$vite`" --host 0.0.0.0 --port $frontendPort --strictPort"

    $frontendProcess = Start-Process `
        -FilePath $nodeCommand.Source `
        -ArgumentList $viteArguments `
        -WorkingDirectory $frontendDir `
        -NoNewWindow `
        -PassThru

    Start-Sleep -Seconds 2

    Check-Process 'React / Vite' $frontendProcess

    Success "React started. PID: $($frontendProcess.Id)"

    # -------------------------------------------------
    # 10. Start Native Schedule Runner
    # -------------------------------------------------

    Step 'Starting native Schedule Runner...'

    $schedulerArguments = @(
        '-u'
        '-m'
        'app.workers.ScheduleRunner'
    )

    $schedulerProcess = Start-Process `
        -FilePath $python `
        -ArgumentList $schedulerArguments `
        -WorkingDirectory $backendDir `
        -NoNewWindow `
        -PassThru

    Start-Sleep -Seconds 2

    Check-Process 'Schedule Runner' $schedulerProcess

    Success "Schedule Runner started. PID: $($schedulerProcess.Id)"

    # -------------------------------------------------
    # 11. Summary
    # -------------------------------------------------

    Write-Host ''
    Write-Host '====================================================' -ForegroundColor Green
    Write-Host '                  CLIPTORA RUNNING                  ' -ForegroundColor Green
    Write-Host '====================================================' -ForegroundColor Green
    Write-Host ''

    Write-Host "Python: $python"
    Write-Host ''
    Write-Host 'FastAPI:'
    Write-Host '  http://127.0.0.1:8000/docs'
    Write-Host ''

    Write-Host 'React:'
    Write-Host '  http://localhost:5173'
    Write-Host ''

    Write-Host 'Scheduler:'
    Write-Host '  app.workers.ScheduleRunner'
    Write-Host ''

    Write-Host "Backend PID:   $($backendProcess.Id)"
    Write-Host "Frontend PID:  $($frontendProcess.Id)"
    Write-Host "Scheduler PID: $($schedulerProcess.Id)"
    Write-Host ''

    Write-Host 'MySQL: Start it from XAMPP.' -ForegroundColor Yellow
    Write-Host ''
    Write-Host 'Press Ctrl+C to stop CLIPTORA.' -ForegroundColor Cyan

    # -------------------------------------------------
    # 12. Monitor processes
    # -------------------------------------------------

    while ($true) {

        Start-Sleep -Milliseconds 500

        Check-Process 'FastAPI' $backendProcess
        Check-Process 'React / Vite' $frontendProcess
        Check-Process 'Schedule Runner' $schedulerProcess
    }

}
catch {

    $exitCode = 1

    Write-Host ''
    Write-Host '====================================================' -ForegroundColor Red
    Write-Host '                    STARTUP ERROR                   ' -ForegroundColor Red
    Write-Host '====================================================' -ForegroundColor Red
    Write-Host ''
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ''

}
finally {

    Write-Host ''
    Write-Host 'Stopping CLIPTORA processes...' -ForegroundColor Yellow

    Stop-ProcessTree `
        -Name 'Schedule Runner' `
        -Process $schedulerProcess

    Stop-ProcessTree `
        -Name 'React' `
        -Process $frontendProcess

    Stop-ProcessTree `
        -Name 'FastAPI' `
        -Process $backendProcess

    Write-Host ''
    Write-Host 'CLIPTORA shutdown completed.' -ForegroundColor Green
}

if ($exitCode -ne 0) {
    exit $exitCode
}
