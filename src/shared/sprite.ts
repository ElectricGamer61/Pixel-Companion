import type { CompanionMood } from './types';
import { HOME_TUCK } from './window-position';

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

/**
 * How many sprite rows are still above the screen edge while the companion is
 * tucked at home. Derived from the tuck so the two can never drift apart.
 */
export const HOME_VISIBLE_ROWS = Math.floor(SPRITE_SIZE * (1 - HOME_TUCK));

/**
 * Where the "peek" faces are stamped instead of FACE_Y.
 *
 * At home the blob's lower half is below the screen edge, so a face drawn at
 * the usual height is simply not there: the user sees a blank dome. The peek
 * expressions ride high on the head, entirely inside HOME_VISIBLE_ROWS, which
 * is what gives the tucked companion a face at all.
 */
export const PEEK_FACE_Y = 4;

/** Faces stamped at PEEK_FACE_Y rather than FACE_Y. */
export const PEEK_FACES: ReadonlySet<string> = new Set([
  'peek',
  'peekBlink',
  'peekHappy',
  'peekSleep',
]);

/** Row the named face is stamped at. */
export function faceOriginY(face: string): number {
  return PEEK_FACES.has(face) ? PEEK_FACE_Y : FACE_Y;
}

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
  // The home poses. Everything below lives in the top rows of the sprite, so it
  // is still on screen while the companion is tucked into the bottom edge: tall
  // wide-awake eyes peering up over the ledge, and a small quiet mouth.
  peek: [
    '..ee....ee..',
    '..ee....ee..',
    '..ee....ee..',
    '.....mm.....',
    '............',
  ],
  peekBlink: [
    '............',
    '..eee..eee..',
    '............',
    '.....mm.....',
    '............',
  ],
  // The greeting pose: eyes crinkled shut, blush, and a wide grin.
  peekHappy: [
    '...e....e...',
    '..e.e..e.e..',
    'cc.m....m.cc',
    '....mmmm....',
    '............',
  ],
  peekSleep: [
    '............',
    '..eee..eee..',
    '............',
    '....mmm.....',
    '............',
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
  // At home the bob is the whole performance: the companion rises up out of the
  // screen edge to look around and settles back down, which is what sells
  // "peeking" when only the top of the head is visible. It never bobs downwards
  // there — that direction is below the edge, where nothing can be seen.
  peeking: [
    { face: 'peek', ticks: 10, bob: 0 },
    { face: 'peek', ticks: 8, bob: -1 },
    { face: 'peekBlink', ticks: 1, bob: -1 },
    { face: 'peek', ticks: 6, bob: -2 },
    { face: 'peek', ticks: 9, bob: -1 },
    { face: 'peek', ticks: 7, bob: 0 },
  ],
  greeting: [
    { face: 'peekHappy', ticks: 3, bob: -3 },
    { face: 'peekHappy', ticks: 3, bob: -1 },
    { face: 'peekHappy', ticks: 3, bob: -3 },
    { face: 'peekHappy', ticks: 5, bob: -2 },
  ],
  dozing: [
    { face: 'peekSleep', ticks: 10, bob: 0 },
    { face: 'peekSleep', ticks: 10, bob: -1 },
  ],
};

/**
 * Flatten body + face into a single SPRITE_SIZE x SPRITE_SIZE grid of palette
 * keys, row-major. `.` means transparent.
 */
export function composeFrame(face: keyof typeof FACES): string[][] {
  const grid = BODY.map((row) => row.split(''));
  const overlay = FACES[face];
  const originY = faceOriginY(face);
  for (let y = 0; y < FACE_HEIGHT; y += 1) {
    const row = overlay[y];
    for (let x = 0; x < FACE_WIDTH; x += 1) {
      const cell = row[x];
      if (cell === '.') continue;
      grid[originY + y][FACE_X + x] = cell;
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
