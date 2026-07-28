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

## Run it

```bash
npm install     # if your npm blocks install scripts: npm approve-scripts electron esbuild
npm start       # production build, then launch
```

For development with hot reload of the UI:

```bash
npm run dev
```

The companion appears in the bottom-right of your primary screen.

| Action | What happens |
| --- | --- |
| Click the character | Opens the chat and settings panel |
| Drag the character | Moves it anywhere; the position is remembered |
| Type and press Enter | The companion replies |
| `Esc` | Closes the panel |
| Settings → Quit companion | Exits the app |

The rest of your desktop stays clickable: the window is transparent, and
click-through is switched off only while the pointer is actually over the
character or the panel.

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
src/renderer/      UI: canvas character, chat panel, settings, speech
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
the unpacked binary launches and persists settings.

Notes for real distribution:

- **Builds are unsigned.** Code signing needs a paid Apple Developer account or a
  Windows certificate, which would break the free promise. Users open an unsigned
  macOS build with right-click → Open, and click through SmartScreen on Windows
  ("More info" → "Run anyway").
- **Cross-compiling** to macOS from Linux is not supported by Apple's tooling.
  Build each platform on that platform, or use free CI runners.
- AppImages need FUSE on some distributions; `--appimage-extract-and-run` works
  where it is missing.

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

## Licence

[MIT](LICENSE). The code and the original pixel art are both covered.
