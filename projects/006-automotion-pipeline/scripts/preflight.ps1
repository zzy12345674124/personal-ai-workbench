param(
    [ValidateSet('local', 'live')]
    [string]$Mode = 'local',

    [switch]$AllowCodexRequest,
    [switch]$AllowDeepSeekRequest,
    [switch]$AllowSyntheticImageUpload
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$workspaceRoot = Split-Path -Parent $projectRoot
$aiWorkspaceName = 'AI' + [char]0x5DE5 + [char]0x4F5C + [char]0x533A
$aiWorkspacePath = Join-Path $workspaceRoot $aiWorkspaceName
$runRootPath = Join-Path $aiWorkspacePath 'automotion-runs'
$schemaPath = Join-Path $projectRoot 'tests\fixtures\preflight-ok.schema.json'
$claudeFallback = 'claude'
$ffmpegFallback = 'ffmpeg'
$chromeCandidates = @(
    'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
)

function Get-ConfiguredPath {
    param(
        [Parameter(Mandatory)] [string]$EnvironmentName,
        [Parameter(Mandatory)] [string]$CommandName,
        [string]$Fallback
    )

    $configured = [Environment]::GetEnvironmentVariable($EnvironmentName)
    if ($configured -and (Test-Path -LiteralPath $configured -PathType Leaf)) {
        return $configured
    }

    if ($Fallback -and (Test-Path -LiteralPath $Fallback -PathType Leaf)) {
        return $Fallback
    }

    # PowerShell 的 Get-Command 默认只返回最高优先级的同名命令（.ps1 脚本优先于
    # 外部命令），而本脚本用 ProcessStartInfo 直接启动子进程，无法执行 .ps1 脚本。
    # 用 -All 枚举全部候选后只保留可执行文件扩展名；
    # StrictMode 下先以 CommandType 短路过滤，避免对无 Extension 属性的对象抛错
    $command = Get-Command $CommandName -All -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandType -eq 'Application' -and $_.Extension -in @('.exe', '.cmd', '.bat', '.com') } |
        Select-Object -First 1
    if ($command -and $command.Source) {
        return $command.Source
    }

    return $null
}

function Invoke-ProcessCapture {
    param(
        [Parameter(Mandatory)] [string]$FilePath,
        [string[]]$Arguments = @(),
        [int]$TimeoutMs = 15000
    )

    function ConvertTo-WindowsArgument {
        param([AllowEmptyString()] [string]$Value)

        if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') {
            return $Value
        }

        $builder = [System.Text.StringBuilder]::new()
        [void]$builder.Append('"')
        $backslashes = 0
        foreach ($character in $Value.ToCharArray()) {
            if ($character -eq '\') {
                $backslashes++
                continue
            }

            if ($character -eq '"') {
                [void]$builder.Append(('\' * (($backslashes * 2) + 1)))
                [void]$builder.Append('"')
                $backslashes = 0
                continue
            }

            if ($backslashes -gt 0) {
                [void]$builder.Append(('\' * $backslashes))
                $backslashes = 0
            }
            [void]$builder.Append($character)
        }

        if ($backslashes -gt 0) {
            [void]$builder.Append(('\' * ($backslashes * 2)))
        }
        [void]$builder.Append('"')
        return $builder.ToString()
    }

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $FilePath
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.Arguments = (($Arguments | ForEach-Object { ConvertTo-WindowsArgument -Value $_ }) -join ' ')

    try {
        $process = [System.Diagnostics.Process]::new()
        $process.StartInfo = $startInfo
        [void]$process.Start()
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()

        if (-not $process.WaitForExit($TimeoutMs)) {
            $process.Kill($true)
            return [ordered]@{
                started = $true
                timedOut = $true
                exitCode = $null
                stdout = ''
                stderr = 'PROCESS_TIMEOUT'
            }
        }

        return [ordered]@{
            started = $true
            timedOut = $false
            exitCode = $process.ExitCode
            stdout = $stdoutTask.Result.Trim()
            stderr = $stderrTask.Result.Trim()
        }
    }
    catch {
        return [ordered]@{
            started = $false
            timedOut = $false
            exitCode = $null
            stdout = ''
            stderr = $_.Exception.GetType().Name
        }
    }
}

function Get-VersionProbe {
    param(
        [string]$Path,
        [string[]]$Arguments = @('--version')
    )

    if (-not $Path) {
        return [ordered]@{
            path = $null
            exists = $false
            callable = $false
            version = $null
            error = 'NOT_FOUND'
        }
    }

    $result = Invoke-ProcessCapture -FilePath $Path -Arguments $Arguments
    $versionText = if ($result.exitCode -eq 0 -and $result.stdout) { $result.stdout } elseif ($result.exitCode -eq 0) { $result.stderr } else { $null }
    return [ordered]@{
        path = $Path
        exists = Test-Path -LiteralPath $Path -PathType Leaf
        callable = ($result.started -and -not $result.timedOut -and $result.exitCode -eq 0)
        version = if ($versionText) { ($versionText -split "`r?`n")[0] } else { $null }
        error = if ($result.exitCode -eq 0) { $null } else { $result.stderr }
    }
}

function Get-LiveFailureCategory {
    param($Result)

    if (-not $Result.started) { return 'PROCESS_START_FAILED' }
    if ($Result.timedOut) { return 'PROCESS_TIMEOUT' }
    if ($Result.exitCode -eq 0) { return $null }

    $text = ([string]$Result.stderr).ToLowerInvariant()
    if ($text -match 'quota|usage limit|credit balance|insufficient') { return 'QUOTA_OR_CREDIT' }
    if ($text -match 'unauthorized|authentication|invalid.*key|401|403') { return 'AUTHENTICATION' }
    if ($text -match 'rate limit|429|network|connection|timed out|timeout') { return 'NETWORK_OR_RATE_LIMIT' }
    return 'NONZERO_EXIT'
}

function Get-SapiVoices {
    try {
        Add-Type -AssemblyName System.Speech
        $synthesizer = [System.Speech.Synthesis.SpeechSynthesizer]::new()
        try {
            return @($synthesizer.GetInstalledVoices() | ForEach-Object {
                [ordered]@{
                    name = $_.VoiceInfo.Name
                    culture = $_.VoiceInfo.Culture.Name
                    enabled = $_.Enabled
                }
            })
        }
        finally {
            $synthesizer.Dispose()
        }
    }
    catch {
        return @([ordered]@{
            name = $null
            culture = $null
            enabled = $false
            error = $_.Exception.GetType().Name
        })
    }
}

function Get-GitProbe {
    $gitPath = Get-ConfiguredPath -EnvironmentName 'GIT_BIN' -CommandName 'git'
    if (-not $gitPath) {
        return [ordered]@{
            path = $null
            repository = $false
            root = $null
            remoteNames = @()
        }
    }

    $rootResult = Invoke-ProcessCapture -FilePath $gitPath -Arguments @('-C', $projectRoot, 'rev-parse', '--show-toplevel')
    $remoteResult = Invoke-ProcessCapture -FilePath $gitPath -Arguments @('-C', $projectRoot, 'remote')
    [string[]]$remoteNames = @()
    if ($remoteResult.exitCode -eq 0 -and $remoteResult.stdout) {
        $remoteNames = @($remoteResult.stdout -split "`r?`n" | Where-Object { $_ })
    }
    return [ordered]@{
        path = $gitPath
        repository = ($rootResult.exitCode -eq 0)
        root = if ($rootResult.exitCode -eq 0) { $rootResult.stdout } else { $null }
        remoteCount = $remoteNames.Count
        remoteNames = [string]::Join(',', $remoteNames)
    }
}

function Get-ZhipuSkillProbe {
    $skillScript = Join-Path $HOME '.claude\skills\zhipu-vision\vision.py'
    if (-not (Test-Path -LiteralPath $skillScript -PathType Leaf)) {
        return [ordered]@{
            path = $skillScript
            exists = $false
            configuredModel = $null
            usesExpectedFlashModel = $false
        }
    }

    $content = Get-Content -LiteralPath $skillScript -Raw -Encoding UTF8
    $modelMatch = [regex]::Match($content, "model\s*=\s*[`"'](?<model>[^`"']+)[`"']")
    $configuredModel = if ($modelMatch.Success) { $modelMatch.Groups['model'].Value } else { $null }
    return [ordered]@{
        path = $skillScript
        exists = $true
        configuredModel = $configuredModel
        usesExpectedFlashModel = ($configuredModel -eq 'glm-4.6v-flash')
    }
}

function Test-StructuredPayload {
    param([string]$Text)

    if (-not $Text) {
        return $false
    }

    # Set-StrictMode -Version Latest 下直接访问可能不存在的属性（如顶层 ok）会抛
    # 终止错误；统一先转成 hashtable 再按索引读取，保证探测在严格模式下稳定
    function ConvertTo-Hashtable {
        param($Object)
        $table = @{}
        $Object.PSObject.Properties | ForEach-Object { $table[$_.Name] = $_.Value }
        return $table
    }

    try {
        $payload = ConvertTo-Hashtable ($Text | ConvertFrom-Json -ErrorAction Stop)

        if ($payload['ok'] -eq $true -and $payload['message'] -eq 'automotion-preflight') {
            return $true
        }

        if ($payload['structured_output']) {
            $inner = ConvertTo-Hashtable $payload['structured_output']
            return ($inner['ok'] -eq $true -and $inner['message'] -eq 'automotion-preflight')
        }

        if ($payload['result']) {
            $inner = ConvertTo-Hashtable ($payload['result'] | ConvertFrom-Json -ErrorAction Stop)
            return ($inner['ok'] -eq $true -and $inner['message'] -eq 'automotion-preflight')
        }
    }
    catch {
        return $false
    }

    return $false
}

function New-SyntheticTestImage {
    # 生成 640x360 白底黑字测试图（视觉探针共用），调用方负责删除返回的路径
    Add-Type -AssemblyName System.Drawing
    $tempImage = Join-Path ([IO.Path]::GetTempPath()) ('automotion-visual-' + [guid]::NewGuid().ToString('N') + '.png')
    $bitmap = [System.Drawing.Bitmap]::new(640, 360)
    try {
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.Clear([System.Drawing.Color]::White)
            $font = [System.Drawing.Font]::new('Arial', 28)
            $brush = [System.Drawing.Brushes]::Black
            $graphics.DrawString('AutoMotion visual preflight', $font, $brush, 90, 145)
            $font.Dispose()
        }
        finally {
            $graphics.Dispose()
        }
        $bitmap.Save($tempImage, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $bitmap.Dispose()
    }
    return $tempImage
}

function Invoke-CodexLiveProbe {
    param([string]$CodexPath)

    if (-not $AllowCodexRequest) {
        return [ordered]@{ attempted = $false; passed = $false; reason = 'EXPLICIT_APPROVAL_REQUIRED' }
    }
    if (-not $CodexPath) {
        return [ordered]@{ attempted = $false; passed = $false; reason = 'CODEX_NOT_FOUND' }
    }

    $tempDir = Join-Path ([IO.Path]::GetTempPath()) ('automotion-codex-' + [guid]::NewGuid().ToString('N'))
    [void](New-Item -ItemType Directory -Path $tempDir)
    try {
        $outputPath = Join-Path $tempDir 'result.json'
        $arguments = @(
            'exec',
            '--ephemeral',
            '--sandbox', 'read-only',
            '--output-schema', $schemaPath,
            '--output-last-message', $outputPath,
            '--skip-git-repo-check',
            'Return exactly this JSON object and do nothing else: {"ok":true,"message":"automotion-preflight"}'
        )
        $result = Invoke-ProcessCapture -FilePath $CodexPath -Arguments $arguments -TimeoutMs 120000
        $text = if (Test-Path -LiteralPath $outputPath -PathType Leaf) {
            Get-Content -LiteralPath $outputPath -Raw -Encoding UTF8
        } else {
            $result.stdout
        }
        return [ordered]@{
            attempted = $true
            passed = ($result.exitCode -eq 0 -and (Test-StructuredPayload -Text $text))
            exitCode = $result.exitCode
            errorCategory = Get-LiveFailureCategory -Result $result
        }
    }
    finally {
        Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-ClaudeLiveProbe {
    param([string]$ClaudePath)

    if (-not $AllowDeepSeekRequest) {
        return [ordered]@{ attempted = $false; passed = $false; reason = 'EXPLICIT_APPROVAL_REQUIRED' }
    }
    if (-not $ClaudePath) {
        return [ordered]@{ attempted = $false; passed = $false; reason = 'CLAUDE_NOT_FOUND' }
    }

    $schema = Get-Content -LiteralPath $schemaPath -Raw -Encoding UTF8
    $arguments = @(
        '-p',
        '--model', 'deepseek-v4-flash',
        '--permission-mode', 'plan',
        '--tools', '',
        '--output-format', 'json',
        '--json-schema', $schema,
        '--no-session-persistence',
        'Return exactly this JSON object and do nothing else: {"ok":true,"message":"automotion-preflight"}'
    )
    $result = Invoke-ProcessCapture -FilePath $ClaudePath -Arguments $arguments -TimeoutMs 120000
    return [ordered]@{
        attempted = $true
        passed = ($result.exitCode -eq 0 -and (Test-StructuredPayload -Text $result.stdout))
        exitCode = $result.exitCode
        errorCategory = Get-LiveFailureCategory -Result $result
    }
}

function Invoke-ZhipuLiveProbe {
    if (-not $AllowSyntheticImageUpload) {
        return [ordered]@{ attempted = $false; passed = $false; reason = 'EXPLICIT_APPROVAL_REQUIRED' }
    }

    $apiKey = [Environment]::GetEnvironmentVariable('ZHIPU_API_KEY')
    if (-not $apiKey) {
        return [ordered]@{ attempted = $false; passed = $false; reason = 'ZHIPU_API_KEY_NOT_SET' }
    }

    # .NET WebRequest 默认走系统代理（本机为 v2rayN 127.0.0.1:7286），会把国内
    # API 流量送入境外出口导致 TLS 层失败；智谱 API 必须直连
    [System.Net.WebRequest]::DefaultWebProxy = $null

    $tempImage = New-SyntheticTestImage

    try {
        $base64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($tempImage))
        $requestBody = [ordered]@{
            model = 'glm-4.6v-flash'
            messages = @(
                [ordered]@{
                    role = 'system'
                    content = 'You are a preflight probe. Respond with exactly the JSON requested by the user; no extra text, no markdown, no thinking.'
                },
                [ordered]@{
                    role = 'user'
                    content = @(
                        [ordered]@{
                            type = 'image_url'
                            image_url = [ordered]@{ url = 'data:image/png;base64,' + $base64 }
                        },
                        [ordered]@{
                            type = 'text'
                            text = 'Describe nothing. Respond with exactly this JSON and nothing else: {"ok":true,"message":"automotion-preflight"}'
                        }
                    )
                }
            )
            thinking = [ordered]@{ type = 'disabled' }
        } | ConvertTo-Json -Depth 10 -Compress

        try {
            $response = Invoke-RestMethod `
                -Method Post `
                -Uri 'https://open.bigmodel.cn/api/paas/v4/chat/completions' `
                -Headers @{ Authorization = "Bearer $apiKey" } `
                -ContentType 'application/json' `
                -Body $requestBody `
                -TimeoutSec 120
            $content = [string]$response.choices[0].message.content
            return [ordered]@{
                attempted = $true
                passed = Test-StructuredPayload -Text $content
                model = [string]$response.model
                errorCategory = $null
            }
        }
        catch {
            return [ordered]@{
                attempted = $true
                passed = $false
                model = 'glm-4.6v-flash'
                errorCategory = $_.Exception.GetType().Name
            }
        }
    }
    finally {
        Remove-Item -LiteralPath $tempImage -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-MiMoLiveProbe {
    if (-not $AllowSyntheticImageUpload) {
        return [ordered]@{ attempted = $false; passed = $false; reason = 'EXPLICIT_APPROVAL_REQUIRED' }
    }

    $apiKey = [Environment]::GetEnvironmentVariable('MIMO_API_KEY')
    if (-not $apiKey) {
        return [ordered]@{ attempted = $false; passed = $false; reason = 'MIMO_API_KEY_NOT_SET' }
    }

    # 国内 API 需直连，绕过 v2rayN 系统代理（同 DashScope/智谱探针）；走小米 Anthropic 兼容端点
    [System.Net.WebRequest]::DefaultWebProxy = $null

    $tempImage = New-SyntheticTestImage
    try {
        $base64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($tempImage))
        $requestBody = [ordered]@{
            model = 'mimo-v2.5'
            max_tokens = 300
            messages = @(
                [ordered]@{
                    role = 'user'
                    content = @(
                        [ordered]@{
                            type = 'image'
                            source = [ordered]@{
                                type = 'base64'
                                media_type = 'image/png'
                                data = $base64
                            }
                        },
                        [ordered]@{
                            type = 'text'
                            text = 'Describe nothing. Respond with exactly this JSON and nothing else: {"ok":true,"message":"automotion-preflight"}'
                        }
                    )
                }
            )
        } | ConvertTo-Json -Depth 12 -Compress

        try {
            $response = Invoke-RestMethod `
                -Method Post `
                -Uri 'https://api.xiaomimimo.com/anthropic/v1/messages' `
                -Headers @{ 'x-api-key' = $apiKey; 'anthropic-version' = '2023-06-01' } `
                -ContentType 'application/json' `
                -Body $requestBody `
                -TimeoutSec 120
            $content = [string](($response.content | Where-Object { $_.type -eq 'text' } | ForEach-Object { $_.text }) -join '')
            return [ordered]@{
                attempted = $true
                passed = Test-StructuredPayload -Text $content
                model = [string]$response.model
                errorCategory = $null
            }
        }
        catch {
            return [ordered]@{
                attempted = $true
                passed = $false
                model = 'mimo-v2.5'
                errorCategory = $_.Exception.GetType().Name
            }
        }
    }
    finally {
        Remove-Item -LiteralPath $tempImage -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-DashScopeLiveProbe {
    if (-not $AllowSyntheticImageUpload) {
        return [ordered]@{ attempted = $false; passed = $false; reason = 'EXPLICIT_APPROVAL_REQUIRED' }
    }

    $apiKey = [Environment]::GetEnvironmentVariable('DASHSCOPE_API_KEY')
    if (-not $apiKey) {
        return [ordered]@{ attempted = $false; passed = $false; reason = 'DASHSCOPE_API_KEY_NOT_SET' }
    }

    # .NET WebRequest 默认走系统代理（本机为 v2rayN 127.0.0.1:7286）；DashScope 为国内 API 需直连
    [System.Net.WebRequest]::DefaultWebProxy = $null

    $tempImage = New-SyntheticTestImage
    try {
        $base64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($tempImage))
        $requestBody = [ordered]@{
            model = 'qwen3.5-omni-flash'
            messages = @(
                [ordered]@{
                    role = 'user'
                    content = @(
                        [ordered]@{
                            type = 'image_url'
                            image_url = [ordered]@{ url = 'data:image/png;base64,' + $base64 }
                        },
                        [ordered]@{
                            type = 'text'
                            text = 'Describe nothing. Respond with exactly this JSON and nothing else: {"ok":true,"message":"automotion-preflight"}'
                        }
                    )
                }
            )
        } | ConvertTo-Json -Depth 10 -Compress

        try {
            $response = Invoke-RestMethod `
                -Method Post `
                -Uri 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions' `
                -Headers @{ Authorization = "Bearer $apiKey" } `
                -ContentType 'application/json' `
                -Body $requestBody `
                -TimeoutSec 120
            $content = [string]$response.choices[0].message.content
            return [ordered]@{
                attempted = $true
                passed = Test-StructuredPayload -Text $content
                model = [string]$response.model
                errorCategory = $null
            }
        }
        catch {
            $category = if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 429) { 'RATE_LIMIT' } else { $_.Exception.GetType().Name }
            return [ordered]@{
                attempted = $true
                passed = $false
                model = 'qwen3.5-omni-flash'
                errorCategory = $category
            }
        }
    }
    finally {
        Remove-Item -LiteralPath $tempImage -Force -ErrorAction SilentlyContinue
    }
}

$nodePath = Get-ConfiguredPath -EnvironmentName 'NODE_BIN' -CommandName 'node'
$npmPath = Get-ConfiguredPath -EnvironmentName 'NPM_BIN' -CommandName 'npm.cmd'
$codexPath = Get-ConfiguredPath -EnvironmentName 'CODEX_BIN' -CommandName 'codex'
$claudePath = Get-ConfiguredPath -EnvironmentName 'CLAUDE_BIN' -CommandName 'claude' -Fallback $claudeFallback
$ffmpegPath = Get-ConfiguredPath -EnvironmentName 'FFMPEG_BIN' -CommandName 'ffmpeg' -Fallback $ffmpegFallback
$chromePath = [Environment]::GetEnvironmentVariable('CHROME_BIN')
if (-not $chromePath -or -not (Test-Path -LiteralPath $chromePath -PathType Leaf)) {
    $chromePath = $chromeCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
}

$codexProbe = Get-VersionProbe -Path $codexPath
if (-not $codexProbe.callable -and -not $codexPath) {
    $codexProbe.error = 'CODEX_ENTRY_NOT_FOUND'
}
if (-not $codexProbe.callable -and $codexPath) {
    # codex 是 Rust 原生二进制，在无控制台的子进程环境下拒绝非终端 stdin
    # （Error: stdin is not a terminal）；版本从包元数据补全，可调用性留待登录后验证
    $codexPkgPath = Join-Path (Join-Path (Split-Path $codexPath) 'node_modules\@openai\codex') 'package.json'
    if (Test-Path -LiteralPath $codexPkgPath) {
        try {
            $codexPkg = Get-Content -LiteralPath $codexPkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
            $codexProbe.version = "codex-cli $($codexPkg.version) (package metadata)"
        }
        catch { }
    }
    $codexProbe.error = 'TTY_REQUIRED'
}

$report = [ordered]@{
    schemaVersion = 1
    checkedAt = [DateTimeOffset]::Now.ToString('o')
    mode = $Mode
    projectRoot = $projectRoot
    local = [ordered]@{
        node = Get-VersionProbe -Path $nodePath
        npm = Get-VersionProbe -Path $npmPath
        codex = $codexProbe
        claude = Get-VersionProbe -Path $claudePath
        ffmpeg = Get-VersionProbe -Path $ffmpegPath -Arguments @('-version')
        chrome = [ordered]@{
            path = $chromePath
            exists = [bool]($chromePath -and (Test-Path -LiteralPath $chromePath -PathType Leaf))
        }
        sapiVoices = @(Get-SapiVoices)
        git = Get-GitProbe
        runRoot = [ordered]@{
            path = $runRootPath
            parentExists = Test-Path -LiteralPath $aiWorkspacePath -PathType Container
        }
        credentials = [ordered]@{
            anthropicBaseUrl = [Environment]::GetEnvironmentVariable('ANTHROPIC_BASE_URL')
            usesDeepSeekEndpoint = ([Environment]::GetEnvironmentVariable('ANTHROPIC_BASE_URL') -eq 'https://api.deepseek.com/anthropic')
            anthropicTokenPresent = [bool][Environment]::GetEnvironmentVariable('ANTHROPIC_AUTH_TOKEN')
            zhipuApiKeyPresent = [bool][Environment]::GetEnvironmentVariable('ZHIPU_API_KEY')
            mimoApiKeyPresent = [bool][Environment]::GetEnvironmentVariable('MIMO_API_KEY')
        }
        zhipuSkill = Get-ZhipuSkillProbe
        packageJsonExists = Test-Path -LiteralPath (Join-Path $projectRoot 'package.json') -PathType Leaf
    }
}

if ($Mode -eq 'live') {
    $report.live = [ordered]@{
        codex = Invoke-CodexLiveProbe -CodexPath $codexPath
        deepseek = Invoke-ClaudeLiveProbe -ClaudePath $claudePath
        mimo = Invoke-MiMoLiveProbe
        zhipu = Invoke-ZhipuLiveProbe
        dashscope = Invoke-DashScopeLiveProbe
    }
}

$report | ConvertTo-Json -Depth 12
