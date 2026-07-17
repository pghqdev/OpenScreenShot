/**
 * useEditor — the editor's state + interaction layer.
 *
 * Owns the CanvasController, the loaded capture, the annotation list, the active
 * tool, selection, and undo/redo history, plus all mouse/keyboard interactions
 * (drawing, selecting, moving, resizing, text, crop, pan/zoom). App.tsx is a
 * thin presentational consumer.
 *
 * History records annotation-list snapshots. Each mutating action snapshots the
 * pre-change list (one entry per action — a move/resize drag snapshots on first
 * motion, not per mousemove). Crop is destructive and clears history (the
 * pre-crop annotation coordinates are invalid for the cropped image).
 */
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { CanvasController } from './canvas';
import type { Annotation, Rect } from './annotations';
import {
  bbox,
  DEFAULT_STYLE,
  handleAt,
  measureTextSize,
  normalizeRect,
  resizeRect,
  translateAnnotation,
  type AnnotationStyle,
  type Handle,
} from './annotations';
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
import { getLastCapture, getSettings, setSettings } from '../shared/storage';
import { formatFilename } from '../shared/utils';
import { canvasToDataUrl, downloadDataUrl, withExtension, type ImageFormat } from './export';
import { exportPdf as exportPdfFile, type PdfOptions } from './pdf';

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
  | { kind: 'move'; id: string; lastX: number; lastY: number }
  | {
      kind: 'resize';
      id: string;
      handle: Handle;
      startBBox: Rect;
      startPt: { x: number; y: number };
      annType: 'rect' | 'blur' | 'arrow';
    }
  | null;

export function useEditor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<CanvasController | null>(null);

  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [tool, setTool] = useState<Tool>('select');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [past, setPast] = useState<Annotation[][]>([]);
  const [future, setFuture] = useState<Annotation[][]>([]);
  const [, setViewTick] = useState(0);
  const [capture, setCapture] = useState<LastCapture | null>(null);
  const [imageSize, setImageSize] = useState<{ w: number; h: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [textEdit, setTextEdit] = useState<{ id: string } | null>(null);
  const [cropActive, setCropActive] = useState(false);
  const [cropDraft, setCropDraft] = useState<Rect | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [settings, setSettingsState] = useState<Settings | null>(null);
  const [exporting, setExporting] = useState(false);
  const [style, setStyle] = useState<AnnotationStyle>(DEFAULT_STYLE);

  // Refs for use inside stable event handlers (avoid stale closures).
  const toolRef = useRef(tool);
  const spaceRef = useRef(false);
  const draftRef = useRef<Annotation | null>(null);
  const interactionRef = useRef<Interaction>(null);
  const cropDraftRef = useRef<Rect | null>(null);
  const annotationsRef = useRef(annotations);
  const selectedIdRef = useRef(selectedId);
  const pastRef = useRef(past);
  const futureRef = useRef(future);
  const dragSnapshottedRef = useRef(false);
  const styleRef = useRef(style);

  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);

  // Sync annotations to the controller + a ref for history/hit-testing.
  useEffect(() => {
    annotationsRef.current = annotations;
    controllerRef.current?.setAnnotations(annotations);
  }, [annotations]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
    controllerRef.current?.setSelected(selectedId);
  }, [selectedId]);

  useEffect(() => {
    styleRef.current = style;
  }, [style]);

  // Persist the annotation style so it's remembered across sessions.
  // Skip the very first run (the initial load from settings) to avoid a write.
  const styleLoadedRef = useRef(false);
  useEffect(() => {
    if (!styleLoadedRef.current) {
      styleLoadedRef.current = true;
      return;
    }
    void setSettings({
      annotationColor: style.color,
      annotationStrokeWidth: style.strokeWidth,
      annotationFontSize: style.fontSize,
    });
  }, [style]);

  // When a new annotation is selected, adopt its style in the style bar.
  useEffect(() => {
    const a = annotationsRef.current.find((x) => x.id === selectedId);
    if (!a) return;
    if (a.type === 'rect' || a.type === 'arrow' || a.type === 'pen') {
      setStyle((s) => ({ ...s, color: a.stroke, strokeWidth: a.strokeWidth }));
    } else if (a.type === 'text') {
      setStyle((s) => ({ ...s, color: a.color, fontSize: a.fontSize }));
    }
  }, [selectedId]);

  useEffect(() => {
    pastRef.current = past;
  }, [past]);
  useEffect(() => {
    futureRef.current = future;
  }, [future]);

  // --- History ---
  const commit = useCallback((updater: (prev: Annotation[]) => Annotation[]) => {
    setPast((p) => [...p, annotationsRef.current]);
    setFuture([]);
    setAnnotations(updater);
  }, []);

  const snapshot = useCallback(() => {
    setPast((p) => [...p, annotationsRef.current]);
    setFuture([]);
  }, []);

  const undo = useCallback(() => {
    if (pastRef.current.length === 0) return;
    const last = pastRef.current[pastRef.current.length - 1];
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [annotationsRef.current, ...f]);
    setAnnotations(last);
    setSelectedId(null);
  }, []);

  const redo = useCallback(() => {
    if (futureRef.current.length === 0) return;
    const next = futureRef.current[0];
    setFuture((f) => f.slice(1));
    setPast((p) => [...p, annotationsRef.current]);
    setAnnotations(next);
    setSelectedId(null);
  }, []);

  const deleteSelection = useCallback(() => {
    const id = selectedIdRef.current;
    if (!id) return;
    commit((prev) => prev.filter((x) => x.id !== id));
    setSelectedId(null);
  }, [commit]);

  // --- Style (color / stroke width / font size) ---
  const applyStyleToSelected = useCallback(
    (patch: (a: Annotation) => Annotation) => {
      const id = selectedIdRef.current;
      if (!id) return;
      commit((prev) => prev.map((a) => (a.id === id ? patch(a) : a)));
    },
    [commit],
  );

  const setStyleColor = useCallback(
    (color: string) => {
      setStyle((s) => ({ ...s, color }));
      applyStyleToSelected((a) =>
        a.type === 'text'
          ? { ...a, color }
          : a.type === 'rect' || a.type === 'arrow' || a.type === 'pen'
            ? { ...a, stroke: color }
            : a,
      );
    },
    [applyStyleToSelected],
  );

  const setStyleStrokeWidth = useCallback(
    (strokeWidth: number) => {
      setStyle((s) => ({ ...s, strokeWidth }));
      applyStyleToSelected((a) =>
        a.type === 'rect' || a.type === 'arrow' || a.type === 'pen' ? { ...a, strokeWidth } : a,
      );
    },
    [applyStyleToSelected],
  );

  const setStyleFontSize = useCallback(
    (fontSize: number) => {
      setStyle((s) => ({ ...s, fontSize }));
      applyStyleToSelected((a) =>
        a.type === 'text' ? { ...a, fontSize, ...measureTextSize(a.text, fontSize) } : a,
      );
    },
    [applyStyleToSelected],
  );

  // Create the controller + load the stashed capture on mount.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const c = new CanvasController(canvas);
    c.onViewChange = () => setViewTick((t) => t + 1);
    controllerRef.current = c;

    void (async () => {
      const s = await getSettings();
      setSettingsState(s);
      applyTheme(s.theme);
      setStyle({
        color: s.annotationColor,
        strokeWidth: s.annotationStrokeWidth,
        fontSize: s.annotationFontSize,
      });
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

  const cropActiveRef = useRef(false);
  useEffect(() => {
    cropActiveRef.current = cropActive;
  }, [cropActive]);

  // Space = temporary pan; tool shortcuts; undo/redo; delete; Esc.
  useEffect(() => {
    const isMod = (e: KeyboardEvent) => e.ctrlKey || e.metaKey;
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTypingTarget(e.target)) {
        e.preventDefault();
        spaceRef.current = true;
        setSpaceHeld(true);
        return;
      }
      if (isTypingTarget(e.target)) return;

      // Undo / redo.
      if (isMod(e) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (isMod(e) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        redo();
        return;
      }
      // Delete selected.
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIdRef.current) {
        e.preventDefault();
        deleteSelection();
        return;
      }
      // Escape: cancel crop, else deselect.
      if (e.key === 'Escape') {
        if (cropActiveRef.current) {
          cancelCrop();
          e.preventDefault();
        } else if (selectedIdRef.current) {
          setSelectedId(null);
          e.preventDefault();
        }
        return;
      }
      // Tool shortcuts.
      if (!isMod(e) && !e.altKey) {
        const t = TOOL_LIST.find((x) => x.shortcut === e.key.toUpperCase());
        if (t) {
          setTool(t.id);
          e.preventDefault();
        }
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
  }, [undo, redo, deleteSelection]);

  // --- Drag handlers (attached to window during a drag) ---
  const onDragMove = useCallback(
    (e: MouseEvent) => {
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
      if (it.kind === 'move') {
        if (!dragSnapshottedRef.current) {
          snapshot();
          dragSnapshottedRef.current = true;
        }
        const dx = p.x - it.lastX;
        const dy = p.y - it.lastY;
        it.lastX = p.x;
        it.lastY = p.y;
        const id = it.id;
        setAnnotations((prev) =>
          prev.map((a) => (a.id === id ? translateAnnotation(a, dx, dy) : a)),
        );
        return;
      }
      if (it.kind === 'resize') {
        if (!dragSnapshottedRef.current) {
          snapshot();
          dragSnapshottedRef.current = true;
        }
        const dx = p.x - it.startPt.x;
        const dy = p.y - it.startPt.y;
        const id = it.id;
        const handle = it.handle;
        const startBBox = it.startBBox;
        setAnnotations((prev) =>
          prev.map((a) => {
            if (a.id !== id) return a;
            if (a.type === 'rect' || a.type === 'blur') {
              const r = resizeRect(startBBox, handle, dx, dy);
              return { ...a, x: r.x, y: r.y, w: r.w, h: r.h };
            }
            if (a.type === 'arrow') {
              if (handle === 'start') return { ...a, x1: p.x, y1: p.y };
              return { ...a, x2: p.x, y2: p.y };
            }
            return a;
          }),
        );
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
    },
    [snapshot],
  );

  const onDragUp = useCallback(() => {
    const c = controllerRef.current;
    const it = interactionRef.current;
    window.removeEventListener('mousemove', onDragMove);
    window.removeEventListener('mouseup', onDragUp);
    interactionRef.current = null;
    dragSnapshottedRef.current = false;
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
        commit((prev) => [...prev, draft]);
      }
    }
    // move / resize: changes already applied during drag (one snapshot on first move).
  }, [onDragMove, commit]);

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

      if (t === 'select') {
        // Resize: handle hit on the currently selected annotation.
        const selId = selectedIdRef.current;
        if (selId) {
          const sel = annotationsRef.current.find((a) => a.id === selId) ?? null;
          if (sel && (sel.type === 'rect' || sel.type === 'blur' || sel.type === 'arrow')) {
            const h = handleAt(sel, (x, y) => c.toScreen(x, y), sx, sy);
            if (h) {
              interactionRef.current = {
                kind: 'resize',
                id: selId,
                handle: h,
                startBBox: bbox(sel),
                startPt: p,
                annType: sel.type,
              };
              window.addEventListener('mousemove', onDragMove);
              window.addEventListener('mouseup', onDragUp);
              return;
            }
          }
        }
        // Select + move: hit-test annotations topmost-first.
        const hit = hitTestAnnotation(c, annotationsRef.current, sx, sy);
        if (hit) {
          setSelectedId(hit);
          selectedIdRef.current = hit;
          interactionRef.current = { kind: 'move', id: hit, lastX: p.x, lastY: p.y };
          window.addEventListener('mousemove', onDragMove);
          window.addEventListener('mouseup', onDragUp);
        } else {
          setSelectedId(null);
          selectedIdRef.current = null;
        }
        return;
      }

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
      const draft = createShapeDraft(
        t as ShapeTool,
        p,
        styleRef.current.color,
        styleRef.current.strokeWidth,
      );
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
    const ann = createTextAnnotation(p, styleRef.current.color, styleRef.current.fontSize);
    commit((prev) => [...prev, ann]);
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
    setSelectedId(null);
    setPast([]);
    setFuture([]);
    cancelCrop();
  }, [cancelCrop]);

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

  const defaultFilename = useCallback(() => {
    const tmpl = settings?.filenameTemplate ?? 'screenshot_{date}_{time}';
    return formatFilename(tmpl, {
      width: imageSize?.w ?? 0,
      height: imageSize?.h ?? 0,
      title: capture?.title,
    });
  }, [settings, imageSize, capture]);

  const exportImage = useCallback(
    async (format: ImageFormat, quality: number, filenameBase: string) => {
      const c = controllerRef.current;
      if (!c || !c.image) return;
      setExporting(true);
      try {
        const canvas = c.composeFinal();
        const dataUrl = canvasToDataUrl(canvas, format, quality);
        await downloadDataUrl(dataUrl, withExtension(filenameBase, format));
      } finally {
        setExporting(false);
      }
    },
    [],
  );

  // Copy the composed image (with annotations) to the clipboard as PNG —
  // the only ClipboardItem image type reliably supported across browsers.
  const copyImage = useCallback(async () => {
    const c = controllerRef.current;
    if (!c || !c.image) return;
    const canvas = c.composeFinal();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Could not encode PNG');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }, []);

  const exportPdf = useCallback(async (opts: PdfOptions, filenameBase: string) => {
    const c = controllerRef.current;
    if (!c || !c.image) return;
    setExporting(true);
    try {
      const canvas = c.composeFinal();
      await exportPdfFile(canvas, opts, `${filenameBase}.pdf`);
    } finally {
      setExporting(false);
    }
  }, []);

  // Screen position (relative to canvas) + display size for the text overlay.
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
  const selectedAnnotation = selectedId
    ? (annotations.find((a) => a.id === selectedId) ?? null)
    : null;

  return {
    canvasRef,
    annotations,
    tool,
    setTool,
    selectedId,
    capture,
    imageSize,
    loading,
    error,
    textEdit,
    cropActive,
    cropDraft,
    spaceHeld,
    zoomPct,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    hasSelection: !!selectedId,
    selectedAnnotation,
    style,
    setStyleColor,
    setStyleStrokeWidth,
    setStyleFontSize,
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
    undo,
    redo,
    deleteSelection,
    exportImage,
    exportPdf,
    copyImage,
    defaultFilename,
    exporting,
    settings,
  };
}

/** Hit-test annotations topmost-first in screen space; returns an id or null. */
function hitTestAnnotation(
  c: CanvasController,
  anns: Annotation[],
  sx: number,
  sy: number,
): string | null {
  const tol = 6;
  for (let i = anns.length - 1; i >= 0; i--) {
    const b = bbox(anns[i]);
    const tl = c.toScreen(b.x, b.y);
    const br = c.toScreen(b.x + b.w, b.y + b.h);
    if (sx >= tl.x - tol && sx <= br.x + tol && sy >= tl.y - tol && sy <= br.y + tol) {
      return anns[i].id;
    }
  }
  return null;
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
