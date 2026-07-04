import { describe, expect, it } from 'vitest';
import {
  bbox,
  createBlurCache,
  genId,
  getHandles,
  handleAt,
  normalizeRect,
  pruneBlurCache,
  resizeRect,
  translateAnnotation,
  type Annotation,
  type BlurCache,
} from '../../src/editor/annotations';

describe('normalizeRect', () => {
  it('leaves an already-normalized rect untouched', () => {
    expect(normalizeRect({ x: 0, y: 0, w: 10, h: 10 })).toEqual({ x: 0, y: 0, w: 10, h: 10 });
  });

  it('flips a negative rect to the same on-screen area', () => {
    expect(normalizeRect({ x: 10, y: 10, w: -10, h: -10 })).toEqual({ x: 0, y: 0, w: 10, h: 10 });
  });

  it('handles mixed signs', () => {
    expect(normalizeRect({ x: 5, y: 5, w: -3, h: -4 })).toEqual({ x: 2, y: 1, w: 3, h: 4 });
  });
});

describe('bbox', () => {
  const base = { stroke: '#f00', strokeWidth: 4, fill: null };

  it('normalizes a rect annotation', () => {
    const a: Annotation = { id: 'r', type: 'rect', x: 10, y: 10, w: -5, h: -3, ...base };
    expect(bbox(a)).toEqual({ x: 5, y: 7, w: 5, h: 3 });
  });

  it('bounds an arrow by its endpoints', () => {
    const a: Annotation = {
      id: 'a',
      type: 'arrow',
      x1: 10,
      y1: 10,
      x2: 30,
      y2: 40,
      stroke: '#f00',
      strokeWidth: 4,
    };
    expect(bbox(a)).toEqual({ x: 10, y: 10, w: 20, h: 30 });
  });

  it('bounds a pen stroke by its points', () => {
    const a: Annotation = {
      id: 'p',
      type: 'pen',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 20 },
        { x: 5, y: 30 },
      ],
      stroke: '#f00',
      strokeWidth: 4,
    };
    expect(bbox(a)).toEqual({ x: 0, y: 0, w: 10, h: 30 });
  });

  it('returns a zero rect for an empty pen stroke', () => {
    const a: Annotation = { id: 'p0', type: 'pen', points: [], stroke: '#f00', strokeWidth: 4 };
    expect(bbox(a)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  it('uses the measured size for text', () => {
    const a: Annotation = {
      id: 't',
      type: 'text',
      x: 5,
      y: 7,
      text: 'hi',
      fontSize: 28,
      color: '#f00',
      width: 100,
      height: 40,
    };
    expect(bbox(a)).toEqual({ x: 5, y: 7, w: 100, h: 40 });
  });

  it('normalizes a blur annotation', () => {
    const a: Annotation = { id: 'b', type: 'blur', x: 10, y: 10, w: -5, h: -3, strength: 8 };
    expect(bbox(a)).toEqual({ x: 5, y: 7, w: 5, h: 3 });
  });
});

describe('genId', () => {
  it('produces unique, non-empty ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => genId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id.length).toBeGreaterThan(0);
  });

  it('returns a UUID-shaped string when crypto.randomUUID is available', () => {
    // Node 20+ exposes crypto.randomUUID globally; if present, expect canonical form.
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      expect(genId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });
});

describe('pruneBlurCache', () => {
  function fakeCache(ids: string[]): BlurCache {
    const cache = createBlurCache();
    for (const id of ids) {
      cache.set(id, {
        tile: { width: 1 } as unknown as HTMLCanvasElement,
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        strength: 1,
      });
    }
    return cache;
  }

  it('drops entries whose id is not in the keep set', () => {
    const cache = fakeCache(['a', 'b', 'c']);
    pruneBlurCache(cache, new Set(['a', 'c']));
    expect([...cache.keys()].sort()).toEqual(['a', 'c']);
  });

  it('keeps everything when all ids are present', () => {
    const cache = fakeCache(['a', 'b']);
    pruneBlurCache(cache, new Set(['a', 'b']));
    expect(cache.size).toBe(2);
  });

  it('clears everything for an empty keep set', () => {
    const cache = fakeCache(['a', 'b']);
    pruneBlurCache(cache, new Set());
    expect(cache.size).toBe(0);
  });
});

describe('getHandles', () => {
  it('returns 8 handles for a rect', () => {
    const a: Annotation = {
      id: 'r',
      type: 'rect',
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      stroke: '#f00',
      strokeWidth: 4,
      fill: null,
    };
    expect(getHandles(a)).toHaveLength(8);
  });

  it('returns 2 handles for an arrow (start + end)', () => {
    const a: Annotation = {
      id: 'a',
      type: 'arrow',
      x1: 0,
      y1: 0,
      x2: 10,
      y2: 10,
      stroke: '#f00',
      strokeWidth: 4,
    };
    const hs = getHandles(a);
    expect(hs.map((h) => h.handle)).toEqual(['start', 'end']);
  });

  it('returns no handles for text or pen (move-only)', () => {
    const t: Annotation = {
      id: 't',
      type: 'text',
      x: 0,
      y: 0,
      text: 'hi',
      fontSize: 28,
      color: '#f00',
      width: 10,
      height: 10,
    };
    const p: Annotation = { id: 'p', type: 'pen', points: [], stroke: '#f00', strokeWidth: 4 };
    expect(getHandles(t)).toEqual([]);
    expect(getHandles(p)).toEqual([]);
  });
});

describe('handleAt', () => {
  const id = (x: number, y: number) => ({ x, y });
  const a: Annotation = {
    id: 'r',
    type: 'rect',
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    stroke: '#f00',
    strokeWidth: 4,
    fill: null,
  };
  it('finds the corner handle under a screen point', () => {
    expect(handleAt(a, id, 100, 100)).toBe('se');
    expect(handleAt(a, id, 0, 0)).toBe('nw');
  });

  it('returns null when no handle is near', () => {
    expect(handleAt(a, id, 50, 50)).toBeNull();
  });
});

describe('resizeRect', () => {
  const start = { x: 0, y: 0, w: 10, h: 10 };
  it('grows from the south-east handle', () => {
    expect(resizeRect(start, 'se', 5, 3)).toEqual({ x: 0, y: 0, w: 15, h: 13 });
  });
  it('shrinks from the north-west handle (opposite corner fixed)', () => {
    expect(resizeRect(start, 'nw', 2, 1)).toEqual({ x: 2, y: 1, w: 8, h: 9 });
  });
  it('moves only the right edge for the east handle', () => {
    expect(resizeRect(start, 'e', 4, 9)).toEqual({ x: 0, y: 0, w: 14, h: 10 });
  });
  it('normalizes when dragged past the opposite edge', () => {
    // Drag the east handle left past the west edge (dx < -w).
    expect(resizeRect(start, 'e', -20, 0)).toEqual({ x: -10, y: 0, w: 10, h: 10 });
  });
});

describe('translateAnnotation', () => {
  it('shifts a rect', () => {
    const a: Annotation = {
      id: 'r',
      type: 'rect',
      x: 1,
      y: 2,
      w: 3,
      h: 4,
      stroke: '#f00',
      strokeWidth: 4,
      fill: null,
    };
    expect(translateAnnotation(a, 10, 20)).toEqual({ ...a, x: 11, y: 22 });
  });
  it('shifts every pen point', () => {
    const a: Annotation = {
      id: 'p',
      type: 'pen',
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
      ],
      stroke: '#f00',
      strokeWidth: 4,
    };
    expect(translateAnnotation(a, 1, 1)).toEqual({
      ...a,
      points: [
        { x: 1, y: 1 },
        { x: 6, y: 6 },
      ],
    });
  });
  it('does not mutate the original', () => {
    const a: Annotation = {
      id: 'r',
      type: 'rect',
      x: 1,
      y: 2,
      w: 3,
      h: 4,
      stroke: '#f00',
      strokeWidth: 4,
      fill: null,
    };
    translateAnnotation(a, 10, 10);
    expect(a.x).toBe(1);
  });
});
