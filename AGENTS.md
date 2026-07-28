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
- **Click-through is hit-tested per pointer move.** The window covers a rectangle of
  desktop and is `setIgnoreMouseEvents(true, { forward: true })` by default; the renderer
  flips it only while the pointer is over a `[data-interactive]` element. New interactive
  UI must carry that attribute or it will be unclickable.
- **Daily check-ins have a grace window** (`DAILY_GRACE_MINUTES` in
  `src/shared/checkins.ts`), so a check-in never fires long after its time. `evaluateCheckIns`
  takes the clock as an argument — keep it pure so it stays testable without timers.
- **On Linux, Electron usually reports zero speech-synthesis voices**, which is why
  `electron/speech.ts` shells out to `spd-say`/`espeak-ng`. Speech recognition is often
  absent too; typing must always remain a complete input path.
- Under WSLg, Electron logs GPU/`SharedImage` errors on startup. They are environmental
  noise, not app faults.

## Verifying UI changes for real

There is no headless screenshot tool in this environment. Launch the built app with
`--remote-debugging-port=<port> --no-sandbox`, then drive and screenshot it over CDP
(`Runtime.evaluate`, `Page.captureScreenshot`) from a throwaway Node script. That is how
the layout and sprite regressions on this branch were actually found; unit tests alone
did not surface them.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
