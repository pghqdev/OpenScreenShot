/**
 * Pure geometry helpers for the capture engine. Unit-tested.
 */

/** Max canvas height in device pixels (Chrome's per-side canvas cap is ~32767; leave a margin). */
export const MAX_CANVAS_HEIGHT_PX = 32000;

/**
 * Compute the scroll positions (in CSS px, from the top of the page) at which to
 * capture a viewport-sized tile, so that every part of a `scrollHeight`-tall page
 * is covered exactly once (the final tile may overlap the previous one by design,
 * which is harmless because the content matches).
 *
 * - If the page fits in one viewport, returns `[0]`.
 * - Otherwise returns `[0, vh, 2vh, ..., scrollHeight - vh]`.
 */
export function computeScrollPositions(scrollHeight: number, viewportHeight: number): number[] {
  if (scrollHeight <= viewportHeight) return [0];
  const last = scrollHeight - viewportHeight;
  const positions: number[] = [];
  let y = 0;
  while (y < last) {
    positions.push(y);
    y += viewportHeight;
  }
  positions.push(last);
  return positions;
}
