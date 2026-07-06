/**
 * Minimal PDF writer — replaces jsPDF (386KB) for our one use case: laying
 * out raster screenshots onto pages. We only ever place images, so this emits
 * a bare PDF with one image XObject per page.
 *
 * Images are stored losslessly as raw DeviceRGB samples under /FlateDecode,
 * compressed with the browser-native CompressionStream (no zlib dependency).
 * Alpha is composited onto white, matching the opaque page background.
 *
 * PDF coordinates are points (1/72") with a bottom-left origin; callers pass
 * top-left placements and we flip the y-axis here.
 */
export interface PlacedImage {
  canvas: HTMLCanvasElement;
  xPt: number;
  yPt: number; // top-left origin; flipped internally
  wPt: number;
  hPt: number;
}

export interface PdfPage {
  widthPt: number;
  heightPt: number;
  image: PlacedImage;
}

const enc = new TextEncoder();

/** Trim a number to at most 4 decimals with no trailing zeros or exponent. */
function fmt(x: number): string {
  return x.toFixed(4).replace(/\.?0+$/, '') || '0';
}

/** zlib-wrap + deflate via the platform stream (PDF /FlateDecode == zlib). */
async function deflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  void writer.write(bytes);
  void writer.close();
  const buf = await new Response(cs.readable).arrayBuffer();
  return new Uint8Array(buf);
}

interface EncodedImage {
  width: number;
  height: number;
  data: Uint8Array<ArrayBuffer>;
}

/** Canvas → white-composited RGB → FlateDecode stream. Exported for tests. */
export async function encodeImage(canvas: HTMLCanvasElement): Promise<EncodedImage> {
  const { width, height } = canvas;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  const { data } = ctx.getImageData(0, 0, width, height);
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    const a = data[i + 3];
    if (a === 255) {
      rgb[j] = data[i];
      rgb[j + 1] = data[i + 1];
      rgb[j + 2] = data[i + 2];
    } else {
      const af = a / 255;
      const inv = 255 * (1 - af);
      rgb[j] = data[i] * af + inv;
      rgb[j + 1] = data[i + 1] * af + inv;
      rgb[j + 2] = data[i + 2] * af + inv;
    }
  }
  return { width, height, data: await deflate(rgb) };
}

class ByteBuffer {
  private parts: Uint8Array<ArrayBuffer>[] = [];
  len = 0;
  push(u8: Uint8Array<ArrayBuffer>): void {
    this.parts.push(u8);
    this.len += u8.length;
  }
  ascii(s: string): void {
    this.push(enc.encode(s));
  }
  concat(): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(this.len);
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
}

export async function buildPdf(pages: PdfPage[]): Promise<Blob> {
  const images = await Promise.all(pages.map((p) => encodeImage(p.image.canvas)));
  const objCount = 2 + pages.length * 3; // catalog + pages tree + (page, content, image) per page
  const offsets: number[] = new Array(objCount + 1).fill(0);
  const b = new ByteBuffer();

  b.ascii('%PDF-1.7\n');
  b.push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // binary marker

  const startObj = (num: number) => {
    offsets[num] = b.len;
  };

  startObj(1);
  b.ascii('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  startObj(2);
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  b.ascii(`2 0 obj\n<< /Type /Pages /Kids [ ${kids} ] /Count ${pages.length} >>\nendobj\n`);

  pages.forEach((p, i) => {
    const pageNum = 3 + i * 3;
    const contentNum = pageNum + 1;
    const imgNum = pageNum + 2;
    const img = images[i];
    const { image } = p;
    const yFlip = p.heightPt - image.yPt - image.hPt;
    const content =
      `q\n${fmt(image.wPt)} 0 0 ${fmt(image.hPt)} ${fmt(image.xPt)} ${fmt(yFlip)} cm\n` +
      `/Im0 Do\nQ\n`;
    const contentBytes = enc.encode(content);

    startObj(pageNum);
    b.ascii(
      `${pageNum} 0 obj\n<< /Type /Page /Parent 2 0 R ` +
        `/MediaBox [0 0 ${fmt(p.widthPt)} ${fmt(p.heightPt)}] ` +
        `/Resources << /XObject << /Im0 ${imgNum} 0 R >> >> ` +
        `/Contents ${contentNum} 0 R >>\nendobj\n`,
    );

    startObj(contentNum);
    b.ascii(`${contentNum} 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`);
    b.push(contentBytes);
    b.ascii('\nendstream\nendobj\n');

    startObj(imgNum);
    b.ascii(
      `${imgNum} 0 obj\n<< /Type /XObject /Subtype /Image ` +
        `/Width ${img.width} /Height ${img.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 ` +
        `/Filter /FlateDecode /Length ${img.data.length} >>\nstream\n`,
    );
    b.push(img.data);
    b.ascii('\nendstream\nendobj\n');
  });

  const xrefOff = b.len;
  b.ascii(`xref\n0 ${objCount + 1}\n0000000000 65535 f \n`);
  for (let i = 1; i <= objCount; i++) {
    b.ascii(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  b.ascii(
    `trailer\n<< /Size ${objCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOff}\n%%EOF\n`,
  );

  return new Blob([b.concat()], { type: 'application/pdf' });
}
