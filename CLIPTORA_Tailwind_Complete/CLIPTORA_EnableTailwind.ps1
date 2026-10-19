#requires -Version 5.1
param(
    [string]$ProjectRoot = (Get-Location).Path,
    [switch]$DryRun,
    [switch]$RunChecks
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $ProjectRoot).Path
$frontend = if (Test-Path -LiteralPath (Join-Path $root 'frontend/package.json')) {
    Join-Path $root 'frontend'
} elseif (Test-Path -LiteralPath (Join-Path $root 'package.json')) {
    $root
} else {
    throw 'Cannot find Cliptora frontend/package.json.'
}

$gitRoot = (& git -C $frontend rev-parse --show-toplevel 2>$null)
if ($LASTEXITCODE -ne 0 -or -not $gitRoot) {
    throw 'Cliptora must already be inside a Git repository.'
}

$vitePath = Join-Path $frontend 'vite.config.mjs'
$mainPath = Join-Path $frontend 'src/main.tsx'
$tailwindPath = Join-Path $frontend 'src/tailwind.css'
$stylesPath = Join-Path $frontend 'src/styles.css'

foreach ($file in @($vitePath, $mainPath, $stylesPath)) {
    if (-not (Test-Path -LiteralPath $file)) { throw "Missing file: $file" }
}

$viteOriginal = [System.IO.File]::ReadAllText($vitePath)
$mainOriginal = [System.IO.File]::ReadAllText($mainPath)
$viteUpdated = $viteOriginal
$mainUpdated = $mainOriginal

$viteNewline = if ($viteOriginal.Contains("`r`n")) { "`r`n" } else { "`n" }
$mainNewline = if ($mainOriginal.Contains("`r`n")) { "`r`n" } else { "`n" }

if ($viteUpdated -notmatch '@tailwindcss/vite') {
    $reactImport = [regex]::Match($viteUpdated, '(?m)^import\s+react\s+from\s+[''"]@vitejs/plugin-react[''"];?')
    if (-not $reactImport.Success) {
        throw 'Unknown Vite configuration. Expected React plugin import; no files changed.'
    }
    $addition = $reactImport.Value + $viteNewline + "import tailwindcss from '@tailwindcss/vite'"
    $viteUpdated = $viteUpdated.Replace($reactImport.Value, $addition)
}

if ($viteUpdated -notmatch 'tailwindcss\s*\(') {
    $pluginsMatch = [regex]::Match($viteUpdated, 'plugins\s*:\s*\[')
    if (-not $pluginsMatch.Success) {
        throw 'Unknown Vite configuration. Could not find plugins: [...]; no files changed.'
    }
    $viteUpdated = $viteUpdated.Insert($pluginsMatch.Index + $pluginsMatch.Length, 'tailwindcss(), ')
}

if ($mainUpdated -notmatch '(?m)^\s*import\s+[''"]\./tailwind\.css[''"]') {
    $stylesImport = [regex]::Match($mainUpdated, '(?m)^import\s+[''"]\./styles\.css[''"];?')
    if (-not $stylesImport.Success) {
        throw 'Cannot find the existing styles.css import in src/main.tsx; no files changed.'
    }
    $mainUpdated = $mainUpdated.Replace($stylesImport.Value, $stylesImport.Value + $mainNewline + "import './tailwind.css'")
}

$tailwindContent = @'
@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);

@theme {
  --color-cl-bg: #101214;
  --color-cl-panel: #191b1d;
  --color-cl-panel-soft: #202224;
  --color-cl-border: #2a2d30;
  --color-cl-muted: #8d9198;
  --color-cl-purple: #8d33e3;
  --color-cl-cyan: #23a5cb;
  --color-cl-orange: #fe7526;
  --color-cl-green: #5bff93;
  --font-cl-body: "DM Sans", sans-serif;
  --font-cl-display: "Manrope", sans-serif;
}
'@

if (Test-Path -LiteralPath $tailwindPath) {
    $present = [System.IO.File]::ReadAllText($tailwindPath).Trim()
    if ($present -ne $tailwindContent.Trim()) {
        throw 'src/tailwind.css exists with custom content. Review it manually; no files changed.'
    }
}

Write-Host "Git repository: $gitRoot" -ForegroundColor Cyan
Write-Host 'Tailwind CSS v4 via Vite; existing design CSS and CORS proxy will be preserved.' -ForegroundColor Cyan
Write-Host 'No Git commits, resets, cleans or backup files.' -ForegroundColor DarkGray

if ($viteUpdated -ne $viteOriginal) { Write-Host '  [update] frontend/vite.config.mjs' }
if ($mainUpdated -ne $mainOriginal) { Write-Host '  [update] frontend/src/main.tsx' }
if (-not (Test-Path -LiteralPath $tailwindPath)) { Write-Host '  [create] frontend/src/tailwind.css' }
Write-Host '  [npm] install tailwindcss@^4 and @tailwindcss/vite@^4 as dev dependencies'

if ($DryRun) {
    Write-Host 'Dry run only. No files or packages changed.' -ForegroundColor Yellow
    exit 0
}

Push-Location $frontend
try {
    & npm.cmd install --save-dev 'tailwindcss@^4' '@tailwindcss/vite@^4'
    if ($LASTEXITCODE -ne 0) { throw 'npm install failed. Source files were not modified.' }
} finally {
    Pop-Location
}

$utf8 = New-Object System.Text.UTF8Encoding($false)
if ($viteUpdated -ne $viteOriginal) { [System.IO.File]::WriteAllText($vitePath, $viteUpdated, $utf8) }
if ($mainUpdated -ne $mainOriginal) { [System.IO.File]::WriteAllText($mainPath, $mainUpdated, $utf8) }
if (-not (Test-Path -LiteralPath $tailwindPath)) { [System.IO.File]::WriteAllText($tailwindPath, $tailwindContent.TrimEnd() + "`n", $utf8) }

Write-Host 'Tailwind CSS installed and configured.' -ForegroundColor Green
& git -C $frontend status --short

if ($RunChecks) {
    Push-Location $frontend
    try {
        & npm.cmd run typecheck
        if ($LASTEXITCODE -ne 0) { throw 'Typecheck failed.' }
        & npm.cmd exec -- vite build
        if ($LASTEXITCODE -ne 0) { throw 'Vite build failed.' }
    } finally {
        Pop-Location
    }
}

Write-Host 'Restart Vite: Ctrl+C, then npm run dev.' -ForegroundColor Cyan
