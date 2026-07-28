import { DEFAULT_SETTINGS } from '../shared/defaults';
import type { AppSettings, CheckInEvent, VoiceSettings } from '../shared/types';

/**
 * Access to the preload API, with an in-memory stand-in so the renderer also
 * runs in a plain browser tab (`npm run dev:renderer`) for quick UI iteration.
 */
export interface Bridge {
  platform: string;
  getSettings(): Promise<AppSettings>;
  saveSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  dragWindow(dx: number, dy: number): Promise<void>;
  endDrag(): Promise<void>;
  setInteractive(interactive: boolean): Promise<void>;
  nativeSpeechAvailable(): Promise<boolean>;
  speakNative(text: string, voice: VoiceSettings): Promise<boolean>;
  stopNativeSpeech(): Promise<void>;
  askModel(system: string, history: { role: string; content: string }[]): Promise<string | null>;
  dataDirectory(): Promise<string>;
  openExternal(url: string): Promise<void>;
  quit(): Promise<void>;
  onCheckIn(handler: (event: CheckInEvent) => void): void;
}

/** True when running inside Electron rather than a bare browser tab. */
export const isDesktop = typeof (window as { companion?: unknown }).companion !== 'undefined';

function browserFallback(): Bridge {
  let settings: AppSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as AppSettings;
  return {
    platform: 'browser',
    getSettings: async () => settings,
    saveSettings: async (patch) => {
      settings = {
        ...settings,
        ...patch,
        checkIns: { ...settings.checkIns, ...(patch.checkIns ?? {}) },
        voice: { ...settings.voice, ...(patch.voice ?? {}) },
        model: { ...settings.model, ...(patch.model ?? {}) },
      };
      return settings;
    },
    dragWindow: async () => undefined,
    endDrag: async () => undefined,
    setInteractive: async () => undefined,
    nativeSpeechAvailable: async () => false,
    speakNative: async () => false,
    stopNativeSpeech: async () => undefined,
    askModel: async () => null,
    dataDirectory: async () => '(browser preview: nothing is saved to disk)',
    openExternal: async (url) => {
      window.open(url, '_blank', 'noopener');
    },
    quit: async () => undefined,
    onCheckIn: () => undefined,
  };
}

export const bridge: Bridge =
  (window as unknown as { companion?: Bridge }).companion ?? browserFallback();
