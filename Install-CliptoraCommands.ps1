param(
    [string]$ProjectRoot = 'C:\xampp\htdocs\CLIPTORA',
    [switch]$Apply
)
$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot 'Install-CliptoraCommands.py'
if (-not (Test-Path $installer)) { throw 'Download Install-CliptoraCommands.py into the same folder first.' }
$mode = if ($Apply) { '--apply' } else { '--dry-run' }
& py $installer --project-root $ProjectRoot --source-folder $PSScriptRoot $mode
if ($LASTEXITCODE -ne 0) { throw 'CLIPTORA Commands installer stopped; no database was changed.' }
