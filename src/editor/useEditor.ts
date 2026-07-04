/**
 * useEditor — the editor's state + interaction layer.
 *
 * Owns the CanvasController, the loaded capture, the annotation list, the active
 * tool, and all mouse/keyboard interactions (drawing, text, crop, pan/zoom).
 * App.tsx is a thin presentational consumer. Selection / move / resize / undo
 * arrive in a later commit; this hook covers creation tools for now.
 */
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { CanvasController } from './canvas';
import type { Annotation, Rect } from './annotations';
import { bbox, measureTextSize, normalizeRect, translateAnnotation } from './annotations';
import {
  createShapeDraft,
  createTextAnnotation,
  dist,
  extendDraft,
  shouldCommit,
  TOOL_LIST,
  type ShapeTool,
  type Tool,
} from './tools';
import type { LastCapture, Settings } from '../shared/types';
import { getLastCapture, getSettings } from '../shared/storage';

export interface TextOverlayPos {
  x: number;
  y: number;
  fontSize: number;
  width: number;
  height: number;
}

type Interaction =
  | { kind: 'pan'; lastX: number; lastY: number }
  | { kind: 'crop'; start: { x: number; y: number } }
  | { kind: 'shape' }
  | { kind: 'pen' }
  | null;

export function useEditor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<CanvasController | null>(null);

  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [tool, setTool] = useState<Tool>('select');
  const [, setViewTick] = useState(0);
  const [capture, setCapture] = useState<LastCapture | null>(null);
  const [imageSize, setImageSize] = useState<{ w: number; h: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [textEdit, setTextEdit] = useState<{ id: string } | null>(null);
  const [cropActive, setCropActive] = useState(false);
  const [cropDraft, setCropDraft] = useState<Rect | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);

  // Refs for use inside stable event handlers (avoid stale closures).
  const toolRef = useRef(tool);
  const spaceRef = useRef(false);
  const draftRef = useRef<Annotation | null>(null);
  const interactionRef = useRef<Interaction>(null);
  const cropDraftRef = useRef<Rect | null>(null);

  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);

  // Keep the controller's annotation list in sync with React state.
  useEffect(() => {
    controllerRef.current?.setAnnotations(annotations);
  }, [annotations]);

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
      setImageSize({ w: cap.width, h: cap.height });
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

  // Wheel zoom (non-passive so we can preventDefault trackpad scroll).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const c = controllerRef.current;
      if (!c) return;
      c.zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.offsetX, e.offsetY);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  // Space = temporary pan; tool shortcuts; Esc cancels crop.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTypingTarget(e.target)) {
        e.preventDefault();
        spaceRef.current = true;
        setSpaceHeld(true);
        return;
      }
      if (isTypingTarget(e.target)) return;
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const t = TOOL_LIST.find((x) => x.shortcut === e.key.toUpperCase());
        if (t) {
          setTool(t.id);
          e.preventDefault();
          return;
        }
      }
      if (e.key === 'Escape' && cropActiveRef.current) {
        cancelCrop();
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceRef.current = false;
        setSpaceHeld(false);
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // --- Drag handlers (attached to window during a drag) ---
  const onDragMove = useCallback((e: MouseEvent) => {
    const c = controllerRef.current;
    const it = interactionRef.current;
    if (!c || !it) return;
    const rect = c.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    if (it.kind === 'pan') {
      c.panBy(e.clientX - it.lastX, e.clientY - it.lastY);
      it.lastX = e.clientX;
      it.lastY = e.clientY;
      return;
    }
    const p = c.toImage(sx, sy);
    if (it.kind === 'crop') {
      const r: Rect = { x: it.start.x, y: it.start.y, w: p.x - it.start.x, h: p.y - it.start.y };
      cropDraftRef.current = r;
      c.setCropRect(r);
      return;
    }
    const draft = draftRef.current;
    if (!draft) return;
    if (it.kind === 'pen' && draft.type === 'pen') {
      const last = draft.points[draft.points.length - 1];
      if (last && dist(last, p) < 1.5) return; // throttle pen samples
    }
    extendDraft(draft, p);
    c.setDraft(draft);
  }, []);

  const onDragUp = useCallback(() => {
    const c = controllerRef.current;
    const it = interactionRef.current;
    window.removeEventListener('mousemove', onDragMove);
    window.removeEventListener('mouseup', onDragUp);
    interactionRef.current = null;
    if (!c || !it) return;
    if (it.kind === 'crop') {
      const r = cropDraftRef.current;
      if (r && Math.abs(r.w) > 2 && Math.abs(r.h) > 2) {
        cropDraftRef.current = r;
        setCropDraft(r);
        setCropActive(true);
        c.setCropRect(r);
      } else {
        cropDraftRef.current = null;
        c.setCropRect(null);
      }
      return;
    }
    if (it.kind === 'shape' || it.kind === 'pen') {
      const draft = draftRef.current;
      draftRef.current = null;
      c.setDraft(null);
      if (draft && shouldCommit(draft)) {
        setAnnotations((prev) => [...prev, draft]);
      }
    }
  }, [onDragMove]);

  const onCanvasMouseDown = useCallback(
    (e: MouseEvent) => {
      const c = controllerRef.current;
      if (!c || !c.image) return;
      const rect = c.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      // Middle button or Space+left = pan.
      if (e.button === 1 || (e.button === 0 && spaceRef.current)) {
        e.preventDefault();
        interactionRef.current = { kind: 'pan', lastX: e.clientX, lastY: e.clientY };
        window.addEventListener('mousemove', onDragMove);
        window.addEventListener('mouseup', onDragUp);
        return;
      }
      if (e.button !== 0) return;
      const p = c.toImage(sx, sy);
      const t = toolRef.current;
      if (t === 'select') return; // arrives with selection
      if (t === 'text') {
        startText(p);
        return;
      }
      if (t === 'crop') {
        cropDraftRef.current = { x: p.x, y: p.y, w: 0, h: 0 };
        c.setCropRect(cropDraftRef.current);
        interactionRef.current = { kind: 'crop', start: p };
        window.addEventListener('mousemove', onDragMove);
        window.addEventListener('mouseup', onDragUp);
        return;
      }
      // Shape tool (rect / arrow / pen / blur).
      const draft = createShapeDraft(t as ShapeTool, p);
      draftRef.current = draft;
      c.setDraft(draft);
      interactionRef.current = { kind: t === 'pen' ? 'pen' : 'shape' };
      window.addEventListener('mousemove', onDragMove);
      window.addEventListener('mouseup', onDragUp);
    },
    [onDragMove, onDragUp],
  );

  // --- Text ---
  function startText(p: { x: number; y: number }) {
    const ann = createTextAnnotation(p);
    setAnnotations((prev) => [...prev, ann]);
    setTextEdit({ id: ann.id });
  }

  const updateText = useCallback((id: string, text: string) => {
    setAnnotations((prev) =>
      prev.map((a) => {
        if (a.id !== id || a.type !== 'text') return a;
        const size = measureTextSize(text, a.fontSize);
        return { ...a, text, width: size.width, height: size.height };
      }),
    );
  }, []);

  const finishText = useCallback((id: string) => {
    setTextEdit(null);
    setAnnotations((prev) => {
      const a = prev.find((x) => x.id === id);
      if (a && a.type === 'text' && a.text.trim() === '') {
        return prev.filter((x) => x.id !== id);
      }
      return prev;
    });
  }, []);

  // --- Crop ---
  const cancelCrop = useCallback(() => {
    cropDraftRef.current = null;
    controllerRef.current?.setCropRect(null);
    setCropActive(false);
    setCropDraft(null);
  }, []);

  const applyCrop = useCallback(() => {
    const c = controllerRef.current;
    const r = cropDraftRef.current;
    if (!c || !c.image || !r) {
      cancelCrop();
      return;
    }
    const n = normalizeRect(r);
    if (n.w < 1 || n.h < 1) {
      cancelCrop();
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(n.w);
    canvas.height = Math.round(n.h);
    const cx = canvas.getContext('2d');
    if (!cx) {
      cancelCrop();
      return;
    }
    cx.drawImage(c.image, n.x, n.y, n.w, n.h, 0, 0, canvas.width, canvas.height);
    const img = new Image();
    img.onload = () => {
      c.setImage(img);
      setImageSize({ w: canvas.width, h: canvas.height });
    };
    img.src = canvas.toDataURL('image/png');
    const w = canvas.width;
    const h = canvas.height;
    setAnnotations((prev) =>
      prev
        .map((a) => translateAnnotation(a, -n.x, -n.y))
        .filter((a) => {
          const b = bbox(a);
          return b.x < w && b.y < h && b.x + b.w > 0 && b.y + b.h > 0;
        }),
    );
    cancelCrop();
  }, [cancelCrop]);

  // cropActive mirror for the keyboard handler (stable effect, no stale closure).
  const cropActiveRef = useRef(false);
  useEffect(() => {
    cropActiveRef.current = cropActive;
  }, [cropActive]);

  // --- Zoom controls ---
  const zoomAtCenter = useCallback((factor: number) => {
    const c = controllerRef.current;
    const canvas = canvasRef.current;
    if (!c || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    c.zoomAt(factor, rect.width / 2, rect.height / 2);
  }, []);

  const zoomIn = useCallback(() => zoomAtCenter(1.25), [zoomAtCenter]);
  const zoomOut = useCallback(() => zoomAtCenter(1 / 1.25), [zoomAtCenter]);
  const fit = useCallback(() => controllerRef.current?.fit(), []);
  const resetZoom = useCallback(() => controllerRef.current?.resetZoom(), []);

  // Screen position (relative to canvas) + display font size for the text overlay.
  const textOverlayPos = useCallback(
    (id: string): TextOverlayPos | null => {
      const c = controllerRef.current;
      if (!c) return null;
      const a = annotations.find((x) => x.id === id);
      if (!a || a.type !== 'text') return null;
      const s = c.toScreen(a.x, a.y);
      return {
        x: s.x,
        y: s.y,
        fontSize: a.fontSize * c.view.zoom,
        width: a.width * c.view.zoom,
        height: a.height * c.view.zoom,
      };
    },
    [annotations],
  );

  const c = controllerRef.current;
  const zoomPct = c ? Math.round(c.view.zoom * 100) : 100;

  return {
    canvasRef,
    controller: controllerRef,
    annotations,
    tool,
    setTool,
    capture,
    imageSize,
    loading,
    error,
    textEdit,
    cropActive,
    cropDraft,
    spaceHeld,
    zoomPct,
    zoomIn,
    zoomOut,
    fit,
    resetZoom,
    onCanvasMouseDown,
    updateText,
    finishText,
    applyCrop,
    cancelCrop,
    textOverlayPos,
  };
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