import { DEFAULT_SETTINGS, applySettingsPatch } from '../shared/defaults';
import type { AppSettings, CheckInEvent, PlacementEvent, VoiceSettings } from '../shared/types';

/**
 * Access to the preload API, with an in-memory stand-in so the renderer also
 * runs in a plain browser tab (`npm run dev:renderer`) for quick UI iteration.
 */
export interface Bridge {
  platform: string;
  getSettings(): Promise<AppSettings>;
  saveSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  startDrag(): Promise<void>;
  /** `dx`/`dy` are total pointer travel since the press, not increments. */
  dragWindowTo(dx: number, dy: number): Promise<void>;
  endDrag(): Promise<void>;
  goHome(): Promise<void>;
  /** Slide fully on screen while the panel is open, tuck back when it closes. */
  setPanelOpen(open: boolean): Promise<void>;
  setInteractive(interactive: boolean): Promise<void>;
  nativeSpeechAvailable(): Promise<boolean>;
  speakNative(text: string, voice: VoiceSettings): Promise<boolean>;
  stopNativeSpeech(): Promise<void>;
  askModel(system: string, history: { role: string; content: string }[]): Promise<string | null>;
  dataDirectory(): Promise<string>;
  openExternal(url: string): Promise<void>;
  quit(): Promise<void>;
  onCheckIn(handler: (event: CheckInEvent) => void): void;
  /** Whether the companion is tucked at home right now. */
  getPlacement(): Promise<PlacementEvent>;
  /** Told whenever that changes. */
  onPlacement(handler: (event: PlacementEvent) => void): void;
}

/** True when running inside Electron rather than a bare browser tab. */
export const isDesktop = typeof (window as { companion?: unknown }).companion !== 'undefined';

function browserFallback(): Bridge {
  let settings: AppSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as AppSettings;
  // There is no window to move in a browser tab, but the home state is pure UI,
  // so the preview still models it: it starts at home and a "drag" leaves.
  let placement: ((event: PlacementEvent) => void) | null = null;
  let home = true;
  const setHome = (next: boolean): void => {
    if (next === home) return;
    home = next;
    placement?.({ home });
  };
  return {
    platform: 'browser',
    getSettings: async () => settings,
    saveSettings: async (patch) => {
      settings = applySettingsPatch(settings, patch);
      return settings;
    },
    startDrag: async () => undefined,
    dragWindowTo: async () => setHome(false),
    endDrag: async () => undefined,
    goHome: async () => setHome(true),
    setPanelOpen: async () => undefined,
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
    getPlacement: async () => ({ home }),
    onPlacement: (handler) => {
      placement = handler;
    },
  };
}

export const bridge: Bridge =
  (window as unknown as { companion?: Bridge }).companion ?? browserFallback();
