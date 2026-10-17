"use client";

import React, { useEffect, useId, useRef, useState } from "react";

import { portal } from "./portal";

/**
 * A small information control that works without a mouse.
 *
 * The app carried a lot of `title` attributes on labels and column headers. A native tooltip does
 * not exist on touch: tapping the element does nothing, so the explanation is simply unreachable.
 * This renders the same note behind a real button. A mouse opens it on hover, a tap toggles it, and
 * keyboard focus opens it too.
 *
 * The note is portalled and positioned inside the viewport. Left as an absolute child it was clipped
 * by table wrappers and, in one narrow form column, pushed the page 24px wider. It is anchored to the
 * button's screen rect and closes on scroll, because a fixed note over a moving target lies.
 */
export function Hint({
  label,
  children,
  className = "",
}: {
  /** What the note is about, used for the button's accessible name. */
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const id = useId();

  const place = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(224, window.innerWidth - 16);
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    const below = rect.bottom + 6;
    // The note is about 120px tall; above is used when below would run off the screen.
    const top = below + 120 > window.innerHeight ? Math.max(8, rect.top - 126) : below;
    setPosition({ top, left, width });
    setOpen(true);
  };

  const hide = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [open]);

  return (
    <span className={`relative inline-flex align-middle md:hidden ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        data-compact
        aria-label={`About ${label}`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (open) hide();
          else place();
        }}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") place();
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse") hide();
        }}
        onFocus={place}
        onBlur={hide}
        className="relative inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 text-[9px] font-bold leading-none text-slate-400 transition-colors after:absolute after:-inset-3.5 after:content-[''] hover:border-slate-400 hover:text-slate-600 dark:border-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
      >
        i
      </button>
      {open && position
        ? portal(
            <span
              id={id}
              role="tooltip"
              style={{ top: position.top, left: position.left, width: position.width }}
              className="fixed z-[80] block rounded-lg border border-slate-200 bg-white p-2.5 font-sans text-[11px] font-normal normal-case leading-relaxed tracking-normal text-slate-600 shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
            >
              {children}
            </span>
          )
        : null}
    </span>
  );
}
