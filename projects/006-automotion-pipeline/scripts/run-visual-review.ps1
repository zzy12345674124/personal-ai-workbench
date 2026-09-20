# Visual review: extract keyframes from final.mp4 and run MiMo review
# Usage: powershell -ExecutionPolicy Bypass -File .\scripts\run-visual-review.ps1 -RunDir <runDir>
# 步骤：ffprobe 取时长 → ffmpeg 抽 3 个关键帧（10%/50%/90% 时间点）→ tsx visual-review.ts
# 产物：visual-review.json（MiMo 评分 + pass 判定）；失败即生产链失败（chain 语义）
param(
    [Parameter(Mandatory)] [string]$RunDir
)

$ErrorActionPreference = 'Stop'
$mp4 = Join-Path $RunDir 'final.mp4'
if (-not (Test-Path -LiteralPath $mp4 -PathType Leaf)) {
    Write-Error "final.mp4 not found in $RunDir"
    exit 1
}

$ffmpegBin = if ($env:FFMPEG_BIN) { $env:FFMPEG_BIN } else { 'ffmpeg' }
$ffprobeBin = if ($env:FFPROBE_BIN) { $env:FFPROBE_BIN } else { 'ffprobe' }

# 时长（秒）；-hide_banner：PS 5.1 把 ffmpeg/ffprobe 的版本横幅（stderr 输出）当
# NativeCommandError（$ErrorActionPreference='Stop' 时），必须抑制
$dur = (& $ffprobeBin -hide_banner -v error -show_entries format=duration -of csv=p=0 $mp4 2>$null).Trim()
if (-not $dur -or $dur -eq 'N/A') {
    Write-Error "ffprobe duration failed for $mp4"
    exit 1
}
$dur = [double]$dur

# 场景内采样（2026-08-08）：固定 10/50/90% 时间点会落在场景间隙（实测 90% 位置空白帧误报）。
# 读 subtitles.json timeline 取 首/中/尾 三镜的起始后 1s（短场景按段内 80% 兜底）；
# 无 subtitles.json 或不足 3 镜时回退固定百分比。
$sampleTimes = New-Object System.Collections.Generic.List[double]
$subsFile = Join-Path $RunDir 'subtitles.json'
if (Test-Path -LiteralPath $subsFile -PathType Leaf) {
    $subs = Get-Content -LiteralPath $subsFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $timeline = @($subs.timeline)
    if ($timeline.Count -ge 3) {
        # 注意：PS 数组字面量里直接写 `$timeline.Count - 1` 会把 `-` 解析成数组相减
        # （op_Subtraction 错误）——计算必须先放变量
        $midIdx = [Math]::Floor($timeline.Count / 2)
        $lastIdx = $timeline.Count - 1
        $picks = @(0, $midIdx, $lastIdx)
        foreach ($idx in $picks) {
            $seg = $timeline[$idx]
            $t = [double]$seg.startSeconds + 1.0
            $span = [double]$seg.endSeconds - [double]$seg.startSeconds
            $maxT = [double]$seg.startSeconds + 0.8 * $span
            $sampleTimes.Add([Math]::Min($t, $maxT))
        }
        Write-Output ("SAMPLING=scenes 镜数=" + $timeline.Count)
    }
}
if ($sampleTimes.Count -ne 3) {
    for ($i = 1; $i -le 3; $i++) { $sampleTimes.Add([Math]::Max(0.0, $dur * ($i * 0.4 - 0.3))) }
    Write-Output "SAMPLING=fallback"
}

# 抽 3 个关键帧（场景内采样点），命名 keyframe-<n>.png（visual-review.ts 的约定）
for ($i = 0; $i -lt 3; $i++) {
    $t = $sampleTimes[$i]
    $out = Join-Path $RunDir ("keyframe-{0}.png" -f ($i + 1))
    & $ffmpegBin -hide_banner -v error -y -ss ([string]$t) -i $mp4 -frames:v 1 $out 2>$null
    if (-not (Test-Path -LiteralPath $out -PathType Leaf)) {
        Write-Error "keyframe extraction failed at t=$t"
        exit 1
    }
    Write-Output ("KEYFRAME=" + ($i + 1) + "/3 t=" + [Math]::Round($t, 1) + "s")
}

# 跑 MiMo 视觉质检（需 MIMO_API_KEY；VISION_PASS_THRESHOLD 可调通过线）
$tsxCli = Join-Path $PSScriptRoot '..\node_modules\tsx\dist\cli.mjs'
$review = Join-Path $PSScriptRoot 'visual-review.ts'
& node $tsxCli $review $RunDir
if ($LASTEXITCODE -ne 0) {
    Write-Error "visual-review.ts failed (exit=$LASTEXITCODE)"
    exit 1
}

# 聚合记账（2026-08-07）：tts-meta.json + visual-review.json → run-summary.json 加 produce
# 注意：写回必须 UTF-8 无 BOM（PS 5.1 Set-Content -Encoding UTF8 会写 BOM，Node JSON.parse 会崩）
$summaryPath = Join-Path $RunDir 'run-summary.json'
if (Test-Path -LiteralPath $summaryPath -PathType Leaf) {
    $summary = Get-Content -LiteralPath $summaryPath -Raw -Encoding UTF8 | ConvertFrom-Json
    # 注意：必须用 pscustomobject——hashtable 上 Add-Member 的属性在 ConvertTo-Json 时丢失（PS 5.1 实测）
    $produce = [pscustomobject]@{}
    $ttsMeta = Join-Path $RunDir 'audio\tts-meta.json'
    if (Test-Path -LiteralPath $ttsMeta -PathType Leaf) {
        $produce | Add-Member -NotePropertyName 'tts' -NotePropertyValue (Get-Content -LiteralPath $ttsMeta -Raw -Encoding UTF8 | ConvertFrom-Json)
    }
    $vrPath = Join-Path $RunDir 'visual-review.json'
    if (Test-Path -LiteralPath $vrPath -PathType Leaf) {
        $vrJson = Get-Content -LiteralPath $vrPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $produce | Add-Member -NotePropertyName 'visualReview' -NotePropertyValue @{
            provider     = $vrJson.provider
            frames       = $vrJson.frames
            inputTokens  = $vrJson.usage.inputTokens
            outputTokens = $vrJson.usage.outputTokens
        }
    }
    if ($produce.PSObject.Properties.Count -gt 0) {
        # -Force：重跑质检时 summary 可能已带 produce（MemberAlreadyExists）
        $summary | Add-Member -NotePropertyName 'produce' -NotePropertyValue $produce -Force
        $json = $summary | ConvertTo-Json -Depth 12
        [IO.File]::WriteAllText($summaryPath, $json, (New-Object System.Text.UTF8Encoding($false)))
        Write-Output ("PRODUCE_META=" + (($produce.PSObject.Properties.Name) -join ','))
    }
}
Write-Output "DONE"
