# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

## Orientation

`README.md` is the authoritative description of what the app is, how to run it, its
directory layout, and its roadmap. Read it first; do not duplicate it here.

`npm run validate` (typecheck of both TS projects + Vitest + build) is the gate to run
before calling any change done.

## Non-negotiable product constraints

These are promises made to users in `README.md`, not preferences:

- **No paid or cloud dependency, ever.** No paid API, model provider, hosting, signing
  certificate, or subscription may become required. The optional local-model hook in
  `src/shared/llm.ts` must stay off by default and must fall back silently to the
  offline responder on every failure path.
- **No telemetry, and no conversation ever written to disk.** Only `settings.json` and
  `checkin-state.json` are persisted.
- **No third-party or copyrighted art.** All sprite data is hand-authored in
  `src/shared/sprite.ts` under this project's MIT licence.
- **No clinical framing.** Emotional support and accountability only, never therapy or
  medical advice. The crisis path in `src/shared/responder.ts` runs before every other
  intent *and* before the optional model, so a model can never bypass it. Changes there
  need the safety tests in `tests/responder.test.ts` to keep passing, including the
  false-positive cases ("this deadline is killing me").

## Architecture rules

- `src/shared/**` is compiled **twice**: CommonJS for the main process
  (`tsconfig.main.json`) and ESM into the renderer bundle. It must stay pure — no
  Electron imports, no DOM imports, no Node built-ins. That purity is what makes the
  conversation, scheduling, sprite, and settings logic directly unit-testable.
- The renderer reaches privileged code only through `electron/preload.ts`. Context
  isolation is on, Node integration is off, and `index.html` carries a CSP that forbids
  remote scripts, styles, images, and connections.
- `src/renderer/bridge.ts` provides an in-memory stub of that API so the renderer also
  boots in a plain browser tab. Keep it in sync when adding a preload channel.

## Sharp edges

- **`hidden` loses to `display`.** Several elements toggled with the `hidden` attribute
  are flex containers, and the UA `[hidden] { display: none }` rule loses to any explicit
  `display`. `styles.css` has a global `[hidden] { display: none !important }` for this;
  removing it silently stacks every panel view on top of each other.
- **Window moves must be absolute, never incremental.** `window.getPosition()` is stale
  while the window manager applies a move, so the old `getPosition() + delta` drag
  protocol silently dropped most of the travel (measured: 100 moves of +2px produced
  +22px). The window then lagged the pointer, the gesture degraded into a click, and
  every drag attempt toggled the chat panel open — the "growing blob" the captain saw.
  `src/shared/window-position.ts` is now the single source of truth for home placement,
  clamping, and the drag gesture: the main process latches the origin on
  `window:drag-start` and applies *total* offsets from the press point, which is
  idempotent. Every move restates the fixed window size, so a drag can never resize the
  overlay.
- **`window.getPosition()` is never the answer to "where is the window?".** It is stale
  right after every move, and at start-up under WSLg it reports `(32, 32)` until the
  compositor catches up — which silently made the companion think it was not at home.
  `placedPosition` in `electron/main.ts` latches what was last *asked* for (always
  clamped, since every move goes through `moveWindowTo`), and `currentPosition` returns
  that. Home-ness, drag origins, and the persisted position all read from it.
- **At home only the top half of the sprite exists.** `HOME_VISIBLE_ROWS` in
  `src/shared/sprite.ts` is derived from `HOME_TUCK`; anything drawn below it is under
  the screen edge. That is why the home moods (`peeking`, `greeting`, `dozing`) use the
  `PEEK_FACES`, stamped at `PEEK_FACE_Y` instead of `FACE_Y`, and never bob downwards.
  Tests in `tests/sprite.test.ts` enforce both. The renderer only learns it is at home
  from the main process (`window:placement` at boot, `companion:placement` after), and it
  mirrors the current pose onto `#character[data-mood]` so a CDP session can read it.
- **Home is a deliberate half-off-screen tuck, and the panel has to undo it.** The
  companion rests sunk `HOME_TUCK` into the bottom edge, so `clampToWorkArea` permits an
  `OVERHANG` past the bottom — but only there, because a window stranded off the sides or
  the top has nothing left to grab. The chat panel fills the window, so `window:panel`
  slides it wholly on screen (`NO_OVERHANG`) while open and tucks straight back on close;
  `peekPosition` in `electron/main.ts` holds the resting place meanwhile, and is what
  `rememberPosition` persists. Placement is expressed in terms of `CHARACTER` — where the
  sprite sits inside the mostly-empty window — not the window box, because the character
  is what the user sees.
- **Quitting must stay reachable from the panel header.** The window is frameless and
  `skipTaskbar`, so the OS offers no way out; `#panel-quit` is it.
- **The panel is a conversation with a settings drawer, not a two-tab app.** `#panel-settings`
  swaps `#chat-view` for `#settings-view`; `Esc` backs out of settings first and only then
  closes the panel. Settings is plain stacked sections at 380px wide — no nested boxes — under
  four headings (Check-ins, Voice, Names, On screen), and anything optional, technical, or
  environment-dependent belongs in the collapsed `#advanced` `<details>` at the bottom: the
  model connection, the voice picker and speed, the speech-engine note, and the data directory.
  `tests/settings-ui.test.ts` reads `index.html` and fails if a power-user control or a piece of
  technical wording leaks into the default view, since no other test can see the panel.
- **Click-through is hit-tested per pointer move.** The window covers a rectangle of
  desktop and is `setIgnoreMouseEvents(true, { forward: true })` by default; the renderer
  flips it only while the pointer is over a `[data-interactive]` element. New interactive
  UI must carry that attribute or it will be unclickable.
- **Daily check-ins have a grace window** (`DAILY_GRACE_MINUTES` in
  `src/shared/checkins.ts`), so a check-in never fires long after its time. `evaluateCheckIns`
  takes the clock as an argument — keep it pure so it stays testable without timers.
  Adding a slot means one entry in its `daily` table plus a `last*Day` key; nothing
  else in the app enumerates the kinds. Because grace windows overlap once there are
  four slots a day, `evaluateCheckIns` fires only the **latest-scheduled** due one and
  marks the rest done for today: several questions arriving at once reads as a queue
  being flushed, not a friend. Tests in `tests/checkins.test.ts` pin that.
- **The companion's care is a product promise, not decoration.** The gym and day
  check-ins must stay answerable with "no" at zero cost: no streaks, no counts, no
  body/weight/diet commentary, and nothing scored — in the offline lines *and* in the
  `systemPrompt` that constrains an optional model. `tests/responder.test.ts` asserts it.
  The feeling rules deliberately sit above the exercise rules in `RULES`, so a message
  that is both is answered as the feeling.
- **`ResponderContext.topic` is memory-only, and must stay that way.** It is how a bare
  "yeah"/"nope" is read as an answer to the check-in just asked; the renderer holds it
  for exactly one turn (`openTopic` in `src/renderer/main.ts`). Persisting it would be
  storing conversation, which the constraints above forbid.
- **All settings writes go through `applySettingsPatch`** (`src/shared/defaults.ts`), in
  both the main process and the browser-preview bridge, so a value the UI can produce but
  the app cannot use — an empty gym-day selection, say — is repaired at save time rather
  than only after a restart.
- **On Linux, Electron usually reports zero speech-synthesis voices**, which is why
  `electron/speech.ts` shells out to `spd-say`/`espeak-ng`. Speech recognition is often
  absent too; typing must always remain a complete input path.
- Under WSLg, Electron logs GPU/`SharedImage` errors on startup. They are environmental
  noise, not app faults. Do not "fix" them by disabling the GPU — that changes how the
  transparent overlay renders.
- **Always-on-top must be re-asserted on Linux, and only there.** `setVisibleOnAllWorkspaces`
  clears the hint on Linux, and window managers drop it on map and on blur.
  `applyAlwaysOnTop` in `electron/main.ts` is the single place that applies it; it only
  touches stacking, so it never disturbs the click-through mouse mask. Off Linux it
  returns early when the state already matches: there the call is a real
  `SetWindowPos(HWND_TOPMOST)`, and the `blur` handler fires on every click into another
  app — including while that app is still creating its window, which is how a topmost
  overlay can leave a launching window stuck behind it.
- **`package.json` needs `homepage`.** electron-builder's Debian target treats it as
  required metadata and the `.deb` build fails without it.

## Icons

`npm run icons` regenerates `build/icon.png` and `build/icon.ico` from the sprite data in
`src/shared/sprite.ts`, so the app icon and the character can never drift apart. The
generator (`scripts/generate-icons.mjs`) writes the PNG and ICO containers itself on top
of Node's zlib — no image library, nothing downloaded — and reproduces the original
hand-authored `build/icon.png` pixel for pixel.

`electron-builder.yml` names `win.icon` explicitly. Without a real `.ico` the executable
keeps Electron's default atom icon, which is what a desktop shortcut then shows. Because
re-embedding that icon means repackaging the whole 270 MB app, every sync also drops the
`.ico` beside the executable as `app-icon.ico` and points the shortcut's `IconLocation`
there — same result, 100 KB instead of a rebuild.

## Iterating on the Windows app from WSL

The installed Windows app lives in `Documents\CODEfold\PixelCompanionWin` (Windows
resolves a Documents folder redirected into OneDrive by itself). `sync-windows-app.sh`
finds it, falls back to the older `%USERPROFILE%\PixelCompanionWin`, and refreshes an
existing desktop shortcut on every run so it can never point at a stale install.

Never repackage to test a change on Windows. `scripts/sync-windows-app.sh`
(`npm run win`) builds locally and replaces only `resources/app.asar` inside the
installed app folder — ~100 KB out of ~270 MB, about two seconds, no download.
The `.exe` itself never changes, so the shortcut keeps working; the sync only
rewrites it to keep its target and icon honest. It packs with the same `asar`
binary electron-builder uses, which
is why the result is byte-shaped exactly like a real package; the unpacked
`resources/app` fallback moves `app.asar` aside rather than relying on Electron's
precedence between the two.

Note that `asar extract-file` writes into the **current directory**, so it will
happily overwrite a source file of the same name — extract into a scratch dir.

## Verifying UI changes for real

There is no headless screenshot tool in this environment. Launch the built app with
`--remote-debugging-port=<port> --no-sandbox`, then drive and screenshot it over CDP
(`Runtime.evaluate`, `Page.captureScreenshot`) from a throwaway Node script. That is how
the layout and sprite regressions on this branch were actually found; unit tests alone
did not surface them.

Drive clicks and drags with `Input.dispatchMouseEvent`, not synthetic `PointerEvent`s:
the drag handler calls `setPointerCapture`, which rejects a made-up `pointerId`, so a
dispatched gesture silently does nothing. To see the companion *on the desktop* from
WSL, screenshot Windows with `BitBlt` plus `CAPTUREBLT` (a transparent layered window is
missing from a plain `CopyFromScreen`) after `SetProcessDPIAware` — Electron reports
positions in DIPs while the capture works in physical pixels, and mixing the two lands
you in the wrong corner.

**Several `Pixel Companion.exe` processes in Task Manager is one running companion.**
Electron always forks a GPU process, a utility process, and a renderer alongside main, so
four entries is the healthy shape. `app.requestSingleInstanceLock()` in `electron/main.ts`
keys on the per-user data directory: measured, six launches produce exactly one main
process, each loser exiting in ~200 ms. Look for more than one *main* (no `--type=` in
its command line) before suspecting a pile-up.

**The losing instance must `app.exit(0)`, never `app.quit()`.** That branch runs before
`app.whenReady()`, and a graceful quit needs the message loop to reach its shutdown, so
pre-ready `app.quit()` is simply dropped: measured on Electron 33, every extra launch left
a windowless main process alive forever (six launches, six survivors, only SIGTERM ended
them). Nothing is visible on screen, which is what makes it easy to miss — the tell is the
process list, not the desktop. The loser owns no window and no state (the primary holds
`settings.json`), so there is nothing to unwind.

Two traps when testing from a git worktree:

- The app takes a **single-instance lock keyed on the shared user-data directory**
  (`~/.config/Pixel Companion/`), so an instance running from another worktree makes
  yours exit immediately and silently. Pass `--user-data-dir=<scratch path>` — and a
  distinct `--remote-debugging-port` — to run one in parallel.
- `scripts/run-linux.sh` is the fastest way to launch a build; `ELECTRON_EXTRA_ARGS`
  passes those debugging flags through without editing the script.

A taken `--remote-debugging-port` fails **silently**: Electron starts and the app runs
normally, but no `DevTools listening on ...` line appears and `/json/list` answers for
whatever already owns the port — so a driver script happily attaches to an unrelated app
and reports nonsense. Grep the launch log for that line before trusting a CDP session.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
