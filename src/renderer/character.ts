import {
  ANIMATION_TICK_MS,
  PALETTE,
  SPRITE_SIZE,
  composeFrame,
  stepAt,
} from '../shared/sprite';
import type { CompanionMood } from '../shared/types';

/** Screen pixels per sprite pixel at scale 1. */
export const BASE_PIXEL = 6;
/** Extra sprite rows below the body so the bob animation never clips. */
const VERTICAL_PADDING = 4;
const REST_OFFSET = 3;

/**
 * Draws the companion onto a canvas, one animation tick at a time.
 *
 * Rendering is plain 2D fillRect over the sprite grid: no image assets, no
 * external libraries, and crisp pixels at any integer scale.
 */
export class Character {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private mood: CompanionMood = 'idle';
  private tick = 0;
  private timer: number | null = null;
  private pixel = BASE_PIXEL;
  /** Cache of composed frames; the grids are static so this never invalidates. */
  private readonly frames = new Map<string, string[][]>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D canvas context unavailable');
    this.context = context;
    this.setScale(1);
  }

  setScale(scale: number): void {
    this.pixel = Math.max(1, Math.round(BASE_PIXEL * scale));
    this.canvas.width = SPRITE_SIZE * this.pixel;
    this.canvas.height = (SPRITE_SIZE + VERTICAL_PADDING) * this.pixel;
    this.canvas.style.width = `${this.canvas.width}px`;
    this.canvas.style.height = `${this.canvas.height}px`;
    this.context.imageSmoothingEnabled = false;
    this.draw();
  }

  setMood(mood: CompanionMood): void {
    if (this.mood === mood) return;
    this.mood = mood;
    this.tick = 0;
    this.draw();
  }

  getMood(): CompanionMood {
    return this.mood;
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => {
      this.tick += 1;
      this.draw();
    }, ANIMATION_TICK_MS);
  }

  stop(): void {
    if (this.timer === null) return;
    window.clearInterval(this.timer);
    this.timer = null;
  }

  private frameFor(face: string): string[][] {
    let grid = this.frames.get(face);
    if (!grid) {
      grid = composeFrame(face);
      this.frames.set(face, grid);
    }
    return grid;
  }

  private draw(): void {
    const step = stepAt(this.mood, this.tick);
    const grid = this.frameFor(step.face);
    const px = this.pixel;
    const originY = (REST_OFFSET + step.bob) * px;

    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Soft contact shadow, so the character reads as sitting on the desktop
    // rather than floating in a void.
    const shadowWidth = SPRITE_SIZE - 4 + step.bob;
    this.context.fillStyle = 'rgba(20, 14, 34, 0.18)';
    this.context.beginPath();
    this.context.ellipse(
      (SPRITE_SIZE / 2) * px,
      (SPRITE_SIZE + REST_OFFSET - 0.5) * px,
      (shadowWidth / 2) * px,
      1.1 * px,
      0,
      0,
      Math.PI * 2,
    );
    this.context.fill();

    for (let y = 0; y < SPRITE_SIZE; y += 1) {
      const row = grid[y];
      for (let x = 0; x < SPRITE_SIZE; x += 1) {
        const key = row[x];
        if (key === '.') continue;
        const color = PALETTE[key];
        if (!color) continue;
        this.context.fillStyle = color;
        this.context.fillRect(x * px, originY + y * px, px, px);
      }
    }
  }
}
