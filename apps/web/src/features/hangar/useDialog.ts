import { useEffect, useRef } from "react";

/**
 * Turns an overlay into a real modal dialog: moves focus inside on open, traps
 * Tab within it, closes on Escape, and restores focus to whatever was focused
 * before it opened. Returns a ref for the dialog container (give it
 * `tabIndex={-1}` so the container itself is a valid focus fallback).
 *
 * `onClose` must be stable (wrap it in useCallback) — the effect depends on it.
 */
export function useDialog<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = (): HTMLElement[] =>
      Array.from(
        el.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((node) => node.offsetParent !== null);

    (focusable()[0] ?? el).focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        e.preventDefault();
        return;
      }
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Restore focus so keyboard users land back on the card they opened.
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return ref;
}
