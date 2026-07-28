import { describe, expect, it } from 'vitest';

import { detectIntent, openingLine, respond, systemPrompt } from '../src/shared/responder';
import type { ResponderContext } from '../src/shared/responder';

const ctx = (overrides: Partial<ResponderContext> = {}): ResponderContext => ({
  companionName: 'Pip',
  userName: '',
  turn: 0,
  ...overrides,
});

describe('detectIntent', () => {
  it('routes crisis language to the safety path', () => {
    for (const text of [
      'I want to kill myself',
      'i have been thinking about suicide',
      "I don't want to live anymore",
      'everyone would be better off without me',
      'I keep cutting myself',
      'I have been self-harming again',
    ]) {
      expect(detectIntent(text), text).toBe('safety');
    }
  });

  it('does not treat common idioms as a crisis', () => {
    for (const text of [
      'this deadline is killing me',
      "I'm dying to go home",
      'my feet are killing me after that walk',
      'I could murder a sandwich',
      'that joke killed',
    ]) {
      expect(detectIntent(text), text).not.toBe('safety');
    }
  });

  it('classifies everyday feelings', () => {
    expect(detectIntent('hey there')).toBe('greeting');
    expect(detectIntent('I feel so anxious about tomorrow')).toBe('anxious');
    expect(detectIntent('everything is too much right now')).toBe('overwhelmed');
    expect(detectIntent('I am really sad today')).toBe('sad');
    expect(detectIntent('I am so frustrated with my team')).toBe('angry');
    expect(detectIntent('I feel lonely')).toBe('lonely');
    expect(detectIntent('I am exhausted')).toBe('tired');
    expect(detectIntent('I keep procrastinating on my essay')).toBe('accountability');
    expect(detectIntent('I am such a failure')).toBe('self_critical');
    expect(detectIntent('thanks, that helped')).toBe('gratitude');
    expect(detectIntent('goodnight')).toBe('farewell');
    expect(detectIntent('who are you?')).toBe('about');
    expect(detectIntent('what can you do?')).toBe('capabilities');
    expect(detectIntent('I finished the thing and I am proud')).toBe('positive');
  });

  it('falls back to open listening for anything unmatched', () => {
    expect(detectIntent('the weather turned again')).toBe('unclear');
    expect(detectIntent('')).toBe('unclear');
    expect(detectIntent('   ')).toBe('unclear');
  });
});

describe('respond', () => {
  it('returns crisis resources without clinical claims', () => {
    const reply = respond('I want to end my life', ctx());
    expect(reply.safety).toBe(true);
    expect(reply.source).toBe('rules');
    expect(reply.text).toContain('988');
    expect(reply.text).toContain('findahelpline.com');
    expect(reply.text.toLowerCase()).not.toMatch(/diagnos|prescri|you have (depression|anxiety)/);
  });

  it('never claims to be a therapist when asked what it is', () => {
    const reply = respond('are you real?', ctx());
    expect(reply.text.toLowerCase()).toMatch(/not a (person|human)|not a therapist|not a counsellor/);
  });

  it('always answers with non-empty text and a valid mood', () => {
    const moods = new Set(['idle', 'listening', 'thinking', 'happy', 'sleeping', 'talking']);
    const samples = [
      'hi',
      'I am so tired',
      'I need to finish my taxes',
      'thank you',
      'blah blah blah',
      '',
    ];
    for (const sample of samples) {
      for (let turn = 0; turn < 5; turn += 1) {
        const reply = respond(sample, ctx({ turn }));
        expect(reply.text.trim().length, sample).toBeGreaterThan(0);
        expect(moods.has(reply.mood), reply.mood).toBe(true);
      }
    }
  });

  it('rotates replies deterministically so it does not repeat itself', () => {
    const seen = new Set<string>();
    for (let turn = 0; turn < 3; turn += 1) {
      seen.add(respond('I feel really sad', ctx({ turn })).text);
    }
    expect(seen.size).toBe(3);
    // Same turn, same input gives the same reply: the engine is pure.
    expect(respond('I feel really sad', ctx({ turn: 1 })).text).toBe(
      respond('I feel really sad', ctx({ turn: 1 })).text,
    );
  });

  it('uses the user name when one is configured, and no stray gap when not', () => {
    const named = respond('hello', ctx({ userName: 'Sam', hour: 10 }));
    expect(named.text).toContain('Sam');
    const anonymous = respond('hello', ctx({ hour: 10 }));
    expect(anonymous.text).not.toMatch(/\s{2,}|\s[.,]/);
    expect(anonymous.text).not.toContain('{name}');
  });

  it('leaves no unfilled placeholders in any template', () => {
    const samples = ['hi', 'who are you', 'what can you do', 'bye', 'thanks', 'I am sad'];
    for (const sample of samples) {
      for (let turn = 0; turn < 4; turn += 1) {
        const reply = respond(sample, ctx({ turn, userName: 'Ada' }));
        expect(reply.text, sample).not.toMatch(/\{\w+\}/);
      }
    }
  });

  it('greets according to the hour', () => {
    expect(respond('hi', ctx({ hour: 8 })).text).toContain('Good morning');
    expect(respond('hi', ctx({ hour: 15 })).text).toContain('Afternoon');
    expect(respond('hi', ctx({ hour: 22 })).text).toContain('Evening');
    expect(respond('hi', ctx({ hour: 3 })).text).toContain('up late');
  });
});

describe('openingLine', () => {
  it('produces a filled greeting for every hour', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const line = openingLine(ctx({ hour }));
      expect(line.length).toBeGreaterThan(0);
      expect(line).not.toMatch(/\{\w+\}/);
    }
  });
});

describe('systemPrompt', () => {
  it('constrains an optional local model to the same non-clinical posture', () => {
    const prompt = systemPrompt(ctx({ companionName: 'Blip' }));
    expect(prompt).toContain('Blip');
    expect(prompt).toMatch(/not a therapist/i);
    expect(prompt).toMatch(/never diagnose/i);
    expect(prompt).toContain('988');
  });
});
