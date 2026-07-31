import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SETTINGS,
  applySettingsPatch,
  mergeCheckInState,
  mergeSettings,
} from '../src/shared/defaults';
import { extractReply, askLocalModel } from '../src/shared/llm';

describe('mergeSettings', () => {
  it('returns defaults for missing or unusable input', () => {
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings('nonsense')).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it('defaults the optional model to off, so the app is offline out of the box', () => {
    expect(DEFAULT_SETTINGS.model.enabled).toBe(false);
    expect(mergeSettings({}).model.enabled).toBe(false);
  });

  it('keeps a partial file working when new settings are added later', () => {
    const merged = mergeSettings({ companionName: 'Blip', checkIns: { morningTime: '07:30' } });
    expect(merged.companionName).toBe('Blip');
    expect(merged.checkIns.morningTime).toBe('07:30');
    expect(merged.checkIns.eveningTime).toBe(DEFAULT_SETTINGS.checkIns.eveningTime);
    expect(merged.voice).toEqual(DEFAULT_SETTINGS.voice);
  });

  it('ignores values of the wrong type instead of corrupting state', () => {
    const merged = mergeSettings({
      companionName: 42,
      scale: 'big',
      checkIns: { enabled: 'yes' },
      voice: { rate: null },
    } as never);
    expect(merged.companionName).toBe(DEFAULT_SETTINGS.companionName);
    expect(merged.scale).toBe(DEFAULT_SETTINGS.scale);
    expect(merged.checkIns.enabled).toBe(DEFAULT_SETTINGS.checkIns.enabled);
    expect(merged.voice.rate).toBe(DEFAULT_SETTINGS.voice.rate);
  });

  it('clamps out-of-range values', () => {
    const merged = mergeSettings({
      scale: 99,
      checkIns: { intervalMinutes: 1 },
      voice: { rate: 20, volume: -3 },
      model: { timeoutMs: 1 },
    } as never);
    expect(merged.scale).toBe(3);
    expect(merged.checkIns.intervalMinutes).toBe(5);
    expect(merged.voice.rate).toBe(2);
    expect(merged.voice.volume).toBe(0);
    expect(merged.model.timeoutMs).toBe(1000);
  });

  it('does not let a blank companion name leave the panel untitled', () => {
    expect(mergeSettings({ companionName: '   ' }).companionName).toBe(
      DEFAULT_SETTINGS.companionName,
    );
  });

  it('has the buddy check-ins on out of the box', () => {
    expect(DEFAULT_SETTINGS.checkIns.gymEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.checkIns.lifeEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.checkIns.gymDays).toBe('12345');
  });

  it('adds the buddy check-ins to a settings file written before they existed', () => {
    const old = mergeSettings({ checkIns: { morningTime: '07:30', eveningTime: '22:00' } });
    expect(old.checkIns.morningTime).toBe('07:30');
    expect(old.checkIns.gymEnabled).toBe(DEFAULT_SETTINGS.checkIns.gymEnabled);
    expect(old.checkIns.gymDays).toBe(DEFAULT_SETTINGS.checkIns.gymDays);
    expect(old.checkIns.lifeTime).toBe(DEFAULT_SETTINGS.checkIns.lifeTime);
  });

  it('repairs a gym-day selection instead of leaving a dead toggle', () => {
    // Every day deselected would be a switch that is on and can never fire.
    expect(mergeSettings({ checkIns: { gymDays: '' } } as never).checkIns.gymDays).toBe('12345');
    expect(mergeSettings({ checkIns: { gymDays: 'sat' } } as never).checkIns.gymDays).toBe('12345');
    expect(mergeSettings({ checkIns: { gymDays: '60' } } as never).checkIns.gymDays).toBe('06');
  });

  it('round-trips a saved file', () => {
    const saved = mergeSettings({ userName: 'Ada', scale: 2 });
    expect(mergeSettings(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  });
});

describe('applySettingsPatch', () => {
  it('merges one level deep, leaving untouched groups alone', () => {
    const next = applySettingsPatch(DEFAULT_SETTINGS, {
      checkIns: { ...DEFAULT_SETTINGS.checkIns, gymTime: '07:15' },
    });
    expect(next.checkIns.gymTime).toBe('07:15');
    expect(next.checkIns.morningTime).toBe(DEFAULT_SETTINGS.checkIns.morningTime);
    expect(next.voice).toEqual(DEFAULT_SETTINGS.voice);
  });

  it('sanitises what the UI sends, without waiting for a restart', () => {
    // Clearing every day chip must not leave a live toggle that never fires.
    const next = applySettingsPatch(DEFAULT_SETTINGS, {
      checkIns: { ...DEFAULT_SETTINGS.checkIns, gymDays: '', intervalMinutes: 1 },
    });
    expect(next.checkIns.gymDays).toBe(DEFAULT_SETTINGS.checkIns.gymDays);
    expect(next.checkIns.intervalMinutes).toBe(5);
  });

  it('keeps the optional model off unless the patch turns it on', () => {
    expect(applySettingsPatch(DEFAULT_SETTINGS, { userName: 'Ada' }).model.enabled).toBe(false);
  });
});

describe('mergeCheckInState', () => {
  it('tolerates a missing or corrupt state file', () => {
    expect(mergeCheckInState(null).lastMorningDay).toBeNull();
    expect(mergeCheckInState({ lastIntervalAt: 'soon' }).lastIntervalAt).toBeNull();
    expect(mergeCheckInState({ lastGymDay: 7 }).lastGymDay).toBeNull();
  });

  it('keeps valid values', () => {
    const restored = mergeCheckInState({
      lastMorningDay: '2025-05-14',
      lastGymDay: '2025-05-14',
      lastLifeDay: '2025-05-13',
      lastIntervalAt: 1000,
    });
    expect(restored.lastMorningDay).toBe('2025-05-14');
    expect(restored.lastGymDay).toBe('2025-05-14');
    expect(restored.lastLifeDay).toBe('2025-05-13');
    expect(restored.lastIntervalAt).toBe(1000);
  });
});

describe('extractReply', () => {
  it('reads the OpenAI chat-completions shape', () => {
    expect(extractReply({ choices: [{ message: { content: ' hello ' } }] })).toBe('hello');
  });

  it('reads the Ollama native shapes', () => {
    expect(extractReply({ message: { content: 'hi there' } })).toBe('hi there');
    expect(extractReply({ response: 'generated' })).toBe('generated');
  });

  it('returns null for anything it cannot understand', () => {
    for (const payload of [null, 'text', {}, { choices: [] }, { choices: [{}] }, { message: {} }]) {
      expect(extractReply(payload)).toBeNull();
    }
  });
});

describe('askLocalModel', () => {
  const config = { ...DEFAULT_SETTINGS.model, enabled: true };

  it('never calls out when the model is disabled', async () => {
    let called = false;
    const result = await askLocalModel(DEFAULT_SETTINGS.model, 'sys', [], (async () => {
      called = true;
      return new Response('{}');
    }) as unknown as typeof fetch);
    expect(result).toBeNull();
    expect(called).toBe(false);
  });

  it('returns null when the server errors, so the offline rules take over', async () => {
    const result = await askLocalModel(config, 'sys', [], (async () =>
      new Response('nope', { status: 500 })) as unknown as typeof fetch);
    expect(result).toBeNull();
  });

  it('returns null when the server is unreachable', async () => {
    const result = await askLocalModel(config, 'sys', [], (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch);
    expect(result).toBeNull();
  });

  it('sends the system prompt ahead of the conversation', async () => {
    let body: Record<string, unknown> = {};
    const result = await askLocalModel(
      config,
      'be kind',
      [{ role: 'user', content: 'hi' }],
      (async (_url: string, init: RequestInit) => {
        body = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ choices: [{ message: { content: 'hey' } }] }));
      }) as unknown as typeof fetch,
    );
    expect(result).toBe('hey');
    expect(body.messages).toEqual([
      { role: 'system', content: 'be kind' },
      { role: 'user', content: 'hi' },
    ]);
  });
});
