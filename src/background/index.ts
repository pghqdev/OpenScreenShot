/**
 * OpenScreenShot background service worker.
 *
 * Coordinates capture requests from the popup (and keyboard commands) and runs
 * them against the active tab using `activeTab` + `scripting` — no broad host
 * permissions. In-page work (measurement, scrolling, canvas compositing) is done
 * by injecting self-contained functions via `chrome.scripting.executeScript`;
 * the service worker itself only orchestrates and captures viewport tiles with
 * `chrome.tabs.captureVisibleTab`.
 */
import type {
  BackgroundMessage,
  CaptureMode,
  PopupMessage,
  TileSpec,
} from '../shared/types';
import { getSettings } from '../shared/storage';
import { formatFilename, isProtectedUrl } from '../shared/utils';
import { computeScrollPositions, MAX_CANVAS_HEIGHT_PX } from '../shared/geometry';
import {
  cropTile,
  getMetrics,
  prepareCapture,
  restoreCapture,
  scrollToPosition,
  stitchTiles,
} from '../content/scroll-capture';
import { selectRegion } from '../content/region-select';

/** Minimum gap between `captureVisibleTab` calls — Chrome throttles to ~2/sec. */
const CAPTURE_THROTTLE_MS = 500;
/** Time to let the page paint/composite after each scroll before capturing. */
const PAINT_SETTLE_MS = 60;

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[OpenScreenShot] installed — welcome card will show on first popup open.');
  }
});

chrome.commands.onCommand.addListener((command) => {
  const mode = commandToMode(command);
  if (mode) void handleCapture(mode).catch(onCaptureError);
});

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (isCaptureRequest(message)) {
    void handleCapture(message.mode).catch(onCaptureError);
  }
  return false; // synchronous: no async sendResponse
});

async function handleCapture(mode: CaptureMode): Promise<void> {
  const tab = await getActiveTab();
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
  switch (mode) {
    case 'visible':
      await captureVisible(tab);
      return;
    case 'full-page':
      await captureFullPage(tab);
      return;
    case 'region':
      await captureRegion(tab);
      return;
  }
}

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

/**
 * Inject a self-contained function into `tabId` and return its (awaited) result.
 * Throws if the injection produces no result.
 */
async function execInTab<A extends unknown[], R>(
  tabId: number,
  func: (...args: A) => R,
  args: A,
): Promise<Awaited<R>> {
  const results = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  const result = results?.[0]?.result;
  if (result === undefined) throw new Error('executeScript returned no result');
  return result as Awaited<R>;
}

/** Inject a fire-and-forget (void) function; its undefined result is ignored. */
async function runInTab<A extends unknown[]>(
  tabId: number,
  func: (...args: A) => unknown,
  args: A,
): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId }, func, args });
}

async function captureVisibleTabPng(windowId: number): Promise<string> {
  return chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
}

async function captureVisible(tab: chrome.tabs.Tab): Promise<void> {
  const tabId = tab.id as number;
  const metrics = await execInTab(tabId, getMetrics, []);
  const windowId = tab.windowId ?? chrome.windows.WINDOW_ID_CURRENT;
  const dataUrl = await captureVisibleTabPng(windowId);
  const width = Math.round(metrics.viewportWidth * metrics.devicePixelRatio);
  const height = Math.round(metrics.viewportHeight * metrics.devicePixelRatio);
  await download(dataUrl, 'png', width, height);
  broadcast({ type: 'CAPTURE_COMPLETE', imageUrl: dataUrl, width, height });
}

async function captureRegion(tab: chrome.tabs.Tab): Promise<void> {
  const tabId = tab.id as number;
  const metrics = await execInTab(tabId, getMetrics, []);
  const rect = await execInTab(tabId, selectRegion, []);
  if (!rect) return; // user pressed Esc — nothing to capture
  const windowId = tab.windowId ?? chrome.windows.WINDOW_ID_CURRENT;
  const tile = await captureVisibleTabPng(windowId);
  const dpr = metrics.devicePixelRatio;
  const x = Math.round(rect.x * dpr);
  const y = Math.round(rect.y * dpr);
  const w = Math.round(rect.width * dpr);
  const h = Math.round(rect.height * dpr);
  const dataUrl = await execInTab(tabId, cropTile, [tile, x, y, w, h]);
  await download(dataUrl, 'png', w, h);
  broadcast({ type: 'CAPTURE_COMPLETE', imageUrl: dataUrl, width: w, height: h });
}

async function captureFullPage(tab: chrome.tabs.Tab): Promise<void> {
  const tabId = tab.id as number;
  const metrics = await execInTab(tabId, getMetrics, []);
  if (metrics.viewportHeight <= 0 || metrics.scrollHeight <= 0) {
    broadcast({
      type: 'CAPTURE_ERROR',
      code: 'blank-page',
      message: "This page has no scrollable content.",
    });
    return;
  }
  const dpr = metrics.devicePixelRatio;
  const canvasHeight = Math.round(metrics.scrollHeight * dpr);
  if (canvasHeight > MAX_CANVAS_HEIGHT_PX) {
    broadcast({
      type: 'CAPTURE_ERROR',
      code: 'too-large',
      message: `This page is too tall to capture in one image (${canvasHeight}px). Try visible or region mode.`,
    });
    return;
  }

  const positions = computeScrollPositions(metrics.scrollHeight, metrics.viewportHeight);
  const windowId = tab.windowId ?? chrome.windows.WINDOW_ID_CURRENT;
  const canvasWidth = Math.round(metrics.viewportWidth * dpr);

  await runInTab(tabId, prepareCapture, []);
  const tiles: TileSpec[] = [];
  try {
    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      const { scrollY } = await execInTab(tabId, scrollToPosition, [pos]);
      await delay(PAINT_SETTLE_MS);
      const dataUrl = await captureVisibleTabPng(windowId);
      tiles.push({ dataUrl, y: Math.round(scrollY * dpr) });
      broadcast({
        type: 'CAPTURE_PROGRESS',
        percent: Math.round(((i + 1) / positions.length) * 100),
      });
      if (i < positions.length - 1) await delay(CAPTURE_THROTTLE_MS);
    }
  } finally {
    await runInTab(tabId, restoreCapture, []);
  }

  const dataUrl = await execInTab(tabId, stitchTiles, [tiles, canvasWidth, canvasHeight]);
  await download(dataUrl, 'png', canvasWidth, canvasHeight);
  broadcast({ type: 'CAPTURE_COMPLETE', imageUrl: dataUrl, width: canvasWidth, height: canvasHeight });
}

async function download(
  dataUrl: string,
  format: string,
  width: number,
  height: number,
): Promise<void> {
  const settings = await getSettings();
  const base = formatFilename(settings.filenameTemplate, { width, height });
  await chrome.downloads.download({
    url: dataUrl,
    filename: `${base}.${format}`,
    saveAs: false,
  });
}

function commandToMode(command: string): CaptureMode | null {
  switch (command) {
    case 'capture-full-page':
      return 'full-page';
    case 'capture-visible':
      return 'visible';
    case 'capture-region':
      return 'region';
    default:
      return null;
  }
}

function onCaptureError(err: unknown): void {
  console.error('[OpenScreenShot] capture failed', err);
  broadcast({ type: 'CAPTURE_ERROR', code: 'unknown', message: 'Capture failed unexpectedly.' });
}

function broadcast(msg: PopupMessage): void {
  // The popup may already be closed (e.g. region mode); ignore delivery failures.
  void chrome.runtime.sendMessage(msg).catch(() => {
    /* popup not listening */
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isCaptureRequest(m: unknown): m is BackgroundMessage {
  return (
    !!m &&
    typeof m === 'object' &&
    (m as { type?: string }).type === 'CAPTURE_REQUEST' &&
    'mode' in m
  );
}