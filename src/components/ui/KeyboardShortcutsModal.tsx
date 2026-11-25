"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { X, Command } from "lucide-react";
import { FocusTrap } from "@/components/ui/FocusTrap";

export interface ShortcutItem {
  key: string;
  action: string;
  category?: "Actions" | "Navigation" | "General";
}

export interface KeyboardShortcutsModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  shortcuts?: ShortcutItem[];
}

export const DEFAULT_SHORTCUTS: ShortcutItem[] = [
  { key: "B", action: "Book seat", category: "Actions" },
  { key: "F", action: "Favorite", category: "Actions" },
  { key: "S", action: "Share", category: "Actions" },
  { key: "/", action: "Focus search", category: "Navigation" },
  { key: "Esc", action: "Close modals", category: "General" },
  { key: "?", action: "Show keyboard shortcuts", category: "General" },
];

function isEditableElement(element: EventTarget | null): boolean {
  if (!element || !(element instanceof HTMLElement)) return false;
  const tagName = element.tagName.toLowerCase();
  if (tagName === "input" || tagName === "textarea" || tagName === "select") {
    return true;
  }
  return element.isContentEditable || element.getAttribute("contenteditable") === "true";
}

export function KeyboardShortcutsModal({
  isOpen: controlledIsOpen,
  onClose: controlledOnClose,
  shortcuts = DEFAULT_SHORTCUTS,
}: KeyboardShortcutsModalProps = {}) {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const isControlled = controlledIsOpen !== undefined;
  const isOpen = isControlled ? controlledIsOpen : internalIsOpen;

  const handleClose = useCallback(() => {
    if (!isControlled) {
      setInternalIsOpen(false);
    }
    controlledOnClose?.();
  }, [isControlled, controlledOnClose]);

  // Direct focus management to complement useFocusTrap
  useEffect(() => {
    if (!isOpen) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => {
      previouslyFocusedRef.current?.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // 1. If modal is currently open, Escape closes it
      if (isOpen && event.key === "Escape") {
        event.preventDefault();
        handleClose();
        return;
      }

      // 2. Ignore modifier combinations (Ctrl, Alt, Meta)
      if (event.ctrlKey || event.altKey || event.metaKey) {
        return;
      }

      // 3. Ignore typing in interactive text inputs
      if (
        isEditableElement(event.target) ||
        isEditableElement(document.activeElement)
      ) {
        return;
      }

      // 4. Trigger on '?' (Shift + / or direct '?')
      if (event.key === "?" || (event.key === "/" && event.shiftKey)) {
        event.preventDefault();
        if (!isControlled) {
          setInternalIsOpen((prev) => !prev);
        } else if (!isOpen) {
          // If controlled and closed, notify parent if supported or toggled
          // Note: In controlled mode, isOpen is driven by props
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, isControlled, handleClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleClose();
        }
      }}
      data-testid="keyboard-shortcuts-backdrop"
    >
      <FocusTrap
        role="dialog"
        aria-modal="true"
        aria-labelledby="keyboard-shortcuts-modal-title"
        aria-describedby="keyboard-shortcuts-modal-description"
        onEscape={handleClose}
        initialFocusRef={closeButtonRef}
        returnFocus={true}
        className="relative w-full max-w-lg p-6 bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 outline-none"
      >
        <button
          ref={closeButtonRef}
          type="button"
          onClick={handleClose}
          aria-label="Close keyboard shortcuts"
          className="absolute top-4 right-4 p-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>

        <div className="flex items-center gap-3 mb-2">
          <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
            <Command className="w-6 h-6" aria-hidden="true" />
          </div>
          <div>
            <h2
              id="keyboard-shortcuts-modal-title"
              className="text-xl font-bold text-zinc-900 dark:text-zinc-100"
            >
              Keyboard Shortcuts
            </h2>
            <p
              id="keyboard-shortcuts-modal-description"
              className="text-xs text-zinc-500 dark:text-zinc-400"
            >
              Hotkeys to navigate and perform actions across WorkSphere
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-2.5 max-h-[60vh] overflow-y-auto pr-1">
          {shortcuts.map((shortcut) => (
            <div
              key={`${shortcut.key}-${shortcut.action}`}
              className="flex items-center justify-between p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800 hover:border-zinc-200 dark:hover:border-zinc-700 transition-colors"
            >
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {shortcut.action}
              </span>
              <kbd className="inline-flex items-center justify-center min-w-[28px] h-7 px-2.5 text-xs font-mono font-bold text-zinc-800 dark:text-zinc-200 bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded-md shadow-sm">
                {shortcut.key}
              </kbd>
            </div>
          ))}
        </div>
      </FocusTrap>
    </div>
  );
}

export default KeyboardShortcutsModal;
