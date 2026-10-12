"use client";

import React, { useEffect, useRef } from "react";
import { X, Keyboard } from "lucide-react";

interface ShortcutItem {
  name: string;
  keys: string[];
  description: string;
}

const SHORTCUTS: ShortcutItem[] = [
  { name: "Pen", keys: ["P"], description: "Activate freehand pen tool" },
  { name: "Eraser", keys: ["E"], description: "Activate eraser tool" },
  { name: "Sticky Note", keys: ["N"], description: "Place collaborative sticky note" },
  { name: "Pan Canvas", keys: ["Space", "+", "Drag"], description: "Pan and navigate across whiteboard" },
  { name: "Undo", keys: ["Ctrl", "+", "Z"], description: "Undo last stroke or action" },
];

export interface KeyboardShortcutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function KeyboardShortcutModal({
  isOpen,
  onClose,
}: KeyboardShortcutModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Lock body scroll when modal is open to prevent backdrop scrolling and canvas panning/zooming (#5595)
  useEffect(() => {
    if (!isOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    // Focus close button on open
    closeButtonRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      // Simple focus trap
      if (e.key === "Tab" && modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcut-modal-title"
      data-testid="keyboard-shortcut-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
              <Keyboard className="h-5 w-5" />
            </div>
            <div>
              <h2
                id="shortcut-modal-title"
                className="text-base font-semibold text-white"
              >
                Keyboard Shortcuts
              </h2>
              <p className="text-xs text-zinc-400">
                Whiteboard hotkeys & navigation
              </p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close shortcuts modal"
            className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {SHORTCUTS.map((item) => (
            <div
              key={item.name}
              className="flex items-center justify-between rounded-xl bg-zinc-800/50 p-2.5 transition-colors hover:bg-zinc-800"
            >
              <div>
                <span className="text-sm font-medium text-zinc-200">
                  {item.name}
                </span>
                <p className="text-xs text-zinc-400">{item.description}</p>
              </div>
              <div className="flex items-center gap-1">
                {item.keys.map((k, idx) =>
                  k === "+" ? (
                    <span key={idx} className="text-xs text-zinc-500">
                      +
                    </span>
                  ) : (
                    <kbd
                      key={idx}
                      className="inline-flex min-w-[24px] items-center justify-center rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs font-semibold text-zinc-300 shadow-sm"
                    >
                      {k}
                    </kbd>
                  ),
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex justify-between items-center text-xs text-zinc-500">
          <span>Press <kbd className="rounded border border-zinc-700 px-1.5 py-0.5 font-mono text-zinc-400">?</kbd> anytime to toggle</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-zinc-800 px-3 py-1.5 font-medium text-zinc-300 hover:bg-zinc-700 hover:text-white"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
