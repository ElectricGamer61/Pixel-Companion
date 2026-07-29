import { BrowserWindow, app, ipcMain, screen, shell } from 'electron';
import { join } from 'node:path';

import { evaluateCheckIns } from '../src/shared/checkins';
import { askLocalModel, type ChatMessage } from '../src/shared/llm';
import type { AppSettings, VoiceSettings } from '../src/shared/types';
import { clampToWorkArea, homePosition, type Point } from '../src/shared/window-position';
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

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

/** The companion's home: bottom-right of the primary display's work area. */
function defaultPosition(): Point {
  return homePosition(screen.getPrimaryDisplay().workArea, WINDOW_SIZE);
}

/**
 * Keep the whole window on a display that actually exists. Monitors get
 * unplugged and a saved position can easily point off-screen.
 */
function clampToDisplay(position: Point): Point {
  const { workArea } = screen.getDisplayNearestPoint(position);
  return clampToWorkArea(position, workArea, WINDOW_SIZE);
}

/**
 * Move the window without ever touching its size.
 *
 * `setBounds` re-states the fixed width and height on every move, so no window
 * manager quirk during a drag can leave the overlay resized.
 */
function moveWindowTo(position: Point): void {
  if (!window || window.isDestroyed()) return;
  const next = clampToDisplay(position);
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
 */
function applyAlwaysOnTop(): void {
  if (!window || window.isDestroyed()) return;
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
 * Persist the window's current position so it reopens where the user left it.
 *
 * Sitting at home is stored as "no custom position" rather than as today's
 * home coordinates, so a companion that was never moved out of the corner still
 * lands in the corner after the screen resolution changes.
 */
function rememberPosition(): void {
  if (!window || window.isDestroyed()) return;
  const [x, y] = window.getPosition();
  const home = defaultPosition();
  settings.windowPosition = x === home.x && y === home.y ? null : { x, y };
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

  ipcMain.handle('window:drag-start', () => {
    if (!window || window.isDestroyed()) return;
    const [x, y] = window.getPosition();
    dragOrigin = { x, y };
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
    rememberPosition();
  });

  // "Return to corner": go home and forget the custom position, so the next
  // launch starts at home too.
  ipcMain.handle('window:home', () => {
    dragOrigin = null;
    moveWindowTo(defaultPosition());
    settings.windowPosition = null;
    saveSettings(settings);
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

// A second launch should focus the existing companion, not spawn another one.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window && !window.isDestroyed()) {
      window.show();
      window.focus();
    }
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
