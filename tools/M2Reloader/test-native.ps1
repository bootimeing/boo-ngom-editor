#Requires -Version 5.1

[CmdletBinding()]
param(
  [string]$HelperPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$tempRoot = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
$testDirectory = [System.IO.Path]::GetFullPath((Join-Path $env:TEMP "boo-m2-reload-test-$PID"))
if (-not $testDirectory.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Unsafe test directory: $testDirectory"
}

$buildHelper = [string]::IsNullOrWhiteSpace($HelperPath)
$helperPath = if ($buildHelper) {
  Join-Path $testDirectory 'M2Reloader.exe'
} else {
  [System.IO.Path]::GetFullPath($HelperPath)
}
$harnessPath = Join-Path $testDirectory 'M2Server.exe'
$harnessSource = Join-Path $projectRoot 'tests\fixtures\M2Server-reload-harness.cpp'
$harnessProcess = $null

try {
  New-Item -ItemType Directory -Path $testDirectory -Force | Out-Null
  if ($buildHelper) {
    & (Join-Path $PSScriptRoot 'build-native.ps1') -OutputPath $helperPath | Out-Null
  } elseif (-not (Test-Path -LiteralPath $helperPath -PathType Leaf)) {
    throw "M2Reloader.exe does not exist: $helperPath"
  }
  & (Join-Path $PSScriptRoot 'build-native.ps1') -SourcePath $harnessSource -OutputPath $harnessPath | Out-Null

  $harnessProcess = Start-Process -FilePath $harnessPath -WindowStyle Hidden -PassThru
  $scanResult = ''
  for ($attempt = 0; $attempt -lt 50; $attempt++) {
    $ErrorActionPreference = 'Continue'
    try {
      $scanResult = (& $helperPath scanpath $harnessPath 2>&1) -join "`n"
    } finally {
      $ErrorActionPreference = 'Stop'
    }
    if ($scanResult -match '(?m)^OK_PID=') { break }
    Start-Sleep -Milliseconds 100
  }
  if ($scanResult -notmatch '(?m)^OK_PID=') {
    throw "Harness menu was not detected: $scanResult"
  }

  $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  $ErrorActionPreference = 'Continue'
  try {
    $reloadResult = (@("reloadpath:$harnessPath|17", 'exit') | & $helperPath daemon 2>&1) -join "`n"
  } finally {
    $ErrorActionPreference = 'Stop'
  }
  $stopwatch.Stop()
  if ($reloadResult -notmatch 'OK_PID=.*ELAPSED_MS=(\d+)') {
    throw "Reload did not complete successfully: $reloadResult"
  }
  $reportedElapsed = [int64]$Matches[1]
  if ($reportedElapsed -lt 1900 -or $stopwatch.ElapsedMilliseconds -lt 1900) {
    throw "Helper returned before M2 completed: reported=$reportedElapsed wall=$($stopwatch.ElapsedMilliseconds)"
  }

  [pscustomobject]@{
    Result = 'PASS'
    ReportedElapsedMs = $reportedElapsed
    WallElapsedMs = $stopwatch.ElapsedMilliseconds
    Helper = $helperPath
    Harness = $harnessPath
  }
} finally {
  if ($harnessProcess -and -not $harnessProcess.HasExited) {
    Stop-Process -Id $harnessProcess.Id -Force -ErrorAction SilentlyContinue
    $harnessProcess.WaitForExit(5000) | Out-Null
  }
  if (Test-Path -LiteralPath $testDirectory) {
    Remove-Item -LiteralPath $testDirectory -Recurse -Force
  }
}
