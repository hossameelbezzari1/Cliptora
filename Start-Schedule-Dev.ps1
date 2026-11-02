# Development-only deployment to an existing cliptora-backend container.
# Does not rebuild images or reset any MySQL volume.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $root
try {
    & (Join-Path $root 'Install-ScheduleTrigger.ps1')
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw 'Installer validation failed.' }

    $container = 'cliptora-backend'
    $state = docker inspect -f '{{.State.Running}}' $container 2>&1
    if ($LASTEXITCODE -ne 0 -or "$state".Trim() -ne 'true') {
        throw "Docker container $container is not running. Start it using your usual docker compose config first."
    }
    docker exec $container mkdir -p /app/app/workflows/nodes /app/app/workers
    if ($LASTEXITCODE -ne 0) { throw 'Could not prepare destination directories inside backend.' }

    $files = @(
        @('.\backend\app\workflows\nodes\schedule_trigger.py', '/app/app/workflows/nodes/schedule_trigger.py'),
        @('.\backend\app\workers\schedule_rules.py', '/app/app/workers/schedule_rules.py'),
        @('.\backend\app\workers\schedule_runner.py', '/app/app/workers/schedule_runner.py')
    )
    foreach ($entry in $files) {
        docker cp $entry[0] "${container}:$($entry[1])"
        if ($LASTEXITCODE -ne 0) { throw "Failed copying $($entry[0]) into $container" }
    }

    docker restart $container | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Backend restart failed.' }

    docker exec $container python -c "from app.workflows.registry import discovered; assert 'core.schedule_trigger' in discovered(), 'Schedule trigger missing from registry'; print('Native Schedule Trigger discovered')"
    if ($LASTEXITCODE -ne 0) { throw 'Schedule node registry check failed. Review backend logs; scheduler was not started.' }

    docker exec -d $container sh -c 'python -u -m app.workers.schedule_runner > /tmp/cliptora_schedule.log 2>&1'
    if ($LASTEXITCODE -ne 0) { throw 'Scheduler process launch failed.' }

    Start-Sleep -Seconds 2
    docker exec $container sh -c 'tail -40 /tmp/cliptora_schedule.log'
    if ($LASTEXITCODE -ne 0) { throw 'Unable to read scheduler log.' }
    Write-Host 'Scheduler launch attempted. Check the log for errors and confirm the process stays running.' -ForegroundColor Yellow
    Write-Host 'docker exec cliptora-backend sh -c "tail -80 /tmp/cliptora_schedule.log"'
} finally {
    Pop-Location
}
