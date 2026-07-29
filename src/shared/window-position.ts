/**
 * Pure geometry and gesture logic for placing and dragging the companion window.
 *
 * This lives in `shared/` on purpose: the main process owns the real window and
 * the renderer owns the pointer, but both need the same rules, and neither half
 * is testable on its own. Everything here is arithmetic over plain objects.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Point, Size {}

/** Pointer travel from the press point that turns a click into a drag. */
export const DRAG_THRESHOLD_PX = 4;

/**
 * Where the character sits inside the transparent window, in window pixels.
 *
 * The window is mostly empty space reserved for the chat panel; the blob itself
 * is a 16x16 sprite at 6 screen pixels each, pinned to the bottom-right by the
 * renderer's flex layout. Home placement is expressed in terms of the
 * *character*, not the window, because that is what the user actually sees.
 */
export const CHARACTER = {
  width: 96,
  height: 96,
  /** Gap from the window's right edge to the character's right edge. */
  right: 10,
  /** Gap from the window's bottom edge to the character's feet. */
  bottom: 18,
} as const;

/** Gap kept between the character and the right edge when it sits at home. */
export const EDGE_MARGIN = 24;

/**
 * How much of the character hides below the screen edge when it sits at home.
 *
 * Half, downwards: the companion sinks into the bottom of the screen with its
 * head still poking up, so it takes up less room while idle and reads as
 * peeking rather than floating in front of the desktop.
 */
export const HOME_TUCK = 0.5;

/**
 * How far the window may hang past the bottom edge of the work area.
 *
 * Exactly enough for the tucked home and no further, so a saved position from
 * an unplugged monitor is still dragged back into reach. The other three edges
 * never overhang: the companion peeks up out of the bottom, and a window
 * stranded sideways or above would have nothing left to grab.
 */
export const OVERHANG: Point = {
  x: 0,
  y: Math.round(CHARACTER.bottom + CHARACTER.height * HOME_TUCK),
};

/** Overhang for states that must stay wholly on screen, such as an open panel. */
export const NO_OVERHANG: Point = { x: 0, y: 0 };

/**
 * The companion's home: the bottom-right area, sunk half-way into the bottom
 * edge of the screen so only its head peeks up.
 *
 * This is the default on first run and the target of "Return to corner", so the
 * two can never drift apart.
 */
export function homePosition(workArea: Rect, size: Size): Point {
  return clampToWorkArea(
    {
      // Horizontally the companion stays wholly on screen, a margin in from the
      // right edge — only the vertical tuck hides anything.
      x: workArea.x + workArea.width - size.width + CHARACTER.right - EDGE_MARGIN,
      y: workArea.y + workArea.height - size.height + OVERHANG.y,
    },
    workArea,
    size,
  );
}

/**
 * Keep the window inside the work area, give or take a deliberate overhang.
 *
 * The overhang is what lets the companion tuck into the corner; everything
 * beyond it is clamped, so a window can never be stranded off screen. Pass
 * `NO_OVERHANG` for states where the whole window has to be readable.
 */
export function clampToWorkArea(
  position: Point,
  workArea: Rect,
  size: Size,
  overhang: Point = OVERHANG,
): Point {
  // A work area smaller than the window can't satisfy both edges; pin to the
  // top-left corner rather than emitting a negative range.
  const maxX = Math.max(workArea.x, workArea.x + workArea.width - size.width + overhang.x);
  const maxY = Math.max(workArea.y, workArea.y + workArea.height - size.height + overhang.y);
  return {
    x: Math.round(Math.min(Math.max(position.x, workArea.x), maxX)),
    y: Math.round(Math.min(Math.max(position.y, workArea.y), maxY)),
  };
}

/**
 * A drag in progress.
 *
 * The window origin is latched once, at press time, and every later move is
 * expressed as a total offset from the press point. The previous design sent
 * per-move deltas that the main process added to a freshly read window
 * position; because the window manager applies moves asynchronously, that read
 * was routinely stale and most of the motion was silently dropped (measured:
 * 100 moves of +2px produced +22px, not +200px). Absolute offsets are
 * idempotent, so a stale read costs nothing and repeated moves can never
 * compound or lose travel.
 */
export interface DragGesture {
  /** Pointer screen coordinates at press time. */
  readonly pointerX: number;
  readonly pointerY: number;
  /** Whether the pointer has travelled far enough to count as a drag. */
  moved: boolean;
}

export function beginDrag(pointerX: number, pointerY: number): DragGesture {
  return { pointerX, pointerY, moved: false };
}

/**
 * Advance a gesture to a new pointer position.
 *
 * Returns the total offset from the press point once the drag threshold has
 * been crossed, and `null` while the gesture still looks like a click. Holding
 * the window still below the threshold is what stops a shaky click from nudging
 * the companion out of its corner.
 */
export function trackDrag(
  gesture: DragGesture,
  pointerX: number,
  pointerY: number,
): Point | null {
  const dx = pointerX - gesture.pointerX;
  const dy = pointerY - gesture.pointerY;
  if (!gesture.moved && Math.abs(dx) + Math.abs(dy) <= DRAG_THRESHOLD_PX) return null;
  gesture.moved = true;
  return { x: dx, y: dy };
}

/** A gesture that never crossed the threshold is a click, not a drag. */
export function isClick(gesture: DragGesture): boolean {
  return !gesture.moved;
}
