# Create or refresh the "Pixel Companion" shortcut on the Windows desktop.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-windows-shortcut.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install-windows-shortcut.ps1 -Remove
#
# From WSL, `./scripts/sync-windows-app.sh --shortcut` calls this for you, and a
# plain sync refreshes an existing shortcut on its own.
#
# It writes one file inside your own Desktop folder and nothing else. Running it
# again just rewrites that same file, so it is safe to repeat after moving the
# app.

[CmdletBinding()]
param(
    # Full path to "Pixel Companion.exe". Empty means "find the usual install".
    [string] $AppExe = '',
    # Icon shown on the shortcut. Defaults to app-icon.ico beside the app, which
    # the sync script keeps up to date, and falls back to the executable.
    [string] $IconFile = '',
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

if (-not $AppExe) {
    # Same order the sync script uses: the CODEfold projects folder first (which
    # follows a Documents folder redirected into OneDrive), then the older
    # %USERPROFILE% location.
    $candidates = @(
        (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'CODEfold\PixelCompanionWin\Pixel Companion.exe'),
        (Join-Path $env:USERPROFILE 'PixelCompanionWin\Pixel Companion.exe')
    )
    $AppExe = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $AppExe) { $AppExe = $candidates[0] }
}

if (-not (Test-Path -LiteralPath $AppExe)) {
    Write-Error "No app found at '$AppExe'. Run scripts/sync-windows-app.sh --bootstrap first, or pass -AppExe."
}

$appDir = Split-Path -Parent $AppExe

if (-not $IconFile) {
    $bundled = Join-Path $appDir 'app-icon.ico'
    $IconFile = if (Test-Path -LiteralPath $bundled) { $bundled } else { $AppExe }
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($linkPath)
$shortcut.TargetPath = $AppExe
$shortcut.WorkingDirectory = $appDir
$shortcut.IconLocation = "$IconFile,0"
$shortcut.Description = 'A free, offline pixel-art companion for emotional support and gentle accountability'
$shortcut.Save()

# Explorer caches shortcut icons aggressively; touching the file is the gentlest
# nudge that makes it re-read one that has just changed.
(Get-Item -LiteralPath $linkPath).LastWriteTime = Get-Date

Write-Output "Desktop shortcut ready: $linkPath -> $AppExe"
Write-Output "Shortcut icon: $IconFile"
