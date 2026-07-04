/**
 * Tool metadata + shape-drafting helpers for the editor.
 *
 * The hook (useEditor) drives interactions; this module holds the pure pieces:
 * the tool list for the toolbar and the create/extend/commit logic for
 * drag-to-draw shape tools. Pen, rect, arrow and blur are "shape" tools that
 * draft then commit; text and crop are special-cased in the hook.
 */
import {
  DEFAULT_BLUR_STRENGTH,
  genId,
  type Annotation,
  type Point,
  type TextAnnotation,
} from './annotations';

export type Tool = 'select' | 'rect' | 'arrow' | 'pen' | 'text' | 'blur' | 'crop';

export type ShapeTool = 'rect' | 'arrow' | 'pen' | 'blur';

export interface ToolDef {
  id: Tool;
  label: string;
  shortcut: string;
}

export const TOOL_LIST: ToolDef[] = [
  { id: 'select', label: 'Select', shortcut: 'V' },
  { id: 'rect', label: 'Rectangle', shortcut: 'R' },
  { id: 'arrow', label: 'Arrow', shortcut: 'A' },
  { id: 'pen', label: 'Pen', shortcut: 'P' },
  { id: 'text', label: 'Text', shortcut: 'T' },
  { id: 'blur', label: 'Blur', shortcut: 'B' },
  { id: 'crop', label: 'Crop', shortcut: 'C' },
];

/** Create a fresh draft annotation for a shape tool at point `p`. */
export function createShapeDraft(
  tool: ShapeTool,
  p: Point,
  stroke: string,
  strokeWidth: number,
): Annotation {
  const id = genId();
  switch (tool) {
    case 'rect':
      return {
        id,
        type: 'rect',
        x: p.x,
        y: p.y,
        w: 0,
        h: 0,
        stroke,
        strokeWidth,
        fill: null,
      };
    case 'arrow':
      return {
        id,
        type: 'arrow',
        x1: p.x,
        y1: p.y,
        x2: p.x,
        y2: p.y,
        stroke,
        strokeWidth,
      };
    case 'pen':
      return {
        id,
        type: 'pen',
        points: [p],
        stroke,
        strokeWidth,
      };
    case 'blur':
      return { id, type: 'blur', x: p.x, y: p.y, w: 0, h: 0, strength: DEFAULT_BLUR_STRENGTH };
  }
}

/** Mutate `draft` in place to follow point `p` (the controller re-renders after). */
export function extendDraft(draft: Annotation, p: Point): void {
  switch (draft.type) {
    case 'rect':
    case 'blur':
      draft.w = p.x - draft.x;
      draft.h = p.y - draft.y;
      break;
    case 'arrow':
      draft.x2 = p.x;
      draft.y2 = p.y;
      break;
    case 'pen':
      draft.points.push(p);
      break;
    case 'text':
      break;
  }
}

/** Whether a drafted annotation is large enough to keep on mouse-up. */
export function shouldCommit(draft: Annotation): boolean {
  switch (draft.type) {
    case 'rect':
    case 'blur':
      return Math.abs(draft.w) > 2 && Math.abs(draft.h) > 2;
    case 'arrow':
      return Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) > 3;
    case 'pen':
      return draft.points.length >= 2;
    case 'text':
      return false;
  }
}

/** Create an empty text annotation placed at `p` (edited via the overlay). */
export function createTextAnnotation(p: Point, color: string, fontSize: number): TextAnnotation {
  return {
    id: genId(),
    type: 'text',
    x: p.x,
    y: p.y,
    text: '',
    fontSize,
    color,
    width: 0,
    height: 0,
  };
}

/** Distance between two points. */
export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
