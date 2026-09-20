# TTS: synthesize narration sentences via SAPI (Microsoft Huihui Desktop)
# Usage: powershell -ExecutionPolicy Bypass -File .\scripts\tts-synthesize.ps1 -RunDir <runDir> [-Rate 0]
param(
    [Parameter(Mandatory)] [string]$RunDir,
    [int]$Rate = 0
)

$ErrorActionPreference = 'Stop'
$scriptJson = Join-Path $RunDir 'final_script.json'
if (-not (Test-Path -LiteralPath $scriptJson -PathType Leaf)) {
    Write-Error "final_script.json not found in $RunDir"
    exit 1
}

$script = Get-Content -LiteralPath $scriptJson -Raw -Encoding UTF8 | ConvertFrom-Json
$audioDir = Join-Path $RunDir 'audio'
[void](New-Item -ItemType Directory -Path $audioDir -Force)

Add-Type -AssemblyName System.Speech
$synth = [System.Speech.Synthesis.SpeechSynthesizer]::new()
try {
    $synth.SelectVoice('Microsoft Huihui Desktop')
    $synth.Rate = $Rate
    for ($i = 0; $i -lt $script.narration.Count; $i++) {
        $wav = Join-Path $audioDir ('{0:D2}.wav' -f ($i + 1))
        $synth.SetOutputToWaveFile($wav)
        $synth.Speak([string]$script.narration[$i])
        Write-Output ("SYNTHESIZED=" + ($i + 1) + "/" + $script.narration.Count)
    }
}
finally {
    $synth.Dispose()
}
Write-Output "DONE"
