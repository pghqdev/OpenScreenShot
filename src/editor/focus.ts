/**
 * Tiny focus-management helpers for accessibility:
 *  - getFocusable: visible, enabled, tabbable descendants of a container.
 *  - trapFocus: keep Tab/Shift+Tab cycling within a container (for modals).
 *  - arrowNav: roving index arrow-key navigation for a role="toolbar" container.
 */

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isVisible);
}

function isVisible(el: HTMLElement): boolean {
  return el.getClientRects().length > 0;
}

/** Keep focus inside `container` on Tab; call from a keydown handler. */
export function trapFocus(container: HTMLElement, e: KeyboardEvent): void {
  if (e.key !== 'Tab') return;
  const f = getFocusable(container);
  if (f.length === 0) return;
  const first = f[0];
  const last = f[f.length - 1];
  const active = document.activeElement as HTMLElement | null;
  if (e.shiftKey) {
    if (active === first || !container.contains(active)) {
      e.preventDefault();
      last.focus();
    }
  } else {
    if (active === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

/**
 * Roving-index arrow-key navigation for a toolbar. Orientation is read from the
 * container's aria-orientation (default horizontal). Range inputs keep their own
 * arrow handling (to adjust the value), so they're skipped.
 */
export function arrowNav(container: HTMLElement, e: KeyboardEvent): void {
  const f = getFocusable(container);
  if (f.length === 0) return;
  const active = document.activeElement as HTMLElement | null;
  if (active && active.tagName === 'INPUT' && (active as HTMLInputElement).type === 'range') {
    return; // let the slider adjust
  }
  const vertical = container.getAttribute('aria-orientation') === 'vertical';
  const prevKey = vertical ? 'ArrowUp' : 'ArrowLeft';
  const nextKey = vertical ? 'ArrowDown' : 'ArrowRight';
  const idx = active ? f.indexOf(active) : -1;
  if (e.key === prevKey) {
    e.preventDefault();
    f[(idx - 1 + f.length) % f.length].focus();
  } else if (e.key === nextKey) {
    e.preventDefault();
    f[(idx + 1) % f.length].focus();
  } else if (e.key === 'Home') {
    e.preventDefault();
    f[0].focus();
  } else if (e.key === 'End') {
    e.preventDefault();
    f[f.length - 1].focus();
  }
}
