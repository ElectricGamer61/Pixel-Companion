import { describe, expect, it } from 'vitest';

import {
  DAY_LABELS,
  dayAllowed,
  dayKey,
  evaluateCheckIns,
  normalizeDays,
  parseTimeOfDay,
} from '../src/shared/checkins';
import { DEFAULT_CHECKIN_STATE, DEFAULT_SETTINGS } from '../src/shared/defaults';
import type { CheckInSettings, CheckInState } from '../src/shared/types';

const settings = (overrides: Partial<CheckInSettings> = {}): CheckInSettings => ({
  ...DEFAULT_SETTINGS.checkIns,
  ...overrides,
});

const state = (overrides: Partial<CheckInState> = {}): CheckInState => ({
  ...DEFAULT_CHECKIN_STATE,
  ...overrides,
});

/** Local-time constructor, so the tests do not depend on the machine's zone. */
const at = (hour: number, minute = 0, day = 14): Date => new Date(2025, 4, day, hour, minute, 0);

describe('parseTimeOfDay', () => {
  it('parses valid 24h times', () => {
    expect(parseTimeOfDay('09:00')).toBe(540);
    expect(parseTimeOfDay('00:00')).toBe(0);
    expect(parseTimeOfDay('23:59')).toBe(1439);
    expect(parseTimeOfDay(' 7:05 ')).toBe(425);
  });

  it('rejects malformed times instead of firing at a wrong hour', () => {
    for (const bad of ['', '9', '9:0', '24:00', '12:60', 'noon', '09:00:00']) {
      expect(parseTimeOfDay(bad), bad).toBeNull();
    }
  });
});

describe('gym days', () => {
  it('stores a selection in one canonical shape', () => {
    expect(normalizeDays('531')).toBe('135');
    expect(normalizeDays('1122')).toBe('12');
    expect(normalizeDays('')).toBe('');
  });

  it('drops anything that is not a weekday index', () => {
    expect(normalizeDays('0x9-6')).toBe('06');
    expect(normalizeDays('nope')).toBe('');
  });

  it('reads the same weekday numbering as Date.getDay', () => {
    expect(DAY_LABELS).toHaveLength(7);
    expect(DAY_LABELS[new Date(2025, 4, 18).getDay()]).toBe('Sun');
    expect(dayAllowed('12345', new Date(2025, 4, 14))).toBe(true);
    expect(dayAllowed('12345', new Date(2025, 4, 18))).toBe(false);
  });
});

describe('evaluateCheckIns', () => {
  it('fires the morning check-in once its time has passed', () => {
    const result = evaluateCheckIns(at(9, 5), settings(), state());
    expect(result.events.map((e) => e.kind)).toEqual(['morning']);
    expect(result.state.lastMorningDay).toBe(dayKey(at(9, 5)));
  });

  it('does not fire before the scheduled time', () => {
    expect(evaluateCheckIns(at(8, 30), settings(), state()).events).toEqual([]);
  });

  it('does not fire a stale morning check-in late at night', () => {
    // Opening the app at 23:00 must not trigger "good morning".
    expect(evaluateCheckIns(at(23, 0), settings({ eveningEnabled: false }), state()).events).toEqual(
      [],
    );
  });

  it('fires each daily check-in at most once per day', () => {
    const first = evaluateCheckIns(at(9, 5), settings(), state());
    const second = evaluateCheckIns(at(10, 0), settings(), first.state);
    expect(second.events).toEqual([]);
  });

  it('fires again the next day', () => {
    const first = evaluateCheckIns(at(9, 5, 14), settings(), state());
    const next = evaluateCheckIns(at(9, 5, 15), settings(), first.state);
    expect(next.events.map((e) => e.kind)).toEqual(['morning']);
  });

  it('can fire morning and evening independently', () => {
    const evening = evaluateCheckIns(at(21, 10), settings({ morningEnabled: false }), state());
    expect(evening.events.map((e) => e.kind)).toEqual(['evening']);
  });

  it('respects the master switch and the per-slot switches', () => {
    expect(evaluateCheckIns(at(9, 5), settings({ enabled: false }), state()).events).toEqual([]);
    expect(
      evaluateCheckIns(at(9, 5), settings({ morningEnabled: false }), state()).events,
    ).toEqual([]);
  });

  it('starts the interval clock instead of nudging immediately on first run', () => {
    const now = at(13, 0);
    const result = evaluateCheckIns(
      now,
      settings({ morningEnabled: false, eveningEnabled: false, intervalEnabled: true }),
      state(),
    );
    expect(result.events).toEqual([]);
    expect(result.state.lastIntervalAt).toBe(now.getTime());
  });

  it('nudges once the interval has elapsed, then resets the clock', () => {
    const config = settings({
      morningEnabled: false,
      eveningEnabled: false,
      intervalEnabled: true,
      intervalMinutes: 60,
    });
    const start = at(13, 0);
    const early = evaluateCheckIns(
      at(13, 30),
      config,
      state({ lastIntervalAt: start.getTime() }),
    );
    expect(early.events).toEqual([]);

    const due = evaluateCheckIns(at(14, 1), config, state({ lastIntervalAt: start.getTime() }));
    expect(due.events.map((e) => e.kind)).toEqual(['interval']);
    expect(due.state.lastIntervalAt).toBe(at(14, 1).getTime());
  });

  it('ignores a malformed time rather than throwing', () => {
    expect(evaluateCheckIns(at(9, 5), settings({ morningTime: 'oops' }), state()).events).toEqual(
      [],
    );
  });

  // The buddy check-ins: the ones that ask what you did, not how you feel.
  it('asks about the gym at its own time, on its own days', () => {
    // 2025-05-14 is a Wednesday, which the default weekday selection includes.
    const onDay = evaluateCheckIns(at(18, 10, 14), settings(), state());
    expect(onDay.events.map((e) => e.kind)).toEqual(['gym']);
    expect(onDay.state.lastGymDay).toBe(dayKey(at(18, 10, 14)));
  });

  it('stays quiet about the gym on a day the user did not pick', () => {
    // 2025-05-17 is a Saturday; the default selection is Monday to Friday.
    expect(new Date(2025, 4, 17).getDay()).toBe(6);
    const saturday = evaluateCheckIns(at(18, 10, 17), settings(), state());
    expect(saturday.events.map((e) => e.kind)).not.toContain('gym');
    expect(saturday.state.lastGymDay).toBeNull();
    // The same clock time on a selected day does ask, so the silence above is
    // the day filter rather than a broken schedule.
    expect(
      evaluateCheckIns(at(18, 10, 16), settings(), state()).events.map((e) => e.kind),
    ).toEqual(['gym']);
  });

  it('asks one thing at a time when several check-ins are due at once', () => {
    // At 18:10 both the day question (17:00) and the gym question (18:00) are
    // inside their grace windows. A friend asks the newer one, not both.
    const result = evaluateCheckIns(at(18, 10, 14), settings(), state());
    expect(result.events).toHaveLength(1);
    expect(result.events[0].kind).toBe('gym');
    // The displaced question is closed out rather than queued for the next tick.
    expect(result.state.lastLifeDay).toBe(dayKey(at(18, 10, 14)));
    expect(evaluateCheckIns(at(18, 11, 14), settings(), result.state).events).toEqual([]);
  });

  it('asks what you did with your day', () => {
    const result = evaluateCheckIns(at(17, 5), settings(), state());
    expect(result.events.map((e) => e.kind)).toEqual(['life']);
    expect(result.state.lastLifeDay).toBe(dayKey(at(17, 5)));
  });

  it('asks each buddy question at most once a day', () => {
    const first = evaluateCheckIns(at(17, 5), settings(), state());
    expect(evaluateCheckIns(at(17, 40), settings(), first.state).events).toEqual([]);
    const gym = evaluateCheckIns(at(18, 5), settings(), first.state);
    expect(gym.events.map((e) => e.kind)).toEqual(['gym']);
    expect(evaluateCheckIns(at(18, 40), settings(), gym.state).events).toEqual([]);
  });

  it('lets the buddy check-ins be turned off one at a time', () => {
    const noGym = evaluateCheckIns(at(18, 10), settings({ gymEnabled: false }), state());
    expect(noGym.events.map((e) => e.kind)).not.toContain('gym');
    expect(evaluateCheckIns(at(17, 5), settings({ lifeEnabled: false }), state()).events).toEqual(
      [],
    );
    // The master switch still covers both of them.
    expect(evaluateCheckIns(at(18, 10), settings({ enabled: false }), state()).events).toEqual([]);
  });

  it('never nags: a gym question left unanswered does not repeat next day at random', () => {
    const asked = evaluateCheckIns(at(18, 10, 14), settings(), state());
    // Thursday the 15th is also selected, so it asks again once - and only once.
    const nextDay = evaluateCheckIns(at(18, 10, 15), settings(), asked.state);
    expect(nextDay.events.map((e) => e.kind)).toEqual(['gym']);
    expect(evaluateCheckIns(at(19, 0, 15), settings(), nextDay.state).events).toEqual([]);
  });

  it('always produces a non-empty prompt', () => {
    for (let day = 1; day <= 28; day += 1) {
      const result = evaluateCheckIns(at(9, 5, day), settings(), state());
      for (const event of result.events) {
        expect(event.message.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
