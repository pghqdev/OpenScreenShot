import { describe, expect, it } from 'vitest';
import {
  bbox,
  createBlurCache,
  genId,
  normalizeRect,
  pruneBlurCache,
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
    const a: Annotation = { id: 'a', type: 'arrow', x1: 10, y1: 10, x2: 30, y2: 40, stroke: '#f00', strokeWidth: 4 };
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