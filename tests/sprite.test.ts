import { describe, expect, it } from 'vitest';

import {
  ANIMATIONS,
  BODY,
  FACES,
  FACE_HEIGHT,
  FACE_WIDTH,
  FACE_X,
  FACE_Y,
  HOME_VISIBLE_ROWS,
  PALETTE,
  PEEK_FACES,
  SPRITE_SIZE,
  animationLength,
  composeFrame,
  faceOriginY,
  stepAt,
} from '../src/shared/sprite';
import type { CompanionMood } from '../src/shared/types';

const MOODS: CompanionMood[] = [
  'idle',
  'listening',
  'thinking',
  'happy',
  'sleeping',
  'talking',
  'peeking',
  'greeting',
  'dozing',
];

/** The moods worn while tucked at home; all of them must stay on screen there. */
const HOME_MOODS: CompanionMood[] = ['peeking', 'greeting', 'dozing'];

describe('sprite grids', () => {
  it('has a square body of the declared size', () => {
    expect(BODY).toHaveLength(SPRITE_SIZE);
    for (const [index, row] of BODY.entries()) {
      expect(row.length, `body row ${index}`).toBe(SPRITE_SIZE);
    }
  });

  it('has faces of the declared size', () => {
    for (const [name, face] of Object.entries(FACES)) {
      expect(face, name).toHaveLength(FACE_HEIGHT);
      for (const [index, row] of face.entries()) {
        expect(row.length, `${name} row ${index}`).toBe(FACE_WIDTH);
      }
    }
  });

  it('uses only palette characters', () => {
    const allowed = new Set(['.', ...Object.keys(PALETTE)]);
    for (const row of BODY) {
      for (const cell of row) expect(allowed.has(cell), cell).toBe(true);
    }
    for (const face of Object.values(FACES)) {
      for (const row of face) {
        for (const cell of row) expect(allowed.has(cell), cell).toBe(true);
      }
    }
  });

  it('keeps every face inside the body silhouette', () => {
    expect(FACE_X + FACE_WIDTH).toBeLessThanOrEqual(SPRITE_SIZE);
    expect(FACE_Y + FACE_HEIGHT).toBeLessThanOrEqual(SPRITE_SIZE);
    for (const [name, face] of Object.entries(FACES)) {
      for (let y = 0; y < FACE_HEIGHT; y += 1) {
        for (let x = 0; x < FACE_WIDTH; x += 1) {
          if (face[y][x] === '.') continue;
          const under = BODY[faceOriginY(name) + y][FACE_X + x];
          expect(under, `${name} at ${x},${y} must not sit on empty space`).not.toBe('.');
        }
      }
    }
  });

  it('keeps every peek face above the screen edge the companion tucks into', () => {
    // The whole point of the peek faces: at home the lower half of the blob is
    // below the screen edge, so an expression drawn down there is invisible.
    expect(HOME_VISIBLE_ROWS).toBeGreaterThan(0);
    for (const name of PEEK_FACES) {
      const face = FACES[name];
      expect(face, name).toBeDefined();
      for (let y = 0; y < FACE_HEIGHT; y += 1) {
        for (let x = 0; x < FACE_WIDTH; x += 1) {
          if (face[y][x] === '.') continue;
          expect(faceOriginY(name) + y, `${name} at ${x},${y}`).toBeLessThan(HOME_VISIBLE_ROWS);
        }
      }
    }
  });

  it('draws symmetric eyes so the character does not look lopsided', () => {
    // `thinking` is the one intentional exception: its eyes glance to one side.
    for (const [name, face] of Object.entries(FACES)) {
      if (name === 'thinking') continue;
      for (const row of face) {
        if (!row.includes('e')) continue;
        const eyesOnly = row.replace(/[^e.]/g, '.');
        expect([...eyesOnly].reverse().join(''), name).toBe(eyesOnly);
      }
    }
  });

  it('keeps the thinking face glancing consistently to one side', () => {
    // Both eyes must shift together, otherwise it reads as a lazy eye.
    const idleEyeRow = FACES.idle[0];
    const thinkingEyeRow = FACES.thinking[0];
    expect(thinkingEyeRow.indexOf('e')).toBe(idleEyeRow.indexOf('e') - 1);
    expect(thinkingEyeRow.lastIndexOf('e')).toBe(idleEyeRow.lastIndexOf('e') - 1);
  });
});

describe('composeFrame', () => {
  it('stamps the face over the body without resizing the grid', () => {
    const grid = composeFrame('idle');
    expect(grid).toHaveLength(SPRITE_SIZE);
    for (const row of grid) expect(row).toHaveLength(SPRITE_SIZE);
    // The idle face has eyes at face column 2, which is body column FACE_X + 2.
    expect(grid[FACE_Y][FACE_X + 2]).toBe('e');
  });

  it('does not mutate the source grids between calls', () => {
    composeFrame('happy');
    const second = composeFrame('idle');
    expect(second[FACE_Y][FACE_X + 2]).toBe('e');
    expect(BODY[FACE_Y][FACE_X + 2]).not.toBe('e');
  });

  it('makes a blink visibly different from open eyes', () => {
    // Both idle and blink are drawn in the same loop, so a subtle difference
    // reads as a rendering glitch rather than a blink.
    const open = FACES.idle.join('');
    const closed = FACES.blink.join('');
    const differing = [...open].filter((cell, index) => cell !== closed[index]).length;
    expect(differing).toBeGreaterThanOrEqual(4);
    // The closed eye must be a single flat row, not a shorter open eye.
    expect(FACES.blink.filter((row) => row.includes('e'))).toHaveLength(1);
  });

  it('produces a distinct frame for every named face', () => {
    const rendered = new Set(
      Object.keys(FACES).map((face) => composeFrame(face).map((row) => row.join('')).join('\n')),
    );
    expect(rendered.size).toBe(Object.keys(FACES).length);
  });
});

describe('animations', () => {
  it('defines a non-empty timeline for every mood', () => {
    for (const mood of MOODS) {
      expect(ANIMATIONS[mood].length, mood).toBeGreaterThan(0);
      expect(animationLength(mood), mood).toBeGreaterThan(0);
    }
  });

  it('references only faces that exist', () => {
    for (const mood of MOODS) {
      for (const step of ANIMATIONS[mood]) {
        expect(FACES[step.face], `${mood} -> ${String(step.face)}`).toBeDefined();
        expect(step.ticks).toBeGreaterThan(0);
      }
    }
  });

  it('loops cleanly and never returns undefined, including for negative ticks', () => {
    for (const mood of MOODS) {
      const length = animationLength(mood);
      for (let tick = -length * 2; tick < length * 3; tick += 1) {
        const step = stepAt(mood, tick);
        expect(step, `${mood}@${tick}`).toBeDefined();
        expect(FACES[step.face]).toBeDefined();
      }
      expect(stepAt(mood, 0)).toEqual(stepAt(mood, length));
    }
  });

  it('wears a peek face for every home mood', () => {
    // A home mood drawn with an ordinary face would leave a blank dome poking
    // out of the desktop, which is exactly the bug these moods exist to fix.
    for (const mood of HOME_MOODS) {
      for (const step of ANIMATIONS[mood]) {
        expect(PEEK_FACES.has(String(step.face)), `${mood} -> ${String(step.face)}`).toBe(true);
      }
    }
  });

  it('keeps every home pose on screen once the bob is applied', () => {
    // The bob shifts the whole sprite; only upward moves are safe at home,
    // since a downward one sinks the face below the edge.
    for (const mood of HOME_MOODS) {
      for (const step of ANIMATIONS[mood]) {
        let lowest = 0;
        FACES[step.face].forEach((row, y) => {
          if (/[^.]/.test(row)) lowest = y;
        });
        expect(
          faceOriginY(step.face) + lowest + Math.max(step.bob, 0),
          `${mood} -> ${String(step.face)}`,
        ).toBeLessThan(HOME_VISIBLE_ROWS);
      }
    }
  });

  it('keeps the bob inside the canvas padding', () => {
    for (const mood of MOODS) {
      for (const step of ANIMATIONS[mood]) {
        expect(step.bob).toBeGreaterThanOrEqual(-3);
        expect(step.bob).toBeLessThanOrEqual(1);
      }
    }
  });
});
