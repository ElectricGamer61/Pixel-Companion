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

/** Gap kept between the window and the screen edges when it sits at home. */
export const EDGE_MARGIN = 24;

/** Pointer travel from the press point that turns a click into a drag. */
export const DRAG_THRESHOLD_PX = 4;

/**
 * The companion's home: tucked into the bottom-right of the work area.
 *
 * This is the default on first run and the target of "Return to corner", so the
 * two can never drift apart.
 */
export function homePosition(workArea: Rect, size: Size, margin = EDGE_MARGIN): Point {
  return clampToWorkArea(
    {
      x: workArea.x + workArea.width - size.width - margin,
      y: workArea.y + workArea.height - size.height - margin,
    },
    workArea,
    size,
  );
}

/**
 * Keep the whole window inside the work area.
 *
 * Clamping the *whole* window rather than just a sliver of it is deliberate: a
 * companion half off the screen reads as a broken blob, and a saved position
 * from an unplugged monitor would otherwise strand it out of reach.
 */
export function clampToWorkArea(position: Point, workArea: Rect, size: Size): Point {
  // A work area smaller than the window can't satisfy both edges; pin to the
  // top-left corner rather than emitting a negative range.
  const maxX = Math.max(workArea.x, workArea.x + workArea.width - size.width);
  const maxY = Math.max(workArea.y, workArea.y + workArea.height - size.height);
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
