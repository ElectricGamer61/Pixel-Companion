import { BrowserWindow, app, ipcMain, screen, shell } from 'electron';
import { join } from 'node:path';

import { evaluateCheckIns } from '../src/shared/checkins';
import { askLocalModel, type ChatMessage } from '../src/shared/llm';
import type { AppSettings, VoiceSettings } from '../src/shared/types';
import {
  dataDirectory,
  loadCheckInState,
  loadSettings,
  saveCheckInState,
  saveSettings,
} from './store';
import { nativeSpeechAvailable, speakNative, stopNative } from './speech';

/** Logical size of the companion window: character plus its chat panel. */
const WINDOW_WIDTH = 380;
const WINDOW_HEIGHT = 520;
/** Gap from the screen edges when placed bottom-right. */
const EDGE_MARGIN = 24;
/** How often the check-in scheduler wakes up. */
const SCHEDULER_INTERVAL_MS = 30_000;

let window: BrowserWindow | null = null;
let settings: AppSettings = { ...loadSettings() };
let schedulerTimer: NodeJS.Timeout | null = null;

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

/** Place the window bottom-right of the primary display's work area. */
function defaultPosition(): { x: number; y: number } {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - WINDOW_WIDTH - EDGE_MARGIN,
    y: workArea.y + workArea.height - WINDOW_HEIGHT - EDGE_MARGIN,
  };
}

/**
 * Keep the window on a display that actually exists. Monitors get unplugged and
 * a saved position can easily point off-screen.
 */
function clampToDisplay(position: { x: number; y: number }): { x: number; y: number } {
  const display = screen.getDisplayNearestPoint(position);
  const { workArea } = display;
  return {
    x: Math.round(Math.min(Math.max(position.x, workArea.x), workArea.x + workArea.width - 80)),
    y: Math.round(Math.min(Math.max(position.y, workArea.y), workArea.y + workArea.height - 80)),
  };
}

function createWindow(): void {
  const position = clampToDisplay(settings.windowPosition ?? defaultPosition());

  window = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
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

  if (settings.alwaysOnTop) {
    // 'floating' keeps the companion above normal windows without fighting
    // full-screen apps or system dialogs.
    window.setAlwaysOnTop(true, 'floating');
  }
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });

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

  window.once('ready-to-show', () => window?.show());
  window.on('closed', () => {
    window = null;
  });
}

/** Persist the window's current position so it reopens where the user left it. */
function rememberPosition(): void {
  if (!window || window.isDestroyed()) return;
  const [x, y] = window.getPosition();
  settings.windowPosition = { x, y };
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
    if (window && !window.isDestroyed()) {
      window.setAlwaysOnTop(settings.alwaysOnTop, settings.alwaysOnTop ? 'floating' : 'normal');
    }
    return settings;
  });

  ipcMain.handle('window:drag', (_event, dx: number, dy: number) => {
    if (!window || window.isDestroyed()) return;
    const [x, y] = window.getPosition();
    const next = clampToDisplay({ x: x + Math.round(dx), y: y + Math.round(dy) });
    window.setPosition(next.x, next.y);
  });

  ipcMain.handle('window:drag-end', () => rememberPosition());

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
