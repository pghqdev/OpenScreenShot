import { useEffect, useRef } from 'preact/hooks';
import { useEditor } from './useEditor';
import { TOOL_LIST, type Tool } from './tools';

export function App() {
  const ed = useEditor();
  const cursor = ed.spaceHeld
    ? 'grab'
    : ed.tool === 'text'
      ? 'text'
      : ed.tool === 'select'
        ? 'default'
        : 'crosshair';

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
          {ed.capture ? <span class="brand-mode">{labelForMode(ed.capture.mode)}</span> : null}
        </div>
        <div class="topbar-controls">
          <div class="zoom-group" role="group" aria-label="Zoom">
            <button class="icon-btn" title="Zoom out" onClick={ed.zoomOut} aria-label="Zoom out">
              −
            </button>
            <span class="zoom-readout" aria-live="polite">{ed.zoomPct}%</span>
            <button class="icon-btn" title="Zoom in" onClick={ed.zoomIn} aria-label="Zoom in">
              +
            </button>
            <button class="text-btn" title="Fit to screen" onClick={ed.fit}>
              Fit
            </button>
            <button class="text-btn" title="Actual size (100%)" onClick={ed.resetZoom}>
              100%
            </button>
          </div>
          <button class="btn-primary" disabled title="Export arrives next">
            Export
          </button>
        </div>
      </header>

      <div class="workspace">
        <aside class="toolbar" aria-label="Annotation tools">
          {TOOL_LIST.map((t) => (
            <button
              key={t.id}
              class={`tool-btn${ed.tool === t.id ? ' is-active' : ''}`}
              title={`${t.label} (${t.shortcut})`}
              aria-pressed={ed.tool === t.id}
              onClick={() => ed.setTool(t.id)}
            >
              <ToolIcon id={t.id} />
            </button>
          ))}
          <div class="toolbar-count" title="Annotations">{ed.annotations.length}</div>
        </aside>

        <div class="stage">
          <canvas
            ref={ed.canvasRef}
            class="stage-canvas"
            data-cursor={cursor}
            onMouseDown={ed.onCanvasMouseDown}
          />

          {ed.cropActive ? (
            <div class="crop-confirm">
              <span>Crop to selection</span>
              <button class="btn-primary btn-sm" onClick={ed.applyCrop}>
                Apply
              </button>
              <button class="text-btn" onClick={ed.cancelCrop}>
                Cancel
              </button>
            </div>
          ) : null}

          {ed.textEdit ? <TextOverlay ed={ed} /> : null}

          {ed.loading ? (
            <div class="overlay-msg">
              <span class="spinner" aria-label="Loading" />
              <span>Loading screenshot…</span>
            </div>
          ) : null}
          {!ed.loading && !ed.capture && !ed.error ? (
            <div class="overlay-msg">
              <div class="empty">
                <div class="empty-emoji" aria-hidden="true">🖼️</div>
                <h2>Nothing to edit yet</h2>
                <p>Use the OpenScreenShot popup to capture a page, then it opens here for editing.</p>
              </div>
            </div>
          ) : null}
          {ed.error ? (
            <div class="overlay-msg">
              <div class="empty">
                <div class="empty-emoji" aria-hidden="true">⚠️</div>
                <h2>Something went wrong</h2>
                <p>{ed.error}</p>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <footer class="statusbar">
        <span>{ed.imageSize ? `${ed.imageSize.w} × ${ed.imageSize.h}px` : '—'}</span>
        <span class="status-sep">·</span>
        <span>{ed.zoomPct}%</span>
        <span class="status-spacer" />
        <span class="status-hint">{hintForTool(ed.tool)}</span>
      </footer>
    </div>
  );
}

function TextOverlay({ ed }: { ed: ReturnType<typeof useEditor> }) {
  const id = ed.textEdit!.id;
  const pos = ed.textOverlayPos(id);
  const ann = ed.annotations.find((a) => a.id === id && a.type === 'text');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  if (!pos || !ann || ann.type !== 'text') return null;

  return (
    <textarea
      ref={ref}
      class="text-overlay"
      style={{
        left: `${pos.x}px`,
        top: `${pos.y}px`,
        fontSize: `${pos.fontSize}px`,
        lineHeight: 1.25,
        width: `${Math.max(60, pos.width + 12)}px`,
        height: `${Math.max(pos.fontSize * 1.4, pos.height + 4)}px`,
      }}
      value={ann.text}
      placeholder="Type…"
      onInput={(e) => ed.updateText(id, (e.target as HTMLTextAreaElement).value)}
      onBlur={() => ed.finishText(id)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        } else if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
    />
  );
}

function ToolIcon({ id }: { id: Tool }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 2,
    'stroke-linecap': 'round' as const,
    'stroke-linejoin': 'round' as const,
  };
  switch (id) {
    case 'select':
      return (
        <svg {...common}>
          <path d="M4 4l6 16 2-7 7-2z" />
        </svg>
      );
    case 'rect':
      return (
        <svg {...common}>
          <rect x="4" y="6" width="16" height="12" rx="2" />
        </svg>
      );
    case 'arrow':
      return (
        <svg {...common}>
          <path d="M4 20L20 4M20 4h-6M20 4v6" />
        </svg>
      );
    case 'pen':
      return (
        <svg {...common}>
          <path d="M16.5 3.5l4 4L7 21H3v-4z" />
        </svg>
      );
    case 'text':
      return (
        <svg {...common}>
          <path d="M5 5h14M12 5v14M9 19h6" />
        </svg>
      );
    case 'blur':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="7" stroke-dasharray="2 3" />
        </svg>
      );
    case 'crop':
      return (
        <svg {...common}>
          <path d="M6 2v14h14M2 6h14v14" />
        </svg>
      );
  }
}

function labelForMode(mode: 'full-page' | 'visible' | 'region'): string {
  switch (mode) {
    case 'full-page':
      return 'Full Page';
    case 'visible':
      return 'Visible';
    case 'region':
      return 'Region';
  }
}

function hintForTool(tool: Tool): string {
  switch (tool) {
    case 'rect':
      return 'Drag to draw a rectangle';
    case 'arrow':
      return 'Drag to draw an arrow';
    case 'pen':
      return 'Drag to draw freehand';
    case 'text':
      return 'Click to place text, then type';
    case 'blur':
      return 'Drag over an area to blur it';
    case 'crop':
      return 'Drag to select, then Apply to crop';
    case 'select':
      return 'Scroll to zoom · Space or middle-drag to pan';
  }
}