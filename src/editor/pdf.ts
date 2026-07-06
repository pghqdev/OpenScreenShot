/**
 * PDF export. The controller composites the image + annotations at full
 * resolution (composeFinal); this module lays them out into a PDF using one of
 * three page-sizing strategies:
 *
 *  - "full": a single custom page matching the image's exact aspect ratio.
 *  - "a4"/"letter" single: the whole image fit onto one page, centered.
 *  - "a4"/"letter" multi-page: the image is sliced vertically into page-height
 *    tiles (with a small overlap so content isn't split mid-line) and each tile
 *    becomes its own page. Slicing keeps the PDF small (one image per page
 *    instead of embedding the full image on every page).
 */
import { buildPdf, type PdfPage } from './pdf-writer';

export interface PdfOptions {
  pageSize: 'a4' | 'letter' | 'full';
  orientation: 'portrait' | 'landscape';
  multiPage: boolean;
  marginMm: number;
}

const PAGE_SIZES_MM: Record<'a4' | 'letter', [number, number]> = {
  a4: [210, 297],
  letter: [215.9, 279.4],
};

const PX_TO_MM = 25.4 / 96;
const MM_TO_PT = 72 / 25.4;
const OVERLAP_MM = 5;

const pt = (mm: number) => mm * MM_TO_PT;

export async function exportPdf(
  canvas: HTMLCanvasElement,
  opts: PdfOptions,
  filename: string,
): Promise<void> {
  const imgW = canvas.width;
  const imgH = canvas.height;
  const imgWmm = imgW * PX_TO_MM;
  const imgHmm = imgH * PX_TO_MM;
  const pages: PdfPage[] = [];

  if (opts.pageSize === 'full') {
    pages.push({
      widthPt: pt(imgWmm),
      heightPt: pt(imgHmm),
      image: { canvas, xPt: 0, yPt: 0, wPt: pt(imgWmm), hPt: pt(imgHmm) },
    });
    await savePdf(pages, filename);
    return;
  }

  const [pw, ph] = PAGE_SIZES_MM[opts.pageSize];
  const landscape = opts.orientation === 'landscape';
  const pageWmm = landscape ? ph : pw;
  const pageHmm = landscape ? pw : ph;
  const margin = opts.marginMm;
  const contentW = pageWmm - margin * 2;
  const contentHmm = pageHmm - margin * 2;
  const fitScale = contentW / imgWmm; // drawn mm per source mm (fit to width)
  const mmPerPx = PX_TO_MM * fitScale; // drawn mm per source px
  const drawHmm = imgHmm * fitScale; // full image height when fit to width

  if (!opts.multiPage || drawHmm <= contentHmm) {
    // Single page: fit the whole image within the content area, centered.
    const s = Math.min(contentW / imgWmm, contentHmm / imgHmm);
    const w = imgWmm * s;
    const h = imgHmm * s;
    pages.push({
      widthPt: pt(pageWmm),
      heightPt: pt(pageHmm),
      image: {
        canvas,
        xPt: pt((pageWmm - w) / 2),
        yPt: pt((pageHmm - h) / 2),
        wPt: pt(w),
        hPt: pt(h),
      },
    });
    await savePdf(pages, filename);
    return;
  }

  // Multi-page: slice into page-height tiles with overlap.
  const contentHpx = contentHmm / mmPerPx;
  const overlapPx = OVERLAP_MM / mmPerPx;
  const stepPx = Math.max(1, contentHpx - overlapPx);
  const pageCount = Math.max(1, Math.ceil((imgH - overlapPx) / stepPx));
  for (let i = 0; i < pageCount; i++) {
    const srcY = Math.round(i * stepPx);
    if (srcY >= imgH) break;
    const srcH = Math.min(Math.round(contentHpx), imgH - srcY);
    if (srcH <= 0) break;
    const tile = sliceCanvas(canvas, 0, srcY, imgW, srcH);
    pages.push({
      widthPt: pt(pageWmm),
      heightPt: pt(pageHmm),
      image: {
        canvas: tile,
        xPt: pt(margin),
        yPt: pt(margin),
        wPt: pt(contentW),
        hPt: pt(srcH * mmPerPx),
      },
    });
  }
  await savePdf(pages, filename);
}

function sliceCanvas(
  src: HTMLCanvasElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = sw;
  c.height = sh;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
  return c;
}

async function savePdf(pages: PdfPage[], filename: string): Promise<void> {
  const blob = await buildPdf(pages);
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
  } finally {
    // Give the download time to start before revoking the blob URL.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}
