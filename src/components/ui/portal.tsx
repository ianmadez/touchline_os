"use client";

import React, { useEffect } from "react";
import { createPortal } from "react-dom";

/**
 * Renders a dialog into the document body rather than where it was written.
 *
 * Learned the hard way, twice now: the surface a dialog is written inside carries a CSS animation, and an
 * animated (transformed) ancestor becomes the containing block for `position: fixed`. The dialog is therefore
 * placed relative to that surface instead of the viewport - which is what put one off the top of the screen
 * when the page was scrolled down, and what left another inset from the sides with a strip of page showing
 * around the blur. A portal takes the ancestor out of the question entirely.
 */
export function portal(node: React.ReactNode) {
  if (typeof document === "undefined") return null;
  return createPortal(node, document.body);
}

/**
 * Holds the page still underneath an open dialog.
 *
 * On the body rather than on a wrapper, because the scrollbar belongs to the document: a dialog that lets the
 * page behind it move is a dialog the reader can scroll away from, and closing it then lands them somewhere
 * else entirely. The previous value is restored on unmount, so nothing is left disabled when a dialog is
 * closed by a route change rather than by its own close button.
 *
 * `active` exists for the callers that render a dialog component unconditionally and let it return nothing:
 * a lock taken by a component that drew no dialog would leave the reader with a page that cannot scroll and
 * nothing on screen to explain it.
 */
export function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [active]);
}
