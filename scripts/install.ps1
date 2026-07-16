<#
.SYNOPSIS
    Install FreeCode on Windows.
.DESCRIPTION
    Downloads the latest self-contained freecode.exe and installs it to
    %LOCALAPPDATA%\freecode\bin, adding that directory to the user PATH.

    One-liner:
      irm https://freecode.ayande.xyz/install.ps1 | iex
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
$arch = (Get-CimInstance Win32_Processor).Architecture
$Artifact = "freecode-windows-x86_64.exe"

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

$url = "https://github.com/$Repo/releases/download/$Version/$Artifact"
$dest = Join-Path $destVersionDir "freecode.exe"
Write-Host "  downloading $Artifact"
Invoke-WebRequest -Uri $url -OutFile $dest

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
