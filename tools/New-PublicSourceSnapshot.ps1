[CmdletBinding()]
param(
    [string]$WorkspaceRoot,
    [string]$Destination
)

$ErrorActionPreference = 'Stop'
if (-not $WorkspaceRoot) { $WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path }
if (-not $Destination) { $Destination = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..')).Path 'projects' }
$excludedDirectories = @('.git', '.godot', '.pytest_cache', '.venv', '__pycache__', 'asset-versions', 'build', 'dist', 'node_modules', 'out', 'productions', 'runs', 'runtime', 'tmp', 'vendor')
$excludedExtensions = @('.db', '.exe', '.log', '.mp3', '.mp4', '.sqlite', '.sqlite3', '.wav', '.webm')
$excludedFiles = @('.env', 'AGENTS.md', 'CLAUDE.md')
$projects = @(
    @{ Prefix = 'project_005_*'; Destination = '005-session-manager' },
    @{ Prefix = 'project_006_*'; Destination = '006-automotion-pipeline' },
    @{ Prefix = 'project_007_*'; Destination = '007-vibemotion-assets' },
    @{ Prefix = 'project_008_*'; Destination = '008-personal-workbench' }
)

function Test-IsExcluded {
    param([System.IO.FileInfo]$File, [string]$SourceRoot)
    $relative = $File.FullName.Substring($SourceRoot.TrimEnd([char[]]'\/').Length).TrimStart([char[]]'\/')
    $segments = $relative -split '[\\/]'
    if ($segments | Where-Object { $excludedDirectories -contains $_ }) { return $true }
    if ($excludedFiles -contains $File.Name) { return $true }
    if (($File.Extension -eq '.md') -and ($File.Name -notmatch '^(README|LICENSE|NOTICE|COPYING)')) { return $true }
    if ($excludedExtensions -contains $File.Extension.ToLowerInvariant()) { return $true }
    return $false
}

New-Item -ItemType Directory -Force -Path $Destination | Out-Null
foreach ($project in $projects) {
    $sourceMatches = @(Get-ChildItem -LiteralPath $WorkspaceRoot -Directory -Filter $project.Prefix)
    if ($sourceMatches.Count -ne 1) { throw "Expected one source project matching $($project.Prefix), found $($sourceMatches.Count)" }
    $sourceRoot = $sourceMatches[0].FullName
    $targetRoot = Join-Path $Destination $project.Destination
    if (-not (Test-Path -LiteralPath $sourceRoot)) { throw "Source project not found: $sourceRoot" }
    New-Item -ItemType Directory -Force -Path $targetRoot | Out-Null
    $copied = 0
    Get-ChildItem -LiteralPath $sourceRoot -File -Recurse -Force | ForEach-Object {
        if (Test-IsExcluded -File $_ -SourceRoot $sourceRoot) { return }
        if ($_.Length -gt 10MB) { return }
        $relative = $_.FullName.Substring($sourceRoot.TrimEnd([char[]]'\/').Length).TrimStart([char[]]'\/')
        $target = Join-Path $targetRoot $relative
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
        Copy-Item -LiteralPath $_.FullName -Destination $target -Force
        $copied++
    }
    Write-Host ("{0}: copied {1} files" -f $project.Destination, $copied)
}
Write-Host "Public source snapshot created at: $Destination"
