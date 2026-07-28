import type { CompanionMood } from './types';

/**
 * The companion's pixel art, authored by hand as character grids.
 *
 * Everything here is original work created for this project and is covered by
 * the project's MIT licence. No third-party or copyrighted sprites are used,
 * and nothing is loaded from the network.
 *
 * The character is a 16x16 blob. The body is drawn once, and a 12x5 face
 * overlay is stamped on top at BODY-relative (FACE_X, FACE_Y), which keeps each
 * expression short enough to read and edit at a glance.
 */

export const SPRITE_SIZE = 16;
export const FACE_WIDTH = 12;
export const FACE_HEIGHT = 5;
export const FACE_X = 2;
export const FACE_Y = 6;

/** `.` is transparent; every other key maps to a colour. */
export const PALETTE: Record<string, string> = {
  o: '#221a33', // outline
  b: '#79dcc0', // body
  l: '#c9f7e8', // highlight
  d: '#4bae95', // shadow
  e: '#221a33', // eyes
  m: '#221a33', // mouth
  c: '#ff9ab5', // blush
};

export const BODY: readonly string[] = [
  '................',
  '.....oooooo.....',
  '...oobbbbbboo...',
  '..obbbbbbbbbbo..',
  '.obbbbbbbbbbbbo.',
  '.obllbbbbbbbbdo.',
  'obllbbbbbbbbbbdo',
  'obbbbbbbbbbbbbdo',
  'obbbbbbbbbbbbbdo',
  'obbbbbbbbbbbbbdo',
  'obbbbbbbbbbbbbdo',
  'obbbbbbbbbbbbbdo',
  '.obbbbbbbbbbbdo.',
  '.obbbbbbbbbbbdo.',
  '..oobbbbbbbdoo..',
  '....oooooooo....',
];

/**
 * Faces, keyed by animation frame name. Each is FACE_HEIGHT rows of
 * FACE_WIDTH characters. Transparent cells fall through to the body.
 */
export const FACES: Record<string, readonly string[]> = {
  idle: [
    '..ee....ee..',
    '..ee....ee..',
    '............',
    '...m....m...',
    '....mmmm....',
  ],
  // A blink is a closed eye, so it must be a flat line rather than a shorter
  // open eye, otherwise it is indistinguishable from `idle` at a glance.
  blink: [
    '............',
    '..eee..eee..',
    '............',
    '...m....m...',
    '....mmmm....',
  ],
  happy: [
    '...e....e...',
    '..e.e..e.e..',
    '............',
    'ccm......mcc',
    '...mmmmmm...',
  ],
  listening: [
    '..ee....ee..',
    '..ee....ee..',
    '............',
    '.....mm.....',
    '............',
  ],
  // Deliberately asymmetric: both eyes glance off to one side, which is what
  // makes this read as "thinking" rather than "staring".
  thinking: [
    '.ee....ee...',
    '.ee....ee...',
    '............',
    '...mmm......',
    '............',
  ],
  sleeping: [
    '............',
    '..eee..eee..',
    '............',
    '.....mm.....',
    '............',
  ],
  talkOpen: [
    '..ee....ee..',
    '..ee....ee..',
    '............',
    '....mmmm....',
    '....mmmm....',
  ],
  talkClosed: [
    '..ee....ee..',
    '..ee....ee..',
    '............',
    '............',
    '....mmmm....',
  ],
};

/**
 * Animation timeline per mood: which face to show, for how many ticks, and how
 * far the body bobs vertically (in sprite pixels) during that step.
 */
export interface AnimationStep {
  face: keyof typeof FACES;
  /** Duration in animation ticks (one tick is ANIMATION_TICK_MS). */
  ticks: number;
  /** Vertical offset in sprite pixels, negative is up. */
  bob: number;
}

export const ANIMATION_TICK_MS = 140;

export const ANIMATIONS: Record<CompanionMood, readonly AnimationStep[]> = {
  idle: [
    { face: 'idle', ticks: 6, bob: 0 },
    { face: 'idle', ticks: 4, bob: -1 },
    { face: 'idle', ticks: 6, bob: 0 },
    { face: 'blink', ticks: 1, bob: 0 },
    { face: 'idle', ticks: 8, bob: -1 },
    { face: 'idle', ticks: 5, bob: 0 },
  ],
  listening: [
    { face: 'listening', ticks: 8, bob: 0 },
    { face: 'listening', ticks: 3, bob: -1 },
    { face: 'blink', ticks: 1, bob: -1 },
    { face: 'listening', ticks: 6, bob: 0 },
  ],
  thinking: [
    { face: 'thinking', ticks: 4, bob: 0 },
    { face: 'thinking', ticks: 4, bob: -1 },
    { face: 'listening', ticks: 3, bob: -1 },
    { face: 'thinking', ticks: 4, bob: 0 },
  ],
  happy: [
    { face: 'happy', ticks: 3, bob: -2 },
    { face: 'happy', ticks: 3, bob: 0 },
    { face: 'happy', ticks: 3, bob: -2 },
    { face: 'happy', ticks: 5, bob: 0 },
  ],
  sleeping: [
    { face: 'sleeping', ticks: 10, bob: 0 },
    { face: 'sleeping', ticks: 10, bob: 1 },
  ],
  talking: [
    { face: 'talkOpen', ticks: 2, bob: 0 },
    { face: 'talkClosed', ticks: 2, bob: 0 },
    { face: 'talkOpen', ticks: 2, bob: -1 },
    { face: 'talkClosed', ticks: 3, bob: 0 },
  ],
};

/**
 * Flatten body + face into a single SPRITE_SIZE x SPRITE_SIZE grid of palette
 * keys, row-major. `.` means transparent.
 */
export function composeFrame(face: keyof typeof FACES): string[][] {
  const grid = BODY.map((row) => row.split(''));
  const overlay = FACES[face];
  for (let y = 0; y < FACE_HEIGHT; y += 1) {
    const row = overlay[y];
    for (let x = 0; x < FACE_WIDTH; x += 1) {
      const cell = row[x];
      if (cell === '.') continue;
      grid[FACE_Y + y][FACE_X + x] = cell;
    }
  }
  return grid;
}

/** Total ticks in one loop of a mood's animation. */
export function animationLength(mood: CompanionMood): number {
  return ANIMATIONS[mood].reduce((total, step) => total + step.ticks, 0);
}

/** Which step of a mood's animation is active at a given tick. */
export function stepAt(mood: CompanionMood, tick: number): AnimationStep {
  const steps = ANIMATIONS[mood];
  const total = animationLength(mood);
  let cursor = ((tick % total) + total) % total;
  for (const step of steps) {
    if (cursor < step.ticks) return step;
    cursor -= step.ticks;
  }
  return steps[steps.length - 1];
}
