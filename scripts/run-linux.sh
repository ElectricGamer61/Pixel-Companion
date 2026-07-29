#!/usr/bin/env bash
#
# One-click local launcher for Pixel Companion on Linux and WSLg.
#
# First run installs dependencies and builds. Every run after that starts the
# already-built app straight away, so there is nothing to reinstall.
#
#   ./scripts/run-linux.sh              # install if needed, rebuild if stale, run
#   ./scripts/run-linux.sh --rebuild    # force a fresh build first
#   ./scripts/run-linux.sh --no-build   # run whatever is already built, never build
#
# Nothing here needs the network except the very first `npm install`, and
# nothing here needs a paid service.

set -euo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$PROJECT_DIR"

FORCE_BUILD=0
SKIP_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --rebuild) FORCE_BUILD=1 ;;
    --no-build) SKIP_BUILD=1 ;;
    -h | --help)
      sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "run-linux.sh: unknown option '$arg' (try --help)" >&2
      exit 2
      ;;
  esac
done

log() { printf '\033[36m[pixel-companion]\033[0m %s\n' "$*"; }
die() {
  printf '\033[31m[pixel-companion]\033[0m %s\n' "$*" >&2
  # Launched from a desktop icon there is no terminal to read, so surface the
  # reason as a notification instead of failing silently.
  if [ ! -t 2 ] && command -v notify-send >/dev/null 2>&1; then
    notify-send "Pixel Companion could not start" "$*" >/dev/null 2>&1 || true
  fi
  exit 1
}

# A .desktop launcher starts with a bare environment, so a Node installed by
# nvm (or fnm/volta) is not on PATH. Bring it in before giving up.
if ! command -v node >/dev/null 2>&1; then
  for bootstrap in "${NVM_DIR:-$HOME/.nvm}/nvm.sh" "$HOME/.fnm/fnm.sh"; do
    # shellcheck disable=SC1090 # user-installed version manager, path is dynamic
    [ -s "$bootstrap" ] && . "$bootstrap" >/dev/null 2>&1 || true
  done
  [ -d "$HOME/.volta/bin" ] && PATH="$HOME/.volta/bin:$PATH"
  export PATH
fi

command -v node >/dev/null 2>&1 || die "Node.js 18+ is required but 'node' was not found on PATH."
command -v npm >/dev/null 2>&1 || die "npm is required but was not found on PATH."

# --- 1. Dependencies: only when they are actually missing -------------------
if [ ! -d node_modules ] || [ ! -x node_modules/.bin/electron ]; then
  log "Installing dependencies (first run only, needs network)..."
  npm install
  # Some npm configurations block package install scripts, which leaves the
  # Electron binary unextracted. Recover without making the user guess.
  if [ ! -x node_modules/.bin/electron ]; then
    log "Approving Electron/esbuild install scripts..."
    npm approve-scripts electron esbuild || true
    npm rebuild electron esbuild || true
  fi
  [ -x node_modules/.bin/electron ] || die "Electron did not install. Run 'npm install' manually and read its output."
else
  log "Dependencies already installed."
fi

# --- 2. Build: only when missing or out of date -----------------------------
BUILD_STAMP=dist-electron/electron/main.js
needs_build() {
  [ "$FORCE_BUILD" -eq 1 ] && return 0
  [ -f "$BUILD_STAMP" ] || return 0
  [ -f dist/index.html ] || return 0
  # Any source file newer than the compiled main process means the build is stale.
  local newer
  newer="$(find src electron index.html package.json vite.config.mts tsconfig*.json \
    -newer "$BUILD_STAMP" -print -quit 2>/dev/null || true)"
  [ -n "$newer" ]
}

if [ "$SKIP_BUILD" -eq 1 ]; then
  [ -f "$BUILD_STAMP" ] || die "Nothing is built yet, so --no-build has nothing to run."
  log "Skipping build (--no-build)."
elif needs_build; then
  log "Building (this only happens after the code changes)..."
  npm run build
else
  log "Build is up to date."
fi

# --- 3. Launch --------------------------------------------------------------
ELECTRON_ARGS=()

# Electron's sandbox helper needs to be setuid root. Distro kernels with
# unprivileged user namespaces disabled (and WSL) usually leave it unusable, in
# which case Electron refuses to start at all without this flag.
CHROME_SANDBOX="node_modules/electron/dist/chrome-sandbox"
if [ ! -u "$CHROME_SANDBOX" ]; then
  ELECTRON_ARGS+=(--no-sandbox)
fi

if [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ]; then
  die "No graphical display found (DISPLAY and WAYLAND_DISPLAY are both unset). On WSL, make sure WSLg is available."
fi

# Under WSLg, Electron logs GPU/SharedImage warnings on startup. They are
# environmental noise and the overlay renders correctly, so the rendering path
# is deliberately left alone here — changing it would change how the character
# looks. ELECTRON_EXTRA_ARGS is the escape hatch for one-off experiments.
if grep -qiE '(microsoft|wsl)' /proc/version 2>/dev/null; then
  log "WSL/WSLg detected. GPU warnings in the log below are expected and harmless."
fi

if [ -n "${ELECTRON_EXTRA_ARGS:-}" ]; then
  # shellcheck disable=SC2206 # deliberate word splitting: this is an args string
  ELECTRON_ARGS+=(${ELECTRON_EXTRA_ARGS})
fi

log "Starting Pixel Companion. Look for the character in the bottom-right of your screen."
exec node_modules/.bin/electron "${ELECTRON_ARGS[@]}" .
