/**
 * Resolves a `data-tour` anchor to the copy of it that is actually on screen.
 *
 * The app now renders its tab buttons twice on a phone: once in the desktop strip (hidden by CSS
 * below 768px) and once in the bottom bar or the More sheet. `querySelector` returns the first
 * match, which is the hidden one, and a zero-sized anchor used to close a whole tour. Choosing the
 * first candidate that is laid out is what makes the duplicate harmless and lets a tour skip a step
 * whose control is not reachable at this width. It also covers anchors that genuinely disappear,
 * such as a panel replaced by an empty state.
 */
export interface TourAnchorRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function visibleTourAnchor(anchor: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const candidates = document.querySelectorAll<HTMLElement>(`[data-tour="${anchor}"]`);
  for (const candidate of candidates) {
    if (candidate.getClientRects().length === 0) continue;
    const rect = candidate.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return candidate;
  }
  return null;
}

export function tourAnchorRect(anchor: string): TourAnchorRect | null {
  const target = visibleTourAnchor(anchor);
  if (target === null) return null;
  const rect = target.getBoundingClientRect();
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}
