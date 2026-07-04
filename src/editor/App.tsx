import { useEffect, useRef, useState } from 'preact/hooks';
import { CanvasController } from './canvas';
import type { LastCapture, Settings } from '../shared/types';
import { getLastCapture, getSettings } from '../shared/storage';

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<CanvasController | null>(null);
  const [, setViewTick] = useState(0);
  const [capture, setCapture] = useState<LastCapture | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);

  // Create the controller + load the stashed capture on mount.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const c = new CanvasController(canvas);
    c.onViewChange = () => setViewTick((t) => t + 1);
    controllerRef.current = c;

    void (async () => {
      const s = await getSettings();
      applyTheme(s.theme);
      const cap = await getLastCapture();
      if (!cap) {
        setLoading(false);
        return;
      }
      setCapture(cap);
      const img = new Image();
      img.onload = () => {
        c.setImage(img);
        setLoading(false);
      };
      img.onerror = () => {
        setError('Could not load the screenshot.');
        setLoading(false);
      };
      img.src = cap.dataUrl;
    })();

    return () => {
      c.destroy();
      controllerRef.current = null;
    };
  }, []);

  // Spacebar = temporary pan (hand) modifier.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTypingTarget(e.target)) {
        e.preventDefault();
        setSpaceHeld(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceHeld(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // Pan via middle-mouse or space+drag. (Left-button interactions arrive with tools.)
  const dragRef = useRef<{ lastX: number; lastY: number } | null>(null);

  function onMouseDown(e: MouseEvent) {
    const isPan = e.button === 1 || (e.button === 0 && spaceHeld);
    if (!isPan) return;
    e.preventDefault();
    dragRef.current = { lastX: e.clientX, lastY: e.clientY };
    window.addEventListener('mousemove', onPanMove);
    window.addEventListener('mouseup', onPanUp);
  }
  function onPanMove(e: MouseEvent) {
    const d = dragRef.current;
    if (!d) return;
    const c = controllerRef.current;
    if (!c) return;
    c.panBy(e.clientX - d.lastX, e.clientY - d.lastY);
    d.lastX = e.clientX;
    d.lastY = e.clientY;
  }
  function onPanUp() {
    dragRef.current = null;
    window.removeEventListener('mousemove', onPanMove);
    window.removeEventListener('mouseup', onPanUp);
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const c = controllerRef.current;
    if (!c) return;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    c.zoomAt(factor, e.offsetX, e.offsetY);
  }

  // Attach a non-passive wheel listener so we can preventDefault (trackpad
  // pinch/scroll would otherwise fight the editor).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  function zoomButton(factor: number) {
    const c = controllerRef.current;
    const canvas = canvasRef.current;
    if (!c || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    c.zoomAt(factor, rect.width / 2, rect.height / 2);
  }

  const c = controllerRef.current;
  const zoomPct = c ? Math.round(c.view.zoom * 100) : 100;

  return (
    <div class="editor">
      <header class="topbar">
        <div class="topbar-brand">
          <span class="brand-mark" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          </span>
          <span class="brand-name">OpenScreenShot</span>
          {capture ? <span class="brand-mode">{labelForMode(capture.mode)}</span> : null}
        </div>
        <div class="topbar-controls">
          <div class="zoom-group" role="group" aria-label="Zoom">
            <button class="icon-btn" title="Zoom out" onClick={() => zoomButton(1 / 1.25)}>
              −
            </button>
            <span class="zoom-readout" aria-live="polite">{zoomPct}%</span>
            <button class="icon-btn" title="Zoom in" onClick={() => zoomButton(1.25)}>
              +
            </button>
            <button class="text-btn" title="Fit to screen" onClick={() => c?.fit()}>
              Fit
            </button>
            <button class="text-btn" title="Actual size (100%)" onClick={() => c?.resetZoom()}>
              100%
            </button>
          </div>
          <button class="btn-primary" disabled>
            Export
          </button>
        </div>
      </header>

      <div class="stage">
        <canvas
          ref={canvasRef}
          class="stage-canvas"
          data-cursor={spaceHeld ? 'grab' : undefined}
          onMouseDown={onMouseDown}
        />
        {loading ? (
          <div class="overlay-msg">
            <span class="spinner" aria-label="Loading" />
            <span>Loading screenshot…</span>
          </div>
        ) : null}
        {!loading && !capture && !error ? (
          <div class="overlay-msg">
            <div class="empty">
              <div class="empty-emoji" aria-hidden="true">🖼️</div>
              <h2>Nothing to edit yet</h2>
              <p>Use the OpenScreenShot popup to capture a page, then it opens here for editing.</p>
            </div>
          </div>
        ) : null}
        {error ? (
          <div class="overlay-msg">
            <div class="empty">
              <div class="empty-emoji" aria-hidden="true">⚠️</div>
              <h2>Something went wrong</h2>
              <p>{error}</p>
            </div>
          </div>
        ) : null}
      </div>

      <footer class="statusbar">
        <span>{capture ? `${capture.width} × ${capture.height}px` : '—'}</span>
        <span class="status-sep">·</span>
        <span>{zoomPct}%</span>
        <span class="status-spacer" />
        <span class="status-hint">Scroll to zoom · drag with middle button or Space to pan</span>
      </footer>
    </div>
  );
}

function labelForMode(mode: LastCapture['mode']): string {
  switch (mode) {
    case 'full-page':
      return 'Full Page';
    case 'visible':
      return 'Visible';
    case 'region':
      return 'Region';
  }
}

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

function applyTheme(theme: Settings['theme']): void {
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  const dark = theme === 'dark' || (theme === 'system' && prefersDark);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}