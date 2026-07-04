/**
 * Page-context functions injected on demand via `chrome.scripting.executeScript`.
 *
 * IMPORTANT: every exported function here must be FULLY SELF-CONTAINED. When
 * injected with `{ func }`, Chrome serializes the function via `toString()` and
 * discards its closure — so no references to module-scope bindings are allowed
 * (only the function's own parameters and page-context globals like `document`,
 * `window`, `Image`, `getComputedStyle`). Helper code is therefore nested inside
 * each function that needs it. The functions are bundled into the service worker
 * (as part of its import graph) but are only ever *stringified* there, never
 * executed — so referencing DOM globals is safe at the type level and harmless at
 * runtime.
 */
import type { Metrics, TileSpec } from '../shared/types';

/** Measure the page so the background can plan the scroll loop + canvas size. */
export function getMetrics(): Metrics {
  const de = document.documentElement;
  return {
    scrollHeight: de.scrollHeight,
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
    devicePixelRatio: window.devicePixelRatio || 1,
  };
}

/**
 * Disable smooth scrolling so capture scrolls are instant. Fixed/sticky
 * elements are NOT hidden here — the first tile is captured with them visible
 * (so a fixed header appears once at the top) and {@link hideFixedElements}
 * hides them for the remaining tiles.
 */
export function prepareCapture(): void {
  document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
}

/**
 * Hide fixed/sticky elements so they don't duplicate across tiles. Hidden
 * elements are tagged with a `data-oss-hidden` attribute so
 * {@link restoreCapture} can find them again.
 */
export function hideFixedElements(): void {
  const els = document.querySelectorAll('*');
  for (const el of els) {
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.position === 'sticky') {
      (el as HTMLElement).dataset.ossHidden = '1';
      (el as HTMLElement).style.setProperty('visibility', 'hidden', 'important');
    }
  }
}

/** Scroll to `y` and report where we actually landed (may be clamped at the bottom). */
export function scrollToPosition(y: number): { scrollY: number; atBottom: boolean } {
  window.scrollTo(0, y);
  const after = window.scrollY;
  const max = document.documentElement.scrollHeight - window.innerHeight;
  return { scrollY: after, atBottom: after >= max - 1 };
}

/** Restore the page to its pre-capture state. */
export function restoreCapture(): void {
  const hidden = document.querySelectorAll('[data-oss-hidden="1"]');
  for (const el of hidden) {
    (el as HTMLElement).style.removeProperty('visibility');
    delete (el as HTMLElement).dataset.ossHidden;
  }
  document.documentElement.style.removeProperty('scroll-behavior');
}

/**
 * Composite every tile onto a single canvas sized `width`×`height` (device px) and
 * return the result as a PNG data URL. Each tile is drawn at its vertical device
 * offset; overlapping tiles overwrite identical content, so no seams appear.
 */
export async function stitchTiles(
  tiles: TileSpec[],
  width: number,
  height: number,
): Promise<string> {
  const load = (src: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('tile load failed'));
      img.src = src;
    });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  for (const tile of tiles) {
    const img = await load(tile.dataUrl);
    ctx.drawImage(img, 0, tile.y, img.naturalWidth, img.naturalHeight);
  }
  return canvas.toDataURL('image/png');
}

/**
 * Crop a viewport capture (`dataUrl`, device px) to the given rectangle (device px)
 * and return the cropped PNG data URL. Used by region capture.
 */
export async function cropTile(
  dataUrl: string,
  x: number,
  y: number,
  w: number,
  h: number,
): Promise<string> {
  const load = (src: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('tile load failed'));
      img.src = src;
    });
  const img = await load(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.drawImage(img, x, y, w, h, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}
