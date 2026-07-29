#!/usr/bin/env bash
#
# Push your local code changes into the installed Windows app, in seconds.
#
# The Windows app is ~270 MB of Electron runtime plus ~100 KB of this project's
# own code. Only that tiny second part ever changes while you are iterating, so
# there is no reason to rebuild or re-download an installer: this script builds
# the project locally and replaces just the code inside the app folder you
# already have. Your existing desktop shortcut keeps working and keeps pointing
# at the same .exe.
#
#   ./scripts/sync-windows-app.sh              # build, sync, done
#   ./scripts/sync-windows-app.sh --launch     # ...and start the app afterwards
#   ./scripts/sync-windows-app.sh --shortcut   # ...and create the desktop shortcut
#   ./scripts/sync-windows-app.sh --bootstrap  # first time only: create the app folder
#   ./scripts/sync-windows-app.sh --dir '<windows or wsl path>'   # non-default location
#
# Every sync also refreshes the app's icon file, and refreshes an existing
# desktop shortcut so it keeps pointing at this install with the right picture.
#
# Run it from WSL. The app folder defaults to Documents\CODEfold\PixelCompanionWin
# (Windows follows a Documents folder redirected into OneDrive by itself), or to
# whatever PIXEL_COMPANION_WIN_DIR is set to.
#
# Nothing is downloaded except by --bootstrap, which fetches the Windows
# Electron runtime once. Nothing here needs a paid service.

set -euo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$PROJECT_DIR"

LAUNCH=0
SHORTCUT=0
BOOTSTRAP=0
TARGET_DIR="${PIXEL_COMPANION_WIN_DIR:-}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --launch) LAUNCH=1 ;;
    --shortcut) SHORTCUT=1 ;;
    --bootstrap) BOOTSTRAP=1 ;;
    --dir)
      [ "$#" -ge 2 ] || {
        echo "sync-windows-app.sh: --dir needs a path" >&2
        exit 2
      }
      TARGET_DIR="$2"
      shift
      ;;
    -h | --help)
      sed -n '2,23p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "sync-windows-app.sh: unknown option '$1' (try --help)" >&2
      exit 2
      ;;
  esac
  shift
done

log() { printf '\033[36m[pixel-companion]\033[0m %s\n' "$*"; }
die() {
  printf '\033[31m[pixel-companion]\033[0m %s\n' "$*" >&2
  exit 1
}

command -v powershell.exe >/dev/null 2>&1 ||
  die "This script talks to Windows, so it needs to run inside WSL (powershell.exe was not found)."

# --- Where the Windows app lives --------------------------------------------
# A Windows path (C:\...) is accepted as readily as a WSL one, because the
# obvious thing to paste is what Explorer shows you.
to_wsl_path() {
  case "$1" in
    [A-Za-z]:[\\/]* | '\\\\'*) wslpath -u "$1" ;;
    *) printf '%s\n' "$1" ;;
  esac
}

if [ -z "$TARGET_DIR" ]; then
  # Ask Windows for both candidate roots in one call: the projects folder under
  # Documents (which follows a Documents folder redirected into OneDrive), and
  # the older %USERPROFILE% location. An existing install wins, so this never
  # silently strands the app the desktop shortcut already points at.
  WIN_ROOTS="$(powershell.exe -NoProfile -NonInteractive -Command \
    '[Environment]::GetFolderPath("MyDocuments") + "|" + [Environment]::GetFolderPath("UserProfile")' \
    2>/dev/null | tr -d '\r')"
  DOCUMENTS_DIR="${WIN_ROOTS%%|*}"
  USER_PROFILE="${WIN_ROOTS##*|}"
  [ -n "$DOCUMENTS_DIR" ] && [ -n "$USER_PROFILE" ] ||
    die "Could not ask Windows where your user folders are. Pass --dir instead."

  CODEFOLD_DIR="$(wslpath -u "$DOCUMENTS_DIR")/CODEfold/PixelCompanionWin"
  LEGACY_DIR="$(wslpath -u "$USER_PROFILE")/PixelCompanionWin"
  if [ -f "$CODEFOLD_DIR/Pixel Companion.exe" ]; then
    TARGET_DIR="$CODEFOLD_DIR"
  elif [ -f "$LEGACY_DIR/Pixel Companion.exe" ]; then
    TARGET_DIR="$LEGACY_DIR"
  else
    TARGET_DIR="$CODEFOLD_DIR"
  fi
else
  TARGET_DIR="$(to_wsl_path "$TARGET_DIR")"
fi

APP_EXE="$TARGET_DIR/Pixel Companion.exe"
RESOURCES_DIR="$TARGET_DIR/resources"

# --- 1. Build the project locally -------------------------------------------
log "Building the current code..."
"$PROJECT_DIR/scripts/run-linux.sh" --build-only

[ -f dist-electron/electron/main.js ] && [ -f dist/index.html ] ||
  die "The build did not produce dist/ and dist-electron/. Fix the build first."

# --- 2. First-time bootstrap ------------------------------------------------
if [ "$BOOTSTRAP" -eq 1 ]; then
  if [ -f "$APP_EXE" ]; then
    log "The app folder already exists at $TARGET_DIR, so there is nothing to bootstrap."
  else
    log "Fetching the Windows Electron runtime and unpacking the app (once, needs network)..."
    npx --no-install electron-builder --win dir ||
      die "electron-builder could not produce a Windows build. Run 'npm install' and try again."
    [ -d release/win-unpacked ] || die "Expected release/win-unpacked to exist after the build."
    mkdir -p "$TARGET_DIR"
    cp -r release/win-unpacked/. "$TARGET_DIR/"
    log "Installed the app into $TARGET_DIR."
  fi
fi

[ -f "$APP_EXE" ] ||
  die "No Windows app found at $TARGET_DIR. Run this once with --bootstrap, or pass --dir."

# --- 3. Replace just this project's code ------------------------------------
# electron-builder ships the app as resources/app.asar, so the sync produces
# exactly that shape with the same tool it used. When the asar packer is not
# available, an unpacked resources/app folder works just as well, and the old
# archive is moved aside so there can be no doubt about which one Electron runs.
STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGE_DIR"' EXIT
mkdir -p "$STAGE_DIR/app"
cp -r dist "$STAGE_DIR/app/dist"
cp -r dist-electron "$STAGE_DIR/app/dist-electron"
cp package.json "$STAGE_DIR/app/package.json"

mkdir -p "$RESOURCES_DIR"
if [ -x node_modules/.bin/asar ]; then
  node_modules/.bin/asar pack "$STAGE_DIR/app" "$STAGE_DIR/app.asar"
  rm -rf "$RESOURCES_DIR/app"
  cp "$STAGE_DIR/app.asar" "$RESOURCES_DIR/app.asar"
else
  log "Packer not available; syncing as an unpacked folder instead."
  [ -f "$RESOURCES_DIR/app.asar" ] &&
    mv -f "$RESOURCES_DIR/app.asar" "$RESOURCES_DIR/app.asar.replaced-by-sync"
  rm -rf "$RESOURCES_DIR/app"
  cp -r "$STAGE_DIR/app" "$RESOURCES_DIR/app"
fi

log "Synced your changes into $TARGET_DIR."

# --- 4. The app's own icon ---------------------------------------------------
# The executable's embedded icon can only change by repackaging, which is the
# 270 MB round trip this whole script exists to avoid. Shipping the .ico as a
# plain file beside it costs 100 KB and is what the desktop shortcut points at,
# so the companion's face is what the user actually sees either way.
ICON_SOURCE="$PROJECT_DIR/build/icon.ico"
APP_ICON="$TARGET_DIR/app-icon.ico"
if [ -f "$ICON_SOURCE" ]; then
  cp -f "$ICON_SOURCE" "$APP_ICON"
else
  log "No build/icon.ico found; run 'npm run icons' to regenerate it."
fi

# --- 5. Desktop shortcut -----------------------------------------------------
# Created on request, but always refreshed when it already exists: a shortcut
# left pointing at an old install, or at the executable's stock Electron icon,
# is exactly the confusion this avoids.
DESKTOP_DIR="$(powershell.exe -NoProfile -NonInteractive -Command \
  '[Environment]::GetFolderPath("Desktop")' 2>/dev/null | tr -d '\r')"
SHORTCUT_EXISTS=0
if [ -n "$DESKTOP_DIR" ] && [ -f "$(wslpath -u "$DESKTOP_DIR")/Pixel Companion.lnk" ]; then
  SHORTCUT_EXISTS=1
fi

if [ "$SHORTCUT" -eq 1 ] || [ "$SHORTCUT_EXISTS" -eq 1 ]; then
  powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass \
    -File "$(wslpath -w "$PROJECT_DIR/scripts/install-windows-shortcut.ps1")" \
    -AppExe "$(wslpath -w "$APP_EXE")" \
    -IconFile "$(wslpath -w "$APP_ICON")" | tr -d '\r'
fi

# --- 6. Optionally start it --------------------------------------------------
if [ "$LAUNCH" -eq 1 ]; then
  # The app takes a single-instance lock, so a second launch would quit on the
  # spot. Saying so beats starting a process that silently disappears — and the
  # already-running companion is still on the old code until it is restarted.
  if powershell.exe -NoProfile -NonInteractive -Command \
    "if (Get-Process -Name 'Pixel Companion' -ErrorAction SilentlyContinue) { 'yes' }" 2>/dev/null |
    grep -q yes; then
    log "Pixel Companion is already running. Close it and re-run to pick up this sync."
  else
    log "Starting Pixel Companion. Look for its head peeking up from the bottom-right corner."
    # Detached, so closing this terminal does not close the companion.
    powershell.exe -NoProfile -NonInteractive -Command \
      "Start-Process -FilePath '$(wslpath -w "$APP_EXE")'" >/dev/null
  fi
else
  log "Open it from your desktop shortcut, or re-run with --launch."
fi
