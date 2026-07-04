/**
 * Annotation model + rendering for the editor.
 *
 * All annotation coordinates are in IMAGE pixels (the native resolution of the
 * captured screenshot), never screen pixels. The CanvasController applies the
 * zoom/pan transform before calling {@link drawAnnotation}, so the draw helpers
 * work in image space — which also makes export trivial (render at 1:1, no
 * transform). Coordinates may be signed during drafting (dragging up-left makes
 * w/h negative); {@link normalizeRect} fixes that for drawing and hit-testing.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

interface BaseAnnotation {
  id: string;
}

export interface RectAnnotation extends BaseAnnotation {
  type: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
  stroke: string;
  strokeWidth: number;
  fill: string | null;
}

export interface ArrowAnnotation extends BaseAnnotation {
  type: 'arrow';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  strokeWidth: number;
}

export interface PenAnnotation extends BaseAnnotation {
  type: 'pen';
  points: Point[];
  stroke: string;
  strokeWidth: number;
}

export interface TextAnnotation extends BaseAnnotation {
  type: 'text';
  x: number;
  y: number;
  text: string;
  fontSize: number;
  color: string;
  /** Measured pixel size, set when the text is committed (for hit-testing/bbox). */
  width: number;
  height: number;
}

export interface BlurAnnotation extends BaseAnnotation {
  type: 'blur';
  x: number;
  y: number;
  w: number;
  h: number;
  strength: number;
}

export type Annotation =
  | RectAnnotation
  | ArrowAnnotation
  | PenAnnotation
  | TextAnnotation
  | BlurAnnotation;

export type AnnotationType = Annotation['type'];

/** Default annotation styling (a vivid red reads well on most pages). */
export const DEFAULT_STROKE = '#ff3b30';
export const DEFAULT_STROKE_WIDTH = 6;
export const DEFAULT_FONT_SIZE = 28;
export const DEFAULT_BLUR_STRENGTH = 8;

const FONT_STACK = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";

/** Generate a unique annotation id. */
export function genId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Flip a rect so w/h are non-negative (keeps the same on-screen area). */
export function normalizeRect(r: Rect): Rect {
  return {
    x: Math.min(r.x, r.x + r.w),
    y: Math.min(r.y, r.y + r.h),
    w: Math.abs(r.w),
    h: Math.abs(r.h),
  };
}

/** Axis-aligned bounding box of an annotation, in image pixels. */
export function bbox(a: Annotation): Rect {
  switch (a.type) {
    case 'rect':
    case 'blur':
      return normalizeRect(a);
    case 'arrow':
      return {
        x: Math.min(a.x1, a.x2),
        y: Math.min(a.y1, a.y2),
        w: Math.abs(a.x2 - a.x1),
        h: Math.abs(a.y2 - a.y1),
      };
    case 'pen': {
      if (a.points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of a.points) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    case 'text':
      return { x: a.x, y: a.y, w: a.width, h: a.height };
  }
}

/** Measure rendered text (single or multi-line) for hit-testing & selection bbox. */
export function measureText(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontSize: number,
): { width: number; height: number } {
  ctx.font = `600 ${fontSize}px ${FONT_STACK}`;
  const lines = text.split('\n');
  const leading = fontSize * 1.25;
  let maxW = 0;
  for (const line of lines) maxW = Math.max(maxW, ctx.measureText(line).width);
  return { width: maxW, height: lines.length * leading };
}

/** A cached pixelated tile for a blur annotation, rebuilt when its region changes. */
interface BlurCacheEntry {
  tile: HTMLCanvasElement;
  x: number;
  y: number;
  w: number;
  h: number;
  strength: number;
}
export type BlurCache = Map<string, BlurCacheEntry>;

/** Create an empty blur cache (one per controller). */
export function createBlurCache(): BlurCache {
  return new Map();
}

/**
 * Draw a single annotation in image space. `ctx` is expected to already carry the
 * zoom/pan transform; each call is wrapped in save/restore by the controller so
 * helpers may freely mutate fill/stroke/dash/smoothing state.
 */
export function drawAnnotation(
  ctx: CanvasRenderingContext2D,
  a: Annotation,
  image: HTMLImageElement | HTMLCanvasElement,
  blurCache: BlurCache,
): void {
  switch (a.type) {
    case 'rect':
      drawRect(ctx, a);
      break;
    case 'arrow':
      drawArrow(ctx, a);
      break;
    case 'pen':
      drawPen(ctx, a);
      break;
    case 'text':
      drawText(ctx, a);
      break;
    case 'blur':
      drawBlur(ctx, a, image, blurCache);
      break;
  }
}

function drawRect(ctx: CanvasRenderingContext2D, a: RectAnnotation): void {
  const r = normalizeRect(a);
  if (r.w <= 0 || r.h <= 0) return;
  if (a.fill) {
    ctx.fillStyle = a.fill;
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
  ctx.lineWidth = a.strokeWidth;
  ctx.strokeStyle = a.stroke;
  ctx.strokeRect(r.x, r.y, r.w, r.h);
}

function drawArrow(ctx: CanvasRenderingContext2D, a: ArrowAnnotation): void {
  const dx = a.x2 - a.x1;
  const dy = a.y2 - a.y1;
  ctx.lineWidth = a.strokeWidth;
  ctx.strokeStyle = a.stroke;
  ctx.fillStyle = a.stroke;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(a.x1, a.y1);
  ctx.lineTo(a.x2, a.y2);
  ctx.stroke();
  const len = Math.hypot(dx, dy);
  if (len < 1) return; // too short to draw a head
  const head = Math.max(10, a.strokeWidth * 3);
  const angle = Math.atan2(dy, dx);
  ctx.beginPath();
  ctx.moveTo(a.x2, a.y2);
  ctx.lineTo(
    a.x2 - head * Math.cos(angle - Math.PI / 6),
    a.y2 - head * Math.sin(angle - Math.PI / 6),
  );
  ctx.lineTo(
    a.x2 - head * Math.cos(angle + Math.PI / 6),
    a.y2 - head * Math.sin(angle + Math.PI / 6),
  );
  ctx.closePath();
  ctx.fill();
}

function drawPen(ctx: CanvasRenderingContext2D, a: PenAnnotation): void {
  if (a.points.length === 0) return;
  ctx.lineWidth = a.strokeWidth;
  ctx.strokeStyle = a.stroke;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(a.points[0].x, a.points[0].y);
  for (let i = 1; i < a.points.length; i++) {
    ctx.lineTo(a.points[i].x, a.points[i].y);
  }
  if (a.points.length === 1) {
    // dot
    ctx.stroke();
  } else {
    ctx.stroke();
  }
}

function drawText(ctx: CanvasRenderingContext2D, a: TextAnnotation): void {
  if (!a.text) return;
  ctx.fillStyle = a.color;
  ctx.textBaseline = 'top';
  ctx.font = `600 ${a.fontSize}px ${FONT_STACK}`;
  const lines = a.text.split('\n');
  const leading = a.fontSize * 1.25;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], a.x, a.y + i * leading);
  }
}

function drawBlur(
  ctx: CanvasRenderingContext2D,
  a: BlurAnnotation,
  image: HTMLImageElement | HTMLCanvasElement,
  blurCache: BlurCache,
): void {
  const r = normalizeRect(a);
  if (r.w <= 0 || r.h <= 0) return;
  const tile = getBlurTile(a.id, r, a.strength, image, blurCache);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tile, r.x, r.y, r.w, r.h);
  // Smoothing is restored by the controller's save/restore wrapper.
}

function getBlurTile(
  id: string,
  r: Rect,
  strength: number,
  image: HTMLImageElement | HTMLCanvasElement,
  blurCache: BlurCache,
): HTMLCanvasElement {
  const entry = blurCache.get(id);
  if (
    entry &&
    entry.x === r.x &&
    entry.y === r.y &&
    entry.w === r.w &&
    entry.h === r.h &&
    entry.strength === strength
  ) {
    return entry.tile;
  }
  const tw = Math.max(1, Math.round(r.w / strength));
  const th = Math.max(1, Math.round(r.h / strength));
  const tile = document.createElement('canvas');
  tile.width = tw;
  tile.height = th;
  const tctx = tile.getContext('2d');
  if (tctx) tctx.drawImage(image, r.x, r.y, r.w, r.h, 0, 0, tw, th);
  blurCache.set(id, { tile, x: r.x, y: r.y, w: r.w, h: r.h, strength });
  return tile;
}

/** Remove cache entries for ids no longer present (call after annotation changes). */
export function pruneBlurCache(blurCache: BlurCache, ids: Set<string>): void {
  for (const key of blurCache.keys()) {
    if (!ids.has(key)) blurCache.delete(key);
  }
}

/**
 * Draw a crop preview: dim everything outside `r` and outline the kept region.
 * (Crop is a transient tool action, not a persistent annotation.)
 */
export function drawCropPreview(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  imageWidth: number,
  imageHeight: number,
): void {
  const n = normalizeRect(r);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, imageWidth, n.y);
  ctx.fillRect(0, n.y + n.h, imageWidth, imageHeight - (n.y + n.h));
  ctx.fillRect(0, n.y, n.x, n.h);
  ctx.fillRect(n.x + n.w, n.y, imageWidth - (n.x + n.w), n.h);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.strokeRect(n.x, n.y, n.w, n.h);
  ctx.setLineDash([]);
}