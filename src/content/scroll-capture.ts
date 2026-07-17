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

/**
 * Measure the page so the background can plan the scroll loop + canvas size.
 *
 * When the document itself doesn't scroll (common in SPAs like Gmail, Claude,
 * Notion — the body is pinned and an inner element scrolls), find that element,
 * tag it `data-oss-scroller`, and report ITS geometry + viewport rect so the
 * capture loop scrolls it and crops each tile to it.
 */
export function getMetrics(): Metrics {
  const de = document.documentElement;
  const dpr = window.devicePixelRatio || 1;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const docScrolls = de.scrollHeight > vh + 4;

  let scroller: HTMLElement | null = null;
  if (!docScrolls) {
    // Pick the element with the most vertical overflow that also covers most of
    // the viewport — the dominant scroll region.
    // ponytail: linear DOM scan, fine for a one-shot capture; index by overflow if it ever matters.
    let bestOverflow = vh * 0.5; // must scroll at least half a viewport to qualify
    for (const el of document.querySelectorAll<HTMLElement>('*')) {
      const cs = getComputedStyle(el);
      if (cs.overflowY !== 'auto' && cs.overflowY !== 'scroll') continue;
      const overflow = el.scrollHeight - el.clientHeight;
      if (overflow <= bestOverflow) continue;
      const r = el.getBoundingClientRect();
      if (r.width < vw * 0.5 || r.height < vh * 0.5) continue;
      bestOverflow = overflow;
      scroller = el;
    }
  }

  if (scroller) {
    scroller.dataset.ossScroller = '1';
    const r = scroller.getBoundingClientRect();
    return {
      scrollHeight: scroller.scrollHeight,
      viewportHeight: scroller.clientHeight,
      viewportWidth: scroller.clientWidth,
      devicePixelRatio: dpr,
      container: { x: r.left, y: r.top, width: scroller.clientWidth, height: scroller.clientHeight },
    };
  }

  return {
    scrollHeight: de.scrollHeight,
    viewportHeight: vh,
    viewportWidth: vw,
    devicePixelRatio: dpr,
    container: null,
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
  const scroller = document.querySelector<HTMLElement>('[data-oss-scroller="1"]');
  scroller?.style.setProperty('scroll-behavior', 'auto', 'important');
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

/**
 * Scroll to `y` and report where we actually landed (may be clamped at the
 * bottom). Scrolls the tagged inner container if present, else the window.
 */
export function scrollToPosition(y: number): { scrollY: number; atBottom: boolean } {
  const scroller = document.querySelector<HTMLElement>('[data-oss-scroller="1"]');
  if (scroller) {
    scroller.scrollTop = y;
    const after = scroller.scrollTop;
    const max = scroller.scrollHeight - scroller.clientHeight;
    return { scrollY: after, atBottom: after >= max - 1 };
  }
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
  const scroller = document.querySelector<HTMLElement>('[data-oss-scroller="1"]');
  if (scroller) {
    scroller.style.removeProperty('scroll-behavior');
    delete scroller.dataset.ossScroller;
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
  crop: { x: number; y: number; w: number; h: number } | null,
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
    if (crop) {
      // Inner-container capture: take only the container's slice of the viewport.
      ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, tile.y, crop.w, crop.h);
    } else {
      ctx.drawImage(img, 0, tile.y, img.naturalWidth, img.naturalHeight);
    }
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
