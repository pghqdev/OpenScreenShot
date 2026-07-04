/** Shared utility helpers used across the extension. */

/**
 * Resolve a filename template using the current date/time and capture context.
 *
 * Supported tokens:
 *   {date}  -> YYYY-MM-DD
 *   {time}  -> HHMMSS
 *   {title} -> sanitized page title (fallback: "screenshot")
 *   {w}     -> image width in px
 *   {h}     -> image height in px
 */
export function formatFilename(
  template: string,
  ctx: { title?: string; width: number; height: number },
): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const title = sanitizeFilename(ctx.title ?? 'screenshot').slice(0, 60) || 'screenshot';

  return template
    .replaceAll('{date}', date)
    .replaceAll('{time}', time)
    .replaceAll('{title}', title)
    .replaceAll('{w}', String(ctx.width))
    .replaceAll('{h}', String(ctx.height));
}

/** Strip characters that are invalid in download filenames across platforms. */
export function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim();
}

/** True for URLs the extension is not allowed to capture. */
export function isProtectedUrl(url: string | undefined): boolean {
  if (!url) return true;
  return (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('https://chrome.google.com/webstore') ||
    url.startsWith('about:')
  );
}
