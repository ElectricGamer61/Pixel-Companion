/**
 * Types shared between the Electron main process and the renderer.
 *
 * This module must stay dependency-free: it is compiled twice (CommonJS for the
 * main process, ESM for the renderer bundle).
 */

/** Visual states the pixel character can be in. */
export type CompanionMood =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'happy'
  | 'sleeping'
  | 'talking';

export type CheckInKind = 'morning' | 'evening' | 'interval';

export interface CheckInSettings {
  /** Master switch. When false no check-in ever fires. */
  enabled: boolean;
  morningEnabled: boolean;
  /** Local wall-clock time, `HH:MM`, 24h. */
  morningTime: string;
  eveningEnabled: boolean;
  eveningTime: string;
  intervalEnabled: boolean;
  /** Minutes between nudges. Clamped to a sane floor when applied. */
  intervalMinutes: number;
}

/**
 * Optional, entirely opt-in hook for a local model server (Ollama, llama.cpp's
 * server, LM Studio, ...) or a bring-your-own-key HTTP endpoint.
 *
 * Disabled by default: the app is fully functional with the built-in offline
 * rule-based responder and never contacts the network unless the user turns
 * this on and points it somewhere themselves.
 */
export interface ModelSettings {
  enabled: boolean;
  /** OpenAI-compatible chat-completions endpoint. */
  endpoint: string;
  model: string;
  /** Optional bearer token. Stored locally only; blank for local servers. */
  apiKey: string;
  /** Milliseconds before falling back to the offline responder. */
  timeoutMs: number;
}

export interface VoiceSettings {
  /** Speak replies aloud using free OS/browser speech synthesis. */
  speakReplies: boolean;
  /** Preferred synthesis voice name, or '' for the system default. */
  voiceName: string;
  /** 0.5 - 2.0 */
  rate: number;
  /** 0 - 1 */
  volume: number;
  /** Offer the microphone button when the runtime supports recognition. */
  micEnabled: boolean;
}

export interface AppSettings {
  /** What the companion calls the user. Blank means "friend". */
  userName: string;
  /** What the user calls the companion. */
  companionName: string;
  checkIns: CheckInSettings;
  voice: VoiceSettings;
  model: ModelSettings;
  /** Window position, remembered across launches. Null means "bottom right". */
  windowPosition: { x: number; y: number } | null;
  /** Character scale multiplier, 1-3. */
  scale: number;
  alwaysOnTop: boolean;
}

/** Persisted bookkeeping so check-ins do not repeat after a restart. */
export interface CheckInState {
  /** `YYYY-MM-DD` of the last fired morning check-in. */
  lastMorningDay: string | null;
  lastEveningDay: string | null;
  /** Epoch ms of the last interval nudge. */
  lastIntervalAt: number | null;
}

export interface CheckInEvent {
  kind: CheckInKind;
  message: string;
}

export interface CompanionReply {
  text: string;
  mood: CompanionMood;
  /** Set when the reply is a safety response, so the UI can surface resources. */
  safety?: boolean;
  /** Which engine produced the reply. */
  source: 'rules' | 'model';
}

/** The API the preload script exposes to the renderer on `window.companion`. */
export interface CompanionBridge {
  getSettings(): Promise<AppSettings>;
  saveSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  /** Move the frameless window by a screen-space delta. */
  dragWindow(dx: number, dy: number): Promise<void>;
  /** Toggle click-through so the transparent parts of the window are inert. */
  setInteractive(interactive: boolean): Promise<void>;
  /** Ask the main process to speak text with an OS TTS binary. */
  speakNative(text: string, voice: VoiceSettings): Promise<boolean>;
  /** Whether an OS TTS command was found on this machine. */
  nativeSpeechAvailable(): Promise<boolean>;
  /** Forward a prompt to the optional local model server. */
  askModel(prompt: string, history: { role: string; content: string }[]): Promise<string | null>;
  onCheckIn(handler: (event: CheckInEvent) => void): void;
  quit(): Promise<void>;
  platform: string;
}
