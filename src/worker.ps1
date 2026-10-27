# One long-lived SAPI5 worker. The Host sends one JSON object per line on
# stdin; the worker replies with one JSON object per line on stdout. Keeping
# the synthesizer alive avoids paying PowerShell/System.Speech startup cost for
# every sentence.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.Volume = 100

function Write-Response {
  param([object]$Payload)
  [Console]::Out.WriteLine(($Payload | ConvertTo-Json -Compress -Depth 6))
  [Console]::Out.Flush()
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ([string]::IsNullOrWhiteSpace($line)) { continue }

  $request = $null
  try {
    $request = $line | ConvertFrom-Json

    if ($request.cmd -eq 'voices') {
      $voices = @()
      foreach ($voice in $synth.GetInstalledVoices()) {
        if (-not $voice.Enabled) { continue }
        $voices += [pscustomobject]@{
          name = $voice.VoiceInfo.Name
          culture = $voice.VoiceInfo.Culture.Name
          gender = [string]$voice.VoiceInfo.Gender
        }
      }
      Write-Response -Payload ([pscustomobject]@{
        id = $request.id
        ok = $true
        voices = @($voices)
      })
      continue
    }

    if ($request.voice) {
      $synth.SelectVoice([string]$request.voice)
    }
    $synth.SetOutputToWaveFile([string]$request.out)
    $synth.Speak([string]$request.text)
    $synth.SetOutputToNull()
    Write-Response -Payload ([pscustomobject]@{
      id = $request.id
      ok = $true
    })
  } catch {
    try { $synth.SetOutputToNull() } catch {}
    Write-Response -Payload ([pscustomobject]@{
      id = $request.id
      ok = $false
      error = $_.Exception.Message
    })
  }
}
