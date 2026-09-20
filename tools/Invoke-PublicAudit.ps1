[CmdletBinding()]
param([string]$Root)

$ErrorActionPreference = 'Stop'
if (-not $Root) { $Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path }
$findings = [System.Collections.Generic.List[object]]::new()
$ignoredDirectories = @('.git', '.godot', '.venv', '__pycache__', 'dist', 'node_modules', 'runs', 'runtime')
$blockedExtensions = @('.db', '.exe', '.sqlite', '.sqlite3')
$textExtensions = @('.bat', '.cmd', '.css', '.gd', '.html', '.js', '.json', '.md', '.mjs', '.ps1', '.py', '.sh', '.ts', '.tsx', '.txt', '.yaml', '.yml')
$patterns = [ordered]@{
    'Possible API key' = '(?i)(api[_-]?key|token|secret)\s*[:=]\s*["'']?[A-Za-z0-9_\-]{20,}'
    'Personal Windows path' = '(?i)[A-Z]:\\Users\\(?!USER\\|username\\|<user>\\)[^\\\s"'']+'
    'Cookie value' = '(?i)(cookie\s*[:=]|SESSDATA=|bili_jct=|DedeUserID=)'
    'Private key' = '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----'
}

Get-ChildItem -LiteralPath $Root -File -Recurse -Force | ForEach-Object {
    $file = $_
    $relativeSegments = $file.FullName.Substring($Root.TrimEnd([char[]]'\/').Length).TrimStart([char[]]'\/') -split '[\\/]'
    if ($relativeSegments | Where-Object { $ignoredDirectories -contains $_ }) { return }
    if ($blockedExtensions -contains $file.Extension.ToLowerInvariant()) { $findings.Add([pscustomobject]@{ Kind = 'Blocked file type'; File = $file.FullName; Detail = $file.Extension }) }
    if ($file.Name -eq '.env') { $findings.Add([pscustomobject]@{ Kind = 'Environment file'; File = $file.FullName; Detail = '.env must not be committed' }) }
    if ($file.Length -gt 50MB) { $findings.Add([pscustomobject]@{ Kind = 'Large file'; File = $file.FullName; Detail = ('{0:N1} MiB' -f ($file.Length / 1MB)) }) }
    if ($textExtensions -contains $file.Extension.ToLowerInvariant()) {
        if ($file.FullName -eq $PSCommandPath) { return }
        $lineNumber = 0
        Get-Content -LiteralPath $file.FullName -ErrorAction SilentlyContinue | ForEach-Object {
            $lineNumber++
            $line = $_
            foreach ($entry in $patterns.GetEnumerator()) {
                if (($entry.Key -eq 'Personal Windows path') -and ($line -match '(?i)\\Users\\(USER|username|<user>)(\\|\b)')) { continue }
                if ($line -match $entry.Value) { $findings.Add([pscustomobject]@{ Kind = $entry.Key; File = $file.FullName; Detail = "line $lineNumber" }) }
            }
        }
    }
}
if ($findings.Count -gt 0) {
    $findings | Sort-Object Kind, File, Detail | Format-Table -AutoSize
    Write-Error "Public audit failed with $($findings.Count) finding(s)."
}
Write-Host 'Public audit passed.'
