/**
 * Shared types for OpenScreenShot — message protocol, capture modes, and settings.
 * Imported by the popup, background service worker, and (later) the editor.
 */

/** The three capture modes offered in the popup. */
export type CaptureMode = 'full-page' | 'visible' | 'region';

// --- Popup → Background (capture requests) -------------------------------

export interface CaptureRequest {
  type: 'CAPTURE_REQUEST';
  mode: CaptureMode;
}

export type BackgroundMessage = CaptureRequest;

// --- Background → Popup (progress / result / error) ----------------------

export interface CaptureProgress {
  type: 'CAPTURE_PROGRESS';
  percent: number;
  message?: string;
}

export interface CaptureComplete {
  type: 'CAPTURE_COMPLETE';
  imageUrl: string;
  width: number;
  height: number;
}

export type CaptureErrorCode = 'protected-page' | 'blank-page' | 'too-large' | 'not-implemented' | 'unknown';

export interface CaptureError {
  type: 'CAPTURE_ERROR';
  code: CaptureErrorCode;
  message: string;
}

export type PopupMessage = CaptureProgress | CaptureComplete | CaptureError;

// --- Capture geometry (in-page measurement results) -----------------------

export interface Metrics {
  scrollHeight: number;
  viewportHeight: number;
  viewportWidth: number;
  devicePixelRatio: number;
}

/** A rectangle in CSS pixels (viewport-relative for region select). */
export interface PageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One captured viewport tile placed at vertical device-pixel offset `y`. */
export interface TileSpec {
  dataUrl: string;
  y: number;
}

/** The most recent capture, stashed in storage so the editor page can load it. */
export interface LastCapture {
  dataUrl: string;
  width: number;
  height: number;
  mode: CaptureMode;
  capturedAt: number;
}

// --- Settings --------------------------------------------------------------

export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'pdf';
export type ThemePreference = 'light' | 'dark' | 'system';

export interface Settings {
  defaultFormat: ExportFormat;
  theme: ThemePreference;
  // PDF defaults (used from M3 onward; stored now so settings are stable)
  pdfPageSize: 'a4' | 'letter' | 'full';
  pdfOrientation: 'portrait' | 'landscape';
  pdfMultiPage: boolean;
  pdfMarginMm: number;
  quality: number; // 0..1, JPEG/WebP/PDF quality
  filenameTemplate: string;
  showOnboarding: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  defaultFormat: 'png',
  theme: 'system',
  pdfPageSize: 'a4',
  pdfOrientation: 'portrait',
  pdfMultiPage: true,
  pdfMarginMm: 8,
  quality: 0.92,
  filenameTemplate: 'screenshot_{date}_{time}',
  showOnboarding: true,
};