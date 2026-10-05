"use client";

import { useEffect, useRef, useState } from "react";
import { X, Command } from "lucide-react";
import { usePlatformModifier } from "@/hooks/usePlatformModifier";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function KeyboardShortcutsModal() {
  const [isOpen, setIsOpen] = useState(false);
  const { formatShortcut } = usePlatformModifier();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const shortcuts = [
    { key: formatShortcut("K"), description: "Global Search" },
    { key: formatShortcut("/"), description: "Toggle AI Chatbot" },
    { key: formatShortcut("Shift+H"), description: "Toggle High-Contrast Mode" },
    { key: "?", description: "Show Keyboard Shortcuts" },
    { key: "Esc", description: "Close Modals" },
    { key: "M", description: "Toggle Map View" },
  ];

  useEffect(() => {
    // Keep Tab / Shift+Tab inside the dialog while it is open.
    const trapFocus = (e: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusable.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (!dialog.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isOpen) {
        if (e.key === "Escape") {
          setIsOpen(false);
          return;
        }
        if (e.key === "Tab") {
          trapFocus(e);
          return;
        }
      }

      // Ignore if user is typing in an input, textarea, or contenteditable
      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return;
      }

      // Check for ? or Shift+/
      if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  // Move focus into the dialog on open, and give it back on close.
  useEffect(() => {
    if (!isOpen) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => {
      previouslyFocusedRef.current?.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) setIsOpen(false);
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="keyboard-shortcuts-title"
        tabIndex={-1}
        className="relative w-full max-w-md p-6 bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 animate-in fade-in zoom-in duration-200 outline-none"
      >
        <button
          ref={closeButtonRef}
          type="button"
          onClick={() => setIsOpen(false)}
          aria-label="Close keyboard shortcuts"
          className="absolute top-4 right-4 p-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 outline-none"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
            <Command className="w-6 h-6" aria-hidden="true" />
          </div>
          <h2
            id="keyboard-shortcuts-title"
            className="text-xl font-bold text-zinc-900 dark:text-zinc-100"
          >
            Keyboard Shortcuts
          </h2>
        </div>

        <div className="space-y-2">
          {shortcuts.map((shortcut) => (
            <div
              key={shortcut.key}
              className="flex items-center justify-between p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800"
            >
              <span className="text-zinc-600 dark:text-zinc-400 font-medium">
                {shortcut.description}
              </span>
              <kbd className="px-2.5 py-1 text-sm font-semibold text-zinc-800 dark:text-zinc-200 bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded-md shadow-sm">
                {shortcut.key}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
