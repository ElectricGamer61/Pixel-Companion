import { BrowserWindow, app, ipcMain, screen, shell } from 'electron';
import { join } from 'node:path';

import { evaluateCheckIns } from '../src/shared/checkins';
import { askLocalModel, type ChatMessage } from '../src/shared/llm';
import type { AppSettings, VoiceSettings } from '../src/shared/types';
import {
  NO_OVERHANG,
  OVERHANG,
  clampToWorkArea,
  homePosition,
  type Point,
} from '../src/shared/window-position';
import {
  dataDirectory,
  loadCheckInState,
  loadSettings,
  saveCheckInState,
  saveSettings,
} from './store';
import { nativeSpeechAvailable, speakNative, stopNative } from './speech';

/**
 * Logical size of the companion window: character plus its chat panel.
 *
 * This is a hard invariant. The window is a fixed-size overlay, so every place
 * that positions it re-states the size instead of trusting whatever the window
 * manager currently believes — that is what keeps a drag from ever resizing it.
 */
const WINDOW_SIZE = { width: 380, height: 520 } as const;
/** How often the check-in scheduler wakes up. */
const SCHEDULER_INTERVAL_MS = 30_000;

let window: BrowserWindow | null = null;
let settings: AppSettings = { ...loadSettings() };
let schedulerTimer: NodeJS.Timeout | null = null;
/**
 * Window origin latched when a drag starts. Drag moves are absolute offsets
 * from this point, never increments applied to a live (and often stale) read of
 * the current position.
 */
let dragOrigin: Point | null = null;
/**
 * Where to tuck back to when the chat panel closes, or `null` while it is shut.
 *
 * At home the companion hangs half off the right edge of the screen, but the
 * panel is as wide as the whole window, so an open panel would be clipped by
 * exactly that overhang. Opening it slides the window wholly on screen and
 * remembers where it came from; closing it slides straight back.
 */
let peekPosition: Point | null = null;
/**
 * The last position the window was asked to take, which is the only reliable
 * answer to "where is it?" — see `currentPosition`.
 */
let placedPosition: Point | null = null;

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

/** The companion's home: peeking out of the primary display's bottom-right. */
function defaultPosition(): Point {
  return homePosition(screen.getPrimaryDisplay().workArea, WINDOW_SIZE);
}

/**
 * How far off the screen edge the window is currently allowed to hang: the
 * tucked overhang normally, nothing at all while the panel needs to be read.
 */
function currentOverhang(): Point {
  return peekPosition ? NO_OVERHANG : OVERHANG;
}

/**
 * Keep the window on a display that actually exists. Monitors get unplugged and
 * a saved position can easily point off-screen.
 */
function clampToDisplay(position: Point, overhang: Point = currentOverhang()): Point {
  const { workArea } = screen.getDisplayNearestPoint(position);
  return clampToWorkArea(position, workArea, WINDOW_SIZE, overhang);
}

/**
 * Where the window is, in screen coordinates.
 *
 * This is the position we last *asked* for, not `window.getPosition()`. The
 * window manager applies moves asynchronously, so a read straight after a move
 * — including the very first placement at start-up, which reports (32, 32)
 * under WSLg until the compositor catches up — is routinely stale. Every move
 * goes through `moveWindowTo`, which clamps first, so the latched value is
 * exactly where the window is heading and never drifts.
 */
function currentPosition(): Point | null {
  if (!window || window.isDestroyed()) return null;
  return placedPosition ? { ...placedPosition } : null;
}

/**
 * Move the window without ever touching its size.
 *
 * `setBounds` re-states the fixed width and height on every move, so no window
 * manager quirk during a drag can leave the overlay resized.
 */
function moveWindowTo(position: Point, overhang: Point = currentOverhang()): void {
  if (!window || window.isDestroyed()) return;
  const next = clampToDisplay(position, overhang);
  placedPosition = next;
  window.setBounds({ ...next, ...WINDOW_SIZE });
}

/**
 * Apply the always-on-top preference.
 *
 * On Linux this has to be re-asserted rather than set once: several window
 * managers drop the hint when the window is first mapped, and
 * `setVisibleOnAllWorkspaces` clears it outright, so the call order below
 * matters. Re-applying only touches stacking — it never focuses the window and
 * never changes the mouse-event mask, so click-through is unaffected.
 *
 * Everywhere else the re-assert is skipped when the state already matches. On
 * Windows this call is a `SetWindowPos(HWND_TOPMOST)`, and the `blur` handler
 * fires it every single time the user clicks another app — including while that
 * app is still creating its window and negotiating the foreground, which is
 * where a topmost overlay can leave a launching window stuck behind it. Linux
 * is the exception because Electron's cached flag says nothing about what the
 * window manager actually did.
 */
function applyAlwaysOnTop(): void {
  if (!window || window.isDestroyed()) return;
  if (process.platform !== 'linux' && window.isAlwaysOnTop() === settings.alwaysOnTop) return;
  if (settings.alwaysOnTop) {
    // 'floating' keeps the companion above normal windows without fighting
    // full-screen apps or system dialogs.
    window.setAlwaysOnTop(true, 'floating');
  } else {
    window.setAlwaysOnTop(false);
  }
}

function createWindow(): void {
  const position = clampToDisplay(settings.windowPosition ?? defaultPosition());
  placedPosition = position;

  window = new BrowserWindow({
    ...WINDOW_SIZE,
    // Belt and braces with `resizable: false`: a window manager that ignores
    // the resizable hint still has to honour the size constraints.
    minWidth: WINDOW_SIZE.width,
    maxWidth: WINDOW_SIZE.width,
    minHeight: WINDOW_SIZE.height,
    maxHeight: WINDOW_SIZE.height,
    x: position.x,
    y: position.y,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: settings.alwaysOnTop,
    // Transparent windows must not paint a background colour.
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Order matters: this clears the always-on-top hint on Linux, so it goes
  // first and `applyAlwaysOnTop` re-asserts afterwards.
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  applyAlwaysOnTop();

  // The window starts click-through; the renderer turns interaction back on
  // when the pointer is actually over the character or a panel.
  window.setIgnoreMouseEvents(true, { forward: true });

  // External links (crisis resources) belong in the user's real browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void window.loadURL(devUrl);
  } else {
    void window.loadFile(join(__dirname, '../../dist/index.html'));
  }

  window.once('ready-to-show', () => {
    window?.show();
    // Some Linux window managers only honour the hint once the window is
    // actually mapped.
    applyAlwaysOnTop();
  });
  // Losing focus is where a window manager is most likely to restack the
  // companion behind whatever the user just clicked.
  window.on('blur', () => applyAlwaysOnTop());
  // Last line of defence for the size invariant: if anything ever does resize
  // the overlay, snap it straight back rather than leaving a grown blob on the
  // desktop. This only touches size, so it cannot disturb click-through.
  window.on('resize', () => {
    if (!window || window.isDestroyed()) return;
    const [width, height] = window.getSize();
    if (width !== WINDOW_SIZE.width || height !== WINDOW_SIZE.height) {
      window.setSize(WINDOW_SIZE.width, WINDOW_SIZE.height);
    }
  });
  window.on('closed', () => {
    window = null;
  });
}

/**
 * Where the companion rests: its tucked place, even while the panel has slid it
 * temporarily on screen.
 */
function restingPosition(): Point | null {
  return peekPosition ?? currentPosition();
}

/** Whether the companion is sitting in its corner rather than somewhere the user dragged it. */
function isAtHome(): boolean {
  const at = restingPosition();
  if (!at) return false;
  const home = defaultPosition();
  return at.x === home.x && at.y === home.y;
}

/**
 * Tell the renderer whether the companion is tucked at home, so it can wear its
 * peeking face there and its ordinary face anywhere else. Only the main process
 * knows where the window actually is, so this is the one source of truth.
 */
function sendPlacement(): void {
  if (!window || window.isDestroyed()) return;
  window.webContents.send('companion:placement', { home: isAtHome() });
}

/**
 * Persist the window's current position so it reopens where the user left it.
 *
 * Sitting at home is stored as "no custom position" rather than as today's
 * home coordinates, so a companion that was never moved out of the corner still
 * lands in the corner after the screen resolution changes.
 */
function rememberPosition(): void {
  // While the panel is open the window is deliberately slid off its resting
  // place, so the tucked position is the one worth saving.
  const at = restingPosition();
  if (!at) return;
  settings.windowPosition = isAtHome() ? null : { ...at };
  saveSettings(settings);
}

function startScheduler(): void {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = setInterval(() => {
    if (!window || window.isDestroyed()) return;
    const state = loadCheckInState();
    const result = evaluateCheckIns(new Date(), settings.checkIns, state);
    if (
      result.state.lastMorningDay !== state.lastMorningDay ||
      result.state.lastEveningDay !== state.lastEveningDay ||
      result.state.lastIntervalAt !== state.lastIntervalAt
    ) {
      saveCheckInState(result.state);
    }
    for (const event of result.events) {
      window.webContents.send('companion:check-in', event);
    }
  }, SCHEDULER_INTERVAL_MS);
}

function registerIpc(): void {
  ipcMain.handle('settings:get', () => settings);

  ipcMain.handle('settings:save', (_event, patch: Partial<AppSettings>) => {
    settings = {
      ...settings,
      ...patch,
      checkIns: { ...settings.checkIns, ...(patch.checkIns ?? {}) },
      voice: { ...settings.voice, ...(patch.voice ?? {}) },
      model: { ...settings.model, ...(patch.model ?? {}) },
    };
    saveSettings(settings);
    applyAlwaysOnTop();
    return settings;
  });

  // Asked once at boot: a renderer that started after the window was placed has
  // no event to have missed, so it reads the state instead of waiting for one.
  ipcMain.handle('window:placement', () => ({ home: isAtHome() }));

  ipcMain.handle('window:drag-start', () => {
    dragOrigin = currentPosition();
  });

  // `dx`/`dy` are the pointer's total travel since the press, not an increment.
  // Applying them to the latched origin makes every move idempotent, so a stale
  // position read can neither drop travel nor compound it.
  ipcMain.handle('window:drag-to', (_event, dx: number, dy: number) => {
    if (!dragOrigin) return;
    moveWindowTo({ x: dragOrigin.x + Math.round(dx), y: dragOrigin.y + Math.round(dy) });
  });

  ipcMain.handle('window:drag-end', () => {
    dragOrigin = null;
    // Dragging with the panel open moves the resting place too, otherwise
    // closing the panel would yank the companion back to where it started.
    if (peekPosition) peekPosition = currentPosition();
    rememberPosition();
    sendPlacement();
  });

  // "Return to corner": tuck back into the corner and forget the custom
  // position, so the next launch starts at home too.
  ipcMain.handle('window:home', () => {
    dragOrigin = null;
    const home = defaultPosition();
    if (peekPosition) {
      // The panel is open and must stay readable, so slide only as far as the
      // corner allows; the tuck happens when the panel closes.
      peekPosition = home;
      moveWindowTo(home, NO_OVERHANG);
    } else {
      moveWindowTo(home);
    }
    settings.windowPosition = null;
    saveSettings(settings);
    sendPlacement();
  });

  // The chat panel fills the window, so it cannot be read while the companion
  // is tucked half off the screen. Slide fully on screen for as long as it is
  // open, and tuck straight back afterwards.
  ipcMain.handle('window:panel', (_event, open: boolean) => {
    if (!window || window.isDestroyed()) return;
    if (open) {
      if (peekPosition) return;
      const resting = currentPosition();
      if (!resting) return;
      peekPosition = resting;
      moveWindowTo(resting, NO_OVERHANG);
    } else {
      const resting = peekPosition;
      if (!resting) return;
      peekPosition = null;
      moveWindowTo(resting);
    }
  });

  ipcMain.handle('window:interactive', (_event, interactive: boolean) => {
    if (!window || window.isDestroyed()) return;
    window.setIgnoreMouseEvents(!interactive, { forward: true });
  });

  ipcMain.handle('speech:available', () => nativeSpeechAvailable());

  ipcMain.handle('speech:speak', (_event, text: string, voice: VoiceSettings) =>
    speakNative(text, voice),
  );

  ipcMain.handle('speech:stop', () => stopNative());

  ipcMain.handle('model:ask', async (_event, system: string, history: ChatMessage[]) =>
    askLocalModel(settings.model, system, history),
  );

  ipcMain.handle('app:data-dir', () => dataDirectory());

  ipcMain.handle('app:open-external', (_event, url: string) => {
    if (/^https?:\/\//.test(url)) return shell.openExternal(url);
    return undefined;
  });

  ipcMain.handle('app:quit', () => app.quit());
}

// A second launch should surface the existing companion, not spawn another one.
// The lock is keyed on the per-user data directory, so double-clicking the
// desktop shortcut a dozen times still leaves exactly one main process (plus
// Electron's usual GPU, utility, and renderer children — several
// "Pixel Companion.exe" entries in Task Manager are one running companion, not
// a pile-up).
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // A companion whose window was somehow lost still has to answer the second
    // launch with a visible character, or the app looks like it failed to open
    // and the user keeps clicking.
    if (!window || window.isDestroyed()) {
      if (app.isReady()) createWindow();
      return;
    }
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    applyAlwaysOnTop();
  });

  void app.whenReady().then(() => {
    registerIpc();
    createWindow();
    startScheduler();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  // The companion is a desktop pet: closing its window means quitting, on
  // every platform including macOS.
  app.quit();
});

app.on('before-quit', () => {
  stopNative();
  if (schedulerTimer) clearInterval(schedulerTimer);
  rememberPosition();
});

if (isDev) {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('render-process-gone', (_e, details) => {
      console.error('[pixel-companion] renderer gone', details);
    });
  });
}
