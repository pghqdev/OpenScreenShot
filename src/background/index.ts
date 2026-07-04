/**
 * OpenScreenShot background service worker.
 *
 * Coordinates capture requests from the popup. In M1 only the "visible"
 * capture path is implemented (single-shot + download). Full-page
 * scroll-and-stitch and region selection arrive in M2.
 */
import type { BackgroundMessage, PopupMessage } from '../shared/types';
import { getSettings } from '../shared/storage';
import { formatFilename, isProtectedUrl } from '../shared/utils';

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // First install: onboarding flag already defaults to true in DEFAULT_SETTINGS.
    console.log('[OpenScreenShot] installed — welcome card will show on first popup open.');
  }
});

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (isCaptureRequest(message)) {
    void handleCapture(message).catch((err) => {
      console.error('[OpenScreenShot] capture failed', err);
      broadcast({
        type: 'CAPTURE_ERROR',
        code: 'unknown',
        message: 'Capture failed unexpectedly.',
      });
    });
  }
  return false; // synchronous: no async sendResponse
});

async function handleCapture(req: BackgroundMessage): Promise<void> {
  switch (req.mode) {
    case 'visible':
      await captureVisible();
      return;
    case 'full-page':
    case 'region':
      broadcast({
        type: 'CAPTURE_ERROR',
        code: 'not-implemented',
        message: 'Full-page and region capture arrive in M2.',
      });
      return;
  }
}

async function captureVisible(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) {
    broadcast({ type: 'CAPTURE_ERROR', code: 'unknown', message: 'No active tab found.' });
    return;
  }
  if (isProtectedUrl(tab.url)) {
    broadcast({
      type: 'CAPTURE_ERROR',
      code: 'protected-page',
      message: "Can't screenshot this protected page.",
    });
    return;
  }

  const windowId = tab.windowId ?? chrome.windows.WINDOW_ID_CURRENT;
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });

  const settings = await getSettings();
  const base = formatFilename(settings.filenameTemplate, { width: 0, height: 0 });
  await chrome.downloads.download({
    url: dataUrl,
    filename: `${base}.png`,
    saveAs: false,
  });

  broadcast({ type: 'CAPTURE_COMPLETE', imageUrl: dataUrl, width: 0, height: 0 });
}

function broadcast(msg: PopupMessage): void {
  // The popup may already be closed; ignore delivery failures.
  void chrome.runtime.sendMessage(msg).catch(() => {
    /* popup not listening */
  });
}

function isCaptureRequest(m: unknown): m is BackgroundMessage {
  return (
    !!m &&
    typeof m === 'object' &&
    (m as { type?: string }).type === 'CAPTURE_REQUEST' &&
    'mode' in m
  );
}
