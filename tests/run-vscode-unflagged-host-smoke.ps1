[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$CodeExecutable,
    [Parameter(Mandatory)][string]$ExtensionPath
)
$ErrorActionPreference = 'Stop'
$installedExe = (Resolve-Path -LiteralPath $CodeExecutable).Path
$signature = Get-AuthenticodeSignature -LiteralPath $installedExe
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft Corporation') {
    throw 'An official signed Microsoft Code.exe is required.'
}
$installedHash = (Get-FileHash -LiteralPath $installedExe -Algorithm SHA256).Hash
$version = (Get-Item -LiteralPath $installedExe).VersionInfo.ProductVersion
$installRoot = Split-Path -Parent $installedExe
$payloads = @(Get-ChildItem -LiteralPath $installRoot -Directory | Where-Object {
    $product = Join-Path $_.FullName 'resources\app\product.json'
    if ($_.Name -notmatch '^[0-9a-fA-F]{10}$' -or -not (Test-Path -LiteralPath $product)) { return $false }
    $metadata = Get-Content -Raw -LiteralPath $product | ConvertFrom-Json
    return $metadata.version -eq $version -and $metadata.commit.StartsWith($_.Name)
})
if ($payloads.Count -ne 1) { throw 'Exactly one matching installed payload is required.' }
$aliasRoot = Join-Path ([IO.Path]::GetTempPath()) ('boo-code-alias-r16-' + [guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $aliasRoot)
$aliasExe = Join-Path $aliasRoot 'Code.exe'
$aliasPayload = Join-Path $aliasRoot $payloads[0].Name
try {
    Copy-Item -LiteralPath $installedExe -Destination $aliasExe
    [void](New-Item -ItemType Junction -Path $aliasPayload -Target $payloads[0].FullName)
    if ((Get-FileHash -LiteralPath $aliasExe -Algorithm SHA256).Hash -ne $installedHash) { throw 'Executable copy mismatch.' }
    Write-Output "ALIAS_EXE_SHA256=$installedHash;VERSION=$version"
    & (Join-Path $PSScriptRoot 'run-vscode-npc-dialog-host-smoke.ps1') -CodeExecutable $aliasExe -ExtensionPath $ExtensionPath -UseNativeCompatLayer -TimeoutSeconds 45
} finally {
    # Never recursively delete a junction or its target. This wrapper only
    # removes the exact two temporary entries it created, then an empty folder.
    if (Test-Path -LiteralPath $aliasPayload) {
        $link = Get-Item -LiteralPath $aliasPayload -Force
        if ($link.LinkType -ne 'Junction' -or $link.Target -ne $payloads[0].FullName) { throw 'Unexpected temporary link target; retaining alias.' }
        [IO.Directory]::Delete($aliasPayload, $false)
    }
    if (Test-Path -LiteralPath $aliasExe) { Remove-Item -LiteralPath $aliasExe -Force }
    if ((Get-ChildItem -LiteralPath $aliasRoot -Force).Count -eq 0) { [IO.Directory]::Delete($aliasRoot, $false) }
    if ((Get-FileHash -LiteralPath $installedExe -Algorithm SHA256).Hash -ne $installedHash) { throw 'Installed Code.exe changed during verification.' }
    if (-not (Test-Path -LiteralPath $payloads[0].FullName)) { throw 'Installed payload missing after verification.' }
    Write-Output 'INSTALLED_CODE_AND_PAYLOAD_PRESERVED=true'
}
