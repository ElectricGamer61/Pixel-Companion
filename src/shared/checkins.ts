import type { CheckInEvent, CheckInKind, CheckInSettings, CheckInState } from './types';

/**
 * How long after its scheduled time a daily check-in is still allowed to fire.
 * Without this, launching the app at 11pm would immediately trigger a "good
 * morning" nudge.
 *
 * The window is half-open — `[time, time + grace)` — so slots spaced a whole
 * grace period apart tile the day without ever being due at the same minute.
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

/**
 * The gym check-in is a friend asking, not a coach measuring. Every phrasing
 * has to be as easy to answer with "no" as with "yes", and none of them may
 * suggest what the user's body should be doing.
 */
const GYM_PROMPTS = [
  'Gym question: did you get moving today, or is it still ahead of you?',
  'Hey - did you make it to your workout? Honest answer, no judgement either way.',
  'Checking in on the moving-your-body plan. How did it go today?',
];

/** The general "did you do something with your day" buddy check-in. */
const LIFE_PROMPTS = [
  'Did you get to do anything today that was actually for you?',
  'One thing: what did you do with today that you are glad about?',
  'How was your day for real - anything you would call a win, even a small one?',
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

/** Day names in `Date.getDay()` order, so `gymDays` has one obvious reading. */
export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * Keep only the digits `0`-`6`, de-duplicated and in week order. Used both when
 * loading settings and when the UI writes a new selection, so the stored string
 * has exactly one shape.
 */
export function normalizeDays(value: string): string {
  const seen = new Set(value.split('').filter((char) => char >= '0' && char <= '6'));
  return [...seen].sort().join('');
}

/** Whether a day-restricted slot is allowed to fire on `now`'s weekday. */
export function dayAllowed(days: string, now: Date): boolean {
  return days.includes(String(now.getDay()));
}

/** One scheduled once-a-day check-in. `days` restricts it to certain weekdays. */
interface DailySlot {
  kind: Exclude<CheckInKind, 'interval'>;
  on: boolean;
  time: string;
  lastKey: 'lastMorningDay' | 'lastEveningDay' | 'lastGymDay' | 'lastLifeDay';
  prompts: string[];
  days?: string;
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

  const daily: DailySlot[] = [
    {
      kind: 'morning',
      on: settings.morningEnabled,
      time: settings.morningTime,
      lastKey: 'lastMorningDay',
      prompts: MORNING_PROMPTS,
    },
    {
      kind: 'gym',
      on: settings.gymEnabled,
      time: settings.gymTime,
      lastKey: 'lastGymDay',
      prompts: GYM_PROMPTS,
      // The only slot that is not every day: nobody trains seven days a week,
      // and a nudge on a rest day is exactly how a buddy turns into a nag.
      days: settings.gymDays,
    },
    {
      kind: 'life',
      on: settings.lifeEnabled,
      time: settings.lifeTime,
      lastKey: 'lastLifeDay',
      prompts: LIFE_PROMPTS,
    },
    {
      kind: 'evening',
      on: settings.eveningEnabled,
      time: settings.eveningTime,
      lastKey: 'lastEveningDay',
      prompts: EVENING_PROMPTS,
    },
  ];

  /** Every daily check-in that is switched on, due, and not yet done today. */
  const due: { entry: DailySlot; scheduled: number }[] = [];
  for (const entry of daily) {
    if (!entry.on) continue;
    if (next[entry.lastKey] === today) continue;
    if (entry.days !== undefined && !dayAllowed(entry.days, now)) continue;
    const scheduled = parseTimeOfDay(entry.time);
    if (scheduled === null) continue;
    const elapsed = nowMinutes - scheduled;
    if (elapsed < 0 || elapsed >= DAILY_GRACE_MINUTES) continue;
    due.push({ entry, scheduled });
  }

  /*
   * Ask one thing at a time. Grace windows overlap once there are several
   * check-ins a day, so opening the app at seven in the evening could otherwise
   * greet the user with a stack of questions — which is a queue being flushed,
   * not a friend saying hello. The most recently scheduled one wins because it
   * is the one still worth asking, and the ones it displaces are marked done so
   * they do not arrive thirty seconds later instead.
   */
  if (due.length > 0) {
    const winner = due.reduce((best, item) => (item.scheduled > best.scheduled ? item : best));
    events.push({
      kind: winner.entry.kind,
      message: pickPrompt(winner.entry.prompts, now.getDate() + winner.scheduled),
    });
    for (const item of due) next[item.entry.lastKey] = today;
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
