/**
 * On-demand region selection overlay, injected via `chrome.scripting.executeScript`.
 * Like {@link ../content/scroll-capture}, this function must be fully self-contained
 * (no module-scope references): Chrome serializes it via `toString()` and drops its
 * closure, so everything it needs is either a parameter or a page-context global.
 *
 * UX: a dimmed mask covers the page; the user click-drags to draw a selection
 * rectangle (clear cutout, dashed border, live W×H readout). After drawing, the
 * rectangle can be moved (drag inside it) or resized (drag a corner handle) and
 * nudged with arrow keys (Shift = ×10). Esc cancels, Enter confirms. The function
 * resolves with the selection in viewport CSS pixels, or `null` if cancelled.
 */
import type { PageRect } from '../shared/types';

export function selectRegion(): Promise<PageRect | null> {
  return new Promise((resolve) => {
    const doc = document;
    const VW = window.innerWidth;
    const VH = window.innerHeight;

    type Rect = { x: number; y: number; w: number; h: number };
    type Pt = { x: number; y: number };
    let rect: Rect | null = null;
    let mode: 'create' | 'move' | 'resize' | null = null;
    let handle: 'nw' | 'ne' | 'sw' | 'se' | null = null;
    let start: Pt = { x: 0, y: 0 };
    let origin: Rect = { x: 0, y: 0, w: 0, h: 0 };
    let done = false;

    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

    // Root container holds the mask, an interaction layer, handles and the readout.
    const root = doc.createElement('div');
    root.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';

    // The selection itself: transparent interior + giant outward box-shadow that
    // dims everything outside the rectangle (the "cutout" effect).
    const mask = doc.createElement('div');
    mask.style.cssText =
      'position:absolute;box-shadow:0 0 0 9999px rgba(0,0,0,0.4);border:2px dashed #2f80ed;' +
      'box-sizing:border-box;pointer-events:none;';
    root.appendChild(mask);

    // Transparent interaction layer catches all mouse events on the page area.
    const layer = doc.createElement('div');
    layer.style.cssText =
      'position:absolute;inset:0;cursor:crosshair;pointer-events:auto;';
    root.appendChild(layer);

    const readout = doc.createElement('div');
    readout.style.cssText =
      'position:absolute;background:rgba(17,17,17,0.85);color:#fff;font:600 12px/1.4 ' +
      'system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:3px 7px;border-radius:5px;' +
      'pointer-events:none;white-space:nowrap;';
    root.appendChild(readout);

    type HandleEl = { el: HTMLElement; corner: 'nw' | 'ne' | 'sw' | 'se' };
    const handles: HandleEl[] = [];
    for (const corner of ['nw', 'ne', 'sw', 'se'] as const) {
      const el = doc.createElement('div');
      const cursor =
        corner === 'nw' || corner === 'se' ? 'nwse-resize' : 'nesw-resize';
      el.style.cssText =
        `position:absolute;width:13px;height:13px;background:#fff;border:2px solid #2f80ed;` +
        `border-radius:50%;pointer-events:auto;cursor:${cursor};box-sizing:border-box;`;
      handles.push({ el, corner });
      root.appendChild(el);
    }

    doc.body.appendChild(root);

    const finish = (result: PageRect | null) => {
      if (done) return;
      done = true;
      doc.removeEventListener('keydown', onKeyDown, true);
      doc.removeEventListener('mousemove', onMove, true);
      doc.removeEventListener('mouseup', onUp, true);
      root.remove();
      resolve(result);
    };

    const render = () => {
      if (!rect) {
        mask.style.display = 'none';
        readout.style.display = 'none';
        for (const h of handles) h.el.style.display = 'none';
        return;
      }
      const { x, y, w, h } = rect;
      mask.style.display = 'block';
      mask.style.left = `${x}px`;
      mask.style.top = `${y}px`;
      mask.style.width = `${w}px`;
      mask.style.height = `${h}px`;
      const placeHandle = (hEl: HTMLElement, corner: 'nw' | 'ne' | 'sw' | 'se') => {
        hEl.style.display = 'block';
        hEl.style.left = `${x + (corner === 'ne' || corner === 'se' ? w : -6)}px`;
        hEl.style.top = `${y + (corner === 'sw' || corner === 'se' ? h : -6)}px`;
      };
      for (const h of handles) placeHandle(h.el, h.corner);
      readout.style.display = 'block';
      readout.textContent = `${Math.round(w)} × ${Math.round(h)}`;
      const rx = clamp(x, 0, VW - 80);
      const ry = y - 26 < 0 ? y + h + 6 : y - 26;
      readout.style.left = `${rx}px`;
      readout.style.top = `${ry}px`;
    };

    const setRect = (x: number, y: number, w: number, h: number) => {
      const nx = clamp(w >= 0 ? x : x + w, 0, VW);
      const ny = clamp(h >= 0 ? y : y + h, 0, VH);
      const nw = Math.min(Math.abs(w), VW - nx);
      const nh = Math.min(Math.abs(h), VH - ny);
      rect = { x: nx, y: ny, w: nw, h: nh };
      render();
    };

    const inRect = (p: Pt) =>
      rect !== null &&
        p.x >= rect.x && p.x <= rect.x + rect.w &&
        p.y >= rect.y && p.y <= rect.y + rect.h;

    const onDown = (e: MouseEvent) => {
      const p = { x: e.clientX, y: e.clientY };
      const target = e.target as HTMLElement;
      const hit = handles.find((h) => h.el === target);
      if (hit) {
        mode = 'resize';
        handle = hit.corner;
      } else if (rect && inRect(p)) {
        mode = 'move';
      } else {
        mode = 'create';
        setRect(p.x, p.y, 0, 0);
      }
      start = p;
      origin = rect ? { ...rect } : { x: p.x, y: p.y, w: 0, h: 0 };
      e.preventDefault();
    };

    const onMove = (e: MouseEvent) => {
      if (!mode) return;
      const p = { x: e.clientX, y: e.clientY };
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      if (mode === 'create') {
        setRect(origin.x, origin.y, p.x - origin.x, p.y - origin.y);
      } else if (mode === 'move' && rect) {
        const w = rect.w;
        const h = rect.h;
        const x = clamp(origin.x + dx, 0, VW - w);
        const y = clamp(origin.y + dy, 0, VH - h);
        rect = { x, y, w, h };
        render();
      } else if (mode === 'resize' && handle && rect) {
        const o = origin;
        let x = o.x;
        let y = o.y;
        let w = o.w;
        let h = o.h;
        if (handle === 'nw' || handle === 'ne') {
          y = clamp(o.y + dy, 0, o.y + o.h - 1);
          h = o.y + o.h - y;
        } else {
          h = clamp(p.y - o.y, 1, VH - o.y);
        }
        if (handle === 'nw' || handle === 'sw') {
          x = clamp(o.x + dx, 0, o.x + o.w - 1);
          w = o.x + o.w - x;
        } else {
          w = clamp(p.x - o.x, 1, VW - o.x);
        }
        rect = { x, y, w, h };
        render();
      }
      e.preventDefault();
    };

    const onUp = () => {
      mode = null;
      handle = null;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(null);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (rect && rect.w >= 2 && rect.h >= 2) {
          finish({ x: rect.x, y: rect.y, width: rect.w, height: rect.h });
        }
        return;
      }
      if (!rect) return;
      const step = e.shiftKey ? 10 : 1;
      let handled = true;
      const { w, h } = rect;
      let { x, y } = rect;
      if (e.key === 'ArrowLeft') x = clamp(x - step, 0, VW - w);
      else if (e.key === 'ArrowRight') x = clamp(x + step, 0, VW - w);
      else if (e.key === 'ArrowUp') y = clamp(y - step, 0, VH - h);
      else if (e.key === 'ArrowDown') y = clamp(y + step, 0, VH - h);
      else handled = false;
      if (handled) {
        e.preventDefault();
        rect = { x, y, w, h };
        render();
      }
    };

    layer.addEventListener('mousedown', onDown);
    for (const h of handles) h.el.addEventListener('mousedown', onDown);
    doc.addEventListener('mousemove', onMove, true);
    doc.addEventListener('mouseup', onUp, true);
    doc.addEventListener('keydown', onKeyDown, true);
    // Prevent the page from scrolling while the user picks a region.
    const blockScroll = (e: Event) => e.preventDefault();
    root.addEventListener('wheel', blockScroll, { passive: false });
    root.addEventListener('touchmove', blockScroll, { passive: false });
  });
}