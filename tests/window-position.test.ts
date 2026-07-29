import { describe, expect, it } from 'vitest';

import {
  CHARACTER,
  DRAG_THRESHOLD_PX,
  EDGE_MARGIN,
  HOME_TUCK,
  NO_OVERHANG,
  OVERHANG,
  beginDrag,
  clampToWorkArea,
  homePosition,
  isClick,
  trackDrag,
  type Point,
  type Rect,
} from '../src/shared/window-position';

/** A plain 1920x1080 display with no taskbar offset. */
const screen: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
/** The real companion window size, which must never change during a drag. */
const size = { width: 380, height: 520 };

describe('homePosition', () => {
  /** The character's right edge in screen coordinates, given a window origin. */
  const characterRight = (x: number): number => x + size.width - CHARACTER.right;
  /** The character's feet in screen coordinates, given a window origin. */
  const characterBottom = (y: number): number => y + size.height - CHARACTER.bottom;

  it('sinks the companion half-way into the bottom edge, head still showing', () => {
    const home = homePosition(screen, size);
    expect(characterBottom(home.y) - screen.height).toBe(CHARACTER.height * HOME_TUCK);
  });

  it('keeps the companion wholly on screen sideways, near the right edge', () => {
    const home = homePosition(screen, size);
    // The tuck is downward only: nothing hides past the right edge.
    expect(screen.width - characterRight(home.x)).toBe(EDGE_MARGIN);
    expect(home.x).toBeGreaterThanOrEqual(screen.x);
  });

  it('respects a work area that is offset by panels or a taskbar', () => {
    const workArea: Rect = { x: 60, y: 28, width: 1800, height: 1000 };
    const home = homePosition(workArea, size);
    expect(characterBottom(home.y) - (workArea.y + workArea.height)).toBe(
      CHARACTER.height * HOME_TUCK,
    );
    expect(workArea.x + workArea.width - characterRight(home.x)).toBe(EDGE_MARGIN);
  });

  it('gives up the tuck rather than stranding the window off screen', () => {
    const workArea: Rect = { x: 0, y: 0, width: 400, height: 560 };
    const home = homePosition(workArea, size);
    expect(home.x).toBeGreaterThanOrEqual(0);
    expect(home.y).toBeLessThanOrEqual(560 - size.height + OVERHANG.y);
  });

  it('never leaves the work area when it is smaller than the window', () => {
    const workArea: Rect = { x: 0, y: 0, width: 300, height: 300 };
    expect(homePosition(workArea, size)).toEqual({ x: 0, y: 0 });
  });
});

describe('clampToWorkArea', () => {
  it('leaves a position that already fits alone', () => {
    expect(clampToWorkArea({ x: 400, y: 300 }, screen, size)).toEqual({ x: 400, y: 300 });
  });

  it('allows exactly the tuck overhang past the bottom edge, and none sideways', () => {
    expect(clampToWorkArea({ x: 5000, y: 5000 }, screen, size)).toEqual({
      x: 1920 - 380,
      y: 1080 - 520 + OVERHANG.y,
    });
  });

  it('never lets the window escape past the left or top edge', () => {
    // Nothing peeks out of those edges, and a window stranded up there would be
    // unreachable: there is no visible part left to grab.
    expect(clampToWorkArea({ x: -900, y: -900 }, screen, size)).toEqual({ x: 0, y: 0 });
  });

  it('keeps the whole window on screen when asked for no overhang', () => {
    // What the open chat panel needs: the panel fills the window, so any
    // overhang clips it.
    expect(clampToWorkArea({ x: 5000, y: 5000 }, screen, size, NO_OVERHANG)).toEqual({
      x: 1920 - 380,
      y: 1080 - 520,
    });
  });

  it('brings a tucked window fully back on screen for the panel', () => {
    const home = homePosition(screen, size);
    const opened = clampToWorkArea(home, screen, size, NO_OVERHANG);
    expect(opened.y).toBeLessThan(home.y);
    expect(opened.y + size.height).toBeLessThanOrEqual(screen.height);
    expect(opened.x + size.width).toBeLessThanOrEqual(screen.width);
    // ...and closing it tucks straight back to where it came from.
    expect(clampToWorkArea(home, screen, size)).toEqual(home);
  });

  it('rounds to whole pixels', () => {
    expect(clampToWorkArea({ x: 400.6, y: 300.4 }, screen, size)).toEqual({ x: 401, y: 300 });
  });
});

describe('drag gestures', () => {
  /** Replay a pointer path and report where the window ends up. */
  const dragAlong = (origin: Point, path: Point[]): { position: Point; moves: number } => {
    const gesture = beginDrag(0, 0);
    let position = origin;
    let moves = 0;
    for (const point of path) {
      const offset = trackDrag(gesture, point.x, point.y);
      if (!offset) continue;
      moves += 1;
      // Exactly what the main process does: apply the total offset to the
      // origin latched at press time.
      position = { x: origin.x + offset.x, y: origin.y + offset.y };
    }
    return { position, moves };
  };

  it('ignores pointer jitter below the threshold', () => {
    const path = [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: -2, y: 1 },
      { x: 0, y: 0 },
    ];
    const { position, moves } = dragAlong({ x: 100, y: 100 }, path);
    expect(moves).toBe(0);
    expect(position).toEqual({ x: 100, y: 100 });
  });

  it('treats a gesture that never crossed the threshold as a click', () => {
    const gesture = beginDrag(0, 0);
    trackDrag(gesture, DRAG_THRESHOLD_PX, 0);
    expect(isClick(gesture)).toBe(true);
  });

  it('treats a gesture that crossed the threshold as a drag, not a click', () => {
    const gesture = beginDrag(0, 0);
    trackDrag(gesture, DRAG_THRESHOLD_PX + 1, 0);
    expect(isClick(gesture)).toBe(false);
  });

  it('keeps moving once the drag has started, even back through the origin', () => {
    const gesture = beginDrag(0, 0);
    expect(trackDrag(gesture, 20, 0)).toEqual({ x: 20, y: 0 });
    // Without the sticky flag the window would freeze whenever the pointer
    // passed back near where it started.
    expect(trackDrag(gesture, 1, 0)).toEqual({ x: 1, y: 0 });
  });

  it('never compounds travel, however many moves a drag reports', () => {
    // The original defect: per-move increments applied to a stale window
    // position. Absolute offsets make the result depend only on where the
    // pointer ended up, so 100 small moves land in exactly the same place as
    // one big one.
    const many = Array.from({ length: 100 }, (_, i) => ({ x: (i + 1) * 2, y: 0 }));
    const stepwise = dragAlong({ x: 100, y: 100 }, many);
    const single = dragAlong({ x: 100, y: 100 }, [{ x: 200, y: 0 }]);

    expect(stepwise.position).toEqual({ x: 300, y: 100 });
    expect(stepwise.position).toEqual(single.position);
  });

  it('is idempotent when the same pointer position is reported repeatedly', () => {
    const repeated = Array.from({ length: 30 }, () => ({ x: 40, y: 25 }));
    expect(dragAlong({ x: 100, y: 100 }, repeated).position).toEqual({ x: 140, y: 125 });
  });

  it('produces only positions, so a drag can never change the window size', () => {
    // Guards the captain's report directly: dragging must move the overlay and
    // touch nothing else. `trackDrag` has no size in scope to return.
    const gesture = beginDrag(0, 0);
    const offset = trackDrag(gesture, 60, 40);
    expect(Object.keys(offset ?? {}).sort()).toEqual(['x', 'y']);
  });

  it('cannot drag the companion further than the tuck off screen', () => {
    const gesture = beginDrag(0, 0);
    const offset = trackDrag(gesture, 9000, 9000);
    const origin = homePosition(screen, size);
    const landed = clampToWorkArea(
      { x: origin.x + (offset?.x ?? 0), y: origin.y + (offset?.y ?? 0) },
      screen,
      size,
    );
    expect(landed).toEqual({
      x: 1920 - 380,
      y: 1080 - 520 + OVERHANG.y,
    });
  });

  it('returns home to exactly the first-run peeking position after any drag', () => {
    const gesture = beginDrag(0, 0);
    trackDrag(gesture, -700, -400);
    expect(homePosition(screen, size)).toEqual({
      x: 1920 - 380 + CHARACTER.right - EDGE_MARGIN,
      y: 1080 - 520 + OVERHANG.y,
    });
  });
});
