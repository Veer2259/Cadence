"use client";

/**
 * The bottom sheet. Block detail, capture and chat all sit in one of these.
 *
 * Dismisses on backdrop tap and on Escape. While open the body cannot scroll,
 * so a flick inside the sheet does not drag the page underneath it. Focus moves
 * into the sheet on open and returns to whatever opened it on close, because a
 * sheet that traps nothing is unusable by keyboard and invisible to a screen
 * reader.
 */

import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";

export type SheetProps = {
  open: boolean;
  onClose: () => void;
  /** Announced as the sheet's name. Rendered unless `hideTitle`. */
  title: string;
  hideTitle?: boolean;
  /** Share of the viewport the sheet may occupy: block 72%, capture 82%, chat 86%. */
  maxHeight?: string;
  children: React.ReactNode;
  className?: string;
};

export function Sheet({
  open,
  onClose,
  title,
  hideTitle = false,
  maxHeight = "72%",
  children,
  className,
}: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    returnFocusTo.current = document.activeElement as HTMLElement | null;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);

    // The page behind must not scroll while a sheet is up.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Focus the panel itself rather than guessing at a first control — the
    // first thing in a chat sheet is a transcript, not an input.
    panelRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      returnFocusTo.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        aria-label={`Close ${title.toLowerCase()}`}
        onClick={onClose}
        className="animate-fade-in absolute inset-0 h-full w-full cursor-default"
        style={{ background: "rgba(42,36,25,.34)" }}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          "animate-sheet-up absolute right-0 bottom-0 left-0 flex flex-col bg-paper outline-none",
          className,
        )}
        style={{
          maxHeight,
          borderTopLeftRadius: "var(--radius-sheet)",
          borderTopRightRadius: "var(--radius-sheet)",
          boxShadow: "var(--shadow-sheet)",
        }}
      >
        <div className="flex shrink-0 justify-center pt-2.5 pb-1">
          <span
            aria-hidden
            className="block h-1 w-10 rounded-full"
            style={{ background: "#E2D9C8" }}
          />
        </div>

        {hideTitle ? null : (
          <h2 className="shrink-0 px-5 pt-1 pb-2 text-lg font-extrabold tracking-[-0.02em] text-ink">
            {title}
          </h2>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>
  );
}
