# TTS: synthesize narration sentences via Xiaomi MiMo-V2.5-TTS
# OpenAI 兼容端点 POST /v1/chat/completions（model=mimo-v2.5-tts，audio 参数指定音色/格式）
# Usage: powershell -ExecutionPolicy Bypass -File .\scripts\tts-synthesize-mimo.ps1 -RunDir <runDir> [-Voice 冰糖] [-Style <旁白风格>]
# 接口与 tts-synthesize.ps1（SAPI）兼容：读 final_script.json narration → audio/01.wav...；输出 SYNTHESIZED=n/N + DONE
param(
    [Parameter(Mandatory)] [string]$RunDir,
    [string]$Voice = '',
    [string]$Style = '',
    [int]$Rate = 0   # 兼容旧接口；MiMo 语速经 Style 指令控制
)

# 音色/风格经环境变量传递（PS 5.1 -File 参数按 ANSI 解析，命令行传中文会变 ??；
# 环境块是 Unicode 安全的）。参数 > 环境变量 > 默认值。
if (-not $Voice) { $Voice = $env:MIMO_TTS_VOICE }
if (-not $Voice) { $Voice = '苏打' }   # 默认音色（用户 2026-08-07 试听选定：苏打·年轻男声）
if (-not $Style) { $Style = $env:MIMO_TTS_STYLE }
if (-not $Style) { $Style = '自然沉稳、吐字清晰，适合纪录片旁白，语速适中' }

$ErrorActionPreference = 'Stop'
$scriptJson = Join-Path $RunDir 'final_script.json'
if (-not (Test-Path -LiteralPath $scriptJson -PathType Leaf)) {
    Write-Error "final_script.json not found in $RunDir"
    exit 1
}

$apiKey = $env:MIMO_API_KEY
if (-not $apiKey) {
    Write-Error "MIMO_API_KEY not set"
    exit 1
}

$script = Get-Content -LiteralPath $scriptJson -Raw -Encoding UTF8 | ConvertFrom-Json
$audioDir = Join-Path $RunDir 'audio'
[void](New-Item -ItemType Directory -Path $audioDir -Force)

$uri = 'https://api.xiaomimimo.com/v1/chat/completions'
# 记账（2026-08-07）：合成结束后写 tts-meta.json，供 run-summary 聚合展示成本/用量
$totalChars = 0
for ($i = 0; $i -lt $script.narration.Count; $i++) {
    $totalChars += ([string]$script.narration[$i]).Length
}
for ($i = 0; $i -lt $script.narration.Count; $i++) {
    $body = @{
        model    = 'mimo-v2.5-tts'
        messages = @(
            @{ role = 'user';       content = $Style }
            @{ role = 'assistant';  content = [string]$script.narration[$i] }
        )
        audio    = @{ format = 'wav'; voice = $Voice }
    } | ConvertTo-Json -Depth 8

    # PS 5.1 坑：Invoke-RestMethod 对字符串 body 按默认 ANSI 编码发送，中文会变 ??——
    # 必须先转 UTF-8 字节数组（byte[] body 不再重新编码）
    $resp = Invoke-RestMethod -Uri $uri -Method Post `
        -Headers @{ 'api-key' = $apiKey } -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($body))
    $b64 = $resp.choices[0].message.audio.data
    if (-not $b64) {
        Write-Error ("no audio data for sentence " + ($i + 1))
        exit 1
    }
    $bytes = [Convert]::FromBase64String($b64)
    $wav = Join-Path $audioDir ('{0:D2}.wav' -f ($i + 1))
    [IO.File]::WriteAllBytes($wav, $bytes)
    Write-Output ("SYNTHESIZED=" + ($i + 1) + "/" + $script.narration.Count)
}
# 记账落盘（2026-08-07）：音色/句数/字符数/调用次数
$meta = @{
    provider = 'mimo-v2.5-tts'
    voice    = $Voice
    sentences = $script.narration.Count
    chars    = $totalChars
    calls    = $script.narration.Count
} | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $audioDir 'tts-meta.json'), $meta, (New-Object System.Text.UTF8Encoding($false)))
Write-Output "DONE"
