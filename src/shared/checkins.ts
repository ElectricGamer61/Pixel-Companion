import type { CheckInEvent, CheckInSettings, CheckInState } from './types';

/**
 * How long after its scheduled time a daily check-in is still allowed to fire.
 * Without this, launching the app at 11pm would immediately trigger a "good
 * morning" nudge.
 */
export const DAILY_GRACE_MINUTES = 180;

/** Local-time `YYYY-MM-DD` key, used to fire daily check-ins at most once a day. */
export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Parse `HH:MM` into minutes past local midnight, or null if malformed. */
export function parseTimeOfDay(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function minutesIntoDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

const MORNING_PROMPTS = [
  'Morning. How are you feeling as today starts?',
  "Good morning. What's one small thing you'd like to get done today?",
  'Hey, new day. Anything on your mind before you dive in?',
];

const EVENING_PROMPTS = [
  'Evening check-in: how did today actually go for you?',
  'Winding down. What went okay today, even a little?',
  "Before the day closes out, how are you doing right now?",
];

const INTERVAL_PROMPTS = [
  'Just checking in. How are you doing?',
  'Quick pause. Water, posture, breath. How is it going?',
  "Still here with you. Anything you want to say out loud?",
];

/** Deterministic prompt choice so the same day gives the same greeting. */
function pickPrompt(prompts: string[], seed: number): string {
  return prompts[Math.abs(Math.trunc(seed)) % prompts.length];
}

/**
 * Decide which check-ins are due right now.
 *
 * Pure: it takes the clock as an argument and returns both the events to fire
 * and the state to persist, so it is fully testable without timers.
 */
export function evaluateCheckIns(
  now: Date,
  settings: CheckInSettings,
  state: CheckInState,
): { events: CheckInEvent[]; state: CheckInState } {
  const events: CheckInEvent[] = [];
  const next: CheckInState = { ...state };
  if (!settings.enabled) return { events, state: next };

  const today = dayKey(now);
  const nowMinutes = minutesIntoDay(now);

  const daily: {
    kind: 'morning' | 'evening';
    on: boolean;
    time: string;
    lastKey: 'lastMorningDay' | 'lastEveningDay';
    prompts: string[];
  }[] = [
    {
      kind: 'morning',
      on: settings.morningEnabled,
      time: settings.morningTime,
      lastKey: 'lastMorningDay',
      prompts: MORNING_PROMPTS,
    },
    {
      kind: 'evening',
      on: settings.eveningEnabled,
      time: settings.eveningTime,
      lastKey: 'lastEveningDay',
      prompts: EVENING_PROMPTS,
    },
  ];

  for (const entry of daily) {
    if (!entry.on) continue;
    if (next[entry.lastKey] === today) continue;
    const scheduled = parseTimeOfDay(entry.time);
    if (scheduled === null) continue;
    const elapsed = nowMinutes - scheduled;
    if (elapsed < 0 || elapsed > DAILY_GRACE_MINUTES) continue;
    events.push({
      kind: entry.kind,
      message: pickPrompt(entry.prompts, now.getDate() + scheduled),
    });
    next[entry.lastKey] = today;
  }

  if (settings.intervalEnabled && settings.intervalMinutes > 0) {
    const gap = settings.intervalMinutes * 60_000;
    const last = next.lastIntervalAt;
    if (last === null) {
      // Do not nudge the moment the app opens; start the clock instead.
      next.lastIntervalAt = now.getTime();
    } else if (now.getTime() - last >= gap) {
      events.push({
        kind: 'interval',
        message: pickPrompt(INTERVAL_PROMPTS, Math.floor(now.getTime() / gap)),
      });
      next.lastIntervalAt = now.getTime();
    }
  }

  return { events, state: next };
}
