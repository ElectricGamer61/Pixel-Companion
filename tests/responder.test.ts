import { describe, expect, it } from 'vitest';

import { detectIntent, homeLine, openingLine, respond, systemPrompt } from '../src/shared/responder';
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

  it('hears a flat, low mood however it is worded', () => {
    // `low`, `numb` and `empty` carry a lot of the low-mood vocabulary, and no
    // test used to cover them — which is how they quietly stopped counting as
    // sad. The intensifier is deliberately not an allowlist.
    for (const text of [
      'i feel very low',
      'i feel completely numb',
      'i feel pretty numb',
      'i feel utterly empty',
      "i've been low all week",
      'my mood is low',
      'everything is empty',
    ]) {
      expect(detectIntent(text), text).toBe('sad');
    }
  });

  it('hears whether the gym actually happened', () => {
    for (const text of [
      'I went to the gym',
      'just got back from the gym',
      'hit the gym before work',
      'I worked out this morning',
      'went for a run',
      'did some yoga',
      'the workout was brutal',
    ]) {
      expect(detectIntent(text), text).toBe('exercise_done');
    }

    for (const text of [
      'I skipped the gym again',
      'missed my workout',
      "didn't make it to the gym",
      'I have not moved all day',
      'no gym today',
      'taking a rest day',
      // A quantity or a stretch of time after "worked out" is a lapse being
      // reported, not the "figure out" idiom.
      "i haven't worked out that much lately",
      'i did not work out the whole week',
      "i haven't worked out much this week",
    ]) {
      expect(detectIntent(text), text).toBe('exercise_missed');
    }
  });

  it('still hears the workout when the rest of the sentence is negative', () => {
    // A "not" later in the sentence is about how the workout went, not about
    // whether it happened. Losing these is how a finished workout ends up
    // getting a shrug, or worse, a to-do list reply.
    for (const text of [
      'i went to the gym but it was not easy',
      'i worked out this morning, no excuses',
      'i went to the gym, no idea why it was so empty',
      'did some yoga, not my best session',
      'i went for a run and it was not fun',
      'i worked out and now i have to shower',
    ]) {
      expect(detectIntent(text), text).toBe('exercise_done');
    }
  });

  it('does not congratulate a workout that has not happened', () => {
    // A plan or a refusal is not a report of a finished workout, and "You went.
    // That is the hard part" to someone who just said they are not going is the
    // single worst thing this rule could do.
    for (const text of ['i am not going to the gym today', 'going to skip the gym tonight']) {
      expect(detectIntent(text), text).toBe('exercise_missed');
    }
    for (const text of ['i will hit the gym later', 'it all worked out in the end']) {
      expect(detectIntent(text), text).not.toBe('exercise_done');
    }
  });

  it('does not read ordinary verbs or the "figure out" sense as exercise', () => {
    // `run`, `walk` and `move` are everyday verbs, and "work out" is as often
    // "figure out" as it is a workout.
    for (const text of [
      'we need to work out the budget',
      "i haven't worked out how to fix this bug",
      'i never worked out what she meant',
      "i didn't get the build to run",
      "i haven't had time to run errands",
      'no time to walk the dog',
      'i never move fast enough at work',
      'i had a lazy day',
    ]) {
      expect(detectIntent(text), text).not.toBe('exercise_done');
      expect(detectIntent(text), text).not.toBe('exercise_missed');
    }
  });

  it('answers the feeling before the habit when a message has both', () => {
    // "I skipped the gym" plus self-criticism is a self-critical message, and
    // the gym part is the least important thing in it.
    expect(detectIntent('I skipped the gym, I am such a failure')).toBe('self_critical');
    expect(detectIntent('I missed my workout and I am so overwhelmed')).toBe('overwhelmed');
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

describe('answering a buddy check-in', () => {
  it('reads a bare yes or no as an answer to the question just asked', () => {
    const yes = respond('yeah', ctx({ topic: 'gym' }));
    expect(yes.text.toLowerCase()).toMatch(/did|showed up|pleased/);
    expect(yes.mood).toBe('happy');

    const no = respond('nope', ctx({ topic: 'gym' }));
    expect(no.text.toLowerCase()).toMatch(/no judgement|got in the way|rest|alright|one day/);
    expect(no.mood).toBe('listening');
  });

  it('does the same for the general day question', () => {
    expect(respond('yes', ctx({ topic: 'life' })).text).not.toBe(
      respond('yes', ctx({ topic: 'gym' })).text,
    );
    expect(respond('not really', ctx({ topic: 'life' })).text.length).toBeGreaterThan(0);
  });

  it('takes a "no" without a lecture, a guilt trip, or a body comment', () => {
    for (const topic of ['gym', 'life'] as const) {
      for (let turn = 0; turn < 4; turn += 1) {
        const text = respond('no', ctx({ topic, turn })).text.toLowerCase();
        expect(text, text).not.toMatch(
          /should|must|need to|lazy|excuse|discipline|weight|calorie|fat|diet|streak/,
        );
      }
    }
  });

  it('is only a lens on a short answer, never a filter on a real one', () => {
    // Something with content of its own is still classified on its own terms.
    expect(respond('I am really sad today', ctx({ topic: 'life' })).text).toBe(
      respond('I am really sad today', ctx()).text,
    );
  });

  it('never lets a topic get in front of the crisis path', () => {
    for (const topic of ['gym', 'life'] as const) {
      const reply = respond('I want to kill myself', ctx({ topic }));
      expect(reply.safety).toBe(true);
      expect(reply.text).toContain('988');
    }
  });

  it('says nothing clinical or measuring in any exercise reply', () => {
    const samples = ['I went to the gym', 'I skipped the gym', 'no gym today', 'I worked out'];
    for (const sample of samples) {
      for (let turn = 0; turn < 4; turn += 1) {
        const text = respond(sample, ctx({ turn })).text.toLowerCase();
        expect(text, sample).not.toMatch(
          /calorie|weight|bmi|diagnos|prescri|you should|burn|reps you|kg|lbs/,
        );
        expect(text.trim().length).toBeGreaterThan(0);
      }
    }
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

describe('homeLine', () => {
  it('stays a glance, not a message', () => {
    const seen = new Set<string>();
    for (let turn = 0; turn < 24; turn += 1) {
      const line = homeLine(turn);
      seen.add(line);
      // Tucked in the corner the companion is furniture with a pulse: a few
      // words, no question, and nothing for the user to have to answer.
      expect(line.length, line).toBeLessThanOrEqual(20);
      expect(line, line).not.toContain('?');
      expect(line).not.toMatch(/\{\w+\}/);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('is stable for a given turn and safe for any turn', () => {
    expect(homeLine(3)).toBe(homeLine(3));
    for (const turn of [-7, 0, 1.5, 10_000]) {
      expect(typeof homeLine(turn)).toBe('string');
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

  it('tells an optional model to ask like a friend, not like a tracker', () => {
    const prompt = systemPrompt(ctx()).toLowerCase();
    expect(prompt).toMatch(/gym/);
    expect(prompt).toMatch(/never comment on their weight/);
  });
});
