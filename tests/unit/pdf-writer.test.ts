import { describe, expect, it } from 'vitest';
import { buildPdf, encodeImage } from '../../src/editor/pdf-writer';

/** Minimal HTMLCanvasElement stand-in exposing what pdf-writer reads. */
function fakeCanvas(width: number, height: number, rgba: number[]): HTMLCanvasElement {
  const data = new Uint8ClampedArray(rgba);
  return {
    width,
    height,
    getContext: () => ({ getImageData: () => ({ data, width, height }) }),
  } as unknown as HTMLCanvasElement;
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate');
  const w = ds.writable.getWriter();
  void w.write(bytes);
  void w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

describe('encodeImage', () => {
  it('losslessly round-trips opaque RGB through FlateDecode', async () => {
    // 2x1: red, green (alpha 255)
    const c = fakeCanvas(2, 1, [255, 0, 0, 255, 0, 255, 0, 255]);
    const enc = await encodeImage(c);
    expect([enc.width, enc.height]).toEqual([2, 1]);
    expect(Array.from(await inflate(enc.data))).toEqual([255, 0, 0, 0, 255, 0]);
  });

  it('composites alpha onto white', async () => {
    // one black pixel at 50% alpha -> ~128 grey on white
    const c = fakeCanvas(1, 1, [0, 0, 0, 128]);
    const rgb = Array.from(await inflate((await encodeImage(c)).data));
    expect(rgb[0]).toBeGreaterThanOrEqual(126);
    expect(rgb[0]).toBeLessThanOrEqual(129);
  });
});

describe('buildPdf', () => {
  it('emits a structurally valid single-image PDF', async () => {
    const c = fakeCanvas(1, 1, [10, 20, 30, 255]);
    const blob = await buildPdf([
      { widthPt: 100, heightPt: 200, image: { canvas: c, xPt: 5, yPt: 5, wPt: 90, hPt: 190 } },
    ]);
    const text = new TextDecoder('latin1').decode(new Uint8Array(await blob.arrayBuffer()));
    expect(text.startsWith('%PDF-1.7')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('/Count 1');
    expect(text).toContain('/MediaBox [0 0 100 200]');
    expect(text).toContain('/Filter /FlateDecode');
    expect(text).toContain('startxref');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    // y flips: top-left yPt=5, hPt=190, page 200 -> cm ty = 200-5-190 = 5
    expect(text).toContain('90 0 0 190 5 5 cm');
  });

  it('assigns one page + xref entry per input page', async () => {
    const c = fakeCanvas(1, 1, [0, 0, 0, 255]);
    const page = { widthPt: 10, heightPt: 10, image: { canvas: c, xPt: 0, yPt: 0, wPt: 10, hPt: 10 } };
    const text = new TextDecoder('latin1').decode(
      new Uint8Array(await (await buildPdf([page, page])).arrayBuffer()),
    );
    expect(text).toContain('/Count 2');
    // 2 + 3*2 = 8 objects -> xref subsection header "0 9"
    expect(text).toContain('xref\n0 9\n');
  });
});
