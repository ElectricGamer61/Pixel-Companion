#!/usr/bin/env bash
#
# Install a desktop launcher for Pixel Companion, pointing at this checkout.
#
#   ./scripts/install-linux-launcher.sh              # install / refresh
#   ./scripts/install-linux-launcher.sh --desktop    # also drop a ~/Desktop icon
#   ./scripts/install-linux-launcher.sh --uninstall  # remove what it installed
#
# It writes only inside your home directory, and it is idempotent: running it
# again just rewrites the same files with the current project path.
#
#   ~/.local/share/applications/pixel-companion.desktop   the launcher entry
#   ~/.local/share/icons/hicolor/256x256/apps/pixel-companion.png   the icon
#   ~/Desktop/pixel-companion.desktop                     only with --desktop
#
# Nothing is installed system-wide, nothing needs sudo, and nothing is
# downloaded.

set -euo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
RUN_SCRIPT="$PROJECT_DIR/scripts/run-linux.sh"

APP_ID=pixel-companion
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
APPS_DIR="$DATA_HOME/applications"
ICON_DIR="$DATA_HOME/icons/hicolor/256x256/apps"
DESKTOP_FILE="$APPS_DIR/$APP_ID.desktop"
ICON_FILE="$ICON_DIR/$APP_ID.png"
DESKTOP_COPY="$HOME/Desktop/$APP_ID.desktop"

WITH_DESKTOP_ICON=0
UNINSTALL=0
for arg in "$@"; do
  case "$arg" in
    --desktop) WITH_DESKTOP_ICON=1 ;;
    --uninstall) UNINSTALL=1 ;;
    -h | --help)
      sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "install-linux-launcher.sh: unknown option '$arg' (try --help)" >&2
      exit 2
      ;;
  esac
done

log() { printf '\033[36m[pixel-companion]\033[0m %s\n' "$*"; }

refresh_menu() {
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$APPS_DIR" >/dev/null 2>&1 || true
  fi
}

if [ "$UNINSTALL" -eq 1 ]; then
  rm -f "$DESKTOP_FILE" "$ICON_FILE" "$DESKTOP_COPY"
  refresh_menu
  log "Removed the launcher, its icon, and any desktop copy."
  log "The project itself in $PROJECT_DIR is untouched."
  exit 0
fi

[ -f "$RUN_SCRIPT" ] || {
  echo "install-linux-launcher.sh: cannot find $RUN_SCRIPT" >&2
  exit 1
}
chmod +x "$RUN_SCRIPT"

mkdir -p "$APPS_DIR" "$ICON_DIR"

# Copy the icon rather than pointing at the checkout, so the menu entry keeps a
# picture even while the project is being rebuilt.
if [ -f "$PROJECT_DIR/build/icon.png" ]; then
  cp -f "$PROJECT_DIR/build/icon.png" "$ICON_FILE"
  ICON_VALUE="$APP_ID"
else
  ICON_VALUE="applications-utilities"
fi

# The Exec value follows the desktop-entry spec: the whole command is one
# double-quoted argument so paths containing spaces still work. run-linux.sh
# finds Node itself, which matters because launchers start with a bare PATH.
write_entry() {
  cat >"$1" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=Pixel Companion
GenericName=Desktop companion
Comment=A free, offline pixel-art companion for emotional support and gentle accountability
Exec="$RUN_SCRIPT"
Path=$PROJECT_DIR
Icon=$ICON_VALUE
Terminal=false
Categories=Utility;
Keywords=companion;pixel;pet;wellbeing;
StartupNotify=false
EOF
  chmod +x "$1"
}

write_entry "$DESKTOP_FILE"
refresh_menu

if [ "$WITH_DESKTOP_ICON" -eq 1 ]; then
  if [ -d "$HOME/Desktop" ]; then
    write_entry "$DESKTOP_COPY"
    # GNOME 43+ requires desktop-file copies to be explicitly trusted.
    if command -v gio >/dev/null 2>&1; then
      gio set "$DESKTOP_COPY" metadata::trusted true >/dev/null 2>&1 || true
    fi
    log "Also wrote $DESKTOP_COPY"
  else
    log "No ~/Desktop directory, so the --desktop copy was skipped."
  fi
fi

log "Installed launcher: $DESKTOP_FILE"
log "It runs: $RUN_SCRIPT"
log "Find 'Pixel Companion' in your application menu and start it from there."

if grep -qiE '(microsoft|wsl)' /proc/version 2>/dev/null; then
  cat <<'EOF'

WSL note
  WSLg publishes Linux .desktop entries into the Windows Start menu, but only
  for distributions that have that integration enabled, and Windows refreshes
  its copy lazily - a new entry can take a minute or a `wsl --shutdown` to
  appear under "<your distro>" in the Start menu. Right-click it there to pin
  it to the taskbar.

  If it never shows up, that is a Windows/WSLg integration limit, not an app
  fault. Two reliable fallbacks, both one step:
    - run  ./scripts/run-linux.sh  from a WSL terminal, or
    - make a Windows shortcut to:
        wsl.exe -d <your distro> -- <path>/scripts/run-linux.sh
EOF
fi
