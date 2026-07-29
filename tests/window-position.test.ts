import { describe, expect, it } from 'vitest';

import {
  DRAG_THRESHOLD_PX,
  EDGE_MARGIN,
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
  it('tucks the whole window into the bottom-right corner', () => {
    expect(homePosition(screen, size)).toEqual({
      x: 1920 - 380 - EDGE_MARGIN,
      y: 1080 - 520 - EDGE_MARGIN,
    });
  });

  it('respects a work area that is offset by panels or a taskbar', () => {
    const workArea: Rect = { x: 60, y: 28, width: 1800, height: 1000 };
    expect(homePosition(workArea, size)).toEqual({
      x: 60 + 1800 - 380 - EDGE_MARGIN,
      y: 28 + 1000 - 520 - EDGE_MARGIN,
    });
  });

  it('gives up the margin rather than hanging off screen', () => {
    // 400 - 380 - 24 would be -4, so the margin loses and the window stays
    // fully visible.
    const workArea: Rect = { x: 0, y: 0, width: 400, height: 560 };
    expect(homePosition(workArea, size)).toEqual({ x: 0, y: 16 });
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

  it('keeps the whole window on screen, not just a corner of it', () => {
    // The bug this guards: a window allowed to hang off the edge reads as a
    // clipped blob rather than a companion sitting in the corner.
    expect(clampToWorkArea({ x: 5000, y: 5000 }, screen, size)).toEqual({
      x: 1920 - 380,
      y: 1080 - 520,
    });
    expect(clampToWorkArea({ x: -900, y: -900 }, screen, size)).toEqual({ x: 0, y: 0 });
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

  it('cannot drag the companion off screen', () => {
    const gesture = beginDrag(0, 0);
    const offset = trackDrag(gesture, 9000, 9000);
    const origin = homePosition(screen, size);
    const landed = clampToWorkArea(
      { x: origin.x + (offset?.x ?? 0), y: origin.y + (offset?.y ?? 0) },
      screen,
      size,
    );
    expect(landed).toEqual({ x: 1920 - 380, y: 1080 - 520 });
  });

  it('returns home to exactly the first-run position after any drag', () => {
    const gesture = beginDrag(0, 0);
    trackDrag(gesture, -700, -400);
    expect(homePosition(screen, size)).toEqual({ x: 1516, y: 536 });
  });
});
