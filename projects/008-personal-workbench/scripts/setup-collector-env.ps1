[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$CondaExe,
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
if (-not $Apply) {
  throw '此脚本会下载并安装依赖。确认影响后请显式添加 -Apply。'
}

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'runtime'))
$environmentDir = [System.IO.Path]::GetFullPath((Join-Path $runtimeRoot 'collector-python'))
if (-not $environmentDir.StartsWith($runtimeRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "采集环境路径越界：$environmentDir"
}
if (-not (Test-Path -LiteralPath $CondaExe -PathType Leaf)) {
  throw "找不到 Conda：$CondaExe"
}

& $CondaExe create --prefix $environmentDir 'python=3.12' pip -y
if ($LASTEXITCODE -ne 0) { throw "Conda 创建环境失败：$LASTEXITCODE" }

$pythonExe = Join-Path $environmentDir 'python.exe'
$lockFile = Join-Path $projectRoot 'requirements\collector.lock'
& $pythonExe -m pip install --requirement $lockFile
if ($LASTEXITCODE -ne 0) { throw "pip 安装依赖失败：$LASTEXITCODE" }

& $pythonExe -m pip check
if ($LASTEXITCODE -ne 0) { throw "依赖完整性检查失败：$LASTEXITCODE" }

Write-Output "采集环境已就绪：$pythonExe"
