
@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title CLIPTORA - Auto Restart Development Launcher

set "CLIPTORA_LAUNCHER=%~f0"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command ^
  "$source = [System.IO.File]::ReadAllText($env:CLIPTORA_LAUNCHER); $marker = 'REM ==== CLIPTORA POWERSHELL ===='; $offset = $source.LastIndexOf($marker); if ($offset -lt 0) { throw 'Launcher content is incomplete.' }; & ([ScriptBlock]::Create($source.Substring($offset + $marker.Length)))"

set "RESULT=%ERRORLEVEL%"

if not "%RESULT%"=="0" (
    echo.
    echo CLIPTORA launcher stopped with an error.
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

$restartDelaySeconds = 3
$maxRestarts = 10
$restartWindowSeconds = 120
$monitorIntervalMs = 1000

$python = $null
$nodeExecutable = $null

$exitCode = 0

$services = @{
    Backend = @{
        Name = 'FastAPI'
        Process = $null
        Restarts = [System.Collections.ArrayList]::new()
    }

    Frontend = @{
        Name = 'React / Vite'
        Process = $null
        Restarts = [System.Collections.ArrayList]::new()
    }

    Scheduler = @{
        Name = 'Schedule Runner'
        Process = $null
        Restarts = [System.Collections.ArrayList]::new()
    }
}

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

function Warning {
    param([string]$Message)

    Write-Host "[WARNING] $Message" -ForegroundColor Yellow
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
        catch {}
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
# SERVICE START
# =====================================================

function Start-CLIPTORAService {
    param(
        [ValidateSet('Backend', 'Frontend', 'Scheduler')]
        [string]$Key
    )

    $service = $services[$Key]
    $name = $service.Name

    Step "Starting $name..."

    $filePath = ''
    $arguments = @()
    $workingDirectory = ''

    switch ($Key) {
        'Backend' {
            $filePath = $python
            $workingDirectory = $backendDir

            $arguments = @(
                '-m',
                'uvicorn',
                'app.main:app',
                '--reload',
                '--host',
                '127.0.0.1',
                '--port',
                "$backendPort"
            )

            if (Test-Port $backendPort) {
                throw "Cannot start FastAPI: port $backendPort is in use."
            }
        }

        'Frontend' {
            $filePath = $nodeExecutable
            $workingDirectory = $frontendDir

            $arguments = @(
                $vite,
                '--host',
                '0.0.0.0',
                '--port',
                "$frontendPort",
                '--strictPort'
            )

            if (Test-Port $frontendPort) {
                throw "Cannot start Vite: port $frontendPort is in use."
            }
        }

        'Scheduler' {
            $filePath = $python
            $workingDirectory = $backendDir

            $arguments = @(
                '-u',
                '-m',
                'app.workers.ScheduleRunner'
            )
        }
    }

    $process = Start-Process `
        -FilePath $filePath `
        -ArgumentList $arguments `
        -WorkingDirectory $workingDirectory `
        -NoNewWindow `
        -PassThru

    $service.Process = $process

    Success "$name started. PID: $($process.Id)"
}

# =====================================================
# AUTOMATIC RESTART
# =====================================================

function Restart-CLIPTORAService {
    param(
        [ValidateSet('Backend', 'Frontend', 'Scheduler')]
        [string]$Key
    )

    $service = $services[$Key]
    $name = $service.Name

    $now = Get-Date

    # Remove restart attempts outside the configured window.
    for ($i = $service.Restarts.Count - 1; $i -ge 0; $i--) {
        $elapsed = ($now - $service.Restarts[$i]).TotalSeconds

        if ($elapsed -gt $restartWindowSeconds) {
            $service.Restarts.RemoveAt($i)
        }
    }

    if ($service.Restarts.Count -ge $maxRestarts) {
        throw "$name crashed $maxRestarts times within $restartWindowSeconds seconds. Automatic restart stopped to prevent a crash loop."
    }

    [void]$service.Restarts.Add($now)

    $attempt = $service.Restarts.Count

    Write-Host ''
    Write-Host '====================================================' -ForegroundColor Yellow
    Write-Host " SERVICE FAILED: $name" -ForegroundColor Red
    Write-Host '====================================================' -ForegroundColor Yellow

    $oldProcess = $service.Process

    if ($null -ne $oldProcess) {
        try {
            $oldProcess.Refresh()

            if ($oldProcess.HasExited) {
                Write-Host "Exit code: $($oldProcess.ExitCode)" -ForegroundColor Yellow
            }
            else {
                Stop-ProcessTree $name $oldProcess
            }
        }
        catch {}
    }

    Write-Host "Restart attempt: $attempt / $maxRestarts"
    Write-Host "Restarting after $restartDelaySeconds seconds..." -ForegroundColor Cyan

    Start-Sleep -Seconds $restartDelaySeconds

    $service.Process = $null

    try {
        Start-CLIPTORAService -Key $Key
        Success "$name restart requested"
    }
    catch {
        Warning "$name restart failed: $($_.Exception.Message)"
        # Keep monitoring; the next attempt will be rate-limited.
    }
}

# =====================================================
# SERVICE MONITOR
# =====================================================

function Monitor-CLIPTORAService {
    param(
        [ValidateSet('Backend', 'Frontend', 'Scheduler')]
        [string]$Key
    )

    $service = $services[$Key]
    $process = $service.Process

    if ($null -eq $process) {
        Restart-CLIPTORAService -Key $Key
        return
    }

    try {
        $process.Refresh()

        if ($process.HasExited) {
            Restart-CLIPTORAService -Key $Key
        }
    }
    catch {
        Restart-CLIPTORAService -Key $Key
    }
}

# =====================================================
# MAIN
# =====================================================

try {
    Write-Host ''
    Write-Host '====================================================' -ForegroundColor Magenta
    Write-Host '                     CLIPTORA                       ' -ForegroundColor Magenta
    Write-Host '           DEVELOPMENT WORKFLOW STUDIO              ' -ForegroundColor Magenta
    Write-Host '====================================================' -ForegroundColor Magenta
    Write-Host ''

    Write-Host 'Mode: Native Windows' -ForegroundColor Green
    Write-Host 'React + FastAPI + MySQL + Schedule Runner'
    Write-Host 'Auto Restart: Enabled' -ForegroundColor Green

    # --------------------------------------------
    # 1. Validate project
    # --------------------------------------------

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

    $nodeExecutable = $nodeCommand.Source

    Success 'Project structure verified'

    # --------------------------------------------
    # 2. Detect Python
    # --------------------------------------------

    Step 'Detecting Python...'

    $detected = Find-Python

    if (-not $detected) {
        throw 'No Python environment containing FastAPI and Uvicorn was found.'
    }

    $python = $detected.Path

    Success "Python found: $($detected.Name)"

    & $python --version

    if ($LASTEXITCODE -ne 0) {
        throw 'Python version check failed.'
    }

    # --------------------------------------------
    # 3. FFmpeg
    # --------------------------------------------

    Step 'Checking FFmpeg...'

    $ffmpegBin = 'C:\ffmpeg\bin'

    if (Test-Path (Join-Path $ffmpegBin 'ffprobe.exe')) {
        $env:PATH = "$ffmpegBin;$env:PATH"
    }

    if (Get-Command ffmpeg.exe -ErrorAction SilentlyContinue) {
        Success 'FFmpeg available'
    }
    else {
        Warning 'FFmpeg not found'
    }

    if (Get-Command ffprobe.exe -ErrorAction SilentlyContinue) {
        Success 'FFprobe available'
    }
    else {
        Warning 'FFprobe not found'
    }

    # --------------------------------------------
    # 4. Scheduler validation
    # --------------------------------------------

    Step 'Checking scheduler files...'

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
    }

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

    Success 'Scheduler syntax verified'

    # --------------------------------------------
    # 5. Port validation
    # --------------------------------------------

    Step 'Checking server ports...'

    if (Test-Port $backendPort) {
        throw "Port $backendPort is already in use."
    }

    if (Test-Port $frontendPort) {
        throw "Port $frontendPort is already in use."
    }

    Success 'Backend and Frontend ports available'

    # --------------------------------------------
    # 6. Duplicate Scheduler check
    # --------------------------------------------

    Step 'Checking duplicate scheduler...'

    $existingSchedulers = @(
        Get-CimInstance Win32_Process `
            -Filter "Name = 'python.exe' OR Name = 'pythonw.exe'" `
            -ErrorAction SilentlyContinue |
        Where-Object {
            $_.CommandLine -match 'app\.workers\.ScheduleRunner'
        }
    )

    if ($existingSchedulers.Count -gt 0) {
        throw 'Another Schedule Runner is already active.'
    }

    Success 'No duplicate scheduler detected'

    # --------------------------------------------
    # 7. Start services
    # --------------------------------------------

    Start-CLIPTORAService -Key 'Backend'
    Start-Sleep -Seconds 2

    Start-CLIPTORAService -Key 'Frontend'
    Start-Sleep -Seconds 2

    Start-CLIPTORAService -Key 'Scheduler'
    Start-Sleep -Seconds 2

    # --------------------------------------------
    # 8. Ready
    # --------------------------------------------

    Write-Host ''
    Write-Host '====================================================' -ForegroundColor Green
    Write-Host '                  CLIPTORA RUNNING                  ' -ForegroundColor Green
    Write-Host '====================================================' -ForegroundColor Green
    Write-Host ''

    Write-Host 'FastAPI: http://127.0.0.1:8000/docs'
    Write-Host 'React:   http://localhost:5173'
    Write-Host 'Scheduler: Active'
    Write-Host ''

    Write-Host 'Automatic recovery is enabled.' -ForegroundColor Green
    Write-Host "Restart delay: $restartDelaySeconds seconds"
    Write-Host "Maximum: $maxRestarts restarts in $restartWindowSeconds seconds"
    Write-Host ''
    Write-Host 'Press Ctrl+C to stop CLIPTORA.' -ForegroundColor Cyan

    # --------------------------------------------
    # 9. Continuous process monitoring
    # --------------------------------------------

    while ($true) {
        Start-Sleep -Milliseconds $monitorIntervalMs

        Monitor-CLIPTORAService -Key 'Backend'
        Monitor-CLIPTORAService -Key 'Frontend'
        Monitor-CLIPTORAService -Key 'Scheduler'
    }
}
catch {
    $exitCode = 1

    Write-Host ''
    Write-Host '====================================================' -ForegroundColor Red
    Write-Host '                    LAUNCHER ERROR                  ' -ForegroundColor Red
    Write-Host '====================================================' -ForegroundColor Red

    Write-Host $_.Exception.Message -ForegroundColor Red
}
finally {
    Write-Host ''
    Write-Host 'Stopping CLIPTORA processes...' -ForegroundColor Yellow

    foreach ($key in @('Scheduler', 'Frontend', 'Backend')) {
        Stop-ProcessTree `
            -Name $services[$key].Name `
            -Process $services[$key].Process
    }

    Write-Host 'CLIPTORA shutdown completed.' -ForegroundColor Green
}

if ($exitCode -ne 0) {
    exit $exitCode
}
