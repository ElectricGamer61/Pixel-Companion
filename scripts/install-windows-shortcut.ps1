# Create or refresh the "Pixel Companion" shortcut on the Windows desktop.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-windows-shortcut.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install-windows-shortcut.ps1 -Remove
#
# From WSL, `./scripts/sync-windows-app.sh --shortcut` calls this for you.
#
# It writes one file inside your own Desktop folder and nothing else. Running it
# again just rewrites that same file, so it is safe to repeat after moving the
# app.

[CmdletBinding()]
param(
    # Full path to "Pixel Companion.exe". Defaults to the location the sync
    # script uses.
    [string] $AppExe = (Join-Path $env:USERPROFILE 'PixelCompanionWin\Pixel Companion.exe'),
    [string] $Name = 'Pixel Companion',
    [switch] $Remove
)

$ErrorActionPreference = 'Stop'

$desktop = [Environment]::GetFolderPath('Desktop')
$linkPath = Join-Path $desktop "$Name.lnk"

if ($Remove) {
    if (Test-Path -LiteralPath $linkPath) {
        Remove-Item -LiteralPath $linkPath -Force
        Write-Output "Removed $linkPath"
    }
    else {
        Write-Output "Nothing to remove: $linkPath does not exist."
    }
    exit 0
}

if (-not (Test-Path -LiteralPath $AppExe)) {
    Write-Error "No app found at '$AppExe'. Run scripts/sync-windows-app.sh --bootstrap first, or pass -AppExe."
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($linkPath)
$shortcut.TargetPath = $AppExe
$shortcut.WorkingDirectory = Split-Path -Parent $AppExe
$shortcut.IconLocation = $AppExe
$shortcut.Description = 'A free, offline pixel-art companion for emotional support and gentle accountability'
$shortcut.Save()

Write-Output "Desktop shortcut ready: $linkPath -> $AppExe"
