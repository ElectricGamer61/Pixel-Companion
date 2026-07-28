import type { AppSettings, CheckInState } from './types';

export const DEFAULT_SETTINGS: AppSettings = {
  userName: '',
  companionName: 'Pip',
  checkIns: {
    enabled: true,
    morningEnabled: true,
    morningTime: '09:00',
    eveningEnabled: true,
    eveningTime: '21:00',
    intervalEnabled: false,
    intervalMinutes: 120,
  },
  voice: {
    speakReplies: false,
    voiceName: '',
    rate: 1,
    volume: 0.9,
    micEnabled: true,
  },
  model: {
    enabled: false,
    endpoint: 'http://localhost:11434/v1/chat/completions',
    model: 'llama3.2',
    apiKey: '',
    timeoutMs: 20000,
  },
  windowPosition: null,
  scale: 1,
  alwaysOnTop: true,
};

export const DEFAULT_CHECKIN_STATE: CheckInState = {
  lastMorningDay: null,
  lastEveningDay: null,
  lastIntervalAt: null,
};

/**
 * Merge persisted JSON over the defaults, one level deep for the nested
 * setting groups. Unknown keys are dropped and missing keys fall back, so a
 * settings file written by an older version still loads.
 */
export function mergeSettings(stored: unknown): AppSettings {
  const base: AppSettings = {
    ...DEFAULT_SETTINGS,
    checkIns: { ...DEFAULT_SETTINGS.checkIns },
    voice: { ...DEFAULT_SETTINGS.voice },
    model: { ...DEFAULT_SETTINGS.model },
  };
  if (!stored || typeof stored !== 'object') return base;
  const s = stored as Partial<AppSettings>;

  if (typeof s.userName === 'string') base.userName = s.userName;
  if (typeof s.companionName === 'string' && s.companionName.trim()) {
    base.companionName = s.companionName.trim();
  }
  if (typeof s.scale === 'number' && Number.isFinite(s.scale)) {
    base.scale = Math.min(3, Math.max(1, s.scale));
  }
  if (typeof s.alwaysOnTop === 'boolean') base.alwaysOnTop = s.alwaysOnTop;
  if (
    s.windowPosition &&
    typeof s.windowPosition.x === 'number' &&
    typeof s.windowPosition.y === 'number'
  ) {
    base.windowPosition = { x: s.windowPosition.x, y: s.windowPosition.y };
  }

  Object.assign(base.checkIns, pickSame(base.checkIns, s.checkIns));
  Object.assign(base.voice, pickSame(base.voice, s.voice));
  Object.assign(base.model, pickSame(base.model, s.model));

  base.checkIns.intervalMinutes = Math.min(
    24 * 60,
    Math.max(5, Math.round(base.checkIns.intervalMinutes)),
  );
  base.voice.rate = Math.min(2, Math.max(0.5, base.voice.rate));
  base.voice.volume = Math.min(1, Math.max(0, base.voice.volume));
  base.model.timeoutMs = Math.min(120000, Math.max(1000, Math.round(base.model.timeoutMs)));

  return base;
}

/** Copy only the keys that exist on `target` and whose types match. */
function pickSame<T extends object>(target: T, source: unknown): Partial<T> {
  const out: Partial<T> = {};
  if (!source || typeof source !== 'object') return out;
  for (const key of Object.keys(target) as (keyof T)[]) {
    const value = (source as T)[key];
    if (value !== undefined && typeof value === typeof target[key]) {
      out[key] = value;
    }
  }
  return out;
}

export function mergeCheckInState(stored: unknown): CheckInState {
  const base = { ...DEFAULT_CHECKIN_STATE };
  if (!stored || typeof stored !== 'object') return base;
  const s = stored as Partial<CheckInState>;
  if (typeof s.lastMorningDay === 'string') base.lastMorningDay = s.lastMorningDay;
  if (typeof s.lastEveningDay === 'string') base.lastEveningDay = s.lastEveningDay;
  if (typeof s.lastIntervalAt === 'number') base.lastIntervalAt = s.lastIntervalAt;
  return base;
}
