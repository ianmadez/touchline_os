"use client";

import { useEffect } from "react";

/**
 * Keeps the screen's fixed chrome glued to the bottom edge that is actually visible.
 *
 * ## What "floats up occasionally" is
 *
 * A `position: fixed` element is placed against the LAYOUT viewport, and on a phone that is not the
 * area the manager can see. Two things move the visible area without ever moving the layout one:
 *
 *   - the address bar, which slides away as the page scrolls and comes back on a scroll up, and
 *   - the software keyboard, which covers the lower half of the screen without shrinking the layout
 *     viewport on a browser that does not implement `interactive-widget`.
 *
 * In both cases `bottom: 0` still means "the bottom of the layout viewport", so the bar is drawn where
 * the manager cannot see it, or worse, halfway up the screen when the keyboard is open. It reads as a
 * bar that drifted off the bottom for no reason.
 *
 * `window.visualViewport` reports the part that IS visible, so the offset between the two is the
 * distance the bar has to move. It is published as a CSS custom property rather than set as an inline
 * style so the stylesheet stays the single place that decides the bar's appearance.
 *
 * ## Why the bar hides while the keyboard is open
 *
 * A tab bar pinned above a keyboard is a control nobody wants: it covers the form the manager is
 * typing into, and every tap risks losing the field. The bar slides out of the way instead, and the
 * layout does not move because the bar does not occupy any space in it.
 */

/** The visible area has to be smaller than the layout one by at least this much to be a keyboard. */
const KEYBOARD_FRACTION = 0.75;

export function useVisualViewportBar(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    let frame = 0;

    const apply = (): void => {
      frame = 0;
      const layoutHeight = window.innerHeight;
      const hidden = Math.max(0, layoutHeight - viewport.height - viewport.offsetTop);
      const root = document.documentElement;

      // A few pixels of difference is the address bar's own animation, not a keyboard.
      root.style.setProperty("--tl-visual-bottom", `${Math.round(hidden)}px`);
      const keyboard = viewport.height < layoutHeight * KEYBOARD_FRACTION;
      if (keyboard) root.dataset.keyboardOpen = "1";
      else delete root.dataset.keyboardOpen;
    };

    const schedule = (): void => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(apply);
    };

    apply();
    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    window.addEventListener("orientationchange", schedule);

    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
      window.removeEventListener("orientationchange", schedule);
      const root = document.documentElement;
      root.style.removeProperty("--tl-visual-bottom");
      delete root.dataset.keyboardOpen;
    };
  }, []);
}
