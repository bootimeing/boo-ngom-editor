#Requires -Version 5.1

[CmdletBinding()]
param(
	[string]$OutputPath,
	[string]$SourcePath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectDirectory = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($SourcePath)) {
	$SourcePath = Join-Path $projectDirectory 'native\M2Reloader.cpp'
} else {
	$SourcePath = [System.IO.Path]::GetFullPath($SourcePath)
}
$defaultOutputPath = Join-Path $projectDirectory 'runtime\native-win-x64\M2Reloader.exe'
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
	$OutputPath = $defaultOutputPath
} else {
	$OutputPath = [System.IO.Path]::GetFullPath($OutputPath)
}
$outputDirectory = Split-Path -Parent $OutputPath
$objectDirectory = Join-Path $projectDirectory 'obj\Release\native-win-x64'
$outputPath = $OutputPath
$objectName = [System.IO.Path]::GetFileNameWithoutExtension($SourcePath) + '.obj'
$objectPath = Join-Path $objectDirectory $objectName

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) {
	throw 'vswhere.exe was not found. Install the Visual Studio Build Tools C++ x64 workload.'
}

$visualStudioPath = (& $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath).Trim()
if (-not $visualStudioPath) {
	throw 'The Visual Studio C++ x64 toolchain was not found.'
}

$msvcRoot = Join-Path $visualStudioPath 'VC\Tools\MSVC'
$msvcDirectory = Get-ChildItem -LiteralPath $msvcRoot -Directory |
	Sort-Object { [version]$_.Name } -Descending |
	Select-Object -First 1
if (-not $msvcDirectory) {
	throw "The MSVC tools directory was not found: $msvcRoot"
}

$clPath = Join-Path $msvcDirectory.FullName 'bin\Hostx64\x64\cl.exe'
if (-not (Test-Path -LiteralPath $clPath)) {
	throw "The x64 cl.exe was not found: $clPath"
}

$kitsRoot = (Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows Kits\Installed Roots' -Name KitsRoot10).KitsRoot10
$sdkIncludeRoot = Join-Path $kitsRoot 'Include'
$sdkDirectory = Get-ChildItem -LiteralPath $sdkIncludeRoot -Directory |
	Where-Object {
		(Test-Path -LiteralPath (Join-Path $_.FullName 'um\Windows.h')) -and
		(Test-Path -LiteralPath (Join-Path $kitsRoot "Lib\$($_.Name)\ucrt\x64\ucrt.lib")) -and
		(Test-Path -LiteralPath (Join-Path $kitsRoot "Lib\$($_.Name)\um\x64\kernel32.lib"))
	} |
	Sort-Object { [version]$_.Name } -Descending |
	Select-Object -First 1
if (-not $sdkDirectory) {
	throw "A complete Windows 10 SDK was not found: $kitsRoot"
}

$sdkVersion = $sdkDirectory.Name
$oldPath = $env:PATH
$oldInclude = $env:INCLUDE
$oldLib = $env:LIB

try {
	$env:PATH = (@(
		(Join-Path $msvcDirectory.FullName 'bin\Hostx64\x64'),
		(Join-Path $kitsRoot "bin\$sdkVersion\x64"),
		$oldPath
	) -join ';')
	$env:INCLUDE = (@(
		(Join-Path $msvcDirectory.FullName 'include'),
		(Join-Path $kitsRoot "Include\$sdkVersion\ucrt"),
		(Join-Path $kitsRoot "Include\$sdkVersion\shared"),
		(Join-Path $kitsRoot "Include\$sdkVersion\um"),
		(Join-Path $kitsRoot "Include\$sdkVersion\winrt")
	) -join ';')
	$env:LIB = (@(
		(Join-Path $msvcDirectory.FullName 'lib\x64'),
		(Join-Path $kitsRoot "Lib\$sdkVersion\ucrt\x64"),
		(Join-Path $kitsRoot "Lib\$sdkVersion\um\x64")
	) -join ';')

	New-Item -ItemType Directory -Path $outputDirectory,$objectDirectory -Force | Out-Null
	$arguments = @(
		'/nologo',
		'/std:c++17',
		'/permissive-',
		'/utf-8',
		'/O2',
		'/MT',
		'/EHsc',
		'/W4',
		'/WX',
		'/DUNICODE',
		'/D_UNICODE',
		'/DWINVER=0x0601',
		'/D_WIN32_WINNT=0x0601',
		'/DNTDDI_VERSION=0x06010000',
		"/Fo$objectPath",
		"/Fe$outputPath",
		$SourcePath,
		'/link',
		'/MACHINE:X64',
		'/SUBSYSTEM:CONSOLE,6.01',
		'/INCREMENTAL:NO',
		'/OPT:REF',
		'/OPT:ICF',
		'kernel32.lib',
		'user32.lib'
	)

	& $clPath @arguments
	if ($LASTEXITCODE -ne 0) {
		throw "Native M2Reloader compilation failed with cl.exe exit code $LASTEXITCODE."
	}
} finally {
	$env:PATH = $oldPath
	$env:INCLUDE = $oldInclude
	$env:LIB = $oldLib
}

$binary = Get-Item -LiteralPath $outputPath
$sha256 = [System.Security.Cryptography.SHA256]::Create()
$stream = [System.IO.File]::OpenRead($outputPath)
try {
	$hashBytes = $sha256.ComputeHash($stream)
	$hash = ([System.BitConverter]::ToString($hashBytes)).Replace('-', '')
} finally {
	$stream.Dispose()
	$sha256.Dispose()
}
[PSCustomObject]@{
	Path = $binary.FullName
	Length = $binary.Length
	SHA256 = $hash
	MSVC = $msvcDirectory.Name
	WindowsSDK = $sdkVersion
}
