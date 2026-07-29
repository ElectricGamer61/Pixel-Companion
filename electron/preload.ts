import { contextBridge, ipcRenderer } from 'electron';

import type { AppSettings, CheckInEvent, VoiceSettings } from '../src/shared/types';

/**
 * The only surface the renderer gets. Context isolation is on and Node
 * integration is off, so everything privileged goes through these named
 * channels.
 */
const api = {
  platform: process.platform,

  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),

  saveSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:save', patch),

  startDrag: (): Promise<void> => ipcRenderer.invoke('window:drag-start'),

  /** `dx`/`dy` are total pointer travel since the press, not increments. */
  dragWindowTo: (dx: number, dy: number): Promise<void> =>
    ipcRenderer.invoke('window:drag-to', dx, dy),

  endDrag: (): Promise<void> => ipcRenderer.invoke('window:drag-end'),

  goHome: (): Promise<void> => ipcRenderer.invoke('window:home'),

  setInteractive: (interactive: boolean): Promise<void> =>
    ipcRenderer.invoke('window:interactive', interactive),

  nativeSpeechAvailable: (): Promise<boolean> => ipcRenderer.invoke('speech:available'),

  speakNative: (text: string, voice: VoiceSettings): Promise<boolean> =>
    ipcRenderer.invoke('speech:speak', text, voice),

  stopNativeSpeech: (): Promise<void> => ipcRenderer.invoke('speech:stop'),

  askModel: (system: string, history: { role: string; content: string }[]): Promise<string | null> =>
    ipcRenderer.invoke('model:ask', system, history),

  dataDirectory: (): Promise<string> => ipcRenderer.invoke('app:data-dir'),

  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:open-external', url),

  quit: (): Promise<void> => ipcRenderer.invoke('app:quit'),

  onCheckIn: (handler: (event: CheckInEvent) => void): void => {
    ipcRenderer.on('companion:check-in', (_event, payload: CheckInEvent) => handler(payload));
  },
};

export type CompanionApi = typeof api;

contextBridge.exposeInMainWorld('companion', api);
