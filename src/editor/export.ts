/**
 * Image export helpers for the editor.
 *
 * The controller composites the image + annotations at full resolution
 * (composeFinal); this module handles format conversion + the download. PDF is
 * added in the next commit; this covers PNG/JPEG/WebP.
 */

export type ImageFormat = 'png' | 'jpeg' | 'webp';

export const IMAGE_FORMATS: { id: ImageFormat; label: string; hint: string }[] = [
  { id: 'png', label: 'PNG', hint: 'Lossless · transparency' },
  { id: 'jpeg', label: 'JPEG', hint: 'Smaller · no transparency' },
  { id: 'webp', label: 'WebP', hint: 'Modern · small + quality' },
];

/** Convert a canvas to a data URL for the given format. JPEG gets a white background. */
export function canvasToDataUrl(
  canvas: HTMLCanvasElement,
  format: ImageFormat,
  quality: number,
): string {
  if (format === 'png') return canvas.toDataURL('image/png');
  if (format === 'jpeg') {
    // JPEG has no alpha channel — paint a white background behind the image.
    const tmp = document.createElement('canvas');
    tmp.width = canvas.width;
    tmp.height = canvas.height;
    const ctx = tmp.getContext('2d');
    if (!ctx) return canvas.toDataURL('image/jpeg', quality);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, tmp.width, tmp.height);
    ctx.drawImage(canvas, 0, 0);
    return tmp.toDataURL('image/jpeg', quality);
  }
  return canvas.toDataURL('image/webp', quality);
}

/** Trigger a browser download of a data URL via the downloads API. */
export async function downloadDataUrl(dataUrl: string, filename: string): Promise<void> {
  await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
}

/** Append the right extension for a format. */
export function withExtension(base: string, format: ImageFormat): string {
  const ext = format === 'jpeg' ? 'jpg' : format;
  return `${base}.${ext}`;
}
