import { describe, expect, it } from 'vitest';

import { dayKey, evaluateCheckIns, parseTimeOfDay } from '../src/shared/checkins';
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

  it('always produces a non-empty prompt', () => {
    for (let day = 1; day <= 28; day += 1) {
      const result = evaluateCheckIns(at(9, 5, day), settings(), state());
      for (const event of result.events) {
        expect(event.message.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
