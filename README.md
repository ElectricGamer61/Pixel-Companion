# Pixel Companion

A small pixel-art creature that lives in the corner of your desktop. Click it to
talk, and it will listen, reflect things back, and check in on you in the
morning and evening.

It is a companion for emotional support and gentle accountability — not therapy,
not medical advice, and not crisis care.

## The free promise

**This app costs nothing to run, forever, and works with the network unplugged.**

- No account, no sign-up, no licence key.
- No paid API, no cloud model provider, no hosting, no subscription.
- No telemetry, no analytics, no crash reporting, no phoning home.
- Every dependency is free and open source (Electron, Vite, TypeScript, Vitest —
  all MIT/BSD/Apache).
- All artwork is original, hand-authored pixel data in
  [`src/shared/sprite.ts`](src/shared/sprite.ts). No third-party or copyrighted
  sprites, and no downloaded assets.

The only optional network feature is a local model server you run yourself
(Ollama, llama.cpp, LM Studio). It is **off by default**, and the app is fully
functional without it.

## Requirements

- [Node.js](https://nodejs.org) 18 or newer (20+ recommended)
- Linux, macOS, or Windows

## I just want to open it

On **Linux or WSL**, there is a one-time setup and then a launcher you click.

**Once, ever:**

```bash
./scripts/run-linux.sh                  # installs, builds, and starts the app
./scripts/install-linux-launcher.sh     # adds "Pixel Companion" to your app menu
```

The first command is the only one that needs the network, and only for the npm
install. Add `--desktop` to the second to also drop an icon on `~/Desktop`.

**Every time after that:** open your application menu, search *Pixel Companion*,
click it. No terminal, no reinstall, no rebuild.

If you would rather stay in the terminal, `./scripts/run-linux.sh` on its own is
the whole story: it installs dependencies only when `node_modules` is missing,
rebuilds only when the source is newer than the last build, and otherwise starts
the app immediately.

| Command | What it does |
| --- | --- |
| `./scripts/run-linux.sh` | Install if needed, rebuild if stale, run |
| `./scripts/run-linux.sh --no-build` | Run what is already built, as fast as possible |
| `./scripts/run-linux.sh --rebuild` | Force a fresh build first |
| `./scripts/install-linux-launcher.sh` | Create/refresh the app-menu entry |
| `./scripts/install-linux-launcher.sh --uninstall` | Remove the entry and its icon |

The launcher installer only ever writes inside your home directory, never needs
`sudo`, and is safe to re-run — it rewrites the same two files:

- `~/.local/share/applications/pixel-companion.desktop`
- `~/.local/share/icons/hicolor/256x256/apps/pixel-companion.png`
- `~/Desktop/pixel-companion.desktop` (only with `--desktop`)

### WSL / WSLg limitations

WSLg can publish Linux `.desktop` entries into the **Windows Start menu**, but
that is a Windows-side integration, not something this project controls:

- It only works on distributions that have WSL desktop-shortcut integration
  enabled, and Windows refreshes its copy lazily — a brand-new entry may take a
  minute, or a `wsl --shutdown`, to appear under your distro's Start-menu folder.
- If it never appears, that is a WSLg limit rather than an app fault. Two
  reliable fallbacks: run `./scripts/run-linux.sh` from a WSL terminal, or make a
  Windows shortcut to
  `wsl.exe -d <your distro> -- <path>/scripts/run-linux.sh` and pin that.
- Under WSLg, Electron prints GPU / `SharedImage` warnings at startup. They are
  environmental noise; the overlay renders correctly. The run script says so
  rather than hiding it, and deliberately does not change the rendering path.

### Windows, with the project living in WSL

This is the fast way to try your own changes: keep the code in WSL, keep one
real Windows app folder, and copy only the changed code across. **One command:**

```bash
npm run win        # build your changes, push them into the Windows app, start it
```

It takes a couple of seconds. Nothing is downloaded, and no installer is built.

**Once, ever** — if you do not have the Windows app folder yet:

```bash
./scripts/sync-windows-app.sh --bootstrap --shortcut
```

That fetches the Windows runtime one time, puts the app in
`C:\Users\<you>\PixelCompanionWin\`, and creates a **Pixel Companion** shortcut
on your desktop. After that you never need it again.

**To use the desktop shortcut:** point it at
`C:\Users\<you>\PixelCompanionWin\Pixel Companion.exe`. Run
`./scripts/sync-windows-app.sh --shortcut` and the shortcut is created or
refreshed for you. The shortcut never has to change again: syncing replaces the
code *inside* that same app, so the icon you click always runs your latest work.

**Packaged builds are only for sharing.** `npm run package` produces a ~100 MB
installer for giving the app to somebody else. You never need it to try your own
changes.

| Command | What it does |
| --- | --- |
| `npm run win` | Build, sync into the Windows app, launch it |
| `./scripts/sync-windows-app.sh` | Build and sync, without launching |
| `./scripts/sync-windows-app.sh --shortcut` | Also create/refresh the desktop shortcut |
| `./scripts/sync-windows-app.sh --bootstrap` | First-time install of the Windows app folder |
| `./scripts/sync-windows-app.sh --dir '<path>'` | Use an app folder somewhere else |

The app folder can also be set once with the `PIXEL_COMPANION_WIN_DIR`
environment variable. To remove the shortcut:
`powershell.exe -ExecutionPolicy Bypass -File scripts\install-windows-shortcut.ps1 -Remove`.

Why this works: the Windows app is ~270 MB of Electron runtime plus ~100 KB of
this project's own code, and only that small part changes while you iterate. The
sync rebuilds it locally and swaps it in, so there is no reinstall, no download,
and no packaging step in the loop.

On **macOS**, and on Windows without WSL, `npm start` is the equivalent; packaged
installers are on the [roadmap](#roadmap).

## Run it

```bash
npm install     # if your npm blocks install scripts: npm approve-scripts electron esbuild
npm start       # production build, then launch
```

For development with hot reload of the UI:

```bash
npm run dev
```

The companion appears in the bottom-right of your primary screen, sunk half-way
into the bottom edge so only its head peeks up.

| Action | What happens |
| --- | --- |
| Hover the character | It looks up, grins, and shows a two-word hello |
| Click the character | Opens the chat and settings panel |
| Drag the character | Moves it anywhere; the position is remembered |
| Right-click the character | Sends it back to the bottom-right corner |
| Panel header 🏠 button | Same: return to the corner |
| Settings → Appearance → Return to corner | Same, from the settings tab |
| Type and press Enter | The companion replies |
| `Esc` | Closes the panel |
| Panel header ⏻ button | Quits the app |
| Settings → Quit companion | Same, from the settings tab |

The rest of your desktop stays clickable: the window is transparent, and
click-through is switched off only while the pointer is actually over the
character or the panel.

### Where it lives, and getting it back

The companion's **home** is the bottom-right of your primary screen, tucked
half-way down into the bottom edge so only the top of its head shows. That is
where it starts on first run, and it stays out of the way until you want it.

At home it has its own pose: the face rides high on its head so it is actually
visible above the screen edge, with tall eyes that blink and a slow bob as it
rises to look around and settles back. Hovering it, or sending it home, gets a
grin and one short line — "psst.", "still here." — which fades on its own and
never asks you anything. Pick it up and it perks up for the whole drag; set it
down away from the corner and it goes back to its ordinary face. Left alone long
enough it dozes off, at home or wherever you put it.

Opening the chat slides the whole window into view for as long as the panel is
open, then tucks it straight back when you close it, so the panel is never
clipped by the screen edge.

Drag the character to put it wherever you like; that position is remembered
across restarts. Dragging only ever moves it: it never resizes the character, the
chat panel, or the window, and it never opens the panel — only a real click does
that. If it ends up somewhere awkward, any of the three "return to corner"
actions above puts it straight back to the tucked home and forgets the custom
position, so the next launch starts there too. It can never be dragged off the
sides or the top of the screen.

## What the "AI" actually is

Worth being blunt about, because the answer is unusual: **by default there is no
AI model at all.**

- **Default: a free, local, rule-based responder.** Replies come from
  [`src/shared/responder.ts`](src/shared/responder.ts) — pattern matching over
  what you typed, plus hand-written supportive phrasings. It runs in-process, on
  your machine, with the network unplugged. Nothing is sent anywhere.
- **It is not Claude, ChatGPT, Copilot, or any cloud service**, and it does not
  shell out to the Claude Code or Codex CLI. There is no API key to buy and no
  provider to sign up with.
- **Optional: your own local model.** If you already run Ollama, llama.cpp, or
  LM Studio, you can point the companion at that endpoint in
  Settings → *Optional local model*. It is off by default, it stays on your
  machine, and if it is disabled, unreachable, or returns anything unusable the
  app silently falls back to the rule-based responder. See
  [Optional: use a local model](#optional-use-a-local-model).
- **The crisis check always runs first**, before any model, so a model can never
  bypass it.

The trade-off is honest: the offline responder is a good listener with a small
vocabulary, not a conversationalist. Enabling a local model is what buys range,
and that choice — and the hardware to run it — stays entirely yours.

## What it does

**Talks back, offline.** The default conversation engine is a rule-based
responder in [`src/shared/responder.ts`](src/shared/responder.ts). It classifies
what you wrote — anxious, overwhelmed, low, angry, lonely, tired, self-critical,
stuck on a task, or just saying hello — and answers with validation plus one open
question. It rotates through several phrasings so it does not repeat itself. It
requires no model and no network.

**Six pixel states.** Idle (with occasional blinks), listening, thinking, happy,
sleeping, and talking, each with its own face and bob animation. The character
dozes off after five minutes alone and wakes when you interact.

**Checks in on you.** Morning and evening prompts at times you choose, plus an
optional every-N-minutes nudge. A check-in appears as a speech bubble; clicking
it opens the conversation. The schedule and its bookkeeping live in a JSON file
on your disk — no notification service, no scheduler daemon.

A daily check-in only fires within three hours of its scheduled time, so opening
the app at midnight never greets you with "good morning".

**Speaks, where your system can.** See [Voice](#voice) below.

**Says something useful about crisis.** If a message contains self-harm or
suicidal language, the companion drops its normal behaviour, says plainly that
this is beyond what a desktop program can help with, and points to
[988](https://988lifeline.org) (US, call or text) and
[findahelpline.com](https://findahelpline.com) (free lines worldwide). This check
runs before anything else, including before the optional local model, so it
cannot be bypassed by a model's output.

## Voice

Both directions use free, built-in facilities only. There is no paid STT or TTS
dependency anywhere in this project.

**Speech output** (enable in Settings → Voice → *Speak replies aloud*) tries, in
order:

1. The Web Speech API (`speechSynthesis`) using your browser/OS voices.
2. Your operating system's own speech command, run by the main process:
   - macOS: `say` (built in)
   - Windows: PowerShell `System.Speech` / SAPI (built in)
   - Linux: `spd-say` (speech-dispatcher) or `espeak-ng` / `espeak`

On most Linux systems Electron ships no synthesis voices, which is exactly what
the fallback is for. If neither path is available, the Voice settings say so.
To enable speech on Debian/Ubuntu:

```bash
sudo apt install speech-dispatcher espeak-ng
```

**Speech input** uses the Web Speech API (`SpeechRecognition`) when the runtime
provides it. Note that a stock Electron build usually does **not** include a
working recognition backend, so the microphone button may report an error the
first time you use it. That is expected, it costs you nothing, and typing is
always available as the primary input. The Voice settings panel tells you which
engines were actually detected on your machine.

Making dictation reliable everywhere needs a bundled offline recogniser — see the
[roadmap](#roadmap).

## Optional: use a local model

Everything above works with no model. If you already run one locally, point the
companion at it in Settings → *Optional local model*:

| Server | Endpoint |
| --- | --- |
| Ollama | `http://localhost:11434/v1/chat/completions` |
| llama.cpp server | `http://localhost:8080/v1/chat/completions` |
| LM Studio | `http://localhost:1234/v1/chat/completions` |

Any OpenAI-compatible chat-completions endpoint works, and both Ollama response
shapes are handled. The system prompt keeps the model inside the same
non-clinical posture as the offline rules.

If the endpoint is disabled, unreachable, slow, or returns anything unusable, the
app silently falls back to the offline responder. Requests are made from the main
process, and an API-key field exists for a bring-your-own-key endpoint later —
but nothing paid is required, and nothing is sent anywhere unless you switch this
on yourself.

## Privacy

- **Local only.** Two small JSON files (`settings.json`, `checkin-state.json`) in
  your OS per-user app-data directory. The exact path is shown in
  Settings → Privacy.
  - Linux: `~/.config/Pixel Companion/`
  - macOS: `~/Library/Application Support/Pixel Companion/`
  - Windows: `%APPDATA%\Pixel Companion\`
- **Conversations are never written to disk.** The chat log lives in memory and
  disappears when you quit.
- **No telemetry of any kind.** There is no analytics or error-reporting code in
  this repository.
- **Locked-down renderer.** Context isolation on, Node integration off, and a
  Content-Security-Policy that forbids remote scripts, styles, images, and
  connections.

## Safety and scope

Pixel Companion offers **emotional support and accountability**. It is not a
therapist, doctor, counsellor, or crisis service, it does not diagnose, and it
gives no medical advice. It is a small program running on your computer.

If you are in danger or in crisis, please contact a real service: 988 in the US
(call or text), or [findahelpline.com](https://findahelpline.com) for free lines
in other countries.

## Develop

```bash
npm run dev         # Vite dev server + Electron with hot reload
npm run typecheck   # both TS projects: renderer/shared and main process
npm test            # Vitest unit tests
npm run build       # production build of main process + renderer
npm run validate    # typecheck + test + build, all three
```

You can also open the renderer in a plain browser tab with `npm run dev:renderer`
for quick UI work. It runs against an in-memory settings stub; the desktop-only
behaviours (always-on-top, drag, check-in scheduling) are inert there, and the
app says so on screen.

### Layout

```
electron/          Main process: window, IPC, disk persistence, OS speech
  main.ts            Transparent always-on-top window, click-through, scheduler
  preload.ts         The only bridge exposed to the renderer
  store.ts           Atomic JSON persistence
  speech.ts          OS text-to-speech fallback
src/shared/        Pure, dependency-free, compiled for BOTH processes
  responder.ts       Offline rule-based conversation engine
  checkins.ts        Check-in scheduling logic (pure: takes the clock as input)
  sprite.ts          The pixel art, as character grids
  llm.ts             Optional local-model client
  defaults.ts        Defaults and forward-compatible settings merging
  window-position.ts Home placement, on-screen clamping, drag gesture logic
src/renderer/      UI: canvas character, chat panel, settings, speech
scripts/           Local launch helpers (no build-system role)
  run-linux.sh              Install-if-missing, build-if-stale, run
  install-linux-launcher.sh Idempotent ~/.local .desktop entry
  sync-windows-app.sh       Push local changes into the installed Windows app
  install-windows-shortcut.ps1 Idempotent Windows desktop shortcut
tests/             Vitest suites for the shared logic
```

Everything in `src/shared` is pure and imports neither Electron nor the DOM,
which is why the interesting logic — intent classification, crisis detection,
check-in timing, sprite geometry, settings migration — is directly unit-tested.

### Editing the character

The art lives in `src/shared/sprite.ts` as grids of single characters, one per
pixel, with a colour palette above them. A 16x16 body is drawn once and a 12x5
face is stamped on top, so a new expression is five short lines. The tests check
grid dimensions, palette validity, that no face pixel lands outside the body, eye
symmetry, and that every animation references a face that exists.

## Packaging

Packaging is for **giving the app to somebody else**. To try your own changes,
use `./scripts/run-linux.sh` or `npm run win` instead — neither one packages
anything.

```bash
npm run package                    # installer for your current platform
npx electron-builder --linux       # AppImage + deb
npx electron-builder --win         # NSIS installer + portable exe
npx electron-builder --mac         # dmg + zip
```

Output lands in `release/`. Config is in
[`electron-builder.yml`](electron-builder.yml); the icon is the companion's own
happy face, generated from the same sprite data the app draws.

Verified on this branch: `npx electron-builder --linux AppImage` produces a
working, self-contained `release/Pixel Companion-0.1.0.AppImage` (~103 MB), and
the unpacked binary launches and persists settings. `npx electron-builder
--linux deb` produces `release/pixel-companion_0.1.0_amd64.deb` (~72 MB) — this
one needs the `homepage` field in `package.json`, which Debian packaging treats
as required metadata, so do not remove it.

Notes for real distribution:

- **Builds are unsigned.** Code signing needs a paid Apple Developer account or a
  Windows certificate, which would break the free promise. Users open an unsigned
  macOS build with right-click → Open, and click through SmartScreen on Windows
  ("More info" → "Run anyway").
- **Cross-compiling** to macOS from Linux is not supported by Apple's tooling.
  Build each platform on that platform, or use free CI runners.
- AppImages need FUSE on some distributions; `--appimage-extract-and-run` works
  where it is missing.

## Why Electron, and what about Tauri?

Both are free and open source, so this is not a cost question — it is a question
of which one gets the MVP in front of people fastest.

| | Electron (today) | Tauri |
| --- | --- | --- |
| Bundle size | ~70–100 MB, ships its own Chromium | ~5–10 MB, uses the OS webview |
| Memory | Higher | Lower |
| Toolchain | Node only | Node **plus** a Rust toolchain |
| Transparent click-through overlay | Working here today | Supported, but the per-platform behaviour has to be re-proven |
| Web Speech / OS speech fallback | Working here today | Webview-dependent; would need re-testing per platform |

**Electron stays for the MVP.** The whole app is the overlay: a transparent,
always-on-top, click-through window that has to sit correctly on X11, WSLg,
Windows, and macOS. That behaviour is the risky part, it already works, and a
port would mean re-proving it on every platform plus adding Rust to the build —
paying a rewrite before the product idea has been validated.

Tauri's advantage is real but it is a *distribution* advantage: a much smaller
download. That matters when strangers install the app, not while the captain is
checking the MVP. The one-click launcher above removes the friction that
actually exists right now, at zero risk to the look and behaviour.

Nothing here blocks a later port: everything interesting already lives in
`src/shared/**`, which is pure TypeScript with no Electron and no DOM imports.
A Tauri shell would reuse it as-is and rewrite only `electron/`.

## Roadmap

Deliberately out of scope for this first MVP, in rough priority order:

1. **Offline speech recognition** — bundle [Vosk](https://alphacephei.com/vosk/)
   or whisper.cpp so dictation works everywhere without the Web Speech API and
   without any cloud service. This is the main gap in the voice-first direction.
2. **One-click installers** — a free GitHub Actions matrix building AppImage,
   deb, dmg, and NSIS on tag, so nontechnical users never see a terminal.
3. **Launch at login** — an opt-in toggle using Electron's
   `setLoginItemSettings`.
4. **Richer accountability** — named goals and streaks, still local-only, with an
   explicit opt-in before anything is written to disk.
5. **More expressions and a second character** — the grid format makes new faces
   cheap, and the palette is a single object to swap for a recolour.
6. **User-editable response packs** — let people edit the offline responder's
   lines in a plain JSON file without touching TypeScript.
7. **Wayland positioning** — placement is accurate on X11, Win32, and macOS;
   native Wayland restricts programmatic window positioning.
8. **Evaluate a Tauri shell** — worth revisiting once the product is validated
   and download size starts to matter, for the reasons in
   [Why Electron, and what about Tauri?](#why-electron-and-what-about-tauri).
   It is a distribution optimisation, not an MVP task.

## Licence

[MIT](LICENSE). The code and the original pixel art are both covered.
