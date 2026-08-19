<#
.SYNOPSIS
    Install FreeCode on Windows.
.DESCRIPTION
    Downloads the latest self-contained freecode.exe and installs it to
    %LOCALAPPDATA%\freecode\bin, adding that directory to the user PATH.

    One-liner:
      irm https://freecode.website/install.ps1 | iex
#>
param(
    [string]$InstallDir,
    [string]$Version
)

$ErrorActionPreference = 'Stop'
$Repo = "ayan-de/freecode"

if (-not $InstallDir) {
    $InstallDir = Join-Path $env:LOCALAPPDATA "freecode\bin"
}
$FreecodeHome = Join-Path $env:USERPROFILE ".freecode"
$BuildsDir    = Join-Path $FreecodeHome "builds"

# Only x86_64 Windows binaries are published today.
# Artifact is a .zip — the exe plus the onnxruntime DLL(s) the memory graph
# embedder needs at runtime (not embeddable by `bun build --compile`).
$arch = (Get-CimInstance Win32_Processor).Architecture
$Artifact = "freecode-windows-x86_64"

if (-not $Version) {
    Write-Host "Resolving latest release..." -ForegroundColor Blue
    $rel = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest"
    $Version = $rel.tag_name
}
if (-not $Version) { throw "Failed to determine latest version" }
$ver = $Version.TrimStart('v')

$destVersionDir = Join-Path (Join-Path $BuildsDir "versions") $ver
$launcher = Join-Path $InstallDir "freecode.exe"

Write-Host "Installing freecode $Version" -ForegroundColor Blue
New-Item -ItemType Directory -Force -Path $InstallDir, $destVersionDir | Out-Null

$url = "https://github.com/$Repo/releases/download/$Version/$Artifact.zip"
$zipPath = Join-Path $env:TEMP "$Artifact-$ver.zip"
Write-Host "  downloading $Artifact.zip"
Invoke-WebRequest -Uri $url -OutFile $zipPath

Expand-Archive -Force -Path $zipPath -DestinationPath $destVersionDir
Remove-Item -Force $zipPath

$dest = Join-Path $destVersionDir "freecode.exe"
Copy-Item -Force $dest $launcher

# Add InstallDir to the user PATH if missing.
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$InstallDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$InstallDir;$userPath", "User")
    Write-Host "Added $InstallDir to your PATH (restart your terminal)." -ForegroundColor Blue
}

Write-Host ""
Write-Host "OK freecode $Version installed!" -ForegroundColor Green
Write-Host "Run 'freecode' in any project to get started."
Write-Host "Update later with: freecode update"
