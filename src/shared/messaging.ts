import type { BackgroundMessage, PopupMessage } from './types';

/** Send a capture request from the popup to the background service worker. */
export function sendToBackground(msg: BackgroundMessage): Promise<unknown> {
  return chrome.runtime.sendMessage(msg);
}

/**
 * Register a handler for messages from the background service worker
 * (progress, completion, errors). Returns an unsubscribe function.
 */
export function onPopupMessage(handler: (msg: PopupMessage) => void): () => void {
  const listener = (message: unknown) => {
    if (message && typeof message === 'object' && 'type' in message) {
      handler(message as PopupMessage);
    }
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

/** Register a handler for capture requests coming from the popup. */
export function onBackgroundMessage(handler: (msg: BackgroundMessage) => void): () => void {
  const listener = (message: unknown) => {
    if (message && typeof message === 'object' && 'type' in message) {
      handler(message as BackgroundMessage);
    }
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}