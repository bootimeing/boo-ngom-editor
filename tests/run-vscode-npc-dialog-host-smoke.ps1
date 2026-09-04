[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
    [string]$CodeExecutable,

    [Parameter(Mandatory)]
    [ValidateScript({ Test-Path -LiteralPath $_ -PathType Container })]
    [string]$ExtensionPath,

    [ValidateScript({ Test-Path -LiteralPath $_ -PathType Container })]
    [string]$Repository = (Split-Path -Parent $PSScriptRoot),

    [ValidateRange(15, 300)]
    [int]$TimeoutSeconds = 60
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-ProcessRows {
    @(Get-CimInstance Win32_Process |
        Select-Object ProcessId, ParentProcessId, ExecutablePath, CommandLine)
}

function Get-ExactExecutableProcessIds {
    param([Parameter(Mandatory)][string]$ExecutablePath)

    $expected = [IO.Path]::GetFullPath($ExecutablePath)
    $ids = foreach ($row in Get-ProcessRows) {
        if (
            $row.ExecutablePath -and
            [string]::Equals(
                [IO.Path]::GetFullPath($row.ExecutablePath),
                $expected,
                [StringComparison]::OrdinalIgnoreCase
            )
        ) {
            [int]$row.ProcessId
        }
    }
    @($ids)
}

function Get-InvocationProcessIds {
    param(
        [Parameter(Mandatory)][int]$RootProcessId,
        [Parameter(Mandatory)][string]$UniqueMarker,
        [Parameter(Mandatory)][System.Collections.Generic.HashSet[int]]$Baseline
    )

    $rows = Get-ProcessRows
    $owned = [System.Collections.Generic.HashSet[int]]::new()
    if (-not $Baseline.Contains($RootProcessId)) {
        [void]$owned.Add($RootProcessId)
    }

    foreach ($row in $rows) {
        $processId = [int]$row.ProcessId
        if (
            -not $Baseline.Contains($processId) -and
            ([string]$row.CommandLine).IndexOf(
                $UniqueMarker,
                [StringComparison]::OrdinalIgnoreCase
            ) -ge 0
        ) {
            [void]$owned.Add($processId)
        }
    }

    do {
        $changed = $false
        foreach ($row in $rows) {
            $processId = [int]$row.ProcessId
            $parentProcessId = [int]$row.ParentProcessId
            if (
                -not $Baseline.Contains($processId) -and
                $owned.Contains($parentProcessId) -and
                $owned.Add($processId)
            ) {
                $changed = $true
            }
        }
    } while ($changed)

    @($owned)
}

function Remove-ValidatedTestDirectory {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$TemporaryRoot
    )

    $resolvedPath = [IO.Path]::GetFullPath($Path)
    $resolvedTemporaryRoot = [IO.Path]::GetFullPath($TemporaryRoot)
    if (
        -not $resolvedPath.StartsWith(
            $resolvedTemporaryRoot,
            [StringComparison]::OrdinalIgnoreCase
        ) -or
        -not ([IO.Path]::GetFileName($resolvedPath) -like 'boo-vscode-npc-host-*')
    ) {
        throw "Refusing to remove an unsafe test path: $resolvedPath"
    }

    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    do {
        try {
            if (Test-Path -LiteralPath $resolvedPath) {
                Remove-Item -LiteralPath $resolvedPath -Recurse -Force
            }
            return
        } catch {
            $retryable = $_.Exception -is [IO.IOException] -or
                $_.Exception -is [UnauthorizedAccessException]
            if (-not $retryable -or [DateTime]::UtcNow -ge $deadline) {
                throw
            }
            Start-Sleep -Milliseconds 250
        }
    } while ($true)
}

$repositoryRoot = (Resolve-Path -LiteralPath $Repository).Path
$extensionRoot = (Resolve-Path -LiteralPath $ExtensionPath).Path
$codeExecutablePath = (Resolve-Path -LiteralPath $CodeExecutable).Path
if (-not [string]::Equals(
    [IO.Path]::GetFileName($codeExecutablePath),
    'Code.exe',
    [StringComparison]::OrdinalIgnoreCase
)) {
    throw "Refusing to launch anything except an exact Code.exe: $codeExecutablePath"
}

$codeExecutableItem = Get-Item -LiteralPath $codeExecutablePath
$codeSignature = Get-AuthenticodeSignature -LiteralPath $codeExecutablePath
if (
    $codeSignature.Status -ne [Management.Automation.SignatureStatus]::Valid -or
    -not $codeSignature.SignerCertificate -or
    $codeSignature.SignerCertificate.Subject -notmatch '(?i)\bMicrosoft Corporation\b'
) {
    throw "Refusing to launch an unsigned or non-Microsoft Code.exe: $codeExecutablePath"
}
if (
    $codeExecutableItem.VersionInfo.CompanyName -ne 'Microsoft Corporation' -or
    $codeExecutableItem.VersionInfo.ProductName -notlike 'Visual Studio Code*'
) {
    throw "Refusing to launch an executable without official VS Code metadata: $codeExecutablePath"
}

$codeInstallRoot = Split-Path -Parent $codeExecutablePath
$matchingInstallPayloads = @(
    foreach ($candidate in Get-ChildItem -LiteralPath $codeInstallRoot -Directory -Force) {
        if ($candidate.Name -notmatch '^[0-9a-fA-F]{10}$') {
            continue
        }
        $candidateProductJson = Join-Path $candidate.FullName 'resources\app\product.json'
        if (-not (Test-Path -LiteralPath $candidateProductJson -PathType Leaf)) {
            continue
        }
        try {
            $candidateProduct = Get-Content -Raw -LiteralPath $candidateProductJson | ConvertFrom-Json
        } catch {
            continue
        }
        $candidateCommit = [string]$candidateProduct.commit
        $candidateVersion = [string]$candidateProduct.version
        if (
            $candidateCommit.Length -ge 10 -and
            [string]::Equals(
                $candidate.Name,
                $candidateCommit.Substring(0, 10),
                [StringComparison]::OrdinalIgnoreCase
            ) -and
            [string]::Equals(
                $candidateVersion,
                [string]$codeExecutableItem.VersionInfo.ProductVersion,
                [StringComparison]::OrdinalIgnoreCase
            )
        ) {
            [pscustomobject]@{
                Directory = $candidate.FullName
                ProductJson = $candidateProductJson
                Version = $candidateVersion
                Commit = $candidateCommit
            }
        }
    }
)
if ($matchingInstallPayloads.Count -ne 1) {
    throw "Refusing an incomplete or mixed VS Code install: Code.exe version $($codeExecutableItem.VersionInfo.ProductVersion) has $($matchingInstallPayloads.Count) matching commit payloads under $codeInstallRoot"
}
$validatedInstallPayload = $matchingInstallPayloads[0]
$runner = Join-Path $repositoryRoot 'tests\vscode-npc-dialog-command-smoke.js'
if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) {
    throw "Missing Extension Host runner: $runner"
}

$m2Executable = Join-Path $extensionRoot 'tools\M2Reloader\runtime\native-win-x64\M2Reloader.exe'
$temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$runRoot = [IO.Path]::GetFullPath((Join-Path $temporaryRoot (
    'boo-vscode-npc-host-' + [guid]::NewGuid().ToString('N')
)))
if (
    -not $runRoot.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase) -or
    -not ([IO.Path]::GetFileName($runRoot) -like 'boo-vscode-npc-host-*')
) {
    throw "Unsafe temporary test path: $runRoot"
}

$workspace = Join-Path $runRoot 'workspace'
$settingsDirectory = Join-Path $workspace '.vscode'
$userData = Join-Path $runRoot 'user-data'
$extensions = Join-Path $runRoot 'extensions'
$localAppData = Join-Path $runRoot 'local-app-data'
$roamingAppData = Join-Path $runRoot 'roaming-app-data'
$processTemp = Join-Path $runRoot 'process-temp'
$resultPath = Join-Path $runRoot 'host-result.json'

$processBaseline = [System.Collections.Generic.HashSet[int]]::new()
foreach ($row in Get-ProcessRows) {
    [void]$processBaseline.Add([int]$row.ProcessId)
}
$m2Before = if (Test-Path -LiteralPath $m2Executable -PathType Leaf) {
    @(Get-ExactExecutableProcessIds -ExecutablePath $m2Executable)
} else {
    @()
}

$process = $null
$failure = $null
try {
    foreach ($directory in @(
        $workspace,
        $settingsDirectory,
        $userData,
        $extensions,
        $localAppData,
        $roamingAppData,
        $processTemp
    )) {
        [void][IO.Directory]::CreateDirectory($directory)
    }

    $settings = [ordered]@{
        'files.encoding' = 'gb2312'
        'files.autoGuessEncoding' = $false
        'boo.engine' = 'GOM'
        'boo.autoDetectEngine' = $false
        'boo.enableDiagnostics' = $false
        'boo.enableCompletion' = $false
        'workbench.startupEditor' = 'none'
        'window.restoreWindows' = 'none'
        'extensions.ignoreRecommendations' = $true
        'telemetry.telemetryLevel' = 'off'
    } | ConvertTo-Json
    [IO.File]::WriteAllText(
        (Join-Path $settingsDirectory 'settings.json'),
        $settings,
        [Text.UTF8Encoding]::new($false)
    )
    $fixture = @(
        '[@main]',
        '#SAY',
        '<Ctrl+F12 Host Smoke>'
    ) -join "`r`n"
    [IO.File]::WriteAllText(
        (Join-Path $workspace 'npc-smoke.txt'),
        "$fixture`r`n",
        [Text.ASCIIEncoding]::new()
    )

    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $codeExecutablePath
    $startInfo.WorkingDirectory = Split-Path -Parent $codeExecutablePath
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.Environment['__COMPAT_LAYER'] = 'RunAsInvoker'
    [void]$startInfo.Environment.Remove('ELECTRON_RUN_AS_NODE')
    [void]$startInfo.Environment.Remove('VSCODE_DEV')
    [void]$startInfo.Environment.Remove('VSCODE_PORTABLE')
    $startInfo.Environment['LOCALAPPDATA'] = $localAppData
    $startInfo.Environment['APPDATA'] = $roamingAppData
    $startInfo.Environment['TEMP'] = $processTemp
    $startInfo.Environment['TMP'] = $processTemp
    $startInfo.Environment['BOO_NPC_DIALOG_HOST_SMOKE_RESULT'] = $resultPath

    $arguments = @(
        '--new-window',
        "--user-data-dir=$userData",
        "--extensions-dir=$extensions",
        '--disable-workspace-trust',
        '--disable-telemetry',
        '--disable-updates',
        '--skip-welcome',
        '--skip-release-notes',
        '--skip-add-to-recently-opened',
        '--use-inmemory-secretstorage',
        "--extensionDevelopmentPath=$extensionRoot",
        "--extensionTestsPath=$runner",
        $workspace
    )
    foreach ($argument in $arguments) {
        [void]$startInfo.ArgumentList.Add($argument)
    }

    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
        throw 'Failed to start the VS Code Extension Host smoke'
    }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()

    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        $ownedProcessIds = @(
            Get-InvocationProcessIds `
                -RootProcessId $process.Id `
                -UniqueMarker $runRoot `
                -Baseline $processBaseline
        )
        if ($ownedProcessIds.Count -gt 0) {
            Stop-Process -Id $ownedProcessIds -Force -ErrorAction SilentlyContinue
        }
        [void]$process.WaitForExit(5000)
        throw "VS Code Extension Host smoke timed out after $TimeoutSeconds seconds"
    }

    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    if ($stdout) {
        [Console]::Out.Write($stdout)
    }
    if ($stderr) {
        [Console]::Error.Write($stderr)
    }
    if ($process.ExitCode -ne 0) {
        throw "VS Code Extension Host smoke failed with exit code $($process.ExitCode)"
    }
    if (-not (Test-Path -LiteralPath $resultPath -PathType Leaf)) {
        throw "Extension Host smoke did not write its result: $resultPath"
    }

    $result = Get-Content -Raw -LiteralPath $resultPath | ConvertFrom-Json
    if (-not $result.ok) {
        throw "Extension Host smoke returned ok=false: $($result.error)"
    }
    Write-Output (
        'VALIDATED_CODE_EXE=' + $codeExecutablePath +
        ';VERSION=' + $validatedInstallPayload.Version +
        ';COMMIT=' + $validatedInstallPayload.Commit
    )
    Write-Output ('HOST_SMOKE_RESULT=' + ($result | ConvertTo-Json -Compress))
} catch {
    $failure = $_
} finally {
    if (Test-Path -LiteralPath $m2Executable -PathType Leaf) {
        $deadline = [DateTime]::UtcNow.AddSeconds(5)
        do {
            $m2After = @(Get-ExactExecutableProcessIds -ExecutablePath $m2Executable)
            $newM2ProcessIds = @($m2After | Where-Object { $_ -notin $m2Before })
            if ($newM2ProcessIds.Count -eq 0) {
                break
            }
            Start-Sleep -Milliseconds 200
        } while ([DateTime]::UtcNow -lt $deadline)

        if ($newM2ProcessIds.Count -gt 0) {
            Stop-Process -Id $newM2ProcessIds -Force -ErrorAction SilentlyContinue
            if (-not $failure) {
                $failure = [RuntimeException]::new(
                    "M2Reloader daemon leaked from the smoke: $($newM2ProcessIds -join ', ')"
                )
            }
        } else {
            Write-Output 'M2_DAEMON_CLEANUP=NATURAL_PASS'
        }
    }

    try {
        Remove-ValidatedTestDirectory -Path $runRoot -TemporaryRoot $temporaryRoot
    } catch {
        if (-not $failure) {
            $failure = $_
        }
    }
}

if ($failure) {
    throw $failure
}
